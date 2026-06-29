import { test, expect } from 'bun:test'
import { recipeHash, datasetKey, datasetDir, resourceFile, manifestFile } from '../tools/layout.js'

const recipe = { kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } }

test('recipeHash is stable regardless of key order', () => {
  const a = recipeHash({ kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } })
  const b = recipeHash({ params: { seed: 589 }, resources: ['Condition'], version: '3.2.0', kind: 'synthea' })
  expect(a).toBe(b)
  expect(a).toMatch(/^[0-9a-f]{8}$/)
})

test('recipeHash changes when content changes', () => {
  expect(recipeHash(recipe)).not.toBe(recipeHash({ ...recipe, params: { seed: 590 } }))
})

test('datasetKey is name_hash', () => {
  expect(datasetKey('synthea-clinical', recipe)).toBe(`synthea-clinical_${recipeHash(recipe)}`)
})

test('paths place size and resource correctly', () => {
  const dir = datasetDir('/data', 'd', recipe, 's')
  expect(dir).toBe(`/data/d_${recipeHash(recipe)}/s`)
  expect(resourceFile('/data', 'd', recipe, 's', 'Condition')).toBe(`${dir}/Condition.ndjson`)
  expect(manifestFile('/data', 'd', recipe, 's')).toBe(`${dir}/manifest.json`)
})
