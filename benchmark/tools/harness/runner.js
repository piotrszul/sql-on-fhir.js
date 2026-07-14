import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { startConnector, SetupError, WorkerTimeout } from './worker.js'
import { makeEngineTempDir } from './tempdir.js'
import { datasetDir } from '../layout.js'
import { assertionFor, countLines } from '../checkfile.js'
import { countCsvRows } from './csv-count.js'
import { statsOf } from './stats.js'
import { bindingFor, validatePlan, warmupCount, OFFICIAL_SCENARIOS } from './plan.js'

// The hook answered a command with {"ok":false,...}: the engine attempted the
// work and reported failure. The worker stays alive (benchmark-hook-format).
class HookError extends Error {}

// A failure of the run as a whole (e.g. the hook does not declare the requested
// scenario) — never recorded as a per-case status.
export class SuiteError extends Error {}

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
// is the harness's own CSV-derived count (or, for a materializing plan, the
// engine-reported post-loop count). present+match => ok verified;
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

// The manifest's lifecycle mode (benchmark-hook-format): `endpoint` is an
// operator-managed connect-mode service; `cli` is a per-invocation CLI hook;
// otherwise the harness spawns and terminates the hook service. Only connect
// mode reuses a service the harness must never restart or reset without care.
function modeOf(manifest) {
  if (manifest.endpoint) return 'connect'
  if (manifest.cli) return 'cli'
  return 'spawn'
}

// The shared execution context threaded through the executor: everything the
// per-case measurement loop needs that does not vary case to case.
function buildContext(opts) {
  const { benchmark, size, dataRoot, manifest, checkfile, caseFilter } = opts
  const { warmup = 1, measurement = 5 } = benchmark.iterations || {}
  const dataDir = datasetDir(dataRoot, benchmark.dataset.name, benchmark.dataset.version, size)
  const resources = benchmark.dataset.resources
  return {
    benchmark,
    size,
    manifest,
    mode: modeOf(manifest),
    dataDir,
    resources,
    resourceCounts: observeResourceCounts(dataDir, resources),
    checkfile,
    warmup,
    measurement,
    inactivityMs: opts.inactivityMs,
    readinessMs: opts.readinessMs,
    plan: opts.plan,
    requiredScenario: opts.requiredScenario,
    cases: caseFilter ? benchmark.cases.filter(caseFilter) : benchmark.cases,
    // Canonical, symlink-free: `outCsv` is built under this dir and handed to
    // engines by path (see tempdir.js).
    workDir: makeEngineTempDir('sof-harness-'),
  }
}

// Run one benchmark suite at one size against one hook, per the
// benchmark-harness capability: the harness owns the worker lifecycle, the
// measurement loop, the wall clock, verification, and report assembly. Official
// scenarios are named plan bindings (design.md D2); the report assembler takes
// the binding, never a raw plan, so no code path stamps an official scenario
// onto a custom-plan run.
export async function runSuite({
  benchmark,
  size,
  dataRoot,
  manifest,
  checkfile = null,
  scenario = 'preloaded_repeated',
  inactivityMs = 300_000,
  readinessMs,
  caseFilter,
}) {
  const binding = bindingFor(scenario, modeOf(manifest))
  if (!binding) {
    throw new Error(`unknown scenario "${scenario}"; valid scenarios are: ${OFFICIAL_SCENARIOS.join(', ')}`)
  }
  validatePlan(binding.plan)
  const ctx = buildContext({
    benchmark,
    size,
    dataRoot,
    manifest,
    checkfile,
    inactivityMs,
    readinessMs,
    caseFilter,
    plan: binding.plan,
    requiredScenario: scenario,
  })
  const results = await executeCases(ctx)
  return assembleReport(ctx, results, { scenario: binding.scenario, phases: binding.phases })
}

// The custom-plan entry point (design.md D3): the ONLY way to reach a plan that
// is not an official binding. It is deliberately NOT on the public harness CLI —
// a plan flag there would be an attractive nuisance during the very phase meant
// to test whether plans should ever be public. The run emits a self-describing,
// deliberately non-conforming internal record (assembleInternalReport), never an
// official scenario stamp: the scenario id must be a caller-supplied
// `internal:<name>`, and report assembly stamps exactly that.
export async function runPlanSuite({
  plan,
  scenarioId,
  phases,
  benchmark,
  size,
  dataRoot,
  manifest,
  checkfile = null,
  inactivityMs = 300_000,
  readinessMs,
  caseFilter,
}) {
  validatePlan(plan)
  if (!/^internal:[A-Za-z0-9._-]+$/.test(scenarioId ?? '')) {
    throw new SetupError(
      `custom-plan scenario id must be a namespaced "internal:<name>"; got ${JSON.stringify(scenarioId)}`,
    )
  }
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new SetupError('custom-plan run requires truthful non-empty `phases` describing the timed region')
  }
  const ctx = buildContext({
    benchmark,
    size,
    dataRoot,
    manifest,
    checkfile,
    inactivityMs,
    readinessMs,
    caseFilter,
    plan,
    requiredScenario: scenarioId,
  })
  const results = await executeCases(ctx)
  return assembleInternalReport(ctx, results, { scenarioId, phases })
}

