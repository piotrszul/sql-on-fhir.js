import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark.schema.json'

const ajv = new Ajv({ strict: false })
const validate = ajv.compile(schema)

const goodFile = {
  name: 'clinical-flat',
  version: '1',
  title: 'clinical-flat',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'synthea-clinical',
    kind: 'synthea',
    version: '1',
    resources: ['Condition'],
    sizes: { s: { population: 100 } },
    defaultSize: 's',
  },
  cases: [{ id: 'condition-flat', title: 'condition flat', view: { resource: 'Condition' } }],
}

test('a well-formed benchmark file passes the schema', () => {
  expect(validate(goodFile)).toBe(true)
})

test('a benchmark file missing fhirVersion fails the schema', () => {
  const bad = structuredClone(goodFile)
  delete bad.fhirVersion
  expect(validate(bad)).toBe(false)
})

test('an unknown top-level property fails the schema', () => {
  const bad = { ...goodFile, bogus: 1 }
  expect(validate(bad)).toBe(false)
})

test('a case carrying inline expectCount is rejected', () => {
  const bad = structuredClone(goodFile)
  bad.cases[0].expectCount = { s: 10 }
  expect(validate(bad)).toBe(false)
})

test('a case without a stable id is rejected', () => {
  const bad = structuredClone(goodFile)
  delete bad.cases[0].id
  expect(validate(bad)).toBe(false)
})

test('a file with an explicit dataset version, ids, and no expectCount is accepted', () => {
  expect(validate(goodFile)).toBe(true)
})

test('a benchmark file omitting the suite name is rejected', () => {
  const bad = structuredClone(goodFile)
  delete bad.name
  expect(validate(bad)).toBe(false)
})

test('a benchmark file omitting the suite version is rejected', () => {
  const bad = structuredClone(goodFile)
  delete bad.version
  expect(validate(bad)).toBe(false)
})

test('a file declaring a stable suite name and version alongside title/group is accepted', () => {
  const f = { ...structuredClone(goodFile), group: 'synthea-clinical' }
  expect(validate(f)).toBe(true)
})
