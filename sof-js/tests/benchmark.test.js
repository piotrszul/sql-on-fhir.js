import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadResources } from '../src/benchmark.js'

test('loadResources parses NDJSON into an array', () => {
  const rows = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  expect(rows).toHaveLength(2)
  expect(rows[0].resourceType).toBe('Observation')
})
