import { test, expect } from 'bun:test'
import { validateBenchmark, validateGroup, validateSchema } from '../tools/validate-benchmarks.js'

const base = () => ({
  title: 't',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'd',
    kind: 'synthea',
    version: '1',
    syntheaVersion: '3.2.0',
    resources: ['Condition'],
    params: {
      endTime: 20250101,
      yearsOfHistory: 1,
      hospitalExport: false,
      practitionerExport: false,
      bulkData: true,
    },
    sizes: { s: { population: 100 }, m: { population: 1000 } },
    defaultSize: 's',
  },
  cases: [{ id: 'c', title: 'c', view: { resource: 'Condition' } }],
})

test('a valid file yields no errors', () => {
  expect(validateBenchmark(base())).toEqual([])
})

test('a case carrying inline expectCount is flagged (generated facts belong in the checkfile)', () => {
  const f = base()
  f.cases[0].expectCount = { s: 10, m: 100 }
  expect(validateBenchmark(f).some((e) => e.includes('expectCount'))).toBe(true)
})

test('case view.resource must be in dataset.resources', () => {
  const f = base()
  f.cases[0].view.resource = 'Patient'
  expect(validateBenchmark(f)).toContain('case "c": view.resource "Patient" not in dataset.resources')
})

test('reference functions are allowed (single-resource is a measurement-setup property)', () => {
  const f = base()
  f.cases[0].view.select = [
    {
      column: [
        { name: 'id', path: 'getResourceKey()' },
        { name: 'subj', path: 'getReferenceKey(subject)' },
      ],
    },
  ]
  expect(validateBenchmark(f)).toEqual([])
})

test('a synthea recipe missing syntheaVersion is rejected (needed to echo into the checkfile)', () => {
  const f = base()
  delete f.dataset.syntheaVersion
  expect(validateBenchmark(f).some((e) => e.includes('syntheaVersion'))).toBe(true)
})

test('a synthea recipe missing params.endTime is rejected', () => {
  const f = base()
  delete f.dataset.params.endTime
  expect(validateBenchmark(f).some((e) => e.includes('endTime'))).toBe(true)
})

test('a synthea recipe missing params.yearsOfHistory is rejected', () => {
  const f = base()
  delete f.dataset.params.yearsOfHistory
  expect(validateBenchmark(f).some((e) => e.includes('yearsOfHistory'))).toBe(true)
})

test('a synthea recipe missing params.hospitalExport is rejected', () => {
  const f = base()
  delete f.dataset.params.hospitalExport
  expect(validateBenchmark(f).some((e) => e.includes('hospitalExport'))).toBe(true)
})

test('a synthea recipe missing params.practitionerExport is rejected', () => {
  const f = base()
  delete f.dataset.params.practitionerExport
  expect(validateBenchmark(f).some((e) => e.includes('practitionerExport'))).toBe(true)
})

test('a synthea recipe missing params.bulkData is rejected', () => {
  const f = base()
  delete f.dataset.params.bulkData
  expect(validateBenchmark(f).some((e) => e.includes('bulkData'))).toBe(true)
})

test('a synthea recipe with boolean toggles set to false is valid (false is a declared value)', () => {
  const f = base()
  f.dataset.params.hospitalExport = false
  f.dataset.params.practitionerExport = false
  f.dataset.params.bulkData = false
  expect(validateBenchmark(f)).toEqual([])
})

test('defaultSize must be a declared size', () => {
  const f = base()
  f.dataset.defaultSize = 'nope'
  expect(validateBenchmark(f).some((e) => e.includes('defaultSize'))).toBe(true)
})

test('group members must declare identical size-tier names', () => {
  const a = base()
  a.group = 'g'
  const b = base()
  b.group = 'g'
  b.dataset.sizes = { s: { population: 5 } }
  expect(validateGroup([a, b]).some((e) => e.includes('group "g"'))).toBe(true)
})

test('validateSchema: well-formed benchmark file returns no errors', () => {
  expect(validateSchema(base())).toEqual([])
})

test('validateSchema: file missing required field returns errors', () => {
  const f = base()
  delete f.fhirVersion
  expect(validateSchema(f).length).toBeGreaterThan(0)
})
