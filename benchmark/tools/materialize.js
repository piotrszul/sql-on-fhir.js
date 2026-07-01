import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { datasetDir, manifestFile, recipeOf } from './layout.js'

// Synthea's bulk export emits the same resources in a non-deterministic LINE ORDER
// across runs (--generate.thread_count=1 pins generation, not export iteration order),
// so the raw NDJSON is only SORTED-identical, not byte-identical. Canonicalise by
// sorting lines with a byte-wise comparator so the persisted bytes — and their
// sha256 — are stable across environments, which is what the checkfile locks.
function canonicaliseNdjson(src, dst) {
  const txt = readFileSync(src, 'utf8')
  const lines = txt.split('\n').filter((l) => l.length > 0)
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  writeFileSync(dst, lines.length ? lines.join('\n') + '\n' : '')
  return lines.length
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export async function materialize({ dataset, size, dataRoot, executor, force = false }) {
  const recipe = recipeOf(dataset)
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
    const checksums = {}
    for (const r of dataset.resources) {
      const src = join(staging, `${r}.ndjson`)
      if (!existsSync(src)) throw new Error(`executor did not produce ${r}.ndjson`)
      const dst = join(dir, `${r}.ndjson`)
      counts[r] = canonicaliseNdjson(src, dst)
      checksums[`${r}.ndjson`] = { sha256: sha256Of(dst) }
    }
    const manifest = {
      name: dataset.name,
      kind: dataset.kind,
      version: dataset.version,
      size,
      population,
      resources: counts,
      files: checksums,
      generatedAt: new Date().toISOString(),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
