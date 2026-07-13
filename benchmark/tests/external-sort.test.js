import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sortFileLines } from '../tools/external-sort.js'

// The canonicalisation contract that bless's checksums depend on: sort the
// non-empty lines with the SAME ordinal comparator the in-memory canonicaliser
// used, one line per output row, trailing newline, empty file => empty output.
// sortFileLines MUST be byte-identical to this reference so existing checkfiles
// stay valid — but memory-bounded (external merge sort), not a whole-file load.
const ORDINAL = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
function reference(lines) {
  const sorted = [...lines].filter((l) => l.length > 0).sort(ORDINAL)
  return sorted.length ? sorted.join('\n') + '\n' : ''
}

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'extsort-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(lines, opts) {
  const src = join(dir, 'in.ndjson')
  const dst = join(dir, 'out.ndjson')
  writeFileSync(src, lines.length ? lines.join('\n') + '\n' : '')
  const count = sortFileLines(src, dst, opts)
  return { count, out: () => readFileSync(dst, 'utf8') }
}

test('output is byte-identical to the in-memory ordinal sort, including unicode', async () => {
  const lines = [
    '{"id":"c","name":"Rubén780"}',
    '{"id":"a","name":"Zoë"}',
    '{"id":"b","name":"Ann"}',
    '{"id":"d","name":"Éric"}',
    '{"id":"a","name":"Aaron"}',
    '{"id":"e","name":"Þorvald"}',
  ]
  const { count, out } = run(lines)
  expect(await count).toBe(6)
  expect(out()).toBe(reference(lines))
})

test('byte-identical across many external-merge chunks (tiny memory budget)', async () => {
  // Deterministic pseudo-shuffle of 5000 distinct lines; a small maxBytes forces
  // many on-disk runs + a k-way merge across run boundaries. Output must still
  // equal the single-pass reference sort exactly.
  const lines = []
  for (let i = 0; i < 5000; i++) {
    const k = ((i * 2654435761) % 5000).toString().padStart(5, '0')
    lines.push(`{"key":"${k}","i":${i}}`)
  }
  const { count, out } = run(lines, { maxBytes: 4096 })
  expect(await count).toBe(5000)
  expect(out()).toBe(reference(lines))
})

test('empty input yields empty output and zero count', async () => {
  const { count, out } = run([])
  expect(await count).toBe(0)
  expect(out()).toBe('')
})

test('already-sorted input is idempotent (byte-identical)', async () => {
  const sorted = ['{"a":1}', '{"a":2}', '{"a":3}', '{"b":1}'].sort(ORDINAL)
  const { count, out } = run(sorted, { maxBytes: 16 })
  await count
  expect(out()).toBe(reference(sorted))
})
