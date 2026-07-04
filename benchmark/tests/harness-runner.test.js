import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'
import reportSchema from '../benchmark-report.schema.json'
import { readManifest } from '../tools/harness/manifest.js'
import { runSuite } from '../tools/harness/runner.js'
import { datasetDir } from '../tools/layout.js'

const validateReport = new Ajv({ strict: false }).compile(reportSchema)
const manifestPath = join(import.meta.dir, 'fixtures/hooks/fake.hook.json')

const suite = {
  name: 'fake-suite',
  version: '1',
  title: 'Fake suite (human label)',
  fhirVersion: '4.0.1',
  iterations: { warmup: 1, measurement: 3 },
  dataset: {
    name: 'fake-data',
    kind: 'synthea',
    version: '1',
    syntheaVersion: '3.2.0',
    resources: ['Observation', 'Condition'],
    sizes: { s: { population: 1 } },
    defaultSize: 's',
    params: { seed: 1 },
  },
  cases: [
    { id: 'obs', title: 'obs', view: { resource: 'Observation' } },
    { id: 'cond', title: 'cond', view: { resource: 'Condition' } },
  ],
}

// Observation: 3 rows, Condition: 2 rows.
function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'harness-'))
  const dir = datasetDir(dataRoot, 'fake-data', '1', 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  writeFileSync(join(dir, 'Condition.ndjson'), '{"b":1}\n{"b":2}\n')
  return dataRoot
}

function run(overrides = {}) {
  return runSuite({
    benchmark: suite,
    size: 's',
    dataRoot: overrides.dataRoot,
    manifest: readManifest(manifestPath),
    ...overrides,
  })
}

const checkfile = {
  dataset: { name: 'fake-data', version: '1' },
  syntheaVersion: '3.2.0',
  sizes: {},
  assertions: { obs: { s: 3 }, cond: { s: 2 } },
}

// ---- 3.1 preloaded_repeated loop + 4.3 report emission ----

