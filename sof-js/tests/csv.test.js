import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serializeCsv, writeCsvFile } from '../src/csv.js'

const rows = [
  { id: '1', note: 'plain' },
  { id: '2', note: 'has,comma "quote"\nand newline' },
  { id: '3', note: 'café 😀' },
]

// serializeCsv is the shared string serializer the server `$run`/SQL paths still
// depend on; refactoring the hook onto a streaming writer must not change it.
test('serializeCsv is unchanged: header + escaped rows, empty result is empty string', () => {
  expect(serializeCsv([])).toBe('')
  const csv = serializeCsv(rows)
  expect(csv.split('\n')[0]).toBe('id,note')
  // a field with a comma/quote/newline is quoted with doubled quotes
  expect(csv).toContain('"has,comma ""quote""\nand newline"')
})

// The hook writes the run-output CSV by streaming lines to disk, never building
// the whole CSV as one string (a wide xl result can exceed the max string length
// even when the row objects fit). Its bytes MUST be identical to
// serializeCsv + writeFileSync for any buffer size, so the harness's row count
// and any downstream consumer are unaffected.
test('writeCsvFile streams byte-identical output to serializeCsv for any buffer size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csvw-'))
  const expected = serializeCsv(rows)
  for (const bufferBytes of [1, 2, 3, 7, 64]) {
    const p = join(dir, `b${bufferBytes}.csv`)
    writeCsvFile(p, rows, { bufferBytes })
    expect(readFileSync(p, 'utf8'), `buffer ${bufferBytes}`).toBe(expected)
  }
  // an empty result writes an empty file (0 rows), matching serializeCsv([]) === ''
  const pe = join(dir, 'empty.csv')
  writeCsvFile(pe, [], { bufferBytes: 4 })
  expect(readFileSync(pe, 'utf8')).toBe('')
  rmSync(dir, { recursive: true, force: true })
})
