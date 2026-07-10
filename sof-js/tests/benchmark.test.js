import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadResources, streamResources } from '../src/benchmark.js'

test('loadResources parses NDJSON into an array', () => {
  const rows = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  expect(rows).toHaveLength(2)
  expect(rows[0].resourceType).toBe('Observation')
})

// The bless path streams resources one at a time (no whole-file readFileSync of a
// parsed array), which is what bounds bless memory at the xl tier.
test('streamResources yields parsed resources one at a time (async iterator)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stream-'))
  const path = join(dir, 'Observation.ndjson')
  writeFileSync(
    path,
    [
      JSON.stringify({ resourceType: 'Observation', id: 'o1' }),
      '', // blank line must be skipped
      JSON.stringify({ resourceType: 'Observation', id: 'o2' }),
      JSON.stringify({ resourceType: 'Observation', id: 'o3' }),
    ].join('\n') + '\n',
  )
  const gen = streamResources(path)
  expect(typeof gen[Symbol.asyncIterator]).toBe('function')
  const ids = []
  for await (const r of gen) {
    expect(r.resourceType).toBe('Observation')
    ids.push(r.id)
  }
  expect(ids).toEqual(['o1', 'o2', 'o3'])
  rmSync(dir, { recursive: true, force: true })
})
