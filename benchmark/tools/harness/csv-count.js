import { readFileSync } from 'node:fs'

// Count the DATA rows of a written CSV file — the harness-derived output row
// count that feeds the work-verification guard, independent of whatever the
// engine under test reports. RFC-4180 dialect: a newline inside a quoted field
// is content, not a row boundary; quotes are escaped by doubling (which this
// state machine handles naturally, since the closing and reopening quote toggle
// the state twice). An empty file is an empty result (the shared serializer
// emits no header for zero rows); otherwise the first line is the header.
export function countCsvRows(path) {
  const txt = readFileSync(path, 'utf8')
  if (txt.length === 0) return 0
  let boundaries = 0
  let inQuotes = false
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === '\n' && !inQuotes) boundaries++
  }
  // A trailing newline terminates the last row rather than starting a new one.
  // (At a well-formed EOF quotes are always balanced, so the final `\n` — if any
  // — is necessarily an unquoted row boundary already counted above.)
  const lines = txt.endsWith('\n') ? boundaries : boundaries + 1
  return Math.max(0, lines - 1)
}
