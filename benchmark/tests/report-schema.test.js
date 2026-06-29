import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-report.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodReport = {
  implementation: { name: 'sof-js', version: '2.0.0' },
  measurement: { phases: ['execute', 'extract'], sink: 'memory', warmup: 1, iterations: 5 },
  results: {
    'clinical-flat': {
      size: 's',
      cases: [{ title: 'condition flat', status: 'ok', outputRows: 10, samplesMs: [1.2, 1.3] }],
    },
  },
}

test('a well-formed report passes the schema', () => {
  expect(validate(goodReport)).toBe(true)
})

test('an invalid status value fails the schema', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].status = 'slow'
  expect(validate(bad)).toBe(false)
})
