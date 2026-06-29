import { createHash } from 'node:crypto'
import { join } from 'node:path'

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

export function recipeHash(recipe) {
  return createHash('sha256').update(stableStringify(recipe)).digest('hex').slice(0, 8)
}

export function datasetKey(name, recipe) {
  return `${name}_${recipeHash(recipe)}`
}

export function datasetDir(dataRoot, name, recipe, size) {
  return join(dataRoot, datasetKey(name, recipe), size)
}

export function resourceFile(dataRoot, name, recipe, size, resourceType) {
  return join(datasetDir(dataRoot, name, recipe, size), `${resourceType}.ndjson`)
}

export function manifestFile(dataRoot, name, recipe, size) {
  return join(datasetDir(dataRoot, name, recipe, size), 'manifest.json')
}
