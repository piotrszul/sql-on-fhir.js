import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { datasetDir, resourceFile, sha256Of } from './layout.js'

// The checkfile is the committed home for everything GENERATED about a benchmark:
// dataset identity, generator version, per-size resource counts, per-file sha256
// checksums, and the result assertions moved out of the benchmark file. These are
// pure data operations (no timing/execution), so they live in the build tooling;
// the runner composes them with its own timing harness and analytic cross-check.

// The single NDJSON line-count implementation: the checkfile locks these counts
// under sha256, so every other consumer (e.g. the harness's report
// resourceCounts) reuses it rather than risking divergent semantics.
export function countLines(path) {
  const txt = readFileSync(path, 'utf8')
  if (txt.length === 0) return 0
  return txt.endsWith('\n') ? txt.split('\n').length - 1 : txt.split('\n').length
}

// Streaming sha256 + line count in a single pass, reading the file in fixed-size
// chunks so bless never holds a whole (potentially xl-sized) file in memory. The
// line count is byte-identical to countLines: a file that does not end in a
// newline counts its final unterminated line. Used by buildCheckfile so blessing
// the largest tier stays memory-bounded (benchmark-reference-runner).
export function hashAndCountLines(path) {
  const fd = openSync(path, 'r')
  const hash = createHash('sha256')
  const buf = Buffer.allocUnsafe(1 << 16)
  let total = 0
  let newlines = 0
  let lastByte = -1
  try {
    let n
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n))
      for (let i = 0; i < n; i++) if (buf[i] === 10) newlines++
      lastByte = buf[n - 1]
      total += n
    }
  } finally {
    closeSync(fd)
  }
  const lines = total === 0 ? 0 : lastByte === 10 ? newlines : newlines + 1
  return { sha256: hash.digest('hex'), lines }
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
