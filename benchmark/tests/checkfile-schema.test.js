import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-checkfile.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodCheckfile = {
  dataset: { name: 'synthea-clinical', version: '1' },
  syntheaVersion: '3.2.0',
  sizes: {
    s: {
      resourceCounts: { Condition: 100, Observation: 200 },
      files: {
        'Condition.ndjson': { sha256: 'a'.repeat(64) },
        'Observation.ndjson': { sha256: 'b'.repeat(64) },
      },
    },
  },
  assertions: {
    'condition-flat': { s: 100 },
    'observation-components': { s: 200 },
  },
}

test('a well-formed checkfile is accepted', () => {
  expect(validate(goodCheckfile)).toBe(true)
})

test('a checkfile missing the dataset identity is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  delete bad.dataset
  expect(validate(bad)).toBe(false)
})

test('a checkfile without syntheaVersion is accepted (present only for synthea datasets)', () => {
  const ok = structuredClone(goodCheckfile)
  delete ok.syntheaVersion
  expect(validate(ok)).toBe(true)
})

test('a checkfile missing sizes is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  delete bad.sizes
  expect(validate(bad)).toBe(false)
})

test('a checkfile missing assertions is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  delete bad.assertions
  expect(validate(bad)).toBe(false)
})

test('an unknown top-level property is rejected', () => {
  const bad = { ...goodCheckfile, bogus: 1 }
  expect(validate(bad)).toBe(false)
})

test('a size entry missing resourceCounts is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  delete bad.sizes.s.resourceCounts
  expect(validate(bad)).toBe(false)
})

test('a size entry missing files is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  delete bad.sizes.s.files
  expect(validate(bad)).toBe(false)
})

test('a file entry missing sha256 is rejected', () => {
  const bad = structuredClone(goodCheckfile)
  bad.sizes.s.files['Condition.ndjson'] = {}
  expect(validate(bad)).toBe(false)
})
