import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Shared content hash for a materialized file. The checkfile is the authoritative
// home for per-file sha256; both the checkfile builder and any consumer that needs
// to compare on-disk bytes use this single implementation.
export function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Dataset identity is the explicit (name, version) pair — human-maintained, NOT a
// derived content hash. This deliberately removes the old JS-only recipe
// canonicaliser, the `.slice(0, 8)` truncation, and the array-order hash bug
// (findings F1/F6): any runner in any language locates data by the string pair
// alone, with no canonicalization contract to reproduce.

export function datasetDir(dataRoot, name, version, size) {
  return join(dataRoot, name, version, size)
}

export function resourceFile(dataRoot, name, version, size, resourceType) {
  return join(datasetDir(dataRoot, name, version, size), `${resourceType}.ndjson`)
}

export function manifestFile(dataRoot, name, version, size) {
  return join(datasetDir(dataRoot, name, version, size), 'manifest.json')
}

// The committed checkfile is a sibling of the benchmark file, discoverable by
// swapping the extension: benchmark/<name>.json -> benchmark/<name>.check.json.
export function checkfileFor(benchmarkPath) {
  const base = basename(benchmarkPath).replace(/\.json$/, '')
  return join(dirname(benchmarkPath), `${base}.check.json`)
}

// The declarative recipe the executor generates from = what the executor needs
// (kind, resources, params). name/version are IDENTITY (not recipe),
// sizes/defaultSize are presentation, and syntheaVersion is identity/lock info
// (not a generation input), so they are stripped.
export function recipeOf(dataset) {
  const { name, version, sizes, defaultSize, syntheaVersion, ...rest } = dataset
  return rest
}
