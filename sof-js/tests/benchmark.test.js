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

test('timeEvaluate materializes CSV inside the timed region (sink csv is truthful)', () => {
  const resources = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  const { outputRows, csv } = timeEvaluate(view, resources, { warmup: 0, measurement: 1 })
  // The timed region must serialize the evaluated rows to CSV, not just return a
  // JS array — otherwise sink:'csv' is not comparable to a runner that writes real CSV.
  expect(typeof csv).toBe('string')
  const lines = csv.split('\n').filter((l) => l.length > 0)
  // header row + one line per output row
  expect(lines.length).toBe(outputRows + 1)
  // header carries the view columns (order follows evaluate()'s row keys)
  expect(lines[0].split(',').sort()).toEqual(['comp_code', 'id'])
  // count semantics unchanged: 2 components on o1 + 1 on o2
  expect(outputRows).toBe(3)
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
