import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'
import reportSchema from '../benchmark-report.schema.json'
import internalReportSchema from '../staging-hooks/flatquack-internal/internal-report.schema.json'
import { runSuite, runPlanSuite } from '../tools/harness/runner.js'
import { internalReportStem, writeInternalReport } from '../tools/harness/internal-report.js'
import { projectJmh } from '../tools/harness/jmh.js'
import { runCli } from '../tools/harness/cli.js'
import { readManifest } from '../tools/harness/manifest.js'
import { datasetDir } from '../tools/layout.js'

const validateReport = new Ajv({ strict: false }).compile(reportSchema)
const validateInternal = new Ajv({ strict: false }).compile(internalReportSchema)
const fakeHookJs = join(import.meta.dir, 'fixtures/hooks/fake-hook.js')

const suite = {
  name: 'fake-suite',
  version: '1',
  title: 'Fake suite',
  fhirVersion: '4.0.1',
  iterations: { warmup: 1, measurement: 2 },
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

const checkfile = {
  dataset: { name: 'fake-data', version: '1' },
  syntheaVersion: '3.2.0',
  sizes: {},
  assertions: { obs: { s: 3 }, cond: { s: 2 } },
}

// Observation: 3 rows, Condition: 2 rows.
function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'plan-exec-'))
  const dir = datasetDir(dataRoot, 'fake-data', '1', 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  writeFileSync(join(dir, 'Condition.ndjson'), '{"b":1}\n{"b":2}\n')
  return dataRoot
}

// A spawn-mode hook declaring the internal scenario, logging every request so a
// test can assert the exact command choreography a plan drives.
function internalManifest(logFile, envOverrides = {}) {
  return {
    command: ['bun', fakeHookJs],
    env: { FAKE_SCENARIOS: 'internal:warm-table-sink', FAKE_LOG: logFile, ...envOverrides },
    implementation: {
      engine: { name: 'duckdb', version: '1.5.3' },
      binding: { name: 'flatquack', version: 'gitref0' },
      variant: 'internal-warm-table-sink',
    },
  }
}

const WARM_PLAN = {
  forkLevel: 'trial',
  trialSetup: 'prepare-lazy',
  invocationSetup: 'none',
  timedRegion: ['run'],
  sink: 'table',
  verification: 'post-loop-count',
  warmup: 'iterations',
}

function commandsFrom(logFile) {
  return readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l !== 'GET /capabilities')
}

function runWarm(overrides = {}) {
  return runPlanSuite({
    plan: WARM_PLAN,
    scenarioId: 'internal:warm-table-sink',
    phases: ['load', 'execute', 'extract'],
    benchmark: suite,
    size: 's',
    checkfile,
    ...overrides,
  })
}

// -- 3.1 fork-per-trial lifecycle --

