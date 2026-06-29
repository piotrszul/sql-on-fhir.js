import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run } from '../tools/cli.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cli-'))
  const dataRoot = join(dir, 'data')
  const file = {
    title: 'clinical-flat', fhirVersion: '4.0.1', group: 'g',
    dataset: {
      name: 'd', kind: 'synthea', version: '3.2.0', resources: ['Condition'],
      sizes: { s: { population: 100 } }, defaultSize: 's', params: { seed: 589 },
    },
    cases: [{ title: 'c', view: { resource: 'Condition' } }],
  }
  writeFileSync(join(dir, 'clinical-flat.json'), JSON.stringify(file))
  return { dir, dataRoot }
}

const fakeRegistry = {
  synthea: async (recipe, population, outDir) => {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'Condition.ndjson'), '{"resourceType":"Condition"}\n'.repeat(2))
  },
}

test('run materializes a single benchmark file by name', async () => {
  const { dir, dataRoot } = setup()
  const manifests = await run({ target: 'clinical-flat.json', size: 's', dir, dataRoot, registry: fakeRegistry })
  expect(manifests).toHaveLength(1)
  expect(manifests[0].resources.Condition).toBe(2)
  rmSync(dir, { recursive: true, force: true })
})

test('run materializes all files in a group', async () => {
  const { dir, dataRoot } = setup()
  const manifests = await run({ group: 'g', size: 's', dir, dataRoot, registry: fakeRegistry })
  expect(manifests).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})
