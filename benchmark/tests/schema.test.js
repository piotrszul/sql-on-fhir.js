import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark.schema.json'

const ajv = new Ajv({ strict: false })
const validate = ajv.compile(schema)

const goodFile = {
  title: 'clinical-flat',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'synthea-clinical',
    kind: 'synthea',
    version: '3.2.0',
    resources: ['Condition'],
    sizes: { s: { population: 100 } },
    defaultSize: 's',
  },
  cases: [{ title: 'condition flat', view: { resource: 'Condition' } }],
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