// -- the generic executor ---------------------------------------------------

// Drive every case through the plan, isolating per-case failures: each case
// runs under its own boundary and is recorded with its own status; a failure
// never aborts the run. Suite- and setup-level failures are the run's, loudly.
async function executeCases(ctx) {
  const state = { worker: null, prepared: null }
  const results = []
  try {
    for (const c of ctx.cases) {
      const outCsv = join(ctx.workDir, `${c.id}.csv`)
      let entry
      try {
        entry = await runCase(c, outCsv, state, ctx)
      } catch (err) {
        if (err instanceof SuiteError || err instanceof SetupError) throw err
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
    rmSync(ctx.workDir, { recursive: true, force: true })
  }
  return results
}

// One case's warmup + measured samples, interpreting the plan's fork level.
// invocation: a fresh worker per sample (dataset-cold by construction).
// suite: one long-lived worker reused across every case (state.worker).
// trial: a fresh worker per case, reused across that case's samples, retired
// with the case.
async function runCase(c, outCsv, state, ctx) {
  const { plan } = ctx

  // The timed region's command payloads are invariant across a case's samples;
  // build them once here so no per-sample allocation lands inside the clock.
  const commands = timedCommands(c, outCsv, ctx)

  if (plan.forkLevel === 'invocation') {
    const measured = await sampleLoop(ctx, async () => {
      const worker = await startGated(ctx)
      try {
        return await timedRegionOnce(worker, commands, ctx)
      } finally {
        await worker.shutdown()
      }
    })
    return finishEntry(c, outCsv, measured, null, ctx)
  }

  const warmups = warmupCount(plan.warmup, ctx.warmup)
  const { worker, prepared } = await acquireCaseWorker(state, plan, ctx)
  try {
    if (plan.trialSetup === 'prepare-lazy') await prepareLazy(worker, c, prepared, ctx)
    for (let i = 0; i < warmups; i++) {
      await invocationSetup(worker, plan, ctx)
      await timedRegionOnce(worker, commands, ctx)
    }
    const measured = await sampleLoop(ctx, async () => {
      await invocationSetup(worker, plan, ctx)
      return timedRegionOnce(worker, commands, ctx)
    })
    const verified = await postLoopVerify(worker, c, outCsv, plan, ctx)
    return finishEntry(c, outCsv, measured, verified, ctx)
  } finally {
    // Trial fork: the case's worker is private and dies with the case. Suite
    // fork: it lives on in state, shut down after the whole loop.
    if (plan.forkLevel === 'trial') await worker.shutdown()
  }
}

async function acquireCaseWorker(state, plan, ctx) {
  if (plan.forkLevel === 'trial') {
    return { worker: await startGated(ctx), prepared: new Set() }
  }
  // suite fork: one worker for the whole run, created lazily on first use and
  // respawned (with a fresh prepared set) after any discard.
  if (!state.worker) {
    state.worker = await startGated(ctx)
    // Connect-mode hygiene: a long-lived operator service may still hold state
    // from a prior run. Plans that reset before each sample already get this;
    // those that do not (preloaded) reset once here, before the first prepare.
    if (ctx.mode === 'connect' && plan.invocationSetup === 'none') {
      await sendChecked(state.worker, { cmd: 'reset' }, ctx.inactivityMs)
    }
    state.prepared = new Set()
  }
  return { worker: state.worker, prepared: state.prepared }
}

// Untimed, per case: prepare only the case's own resource, and only once, so a
// missing/broken resource file fails only the cases that query it (per-case
// failure isolation). Only declared dataset resources are preparable; a view
// against anything else is the hook's to answer (ok:false).
async function prepareLazy(worker, c, prepared, ctx) {
  const resource = c.view.resource
  if (ctx.resources.includes(resource) && !prepared.has(resource)) {
    await sendChecked(
      worker,
      { cmd: 'prepare', dataDir: ctx.dataDir, resources: [resource] },
      ctx.inactivityMs,
    )
    prepared.add(resource)
  }
}

// Untimed, before each timed region: connect-mode end_to_end trusts a reset to
// restore dataset-coldness on a service it never restarts.
async function invocationSetup(worker, plan, ctx) {
  if (plan.invocationSetup === 'reset') await sendChecked(worker, { cmd: 'reset' }, ctx.inactivityMs)
}

// The plan's timed region as concrete command payloads. A csv-sink run streams
// to outCsv (the harness counts that file); a table-sink run materializes
// in-engine and post-loop verification owns the row count.
function timedCommands(c, outCsv, ctx) {
  return ctx.plan.timedRegion.map((cmd) => {
    if (cmd === 'prepare') return { cmd: 'prepare', dataDir: ctx.dataDir, resources: ctx.resources }
    const runCmd = { cmd: 'run', view: c.view }
    if (ctx.plan.sink === 'csv') runCmd.outCsv = outCsv
    return runCmd
  })
}

// One wall-clocked pass over the pre-built timed-region commands.
async function timedRegionOnce(worker, commands, ctx) {
  const t0 = performance.now()
  let resp
  for (const cmd of commands) {
    resp = await sendChecked(worker, cmd, ctx.inactivityMs)
  }
  return { ms: performance.now() - t0, resp }
}

// The shared measurement loop: `measurement` timed samples, each produced by a
// caller-supplied `sample()` that owns its timed region and returns { ms, resp }.
// Advisory per-phase splits accumulate here, never into samplesMs.
async function sampleLoop(ctx, sample) {
  const samplesMs = []
  const phaseSamplesMs = {}
  let lastResp
  for (let i = 0; i < ctx.measurement; i++) {
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

// Verification is always outside every timed region. in-run-csv: the timed run
// already wrote outCsv; the harness counts it in finishEntry. post-loop-count:
// one untimed count(*) verb; the engine reports the row count of the sink it
// materialized in the timed region. post-loop-extract: one untimed extract verb
// writes the CSV; the harness counts that file. Returns { rows } when the count
// comes from a post-loop verb, or null for in-run-csv.
async function postLoopVerify(worker, c, outCsv, plan, ctx) {
  if (plan.verification === 'post-loop-count') {
    const resp = await sendChecked(worker, { cmd: 'count' }, ctx.inactivityMs)
    return { rows: resp.rows }
  }
  if (plan.verification === 'post-loop-extract') {
    await sendChecked(worker, { cmd: 'extract', outCsv }, ctx.inactivityMs)
    return { rows: countCsvRows(outCsv) }
  }
  return null
}

function finishEntry(c, outCsv, { samplesMs, phaseSamplesMs, lastResp }, verified, ctx) {
  const outputRows = verified ? verified.rows : countCsvRows(outCsv)
  const verdict = verdictFor({
    outputRows,
    expected: assertionFor(ctx.checkfile, c.id, ctx.size),
    variancePermitted: !!c.countVariancePermitted,
  })
  const entry = { id: c.id, ...verdict, outputRows, samplesMs, stats: statsOf(samplesMs) }
  if (ctx.resourceCounts[c.view.resource] != null) entry.inputRows = ctx.resourceCounts[c.view.resource]
  if (Object.keys(phaseSamplesMs).length) entry.phaseSamplesMs = phaseSamplesMs
  // Only in-run-csv has a hook-reported outputRows to cross-check; a post-loop
  // verb's response IS the authoritative count.
  if (!verified && lastResp?.outputRows != null && lastResp.outputRows !== outputRows) {
    entry.message = `hook-reported outputRows ${lastResp.outputRows} differs from the CSV-derived count ${outputRows}; the harness count is authoritative`
  }
  return entry
}

// Bring-up + capabilities gate: startConnector resolves only once the hook has
// answered `capabilities` (readiness), and the harness never drives a hook
// through a scenario it did not declare (benchmark-hook-format). Custom-plan
// runs gate on the plan's declared internal id (design.md D3/D6).
async function startGated(ctx) {
  const worker = await startConnector(ctx.manifest, ctx.readinessMs ? { readinessMs: ctx.readinessMs } : {})
  const declared = worker.capabilities.scenarios
  if (!declared?.includes(ctx.requiredScenario)) {
    await worker.shutdown()
    throw new SuiteError(`hook does not declare scenario "${ctx.requiredScenario}" (declares: ${declared})`)
  }
  return worker
}

// The report's measurement block is stamped from the caller-chosen scenario and
// phases; sink and warmup are derived from ctx.plan so the two derivations never
// drift from the plan actually executed.
function assembleReport(ctx, results, { scenario, phases }) {
  return {
    implementation: ctx.manifest.implementation,
    benchmark: { name: ctx.benchmark.name, version: ctx.benchmark.version },
    dataset: { name: ctx.benchmark.dataset.name, version: ctx.benchmark.dataset.version },
    measurement: {
      scenario,
      phases,
      sink: ctx.plan.sink,
      warmup: warmupCount(ctx.plan.warmup, ctx.warmup),
      iterations: ctx.measurement,
    },
    results: {
      [ctx.benchmark.name]: {
        size: ctx.size,
        fhirVersion: ctx.benchmark.fhirVersion,
        resourceCounts: ctx.resourceCounts,
        cases: results,
      },
    },
  }
}

// The internal record (design.md D5): the exact report structure, but stamped
// with the caller's non-official `internal:<name>` scenario, the truthful
// caller-supplied phases, and the plan embedded verbatim as `measurement.plan`
// (so the count's provenance — engine-reported vs harness-counted — is recorded
// in the data it qualifies). The published report schema's closed scenario enum
// plus its `additionalProperties: false` on `measurement` make this record fail
// validation everywhere the contract is enforced, at zero contract cost.
function assembleInternalReport(ctx, results, { scenarioId, phases }) {
  const record = assembleReport(ctx, results, { scenario: scenarioId, phases })
  record.measurement.plan = ctx.plan
  return record
}
