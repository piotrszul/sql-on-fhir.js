import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadResources, timeEvaluate, statsOf } from '../src/benchmark.js'

const view = {
  resource: 'Observation',
  select: [
    { column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] },
    {
      forEach: 'component',
      column: [{ name: 'comp_code', path: 'code.coding.first().code', type: 'string' }],
    },
  ],
}

test('loadResources parses NDJSON into an array', () => {
  const rows = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  expect(rows).toHaveLength(2)
  expect(rows[0].resourceType).toBe('Observation')
})

test('timeEvaluate returns one sample per measurement iteration and the output row count', () => {
  const resources = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  const { samplesMs, outputRows } = timeEvaluate(view, resources, { warmup: 1, measurement: 3 })
  expect(samplesMs).toHaveLength(3)
  expect(outputRows).toBe(3) // 2 components on o1 + 1 on o2
})

test('statsOf computes the defined basic-statistics shape (median replaces p50)', () => {
  const s = statsOf([2, 4, 6])
  expect(s.min).toBe(2)
  expect(s.max).toBe(6)
  expect(s.mean).toBe(4)
  expect(s).toHaveProperty('stddev')
  expect(s).toHaveProperty('median')
  expect(s.median).toBe(4)
  expect(s).not.toHaveProperty('p50')
  expect(s).not.toHaveProperty('p95')
})
