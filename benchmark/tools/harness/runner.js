import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnWorker, ProtocolError, WorkerCrash, WorkerTimeout } from './worker.js'
import { datasetDir } from '../layout.js'
import { assertionFor } from '../checkfile.js'
import { countCsvRows } from './csv-count.js'
import { statsOf } from './stats.js'

// The hook answered a command with {"ok":false,...}: the engine attempted the
// work and reported failure. The worker stays alive (benchmark-hook-format).
class HookError extends Error {}

// A failure of the run as a whole (e.g. the hook does not declare the requested
// scenario) — never recorded as a per-case status.
class SuiteError extends Error {}

const PHASES = { preloaded_repeated: ['execute', 'extract'], end_to_end: ['load', 'execute', 'extract'] }

function countNdjsonLines(path) {
  const txt = readFileSync(path, 'utf8')
  return txt.split('\n').filter((l) => l.trim().length > 0).length
}

// Dataset resource counts for report traceability. Advisory, never able to void
// completed cases (the partial-run guarantee): a missing file degrades to {}.
function observeResourceCounts(dataDir, resources) {
  try {
    const counts = {}
    for (const r of resources) counts[r] = countNdjsonLines(join(dataDir, `${r}.ndjson`))
    return counts
  } catch {
    return {}
  }
}

// The work-verification guard (benchmark-reference-runner): the compared count
// is the harness's own CSV-derived count. present+match => ok verified;
// present+mismatch => count_mismatch unless variance-permitted; absent => ok
// UNVERIFIED (the report's `verified` flag distinguishes the two).
function verdictFor({ outputRows, expected, variancePermitted }) {
  if (expected == null) return { status: 'ok' }
  if (outputRows === expected || variancePermitted) return { status: 'ok', verified: true }
  return { status: 'count_mismatch', verified: true }
}

function failureStatus(err) {
  if (err instanceof WorkerTimeout) return 'timeout'
  return 'execution_error' // WorkerCrash, ProtocolError, HookError: best-effort default
}

async function sendChecked(worker, cmd, timeoutMs) {
  const resp = await worker.send(cmd, { timeoutMs })
  if (!resp.ok) throw new HookError(resp.error || 'hook reported failure')
  return resp
}

