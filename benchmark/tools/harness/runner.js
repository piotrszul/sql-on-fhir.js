import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnWorker, ProtocolError, WorkerCrash, WorkerTimeout } from './worker.js'
import { datasetDir } from '../layout.js'
import { assertionFor, countLines } from '../checkfile.js'
import { countCsvRows } from './csv-count.js'
import { statsOf } from './stats.js'

// The hook answered a command with {"ok":false,...}: the engine attempted the
// work and reported failure. The worker stays alive (benchmark-hook-format).
class HookError extends Error {}

// A failure of the run as a whole (e.g. the hook does not declare the requested
// scenario) — never recorded as a per-case status.
class SuiteError extends Error {}

const PHASES = { preloaded_repeated: ['execute', 'extract'], end_to_end: ['load', 'execute', 'extract'] }

// Dataset resource counts for report traceability, counted with the checkfile's
// own countLines so they can never disagree with the sha256-locked counts.
// Advisory, never able to void completed cases (the partial-run guarantee): a
// missing file degrades to {}.
function observeResourceCounts(dataDir, resources) {
  try {
    const counts = {}
    for (const r of resources) counts[r] = countLines(join(dataDir, `${r}.ndjson`))
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

  const resources = benchmark.dataset.resources
  const resourceCounts = observeResourceCounts(dataDir, resources)

  let results
  try {
    const runCase = scenario === 'end_to_end' ? runCaseEndToEnd : runCasePreloaded
    const state = { worker: null, prepared: null }
    results = []
    for (const c of cases) {
      const outCsv = join(workDir, `${c.id}.csv`)
      // Per-case failure isolation: each case runs under its own boundary and is
      // recorded with its own status; a failure never aborts the run.
      let entry
      try {
        entry = await runCase(c, outCsv, state)
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
        cases: results,
      },
    },
  }

  // -- scenario loops ---------------------------------------------------------

  // preloaded_repeated: one long-lived worker; spawn + prepare OUTSIDE every
  // timed region; each measured sample wall-clocks one `run` round-trip.
  // Prepare is lazy and per-resource so a missing/broken resource file fails
  // only the cases that query it (per-case failure isolation), never the run.
  async function runCasePreloaded(c, outCsv, state) {
    if (!state.worker) {
      state.worker = await spawnGated()
      state.prepared = new Set()
    }
    const worker = state.worker
    // Only declared dataset resources are preparable; a view against anything
    // else is the hook's to answer (ok:false), not the harness's to prepare.
    if (resources.includes(c.view.resource) && !state.prepared.has(c.view.resource)) {
      await sendChecked(worker, { cmd: 'prepare', dataDir, resources: [c.view.resource] }, inactivityMs)
      state.prepared.add(c.view.resource)
    }
    const runCmd = { cmd: 'run', view: c.view, outCsv }
    for (let i = 0; i < warmup; i++) await sendChecked(worker, runCmd, inactivityMs)
    const measured = await sampleLoop(async () => {
      const t0 = performance.now()
      const resp = await sendChecked(worker, runCmd, inactivityMs)
      return { ms: performance.now() - t0, resp }
    })
    return finishEntry(c, outCsv, measured)
  }

  // end_to_end: a FRESH worker per sample (spawn untimed — VM boot is not ETL
  // cost), the prepare + run round-trips timed together, restart between
  // samples so every sample is dataset-cold by construction. Warmup is ignored.
  async function runCaseEndToEnd(c, outCsv) {
    const measured = await sampleLoop(async () => {
      const worker = await spawnGated()
      try {
        const t0 = performance.now()
        await sendChecked(worker, { cmd: 'prepare', dataDir, resources }, inactivityMs)
        const resp = await sendChecked(worker, { cmd: 'run', view: c.view, outCsv }, inactivityMs)
        return { ms: performance.now() - t0, resp }
      } finally {
        await worker.shutdown()
      }
    })
    return finishEntry(c, outCsv, measured)
  }

  // The shared measurement loop: `measurement` timed samples, each produced by a
  // scenario-supplied `sample()` that owns its timed region and returns
  // { ms, resp }. Advisory per-phase splits accumulate here, never into samplesMs.
  async function sampleLoop(sample) {
    const samplesMs = []
    const phaseSamplesMs = {}
    let lastResp
    for (let i = 0; i < measurement; i++) {
      const { ms, resp } = await sample()
      samplesMs.push(ms)
      lastResp = resp
      accumulatePhases(phaseSamplesMs, resp.phasesMs)
    }
    return { samplesMs, phaseSamplesMs, lastResp }
  }

  // Advisory diagnostics only (benchmark-hook-format): hook-reported per-phase
  // splits accumulate into phaseSamplesMs and never touch samplesMs.
  function accumulatePhases(acc, phasesMs) {
    if (!phasesMs) return
    for (const [phase, ms] of Object.entries(phasesMs)) (acc[phase] ??= []).push(ms)
  }

  function finishEntry(c, outCsv, { samplesMs, phaseSamplesMs, lastResp }) {
    const outputRows = countCsvRows(outCsv)
    const verdict = verdictFor({
      outputRows,
      expected: assertionFor(checkfile, c.id, size),
      variancePermitted: !!c.countVariancePermitted,
    })
    const entry = { id: c.id, ...verdict, outputRows, samplesMs, stats: statsOf(samplesMs) }
    if (resourceCounts[c.view.resource] != null) entry.inputRows = resourceCounts[c.view.resource]
    if (Object.keys(phaseSamplesMs).length) entry.phaseSamplesMs = phaseSamplesMs
    if (lastResp?.outputRows != null && lastResp.outputRows !== outputRows) {
      entry.message = `hook-reported outputRows ${lastResp.outputRows} differs from the CSV-derived count ${outputRows}; the harness count is authoritative`
    }
    return entry
  }

  // Spawn + capabilities gate: the harness never drives a hook through a
  // scenario it did not declare (benchmark-hook-format).
  async function spawnGated() {
    const worker = spawnWorker(manifest)
    try {
      const caps = await sendChecked(worker, { cmd: 'capabilities' }, inactivityMs)
      if (!caps.scenarios?.includes(scenario)) {
        throw new SuiteError(`hook does not declare scenario "${scenario}" (declares: ${caps.scenarios})`)
      }
      return worker
    } catch (err) {
      worker.kill()
      throw err
    }
  }
}
