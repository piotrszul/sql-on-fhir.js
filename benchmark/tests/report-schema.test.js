import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-report.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodReport = {
  implementation: { engine: { name: 'sof-js', version: '2.0.0' } },
  benchmark: { name: 'clinical-flat', version: '1' },
  dataset: { name: 'synthea-clinical', version: '1' },
  measurement: {
    scenario: 'preloaded_repeated',
    phases: ['execute', 'extract'],
    sink: 'memory',
    warmup: 1,
    iterations: 5,
  },
  results: {
    'clinical-flat': {
      size: 's',
      resourceCounts: { Condition: 10 },
      cases: [
        {
          id: 'condition-flat',
          status: 'ok',
          inputRows: 10,
          outputRows: 10,
          samplesMs: [1.2, 1.3],
          stats: { mean: 1.25, min: 1.2, max: 1.3, stddev: 0.05, median: 1.25 },
        },
      ],
    },
  },
}

test('a well-formed report passes the schema', () => {
  expect(validate(goodReport)).toBe(true)
})

test('a report with binding and variant passes the schema', () => {
  const r = structuredClone(goodReport)
  r.implementation.binding = { name: 'sof-py', version: '0.3.0' }
  r.implementation.variant = 'columnar'
  expect(validate(r)).toBe(true)
})

test('a report with the old flat implementation shape is rejected', () => {
  const bad = structuredClone(goodReport)
  bad.implementation = { name: 'sof-js', version: '2.0.0' }
  expect(validate(bad)).toBe(false)
})

test('a report omitting implementation.engine is rejected', () => {
  const bad = structuredClone(goodReport)
  delete bad.implementation.engine
  bad.implementation.binding = { name: 'sof-py', version: '0.3.0' }
  expect(validate(bad)).toBe(false)
})

test('a measurement.scenario outside the enum is rejected', () => {
  const bad = structuredClone(goodReport)
  bad.measurement.scenario = 'throughput'
  expect(validate(bad)).toBe(false)
})

test('both scenario enum members are accepted', () => {
  const e2e = structuredClone(goodReport)
  e2e.measurement.scenario = 'end_to_end'
  expect(validate(e2e)).toBe(true)
  const pre = structuredClone(goodReport)
  pre.measurement.scenario = 'preloaded_repeated'
  expect(validate(pre)).toBe(true)
})

test('a free-form stats missing the defined fields is rejected', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].stats = { avg: 1.2 }
  expect(validate(bad)).toBe(false)
})

test('stats carrying {mean, stddev, min, max, median} is accepted', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].stats = { mean: 1.25, stddev: 0.05, min: 1.2, max: 1.3, median: 1.25 }
  expect(validate(r)).toBe(true)
})

test('stats omitting median (a required field) is rejected', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].stats = { mean: 1.25, stddev: 0.05, min: 1.2, max: 1.3 }
  expect(validate(bad)).toBe(false)
})

test('stats carrying the required fields but omitting p95 and ci95 is accepted (both optional)', () => {
  const r = structuredClone(goodReport)
  const c = r.results['clinical-flat'].cases[0]
  c.stats = { mean: 1.25, stddev: 0.05, min: 1.2, max: 1.3, median: 1.25 }
  expect(c.stats).not.toHaveProperty('p95')
  expect(c.stats).not.toHaveProperty('ci95')
  expect(validate(r)).toBe(true)
})

test('stats carrying an optional p95 is accepted', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].stats = {
    mean: 1.25,
    stddev: 0.05,
    min: 1.2,
    max: 1.3,
    median: 1.25,
    p95: 1.3,
  }
  expect(validate(r)).toBe(true)
})

test('samplesMs with a low count is accepted (>= 7 is advisory, never a minItems floor)', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].samplesMs = [1.2]
  expect(validate(r)).toBe(true)
})

test('a low sample count is NOT schema-rejected (>= 7 is advisory)', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].samplesMs = [1.2]
  expect(validate(r)).toBe(true)
})

test('an invalid status value fails the schema', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].status = 'slow'
  expect(validate(bad)).toBe(false)
})

test('a per-case result must key on id, not title', () => {
  const bad = structuredClone(goodReport)
  delete bad.results['clinical-flat'].cases[0].id
  bad.results['clinical-flat'].cases[0].title = 'condition flat'
  expect(validate(bad)).toBe(false)
})

test('an unknown key in the implementation object fails the schema', () => {
  const bad = structuredClone(goodReport)
  bad.implementation.vendor = 'acme'
  expect(validate(bad)).toBe(false)
})

test('an unknown key in a per-result object fails the schema', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].notes = 'extra'
  expect(validate(bad)).toBe(false)
})