test('preloaded_repeated: report is schema-valid with harness-timed samples and manifest identity', async () => {
  const dataRoot = seedData()
  const report = await run({ dataRoot, checkfile })
  expect(validateReport(report)).toBe(true)
  // implementation copied verbatim from the manifest
  expect(report.implementation).toEqual({
    engine: { name: 'fake-engine', version: '0.0.1' },
    variant: 'test',
  })
  expect(report.benchmark).toEqual({ name: 'fake-suite', version: '1' })
  expect(report.dataset).toEqual({ name: 'fake-data', version: '1' })
  expect(report.measurement).toEqual({
    scenario: 'preloaded_repeated',
    phases: ['execute', 'extract'],
    sink: 'csv',
    warmup: 1,
    iterations: 3,
  })
  const res = report.results['fake-suite']
  expect(res.size).toBe('s')
  expect(res.resourceCounts).toEqual({ Observation: 3, Condition: 2 })
  const obs = res.cases.find((c) => c.id === 'obs')
  expect(obs.status).toBe('ok')
  expect(obs.verified).toBe(true)
  expect(obs.samplesMs).toHaveLength(3) // warmup discarded
  expect(obs.inputRows).toBe(3)
  expect(obs.outputRows).toBe(3) // counted from the written CSV
  expect(obs.stats).toHaveProperty('median')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('results are keyed by the stable suite name, not the title', async () => {
  const dataRoot = seedData()
  const report = await run({ dataRoot })
  expect(report.results).toHaveProperty('fake-suite')
  expect(report.results).not.toHaveProperty('Fake suite (human label)')
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- 3.4 advisory phase splits ----

test('hook phasesMs land in phaseSamplesMs, never in samplesMs', async () => {
  const dataRoot = seedData()
  const report = await run({ dataRoot })
  const obs = report.results['fake-suite'].cases.find((c) => c.id === 'obs')
  expect(obs.phaseSamplesMs.execute).toHaveLength(3)
  expect(obs.phaseSamplesMs.extract).toHaveLength(3)
  // the fake hook reports execute: 1.0 per sample; harness samples are real
  // wall-clock times, not the hook's numbers
  expect(obs.phaseSamplesMs.execute[0]).toBe(1.0)
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- 4.2 verification guard ----

test('present + mismatching assertion => count_mismatch', async () => {
  const dataRoot = seedData()
  const cf = structuredClone(checkfile)
  cf.assertions.obs.s = 99
  const report = await run({ dataRoot, checkfile: cf })
  expect(report.results['fake-suite'].cases.find((c) => c.id === 'obs').status).toBe('count_mismatch')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('absent assertion => ok but unverified', async () => {
  const dataRoot = seedData()
  const report = await run({ dataRoot }) // no checkfile at all
  const obs = report.results['fake-suite'].cases.find((c) => c.id === 'obs')
  expect(obs.status).toBe('ok')
  expect(obs.verified).not.toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a countVariancePermitted case is not auto-flagged on divergence', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases[0].countVariancePermitted = true
  const cf = structuredClone(checkfile)
  cf.assertions.obs.s = 99
  const report = await run({ dataRoot, benchmark: b, checkfile: cf })
  expect(report.results['fake-suite'].cases.find((c) => c.id === 'obs').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('hook-reported outputRows disagreeing with the CSV count is surfaced in message', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [{ id: 'mis', title: 'mis', view: { resource: 'MisreportMe' } }]
  const report = await run({ dataRoot, benchmark: b })
  const mis = report.results['fake-suite'].cases.find((c) => c.id === 'mis')
  expect(mis.status).toBe('ok') // no assertion; the harness count is authoritative
  expect(mis.outputRows).toBe(0) // CSV-derived, not the hook's over-report
  expect(mis.message).toMatch(/outputRows/)
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- 2.5 failure isolation: record-and-continue with respawn ----

test('a crashing case is execution_error; the worker respawns and later cases succeed', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [
    { id: 'obs', title: 'obs', view: { resource: 'Observation' } },
    { id: 'boom', title: 'boom', view: { resource: 'CrashMe' } },
    { id: 'cond', title: 'cond', view: { resource: 'Condition' } },
  ]
  const report = await run({ dataRoot, benchmark: b, checkfile })
  const cases = report.results['fake-suite'].cases
  expect(cases).toHaveLength(3)
  expect(cases.find((c) => c.id === 'boom').status).toBe('execution_error')
  expect(cases.find((c) => c.id === 'obs').status).toBe('ok')
  expect(cases.find((c) => c.id === 'cond').status).toBe('ok') // after respawn + re-prepare
  expect(validateReport(report)).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('an unresponsive case maps to timeout under the harness budget; the run continues', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [
    { id: 'hang', title: 'hang', view: { resource: 'HangMe' } },
    { id: 'obs', title: 'obs', view: { resource: 'Observation' } },
  ]
  const report = await run({ dataRoot, benchmark: b, inactivityMs: 250 })
  const cases = report.results['fake-suite'].cases
  expect(cases.find((c) => c.id === 'hang').status).toBe('timeout')
  expect(cases.find((c) => c.id === 'obs').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('an ok:false response is execution_error with the hook error as message; worker stays alive', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [
    { id: 'fail', title: 'fail', view: { resource: 'FailMe' } },
    { id: 'obs', title: 'obs', view: { resource: 'Observation' } },
  ]
  const report = await run({ dataRoot, benchmark: b })
  const fail = report.results['fake-suite'].cases.find((c) => c.id === 'fail')
  expect(fail.status).toBe('execution_error')
  expect(fail.message).toMatch(/engine exploded/)
  expect(report.results['fake-suite'].cases.find((c) => c.id === 'obs').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a polluted protocol stream fails the case but not the run', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [
    { id: 'noisy', title: 'noisy', view: { resource: 'PolluteMe' } },
    { id: 'obs', title: 'obs', view: { resource: 'Observation' } },
  ]
  const report = await run({ dataRoot, benchmark: b })
  expect(report.results['fake-suite'].cases.find((c) => c.id === 'noisy').status).toBe('execution_error')
  expect(report.results['fake-suite'].cases.find((c) => c.id === 'obs').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a missing dataset resource file fails only the cases that need it, not the whole run', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'harness-'))
  const dir = datasetDir(dataRoot, 'fake-data', '1', 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  // Condition.ndjson deliberately absent; the suite still declares both resources.
  const report = await run({ dataRoot, checkfile })
  const cases = report.results['fake-suite'].cases
  expect(cases.find((c) => c.id === 'obs').status).toBe('ok')
  expect(cases.find((c) => c.id === 'cond').status).toBe('execution_error')
  expect(validateReport(report)).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('caseFilter runs a subset; the report contains only those cases and validates', async () => {
  const dataRoot = seedData()
  const report = await run({ dataRoot, caseFilter: (c) => c.id === 'cond' })
  const cases = report.results['fake-suite'].cases
  expect(cases).toHaveLength(1)
  expect(cases[0].id).toBe('cond')
  expect(validateReport(report)).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- 3.2 end_to_end loop ----

test('end_to_end: fresh worker per sample, prepare+run timed, phases include load', async () => {
  const dataRoot = seedData()
  const b = structuredClone(suite)
  b.cases = [{ id: 'obs', title: 'obs', view: { resource: 'Observation' } }]
  b.iterations = { warmup: 1, measurement: 2 }
  const report = await run({ dataRoot, benchmark: b, scenario: 'end_to_end', checkfile })
  expect(report.measurement.scenario).toBe('end_to_end')
  expect(report.measurement.phases).toEqual(['load', 'execute', 'extract'])
  expect(report.measurement.sink).toBe('csv')
  // e2e ignores warmup (each sample is a fresh, dataset-cold worker) and
  // records the actually-used counts
  expect(report.measurement.warmup).toBe(0)
  const obs = report.results['fake-suite'].cases[0]
  expect(obs.status).toBe('ok')
  expect(obs.verified).toBe(true)
  expect(obs.samplesMs).toHaveLength(2)
  expect(validateReport(report)).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- capability gating ----

test('a hook that does not declare the requested scenario is refused', async () => {
  const dataRoot = seedData()
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  const gated = {
    command: ['bun', join(import.meta.dir, 'fixtures/hooks/fake-hook.js')],
    env: { FAKE_SCENARIOS: 'preloaded_repeated' },
    implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
  }
  writeFileSync(join(dir, 'gated.hook.json'), JSON.stringify(gated))
  await expect(
    run({ dataRoot, manifest: readManifest(join(dir, 'gated.hook.json')), scenario: 'end_to_end' }),
  ).rejects.toThrow(/scenario/i)
  rmSync(dir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})