test('fork-per-trial: a fresh worker per case, reused across that case warmup+samples, retired at case end', async () => {
  const dataRoot = seedData()
  const logDir = mkdtempSync(join(tmpdir(), 'warmlog-'))
  const logFile = join(logDir, 'commands.log')
  await runWarm({ dataRoot, manifest: internalManifest(logFile) })
  // warmup 1 + measurement 2 = 3 runs per case; prepare + count once per case;
  // a shutdown ends each case's private worker. Two cases => the block twice.
  const perCase = ['POST /prepare', 'POST /run', 'POST /run', 'POST /run', 'POST /count', 'POST /shutdown']
  expect(commandsFrom(logFile)).toEqual([...perCase, ...perCase])
  rmSync(logDir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 3.2 post-loop count feeds the guard --

test('post-loop count: engine-reported rows feed the verification guard', async () => {
  const dataRoot = seedData()
  const logDir = mkdtempSync(join(tmpdir(), 'warmlog-'))
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(logDir, 'c.log')) })
  const cases = record.results['fake-suite'].cases
  const obs = cases.find((c) => c.id === 'obs')
  expect(obs.status).toBe('ok')
  expect(obs.verified).toBe(true)
  expect(obs.outputRows).toBe(3) // from count(*), matching the checkfile assertion
  expect(cases.find((c) => c.id === 'cond').outputRows).toBe(2)
  rmSync(logDir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 3.3 post-loop extract --

test('post-loop extract: one untimed extract after the loop; the harness counts the CSV', async () => {
  const dataRoot = seedData()
  const logDir = mkdtempSync(join(tmpdir(), 'warmlog-'))
  const logFile = join(logDir, 'commands.log')
  const record = await runWarm({
    dataRoot,
    manifest: internalManifest(logFile),
    plan: { ...WARM_PLAN, verification: 'post-loop-extract' },
  })
  const obs = record.results['fake-suite'].cases.find((c) => c.id === 'obs')
  expect(obs.outputRows).toBe(3) // counted by the harness from the extracted CSV
  const cmds = commandsFrom(logFile)
  // exactly one extract per case, after the three runs, before shutdown
  expect(cmds.filter((c) => c === 'POST /extract')).toHaveLength(2)
  expect(cmds.filter((c) => c === 'POST /count')).toHaveLength(0)
  const firstExtract = cmds.indexOf('POST /extract')
  expect(cmds.slice(0, firstExtract)).toEqual(['POST /prepare', 'POST /run', 'POST /run', 'POST /run'])
  rmSync(logDir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 3.4 official bindings never issue the verbs --

test('official scenarios never send count or extract', async () => {
  const dataRoot = seedData()
  for (const scenario of ['preloaded_repeated', 'end_to_end']) {
    const logDir = mkdtempSync(join(tmpdir(), 'offlog-'))
    const logFile = join(logDir, 'commands.log')
    const manifest = {
      command: ['bun', fakeHookJs],
      env: { FAKE_LOG: logFile },
      implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
    }
    await runSuite({ benchmark: suite, size: 's', dataRoot, manifest, checkfile, scenario })
    const cmds = commandsFrom(logFile)
    expect(cmds.some((c) => c.includes('/count') || c.includes('/extract'))).toBe(false)
    rmSync(logDir, { recursive: true, force: true })
  }
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 3.5 the module entry point is the only way in; the CLI drives only official names --

test('the public CLI refuses a custom/internal scenario name', async () => {
  const dataRoot = seedData()
  const dir = mkdtempSync(join(tmpdir(), 'clihook-'))
  const suitePath = join(dir, 'suite.json')
  writeFileSync(suitePath, JSON.stringify(suite))
  const hookPath = join(dir, 'hook.json')
  writeFileSync(hookPath, JSON.stringify(internalManifest(join(dir, 'c.log'))))
  await expect(
    runCli([
      'run',
      '--hook',
      hookPath,
      suitePath,
      '--data',
      dataRoot,
      '--scenario',
      'internal:warm-table-sink',
    ]),
  ).rejects.toThrow(/unknown scenario/i)
  rmSync(dir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})

test('runPlanSuite rejects a scenario id that is not namespaced internal:', async () => {
  const dataRoot = seedData()
  await expect(
    runWarm({
      dataRoot,
      manifest: internalManifest(join(tmpdir(), 'x.log')),
      scenarioId: 'preloaded_repeated',
    }),
  ).rejects.toThrow(/internal:/)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('runPlanSuite rejects an unsound plan (post-loop-count with a csv sink) before any case', async () => {
  const dataRoot = seedData()
  await expect(
    runWarm({
      dataRoot,
      manifest: internalManifest(join(tmpdir(), 'x.log')),
      plan: { ...WARM_PLAN, sink: 'csv' },
    }),
  ).rejects.toThrow(/materializing table sink/)
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 4.1 the internal record is report-shaped, truthful, plan-embedding --

test('runPlanSuite emits a report-shaped record with the internal scenario and the plan embedded', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  expect(record.measurement.scenario).toBe('internal:warm-table-sink')
  expect(record.measurement.phases).toEqual(['load', 'execute', 'extract'])
  expect(record.measurement.sink).toBe('table')
  expect(record.measurement.warmup).toBe(1)
  expect(record.measurement.iterations).toBe(2)
  expect(record.measurement.plan).toEqual(WARM_PLAN)
  expect(record.implementation.variant).toBe('internal-warm-table-sink')
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 4.2 fail-closed against the published contract --

test('the internal record FAILS the published report schema (non-official scenario + extra plan block)', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  expect(validateReport(record)).toBe(false)
  // No code path launders a raw plan into an official scenario stamp.
  expect(['preloaded_repeated', 'end_to_end']).not.toContain(record.measurement.scenario)
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 4.3 the staging-local schema accepts the internal shape --

test('the internal record validates against the staging-local internal-report schema', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  expect(validateInternal(record)).toBe(true)
  // and the staging schema rejects an official-scenario record (its guard is real)
  const official = await runSuite({
    benchmark: suite,
    size: 's',
    dataRoot,
    manifest: { command: ['bun', fakeHookJs], implementation: { engine: { name: 'x', version: '1' } } },
    checkfile,
  })
  expect(validateInternal(official)).toBe(false)
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 4.4 JMH projects from the internal record unchanged --

test('projectJmh yields JMH files from the internal record (labels carry no conformance claim)', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  const files = projectJmh(record)
  expect(files.length).toBe(1)
  expect(files[0].filename).toMatch(/internal-warm-table-sink/)
  const entries = JSON.parse(files[0].content)
  expect(entries.map((e) => e.benchmark).sort()).toEqual(['fake-suite.cond', 'fake-suite.obs'])
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- 4.5 advisory phase splits are still recorded --

test('hook-reported phasesMs land in the internal record advisory phaseSamplesMs', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  const obs = record.results['fake-suite'].cases.find((c) => c.id === 'obs')
  expect(obs.phaseSamplesMs.execute).toHaveLength(2) // one per measured sample
  rmSync(dataRoot, { recursive: true, force: true })
})

// -- internal-report file writer --

test('writeInternalReport names the file <stem>.internal-report.json', async () => {
  const dataRoot = seedData()
  const record = await runWarm({ dataRoot, manifest: internalManifest(join(tmpdir(), 'c.log')) })
  const outDir = mkdtempSync(join(tmpdir(), 'irep-'))
  const path = writeInternalReport(record, outDir)
  expect(path).toMatch(/\.internal-report\.json$/)
  expect(internalReportStem(record)).toMatch(/fake-suite-s-duckdb-1\.5\.3/)
  expect(JSON.parse(readFileSync(path, 'utf8')).measurement.scenario).toBe('internal:warm-table-sink')
  rmSync(outDir, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
})
