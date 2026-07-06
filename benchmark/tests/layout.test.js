import { test, expect } from 'bun:test'
import * as layout from '../tools/layout.js'
import { datasetDir, resourceFile, manifestFile, checkfileFor, recipeOf, pathFrom } from '../tools/layout.js'

test('pathFrom decodes percent-encoded module URLs into real filesystem paths', () => {
  // A repo checked out under a directory with a space must not yield a %20 path.
  expect(pathFrom('file:///tmp/My%20Projects/tools/x.js', '../data')).toBe('/tmp/My Projects/data')
  expect(pathFrom('file:///tmp/plain/tools/x.js', '../data')).toBe('/tmp/plain/data')
})

test('paths are keyed by explicit name and version, with no content hash', () => {
  const dir = datasetDir('/data', 'synthea-clinical', '1', 's')
  expect(dir).toBe('/data/synthea-clinical/1/s')
  expect(resourceFile('/data', 'synthea-clinical', '1', 's', 'Condition')).toBe(`${dir}/Condition.ndjson`)
  expect(manifestFile('/data', 'synthea-clinical', '1', 's')).toBe(`${dir}/manifest.json`)
})

test('no content-hash derivation is exported (F1/F6 removed)', () => {
  expect(layout.recipeHash).toBeUndefined()
  expect(layout.datasetKey).toBeUndefined()
})

test('distinct versions and sizes occupy distinct directories', () => {
  expect(datasetDir('/data', 'd', '1', 's')).not.toBe(datasetDir('/data', 'd', '2', 's'))
  expect(datasetDir('/data', 'd', '1', 's')).not.toBe(datasetDir('/data', 'd', '1', 'm'))
})

test('checkfileFor resolves the sibling checkfile by benchmark file basename', () => {
  expect(checkfileFor('/bench/clinical-flat.json')).toBe('/bench/clinical-flat.check.json')
})

test('recipeOf strips name/version/sizes/defaultSize/syntheaVersion and keeps recipe params', () => {
  const dataset = {
    name: 'd',
    kind: 'synthea',
    version: '1',
    syntheaVersion: '3.2.0',
    resources: ['Condition'],
    params: { seed: 589 },
    sizes: { s: { population: 100 } },
    defaultSize: 's',
  }
  // recipeOf keeps what the executor needs to generate: kind, resources, params.
  // syntheaVersion is identity/lock info, NOT a generation input, so it is stripped.
  const recipe = recipeOf(dataset)
  expect(recipe.syntheaVersion).toBeUndefined()
  expect(recipe).toEqual({
    kind: 'synthea',
    resources: ['Condition'],
    params: { seed: 589 },
  })
})
