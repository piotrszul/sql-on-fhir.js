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

// loadResources reads the file in fixed-size byte chunks (never one whole-file
// string, which an xl resource file would exceed), so it must reassemble lines —
// and multibyte UTF-8 characters — that straddle a chunk boundary, still skip
// blank lines, and still parse a final line with no trailing newline. Forcing
// tiny chunk sizes lands the boundaries mid-line and mid-character.
test('loadResources streams NDJSON: chunk-boundary and multibyte safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-'))
  const p = join(dir, 'Observation.ndjson')
  const rows = [
    { resourceType: 'Observation', id: 'o1', note: 'café' },
    { resourceType: 'Observation', id: 'o2', note: '😀😀' },
    { resourceType: 'Observation', id: 'o3' },
  ]
  // a blank line to skip, and NO trailing newline on the last line
  const content = [JSON.stringify(rows[0]), '', JSON.stringify(rows[1]), JSON.stringify(rows[2])].join('\n')
  writeFileSync(p, content)
  for (const chunkBytes of [1, 2, 3, 5, 8, 64]) {
    expect(loadResources(p, { chunkBytes }), `chunk ${chunkBytes}`).toEqual(rows)
  }
  rmSync(dir, { recursive: true, force: true })
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
