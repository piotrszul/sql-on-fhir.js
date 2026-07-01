import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { datasetDir } from './layout.js'

// The checkfile is the committed home for everything GENERATED about a benchmark:
// dataset identity, generator version, per-size resource counts, per-file sha256
// checksums, and the result assertions moved out of the benchmark file. These are
// pure data operations (no timing/execution), so they live in the build tooling;
// the runner composes them with its own timing harness and analytic cross-check.

function countLines(path) {
  const txt = readFileSync(path, 'utf8')
  if (txt.length === 0) return 0
  return txt.endsWith('\n') ? txt.split('\n').length - 1 : txt.split('\n').length
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Build a checkfile object from materialized data + assertions. When `previous` is
// supplied, sizes and per-case assertion entries not being (re-)blessed now are
// carried forward, so blessing one size never disturbs another.
export function buildCheckfile({ dataRoot, dataset, sizes, assertions, previous }) {
  const sizeEntries = { ...(previous?.sizes || {}) }
  for (const size of sizes) {
    const dir = datasetDir(dataRoot, dataset.name, dataset.version, size)
    const resourceCounts = {}
    const files = {}
    for (const r of dataset.resources) {
      const path = `${dir}/${r}.ndjson`
      resourceCounts[r] = countLines(path)
      files[`${r}.ndjson`] = { sha256: sha256Of(path) }
    }
    sizeEntries[size] = { resourceCounts, files }
  }

  // Merge assertions per case per size on top of any previous assertions.
  const merged = {}
  for (const id of new Set([...Object.keys(previous?.assertions || {}), ...Object.keys(assertions || {})])) {
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
    const path = `${dir}/${file}`
    if (!existsSync(path)) {
      drift.push(`${size}/${file}: missing (locked ${sha256})`)
      continue
    }
    const actual = sha256Of(path)
    if (actual !== sha256) drift.push(`${size}/${file}: sha256 drift (locked ${sha256}, actual ${actual})`)
  }
  return drift
}
