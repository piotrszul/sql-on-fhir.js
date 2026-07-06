import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { blessCheckfile, deriveExpectedCount } from '../src/benchmark-run.js'
import { datasetDir, checkfileFor } from '../../benchmark/tools/layout.js'
import { readCheckfile, assertionFor } from '../../benchmark/tools/checkfile.js'

// benchmark-run.js is bless-only: the measurement loop, report emission and JMH
// projection live in the shared harness (benchmark/tools/harness). What remains
// here is the reference-implementation privilege — minting checkfile assertions
// under the analytic cross-check.

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

// ---- analytic derivation ----

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

// ---- bless writes the checkfile, cross-checked, other sizes preserved ----

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

// bless is all-or-nothing, in deliberate contrast to the harness's per-case
// record-and-continue: a checkfile must never be written from an incomplete run.
test('blessCheckfile HARD-fails when a case resource file is absent (no isolation)', () => {
  const dataRoot = seedData() // seeds Observation.ndjson but NOT Patient.ndjson
  const b = structuredClone(benchmark)
  b.cases.push({
    id: 'missing-data',
    title: 'reads a resource with no materialized file',
    view: {
      resource: 'Patient',
      select: [{ column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] }],
    },
  })
  expect(() =>
    blessCheckfile({ benchmark: b, size: 's', dataRoot, checkfilePath: checkfilePath(dataRoot) }),
  ).toThrow()
  rmSync(dataRoot, { recursive: true, force: true })
})

// A recipe without a generator version must hard-fail rather than silently
// recording the dataset version as the generator version (the removed fallback).
test('blessCheckfile HARD-fails when the recipe omits syntheaVersion', () => {
  const dataRoot = seedData()
  const b = structuredClone(benchmark)
  delete b.dataset.syntheaVersion
  expect(() =>
    blessCheckfile({ benchmark: b, size: 's', dataRoot, checkfilePath: checkfilePath(dataRoot) }),
  ).toThrow(/syntheaVersion/)
  rmSync(dataRoot, { recursive: true, force: true })
})
