import { scanFileBytes } from '../layout.js'

// Count the DATA rows of a written CSV file — the harness-derived output row
// count that feeds the work-verification guard, independent of whatever the
// engine under test reports. RFC-4180 dialect: a newline inside a quoted field
// is content, not a row boundary; quotes are escaped by doubling (which this
// state machine handles naturally, since the closing and reopening quote toggle
// the state twice). An empty file is an empty result (the shared serializer
// emits no header for zero rows); otherwise the first line is the header.
//
// The file is scanned in fixed-size byte chunks (scanFileBytes) with the quote
// state carried across chunk boundaries, so a wide result's CSV is never held as
// one whole-file string (which at the xl tier can exceed the engine's max string
// length). `"` (0x22) and `\n` (0x0A) are single-byte ASCII that never occur as
// UTF-8 continuation bytes, so byte-level scanning is multibyte-safe; the
// per-byte loop (unlike the checkfile's memchr-based line tally) is inherent to
// tracking quote state.
export function countCsvRows(path, { chunkBytes } = {}) {
  let boundaries = 0
  let inQuotes = false
  let total = 0
  let lastByte = -1
  scanFileBytes(
    path,
    (buf, n) => {
      for (let i = 0; i < n; i++) {
        const b = buf[i]
        if (b === 34)
          inQuotes = !inQuotes // '"'
        else if (b === 10 && !inQuotes) boundaries++ // '\n'
      }
      lastByte = buf[n - 1]
      total += n
    },
    chunkBytes,
  )
  if (total === 0) return 0
  // A trailing newline terminates the last row rather than starting a new one.
  // (At a well-formed EOF quotes are always balanced, so the final `\n` — if any
  // — is necessarily an unquoted row boundary already counted above.)
  const lines = lastByte === 10 ? boundaries : boundaries + 1
  return Math.max(0, lines - 1)
}
