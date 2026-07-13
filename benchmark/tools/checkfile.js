import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { datasetDir, resourceFile, sha256Of, scanFileBytes } from './layout.js'

// The checkfile is the committed home for everything GENERATED about a benchmark:
// dataset identity, generator version, per-size resource counts, per-file sha256
// checksums, and the result assertions moved out of the benchmark file. These are
// pure data operations (no timing/execution), so they live in the build tooling;
// the runner composes them with its own timing harness and analytic cross-check.

// The one newline-count rule, shared structurally by countLines and
// hashAndCountLines rather than asserted equivalent in a comment: a file that
// does not end in a newline counts its final unterminated line, and an empty
// file counts zero. Newlines are found with Buffer.indexOf (native memchr)
// rather than a per-byte JS loop — a counting pass at the xl tier visits ~9e9
// bytes. `0x0A` never occurs inside a UTF-8 multibyte sequence, so byte-level
// scanning is multibyte-safe.
function lineTally() {
  let total = 0
  let newlines = 0
  let lastByte = -1
  return {
    update(buf, n) {
      for (let i = 0; (i = buf.indexOf(10, i)) !== -1 && i < n; i++) newlines++
      lastByte = buf[n - 1]
      total += n
    },
    lines: () => (total === 0 ? 0 : lastByte === 10 ? newlines : newlines + 1),
  }
}

// Count NDJSON lines by streaming the file. The checkfile locks these counts
// under sha256, so every other consumer (e.g. the harness's report
// resourceCounts) reuses this single implementation rather than risking
// divergent semantics.
export function countLines(path, { chunkBytes } = {}) {
  const tally = lineTally()
  scanFileBytes(path, tally.update, chunkBytes)
  return tally.lines()
}

// Streaming sha256 + line count in a single pass over the same fixed-size chunks,
// so blessing the largest tier stays memory-bounded (benchmark-reference-runner).
export function hashAndCountLines(path, { chunkBytes } = {}) {
  const hash = createHash('sha256')
  const tally = lineTally()
  scanFileBytes(
    path,
    (buf, n) => {
      hash.update(buf.subarray(0, n))
      tally.update(buf, n)
    },
    chunkBytes,
  )
  return { sha256: hash.digest('hex'), lines: tally.lines() }
}

// Build a checkfile object from materialized data + assertions. When `previous` is
// supplied, sizes and per-case assertion entries not being (re-)blessed now are
// carried forward, so blessing one size never disturbs another. sha256 and line
// counts are computed in a single streaming pass so the largest tier stays
// memory-bounded.
//
// `keepIds` names every case id that should survive the prune (the full current
// benchmark, so unselected cases keep their prior assertions when blessing a
// subset). It defaults to the ids being blessed now, preserving the original
// "prune to the current keys" behaviour for callers that bless the whole file.
export function buildCheckfile({ dataRoot, dataset, sizes, assertions, previous, keepIds }) {
  const sizeEntries = { ...(previous?.sizes || {}) }
  for (const size of sizes) {
    const resourceCounts = {}
    const files = {}
    for (const r of dataset.resources) {
      const path = resourceFile(dataRoot, dataset.name, dataset.version, size, r)
      const { sha256, lines } = hashAndCountLines(path)
      resourceCounts[r] = lines
      files[`${r}.ndjson`] = { sha256 }
    }
    sizeEntries[size] = { resourceCounts, files }
  }

  // Merge assertions per case per size on top of any previous assertions, then
  // prune: only case ids still in the current benchmark survive, so a
  // deleted/renamed case's stale assertion does not persist. `keepIds` is the
  // full current case set; an unselected case (no fresh assertion this run) keeps
  // its carried-forward previous value.
  const currentIds = new Set(keepIds || Object.keys(assertions || {}))
  const merged = {}
  for (const id of currentIds) {
    merged[id] = { ...(previous?.assertions?.[id] || {}), ...(assertions?.[id] || {}) }
  }

  return {
    dataset: { name: dataset.name, version: dataset.version },
    syntheaVersion: dataset.syntheaVersion,
    sizes: sizeEntries,
    assertions: merged,
  }
}

export function writeCheckfile(path, checkfile) {
  writeFileSync(path, JSON.stringify(checkfile, null, 2) + '\n')
}

export function readCheckfile(path) {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Read the expected output row count for a case id at a size, or undefined.
export function assertionFor(checkfile, id, size) {
  return checkfile?.assertions?.[id]?.[size]
}

// Optional strict check: recompute each locked file's sha256 and report drift.
export function verifyChecksums({ dataRoot, checkfile, size }) {
  const drift = []
  const files = checkfile?.sizes?.[size]?.files || {}
  const dir = datasetDir(dataRoot, checkfile.dataset.name, checkfile.dataset.version, size)
  for (const [file, { sha256 }] of Object.entries(files)) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      drift.push(`${size}/${file}: missing (locked ${sha256})`)
      continue
    }
    const actual = sha256Of(path)
    if (actual !== sha256) drift.push(`${size}/${file}: sha256 drift (locked ${sha256}, actual ${actual})`)
  }
  return drift
}
