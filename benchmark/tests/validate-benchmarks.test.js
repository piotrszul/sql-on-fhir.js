import { test, expect } from 'bun:test'
import { validateBenchmark, validateGroup, validateSchema } from '../tools/validate-benchmarks.js'

const base = () => ({
  title: 't',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'd', kind: 'synthea', version: '3.2.0',
    resources: ['Condition'],
    sizes: { s: { population: 100 }, m: { population: 1000 } },
    defaultSize: 's',
  },
  cases: [{ title: 'c', view: { resource: 'Condition' }, expectCount: { s: 10, m: 100 } }],
})

test('a valid file yields no errors', () => {
  expect(validateBenchmark(base())).toEqual([])
})

test('case view.resource must be in dataset.resources', () => {
  const f = base()
  f.cases[0].view.resource = 'Patient'
  expect(validateBenchmark(f)).toContain('case "c": view.resource "Patient" not in dataset.resources')
})

test('reference functions are allowed (single-resource is a measurement-setup property)', () => {
  const f = base()
  f.cases[0].view.select = [
    { column: [{ name: 'id', path: 'getResourceKey()' }, { name: 'subj', path: 'getReferenceKey(subject)' }] },
  ]
  expect(validateBenchmark(f)).toEqual([])
})

test('expectCount keys must be declared sizes', () => {
  const f = base()
  f.cases[0].expectCount = { s: 10, XL: 1 }
  expect(validateBenchmark(f).some((e) => e.includes('expectCount size "XL"'))).toBe(true)
})

test('defaultSize must be a declared size', () => {
  const f = base()
  f.dataset.defaultSize = 'nope'
  expect(validateBenchmark(f).some((e) => e.includes('defaultSize'))).toBe(true)
})

test('group members must declare identical size-tier names', () => {
  const a = base(); a.group = 'g'
  const b = base(); b.group = 'g'; b.dataset.sizes = { s: { population: 5 } }
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
