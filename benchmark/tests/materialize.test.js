import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { materialize } from '../tools/materialize.js'
import { resourceFile } from '../tools/layout.js'

const dataset = {
  name: 'd',
  kind: 'synthea',
  version: '3.2.0',
  resources: ['Condition'],
  sizes: { s: { population: 100 } },
  defaultSize: 's',
  params: { seed: 589 },
}

// fake executor: writes 3 Conditions and 5 (to-be-pruned) Observations
let calls = 0
const fakeExecutor = async (recipe, population, outDir) => {
  calls++
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'Condition.ndjson'), '{"resourceType":"Condition"}\n'.repeat(3))
  writeFileSync(join(outDir, 'Observation.ndjson'), '{"resourceType":"Observation"}\n'.repeat(5))
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'bench-'))
}

const recipe = { kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } }

test('materialize generates, prunes siblings, and writes a manifest', async () => {
  const dataRoot = freshRoot()
  const manifest = await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  expect(existsSync(resourceFile(dataRoot, 'd', recipe, 's', 'Condition'))).toBe(true)
  // Observation was pruned — not in selected resources
  expect(manifest.resources.Observation).toBeUndefined()
  expect(manifest.resources.Condition).toBe(3)
  expect(manifest.population).toBe(100)
  rmSync(dataRoot, { recursive: true })
})

test('materialize is idempotent — second call skips the executor', async () => {
  const dataRoot = freshRoot()
  calls = 0
  await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  expect(calls).toBe(1)
  rmSync(dataRoot, { recursive: true })
})
