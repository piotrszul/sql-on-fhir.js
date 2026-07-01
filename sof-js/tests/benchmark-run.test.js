import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'
import reportSchema from '../../benchmark/benchmark-report.schema.json'
import { buildReport, blessCheckfile, deriveExpectedCount } from '../src/benchmark-run.js'
import { datasetDir, checkfileFor } from '../../benchmark/tools/layout.js'
import { readCheckfile, assertionFor } from '../../benchmark/tools/checkfile.js'

const validateReport = new Ajv({ strict: false }).compile(reportSchema)

const benchmark = {
  name: 'clinical-flat',
  version: '2',
  title: 'Clinical flat (human label)',
  fhirVersion: '4.0.1',
  iterations: { warmup: 0, measurement: 2 },
  dataset: {
    name: 'synthea-clinical',
    kind: 'synthea',
    version: '1',
    syntheaVersion: '3.2.0',
    resources: ['Observation'],
    sizes: { s: { population: 100 } },
    defaultSize: 's',
    params: { seed: 589 },
  },
  cases: [
    {
      id: 'obs',
      title: 'obs',
      view: {
        resource: 'Observation',
        select: [{ column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] }],
      },
    },
    {
      id: 'obs-components',
      title: 'observation components',
      view: {
        resource: 'Observation',
        select: [
          { column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] },
          { forEach: 'component', column: [{ name: 'c', path: 'code.coding.first().code', type: 'code' }] },
        ],
      },
    },
  ],
}

// two Observations; o1 has 2 components, o2 has 1 => 3 component-rows total
function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'run-'))
  const dir = datasetDir(dataRoot, 'synthea-clinical', '1', 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'Observation.ndjson'),
    [
      JSON.stringify({
        resourceType: 'Observation',
        id: 'o1',
        component: [{ code: { coding: [{ code: 'a' }] } }, { code: { coding: [{ code: 'b' }] } }],
      }),
      JSON.stringify({
        resourceType: 'Observation',
        id: 'o2',
        component: [{ code: { coding: [{ code: 'c' }] } }],
      }),
    ].join('\n') + '\n',
  )
  return dataRoot
}

function checkfilePath(dataRoot) {
  return join(dataRoot, 'clinical-flat.check.json')
}

// ---- §6/§7: data resolution by identity + checkfile-driven guard ----