// Run one benchmark suite at one size against one hook, per the
// benchmark-harness capability: the harness owns the worker lifecycle, the
// measurement loop, the wall clock, verification, and report assembly.
export async function runSuite({
  benchmark,
  size,
  dataRoot,
  manifest,
  checkfile = null,
  scenario = 'preloaded_repeated',
  inactivityMs = 300_000,
  caseFilter,
}) {
  const dataDir = datasetDir(dataRoot, benchmark.dataset.name, benchmark.dataset.version, size)
  const { warmup = 1, measurement = 5 } = benchmark.iterations || {}
  const cases = caseFilter ? benchmark.cases.filter(caseFilter) : benchmark.cases
  const workDir = mkdtempSync(join(tmpdir(), 'sof-harness-'))

  const ctx = { manifest, scenario, dataDir, resources: benchmark.dataset.resources, inactivityMs }
  const resourceCounts = observeResourceCounts(dataDir, benchmark.dataset.resources)

  let results
  try {
    const loop = scenario === 'end_to_end' ? runCaseEndToEnd : runCasePreloaded
    const state = { worker: null }
    results = []
    for (const c of cases) {
      const outCsv = join(workDir, `${c.id}.csv`)
      // Per-case failure isolation: each case runs under its own boundary and is
      // recorded with its own status; a failure never aborts the run.
      let entry
      try {
        entry = await loop({ ctx, state, c, outCsv, warmup, measurement })
      } catch (err) {
        if (err instanceof SuiteError) throw err
        // An untrusted or dead worker is discarded; the next case respawns.
        if (!(err instanceof HookError)) {
          state.worker?.kill()
          state.worker = null
        }
        entry = { id: c.id, status: failureStatus(err), message: String(err?.message ?? err) }
      }
      results.push(entry)
    }
    await state.worker?.shutdown()
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  const finished = results.map((entry) => {
    if (entry.samplesMs == null) return entry
    const { expected, variancePermitted, ...rest } = entry
    const verdict = verdictFor(entry)
    return { ...rest, ...verdict, stats: statsOf(entry.samplesMs) }
  })

  return {
    implementation: manifest.implementation,
    benchmark: { name: benchmark.name, version: benchmark.version },
    dataset: { name: benchmark.dataset.name, version: benchmark.dataset.version },
    measurement: {
      scenario,
      phases: PHASES[scenario],
      sink: 'csv',
      // e2e ignores warmup — every sample is a fresh, dataset-cold worker — and
      // the report records the counts actually used, never an unenforced claim.
      warmup: scenario === 'end_to_end' ? 0 : warmup,
      iterations: measurement,
    },
    results: {
      [benchmark.name]: {
        size,
        fhirVersion: benchmark.fhirVersion,
        resourceCounts,
        cases: finished,
      },
    },
  }

  // -- scenario loops ---------------------------------------------------------

  // preloaded_repeated: one long-lived worker; spawn + prepare OUTSIDE every
  // timed region; each measured sample wall-clocks one `run` round-trip.
  async function runCasePreloaded({ ctx, state, c, outCsv, warmup, measurement }) {
    if (!state.worker) state.worker = await spawnPrepared(ctx)
    const worker = state.worker
    const runCmd = { cmd: 'run', view: c.view, outCsv }
    for (let i = 0; i < warmup; i++) await sendChecked(worker, runCmd, ctx.inactivityMs)
    const { samplesMs, phaseSamplesMs, lastResp } = await measure(
      worker,
      runCmd,
      measurement,
      ctx.inactivityMs,
    )
    return finishEntry({ ctx, c, outCsv, samplesMs, phaseSamplesMs, lastResp })
  }

  // end_to_end: a FRESH worker per sample (spawn untimed — VM boot is not ETL
  // cost), the prepare + run round-trips timed together, restart between
  // samples so every sample is dataset-cold by construction. Warmup is ignored.
  async function runCaseEndToEnd({ ctx, c, outCsv, measurement }) {
    const samplesMs = []
    const phaseAcc = {}
    let lastResp
    for (let i = 0; i < measurement; i++) {
      const worker = await spawnGated(ctx)
      try {
        const t0 = performance.now()
        await sendChecked(
          worker,
          { cmd: 'prepare', dataDir: ctx.dataDir, resources: ctx.resources },
          ctx.inactivityMs,
        )
        lastResp = await sendChecked(worker, { cmd: 'run', view: c.view, outCsv }, ctx.inactivityMs)
        samplesMs.push(performance.now() - t0)
        accumulatePhases(phaseAcc, lastResp.phasesMs)
      } finally {
        await worker.shutdown()
      }
    }
    return finishEntry({ ctx, c, outCsv, samplesMs, phaseSamplesMs: phaseAcc, lastResp })
  }

  async function measure(worker, runCmd, measurement, inactivityMs) {
    const samplesMs = []
    const phaseAcc = {}
    let lastResp
    for (let i = 0; i < measurement; i++) {
      const t0 = performance.now()
      lastResp = await sendChecked(worker, runCmd, inactivityMs)
      samplesMs.push(performance.now() - t0)
      accumulatePhases(phaseAcc, lastResp.phasesMs)
    }
    return { samplesMs, phaseSamplesMs: phaseAcc, lastResp }
  }

  // Advisory diagnostics only (benchmark-hook-format): hook-reported per-phase
  // splits accumulate into phaseSamplesMs and never touch samplesMs.
  function accumulatePhases(acc, phasesMs) {
    if (!phasesMs) return
    for (const [phase, ms] of Object.entries(phasesMs)) (acc[phase] ??= []).push(ms)
  }

  function finishEntry({ ctx, c, outCsv, samplesMs, phaseSamplesMs, lastResp }) {
    const outputRows = countCsvRows(outCsv)
    const entry = {
      id: c.id,
      outputRows,
      samplesMs,
      expected: assertionFor(checkfile, c.id, size),
      variancePermitted: !!c.countVariancePermitted,
    }
    if (resourceCounts[c.view.resource] != null) entry.inputRows = resourceCounts[c.view.resource]
    if (Object.keys(phaseSamplesMs).length) entry.phaseSamplesMs = phaseSamplesMs
    if (lastResp?.outputRows != null && lastResp.outputRows !== outputRows) {
      entry.message = `hook-reported outputRows ${lastResp.outputRows} differs from the CSV-derived count ${outputRows}; the harness count is authoritative`
    }
    return entry
  }

  // Spawn + capabilities gate: the harness never drives a hook through a
  // scenario it did not declare (benchmark-hook-format).
  async function spawnGated(ctx) {
    const worker = spawnWorker(ctx.manifest)
    try {
      const caps = await sendChecked(worker, { cmd: 'capabilities' }, ctx.inactivityMs)
      if (!caps.scenarios?.includes(ctx.scenario)) {
        throw new SuiteError(`hook does not declare scenario "${ctx.scenario}" (declares: ${caps.scenarios})`)
      }
      return worker
    } catch (err) {
      worker.kill()
      throw err
    }
  }

  async function spawnPrepared(ctx) {
    const worker = await spawnGated(ctx)
    try {
      await sendChecked(
        worker,
        { cmd: 'prepare', dataDir: ctx.dataDir, resources: ctx.resources },
        ctx.inactivityMs,
      )
      return worker
    } catch (err) {
      worker.kill()
      throw err
    }
  }
}
