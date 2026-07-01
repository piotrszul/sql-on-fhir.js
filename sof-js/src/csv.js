// Shared CSV serialization for flat (row-object) results.
//
// Single source of truth so the server `$run`/SQL-query paths and the benchmark
// runner materialize CSV identically — the benchmark's `sink: 'csv'` extract
// cost is only comparable to a real CSV writer if it uses the same serializer.

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

// Serialize an array of row objects to CSV text. Columns are taken from the
// first row's keys. Emits a header row (unless includeHeader is false) followed
// by one line per row. An empty result serializes to the empty string.
export function serializeCsv(rows, { includeHeader = true } = {}) {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const lines = []
  if (includeHeader) lines.push(cols.join(','))
  for (const row of rows) {
    lines.push(cols.map((c) => csvEscape(row[c])).join(','))
  }
  return lines.join('\n')
}