test('runner resolves data/<name>/<version>/<size>/ from identity, no hash', () => {
  const dataRoot = seedData()
  // the file lives at synthea-clinical/1/s — the plain identity path
  expect(existsSync(join(dataRoot, 'synthea-clinical', '1', 's', 'Observation.ndjson'))).toBe(true)
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(report.results['clinical-flat'].cases[0].outputRows).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('runner reads expected counts from the checkfile (matching => ok)', () => {
  const dataRoot = seedData()
  const cf = {
    dataset: { name: 'synthea-clinical', version: '1' },
    syntheaVersion: '3.2.0',
    sizes: {},
    assertions: { obs: { s: 2 }, 'obs-components': { s: 3 } },
  }
  writeFileSync(checkfilePath(dataRoot), JSON.stringify(cf))
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    checkfilePath: checkfilePath(dataRoot),
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  const cases = report.results['clinical-flat'].cases
  expect(cases.find((c) => c.id === 'obs').status).toBe('ok')
  expect(cases.find((c) => c.id === 'obs-components').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('runner flags count_mismatch against a present checkfile assertion', () => {
  const dataRoot = seedData()
  const cf = {
    dataset: { name: 'synthea-clinical', version: '1' },
    syntheaVersion: '3.2.0',
    sizes: {},
    assertions: { obs: { s: 99 } },
  }
  writeFileSync(checkfilePath(dataRoot), JSON.stringify(cf))
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    checkfilePath: checkfilePath(dataRoot),
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(report.results['clinical-flat'].cases.find((c) => c.id === 'obs').status).toBe('count_mismatch')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a countVariancePermitted case is NOT auto-flagged count_mismatch on divergence', () => {
  const dataRoot = seedData()
  const b = structuredClone(benchmark)
  b.cases[0].countVariancePermitted = true
  const cf = {
    dataset: { name: 'synthea-clinical', version: '1' },
    syntheaVersion: '3.2.0',
    sizes: {},
    assertions: { obs: { s: 99 } },
  }
  writeFileSync(checkfilePath(dataRoot), JSON.stringify(cf))
  const report = buildReport({
    benchmark: b,
    size: 's',
    dataRoot,
    checkfilePath: checkfilePath(dataRoot),
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(report.results['clinical-flat'].cases.find((c) => c.id === 'obs').status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('absent assertion => ok', () => {
  const dataRoot = seedData()
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(report.results['clinical-flat'].cases[0].status).toBe('ok')
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- §7: report shape (implementation, scenario, stats, provenance, inputRows, id) ----

test('buildReport emits a schema-valid report with structured implementation, scenario, stats and provenance', () => {
  const dataRoot = seedData()
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(validateReport(report)).toBe(true)
  expect(report.implementation.engine).toEqual({ name: 'sof-js', version: '2.0.0' })
  // benchmark identity sourced DIRECTLY from the authored suite name/version,
  // not invented from a pinned tag and not the dataset version (which is '1').
  expect(report.benchmark).toEqual({ name: 'clinical-flat', version: '2' })
  expect(report.dataset).toEqual({ name: 'synthea-clinical', version: '1' })
  expect(['end_to_end', 'preloaded_repeated']).toContain(report.measurement.scenario)
  const res = report.results['clinical-flat']
  expect(res.resourceCounts.Observation).toBe(2)
  const c0 = res.cases[0]
  expect(c0.id).toBe('obs')
  expect(c0.inputRows).toBe(2) // number of Observation resources loaded
  expect(c0.stats).toHaveProperty('mean')
  expect(c0.stats).toHaveProperty('median')
  expect(c0.stats).not.toHaveProperty('p50')
  expect(c0.stats).toHaveProperty('stddev')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('the results map is keyed by the stable suite name, not the free-text title', () => {
  const dataRoot = seedData()
  const report = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(report.results).toHaveProperty('clinical-flat') // suite name
  expect(report.results).not.toHaveProperty('Clinical flat (human label)') // title
  rmSync(dataRoot, { recursive: true, force: true })
})

test('both scenarios default to a csv sink', () => {
  const dataRoot = seedData()
  const e2e = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    scenario: 'end_to_end',
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  const pre = buildReport({
    benchmark,
    size: 's',
    dataRoot,
    scenario: 'preloaded_repeated',
    impl: { engine: { name: 'sof-js', version: '2.0.0' } },
  })
  expect(e2e.measurement.sink).toBe('csv')
  expect(pre.measurement.sink).toBe('csv')
  // The scenario distinction is the load boundary, not the sink: end_to_end
  // includes load; preloaded_repeated excludes it. Both extract to csv.
  expect(e2e.measurement.phases).toEqual(['load', 'execute', 'extract'])
  expect(pre.measurement.phases).toEqual(['execute', 'extract'])
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- §5.1: analytic derivation ----

test('deriveExpectedCount: plain projection => input resource count', () => {
  const dataRoot = seedData()
  const resources = readFileSync(join(dataRoot, 'synthea-clinical', '1', 's', 'Observation.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(deriveExpectedCount(benchmark.cases[0].view, resources)).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('deriveExpectedCount: forEach over a collection => total collection-entry count', () => {
  const dataRoot = seedData()
  const resources = readFileSync(join(dataRoot, 'synthea-clinical', '1', 's', 'Observation.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(deriveExpectedCount(benchmark.cases[1].view, resources)).toBe(3)
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- §5/§6: bless writes the checkfile, cross-checked, other sizes preserved ----

test('blessCheckfile writes the checkfile with counts, checksums and assertions; not the benchmark file', () => {
  const dataRoot = seedData()
  const cfPath = checkfilePath(dataRoot)
  blessCheckfile({ benchmark, size: 's', dataRoot, checkfilePath: cfPath })
  const cf = readCheckfile(cfPath)
  expect(cf.dataset).toEqual({ name: 'synthea-clinical', version: '1' })
  expect(cf.syntheaVersion).toBe('3.2.0')
  expect(cf.sizes.s.resourceCounts.Observation).toBe(2)
  expect(cf.sizes.s.files['Observation.ndjson'].sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(assertionFor(cf, 'obs', 's')).toBe(2)
  expect(assertionFor(cf, 'obs-components', 's')).toBe(3) // forEach entry count
  rmSync(dataRoot, { recursive: true, force: true })
})

test('checkfileFor derives the checkfile path from the benchmark file path', () => {
  expect(checkfileFor('/bench/clinical-flat.json')).toBe('/bench/clinical-flat.check.json')
})
