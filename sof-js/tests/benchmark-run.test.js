import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReport, bless } from '../src/benchmark-run.js'
import { datasetDir } from '../../benchmark/tools/layout.js'

const benchmark = {
  title: 'clinical-flat', fhirVersion: '4.0.1',
  iterations: { warmup: 0, measurement: 2 },
  dataset: {
    name: 'd', kind: 'synthea', version: '3.2.0', resources: ['Observation'],
    sizes: { s: { population: 100 } }, defaultSize: 's', params: { seed: 589 },
  },
  cases: [{ title: 'obs', view: { resource: 'Observation', select: [{ column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] }] }, expectCount: { s: 2 } }],
}

function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'run-'))
  const recipe = { kind: 'synthea', version: '3.2.0', resources: ['Observation'], params: { seed: 589 } }
  const dir = datasetDir(dataRoot, 'd', recipe, 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Observation.ndjson'), '{"resourceType":"Observation","id":"o1"}\n{"resourceType":"Observation","id":"o2"}\n')
  return dataRoot
}

test('buildReport marks a matching count as ok', () => {
  const dataRoot = seedData()
  const report = buildReport({ benchmark, size: 's', dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
  expect(report.results['clinical-flat'].cases[0].status).toBe('ok')
  expect(report.results['clinical-flat'].cases[0].outputRows).toBe(2)
  expect(report.measurement.iterations).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('buildReport flags a count mismatch', () => {
  const dataRoot = seedData()
  const b2 = structuredClone(benchmark)
  b2.cases[0].expectCount.s = 99
  const report = buildReport({ benchmark: b2, size: 's', dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
  expect(report.results['clinical-flat'].cases[0].status).toBe('count_mismatch')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('bless fills expectCount from observed rows', () => {
  const dataRoot = seedData()
  const b3 = structuredClone(benchmark)
  delete b3.cases[0].expectCount
  const blessed = bless({ benchmark: b3, size: 's', dataRoot })
  expect(blessed.cases[0].expectCount.s).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})
