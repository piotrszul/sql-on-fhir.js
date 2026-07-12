import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { countCsvRows } from '../tools/harness/csv-count.js'
import { statsOf } from '../tools/harness/stats.js'

function csvFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'csv-'))
  const path = join(dir, 'out.csv')
  writeFileSync(path, content)
  return { path, dir }
}

test('counts data rows below the header', () => {
  const { path, dir } = csvFile('id,code\n1,a\n2,b\n3,c')
  expect(countCsvRows(path)).toBe(3)
  rmSync(dir, { recursive: true, force: true })
})

test('an empty file (empty result) is zero rows', () => {
  const { path, dir } = csvFile('')
  expect(countCsvRows(path)).toBe(0)
  rmSync(dir, { recursive: true, force: true })
})

test('a header-only file is zero rows', () => {
  const { path, dir } = csvFile('id,code')
  expect(countCsvRows(path)).toBe(0)
  rmSync(dir, { recursive: true, force: true })
})

// The run-output contract (benchmark-hook-format) requires a single CSV file
// carrying a HEADER row: the harness counts data rows as line-count-minus-one.
// An engine that writes headerless CSV is therefore silently undercounted by
// one and fails verification for a non-obvious reason — this pins that the
// header is a contract requirement, not a cosmetic detail. Surfaced validating
// the Pathling CLI hook (staging-hooks/pathling-cli/FINDINGS.md).
test('a headerless CSV is undercounted — run output must carry a header row', () => {
  const { path, dir } = csvFile('1,a\n2,b\n3,c') // three data rows, no header
  expect(countCsvRows(path)).toBe(2) // miscounted by one: the header contract bites
  rmSync(dir, { recursive: true, force: true })
})

test('a quoted embedded newline does not count as a row boundary', () => {
  const { path, dir } = csvFile('id,note\n1,"line one\nline two"\n2,plain')
  expect(countCsvRows(path)).toBe(2)
  rmSync(dir, { recursive: true, force: true })
})

test('a trailing newline does not add a phantom row', () => {
  const { path, dir } = csvFile('id\n1\n2\n')
  expect(countCsvRows(path)).toBe(2)
  rmSync(dir, { recursive: true, force: true })
})

test('escaped double quotes inside a quoted field are handled', () => {
  const { path, dir } = csvFile('id,note\n1,"say ""hi""\nthere"')
  expect(countCsvRows(path)).toBe(1)
  rmSync(dir, { recursive: true, force: true })
})

// countCsvRows streams the output CSV in fixed-size byte chunks (a wide xl
// result's CSV can exceed the engine's max string length), so the RFC-4180 quote
// state — which decides whether a newline is a row boundary or quoted content —
// must carry across chunk boundaries. Forcing tiny chunk sizes lands boundaries
// inside a quoted field, between the two quotes of an escaped `""`, and mid
// multibyte character.
test('countCsvRows is chunk-boundary correct with tiny chunks', () => {
  const content = 'id,note\n1,"line one\nline two"\n2,"say ""hi""\ncafé 😀"\n3,plain'
  const { path, dir } = csvFile(content)
  expect(countCsvRows(path)).toBe(3) // whole-file reference
  for (const chunkBytes of [1, 2, 3, 5, 7, 64]) {
    expect(countCsvRows(path, { chunkBytes }), `chunk ${chunkBytes}`).toBe(3)
  }
  rmSync(dir, { recursive: true, force: true })
})

test('statsOf computes the defined basic-statistics shape', () => {
  const s = statsOf([2, 4, 6])
  expect(s.min).toBe(2)
  expect(s.max).toBe(6)
  expect(s.mean).toBe(4)
  expect(s.median).toBe(4)
  expect(s).toHaveProperty('stddev')
  expect(s).not.toHaveProperty('p50')
})
