// Shared CSV serialization for flat (row-object) results.
//
// Single source of truth so the server `$run`/SQL-query paths and the benchmark
// runner materialize CSV identically — the benchmark's `sink: 'csv'` extract
// cost is only comparable to a real CSV writer if it uses the same serializer.

import { openSync, writeSync, closeSync } from 'node:fs'

// RFC-4180-style escaping: quote a field that contains a comma, quote or
// newline, doubling any embedded quotes. null/undefined become empty.
export function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

// Yield CSV lines one at a time: the header (unless suppressed) then one line per
// row. The single source of the CSV shape — both serializeCsv and writeCsvFile
// build on it — so a streaming writer never has to differ from the whole-string
// serializer by a byte. An empty result yields nothing.
export function* csvLines(rows, { includeHeader = true } = {}) {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  if (includeHeader) yield cols.join(',')
  for (const row of rows) {
    yield cols.map((c) => csvEscape(row[c])).join(',')
  }
}

// Serialize an array of row objects to CSV text. Columns are taken from the
// first row's keys. Emits a header row (unless includeHeader is false) followed
// by one line per row. An empty result serializes to the empty string.
export function serializeCsv(rows, opts = {}) {
  return [...csvLines(rows, opts)].join('\n')
}

// Stream row objects to a CSV file, flushing a bounded line buffer to disk rather
// than ever holding the whole CSV as one string — a wide result at the xl tier can
// exceed the engine's max string length even when the row objects fit in memory.
// Synchronous (openSync/writeSync) so the hook's request handler stays sync, and
// byte-identical to serializeCsv + writeFileSync (lines joined by '\n', no
// trailing newline; an empty result writes an empty file). This bounds the CSV
// WRITE; the resident result-row array that the non-streaming evaluate() returns
// is inherent to the engine and out of scope for this bound.
export function writeCsvFile(path, rows, { includeHeader = true, bufferBytes = 1 << 16 } = {}) {
  const fd = openSync(path, 'w')
  try {
    // Lines accumulate in an array and are joined once per flush — no per-line
    // string concatenation. The flush threshold counts UTF-16 units, an
    // approximation of bytes that only affects flush timing, never content.
    let parts = []
    let buffered = 0
    let first = true
    for (const line of csvLines(rows, { includeHeader })) {
      parts.push(line)
      buffered += line.length + 1
      if (buffered >= bufferBytes) {
        writeSync(fd, (first ? '' : '\n') + parts.join('\n'))
        first = false
        parts = []
        buffered = 0
      }
    }
    if (parts.length > 0) writeSync(fd, (first ? '' : '\n') + parts.join('\n'))
  } finally {
    closeSync(fd)
  }
}
