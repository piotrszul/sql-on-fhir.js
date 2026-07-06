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

// ---- benchmark-harness change: stats opens for additive extension ----
// The five fields stay REQUIRED; extra fields are PERMITTED (no consumer may
// rely on them). Forcing recomputation from samplesMs is achieved by keeping
// samplesMs required, not by banning keys.

test('stats carrying a p95 beyond the required five is accepted (open for extension)', () => {
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

test('stats carrying a ci95 beyond the required five is accepted (open for extension)', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].stats = {
    mean: 1.25,
    stddev: 0.05,
    min: 1.2,
    max: 1.3,
    median: 1.25,
    ci95: { lo: 1.2, hi: 1.3 },
  }
  expect(validate(r)).toBe(true)
})

// ---- benchmark-harness change: verified distinguishes verified from unverified ok ----

test('a case with verified: true is accepted', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].verified = true
  expect(validate(r)).toBe(true)
})

test('a case with verified: false is accepted', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].verified = false
  expect(validate(r)).toBe(true)
})

test('a case without verified remains valid (the field is optional and additive)', () => {
  const r = structuredClone(goodReport)
  expect(r.results['clinical-flat'].cases[0]).not.toHaveProperty('verified')
  expect(validate(r)).toBe(true)
})

test('a non-boolean verified is rejected', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].verified = 'yes'
  expect(validate(bad)).toBe(false)
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

// ---- Wave 2 (#8): status taxonomy extension + optional per-case message ----

test('a case status of timeout is accepted (Wave 2 enum extension)', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].status = 'timeout'
  expect(validate(r)).toBe(true)
})

test('a case status of malformed is accepted (Wave 2 enum extension)', () => {
  const r = structuredClone(goodReport)
  r.results['clinical-flat'].cases[0].status = 'malformed'
  expect(validate(r)).toBe(true)
})

test('all six status enum members are accepted', () => {
  for (const status of [
    'ok',
    'count_mismatch',
    'generation_error',
    'execution_error',
    'timeout',
    'malformed',
  ]) {
    const r = structuredClone(goodReport)
    r.results['clinical-flat'].cases[0].status = status
    expect(validate(r)).toBe(true)
  }
})

test('a case with a free-text message is accepted (message is optional context)', () => {
  const r = structuredClone(goodReport)
  const c = r.results['clinical-flat'].cases[0]
  c.status = 'execution_error'
  c.message = 'engine raised: unsupported fhirpath function frobnicate()'
  expect(validate(r)).toBe(true)
})

test('a case WITHOUT a message is accepted (message is optional)', () => {
  const r = structuredClone(goodReport)
  const c = r.results['clinical-flat'].cases[0]
  expect(c).not.toHaveProperty('message')
  expect(validate(r)).toBe(true)
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
