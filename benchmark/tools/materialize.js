import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { datasetDir, manifestFile, recipeOf } from './layout.js'
import { sortFileLines } from './external-sort.js'

// Synthea's bulk export emits the same resources in a non-deterministic LINE ORDER
// across runs (multi-threaded generators export patients as they finish, and no
// generator flag serialises that), so the raw NDJSON is only SORTED-identical, not
// byte-identical. Canonicalise by an ordinal (locale-independent) line sort so the
// persisted bytes — and their sha256 — are stable across environments, which is
// what the checkfile locks. The sort is a memory-bounded external merge sort
// (external-sort.js), so even the largest tiers canonicalise without ever loading
// the whole (multi-GB) file into memory. Returns the line count.
function canonicaliseNdjson(src, dst) {
  return sortFileLines(src, dst)
}

export async function materialize({ dataset, size, dataRoot, executor, force = false }) {
  // recipeOf strips syntheaVersion for identity purposes; the executor still needs
  // it to resolve/auto-fetch the pinned generator jar, so pass it through here.
  const recipe = { ...recipeOf(dataset), syntheaVersion: dataset.syntheaVersion }
  const population = dataset.sizes[size].population
  const dir = datasetDir(dataRoot, dataset.name, dataset.version, size)
  const manifestPath = manifestFile(dataRoot, dataset.name, dataset.version, size)

  if (!force && existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const present = dataset.resources.every((r) => existsSync(join(dir, `${r}.ndjson`)))
    if (existing.population === population && present) return existing
  }

  const staging = mkdtempSync(join(tmpdir(), 'bench-gen-'))
  try {
    await executor(recipe, population, staging)
    mkdirSync(dir, { recursive: true })
    // keep only selected resources; prune the rest
    const counts = {}
    for (const r of dataset.resources) {
      const src = join(staging, `${r}.ndjson`)
      if (!existsSync(src)) throw new Error(`executor did not produce ${r}.ndjson`)
      const dst = join(dir, `${r}.ndjson`)
      counts[r] = await canonicaliseNdjson(src, dst)
    }
    // Per-file sha256 lives in the checkfile (the authoritative lock); the manifest
    // records only identity, population, per-file row counts, and a timestamp.
    const manifest = {
      name: dataset.name,
      kind: dataset.kind,
      version: dataset.version,
      size,
      population,
      resources: counts,
      generatedAt: new Date().toISOString(),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
