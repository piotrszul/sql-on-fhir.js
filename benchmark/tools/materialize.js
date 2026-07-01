import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { datasetDir, manifestFile, recipeOf } from './layout.js'

function countLines(path) {
  const txt = readFileSync(path, 'utf8')
  if (txt.length === 0) return 0
  return txt.endsWith('\n') ? txt.split('\n').length - 1 : txt.split('\n').length
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
      renameSync(src, dst)
      counts[r] = countLines(dst)
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
