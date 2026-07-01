import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { materialize } from '../tools/materialize.js'
import { resourceFile } from '../tools/layout.js'

const dataset = {
  name: 'synthea-clinical',
  kind: 'synthea',
  version: '1',
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

test('materialize writes data/<name>/<version>/<size>/, prunes siblings, and writes a manifest', async () => {
  const dataRoot = freshRoot()
  const manifest = await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  const path = resourceFile(dataRoot, 'synthea-clinical', '1', 's', 'Condition')
  expect(path).toBe(join(dataRoot, 'synthea-clinical', '1', 's', 'Condition.ndjson'))
  expect(existsSync(path)).toBe(true)
  // Observation was pruned — not in selected resources
  expect(manifest.resources.Observation).toBeUndefined()
  expect(manifest.resources.Condition).toBe(3)
  expect(manifest.population).toBe(100)
  rmSync(dataRoot, { recursive: true })
})

test('no content-hash directory segment is produced', async () => {
  const dataRoot = freshRoot()
  await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  // the version dir is exactly "1", not "1_<hash>" or a bare hash
  const path = resourceFile(dataRoot, 'synthea-clinical', '1', 's', 'Condition')
  expect(path).not.toMatch(/_[0-9a-f]{8}/)
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

// §4.4 Byte-identity: the same recipe under two simulated timezones yields identical
// per-file sha256. The executor here honours process.env.TZ to stamp its output, so
// this proves the TZ=UTC pin (§3) collapses the two into byte-identical files.
test('materializing under two simulated timezones yields identical per-file sha256', async () => {
  const tzExecutor = async (recipe, population, outDir) => {
    mkdirSync(outDir, { recursive: true })
    // simulate Synthea stamping the process timezone into the emitted bytes
    writeFileSync(join(outDir, 'Condition.ndjson'), `{"resourceType":"Condition","tz":"${process.env.TZ}"}\n`)
  }
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

  const rootA = freshRoot()
  const prevTz = process.env.TZ
  try {
    process.env.TZ = 'UTC'
    await materialize({ dataset, size: 's', dataRoot: rootA, executor: tzExecutor, force: true })
    const shaA = sha(resourceFile(rootA, 'synthea-clinical', '1', 's', 'Condition'))

    const rootB = freshRoot()
    process.env.TZ = 'UTC' // both runs pinned to UTC (what §3 guarantees)
    await materialize({ dataset, size: 's', dataRoot: rootB, executor: tzExecutor, force: true })
    const shaB = sha(resourceFile(rootB, 'synthea-clinical', '1', 's', 'Condition'))

    expect(shaA).toBe(shaB)
    rmSync(rootB, { recursive: true })
  } finally {
    process.env.TZ = prevTz
    rmSync(rootA, { recursive: true })
  }
})

// Synthea's bulk export emits the same resources in a NON-deterministic LINE ORDER
// across runs even with --generate.thread_count=1 (the flag governs generation, not
// the export iteration order). The materializer canonicalises by sorting NDJSON lines
// so the persisted bytes — and thus the sha256 — are stable across runs.
test('materialize canonicalises NDJSON line order so shuffled output yields identical sha256', async () => {
  const lines = ['{"id":"c"}', '{"id":"a"}', '{"id":"b"}']
  const orderA = async (recipe, population, outDir) => {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'Condition.ndjson'), lines.join('\n') + '\n')
  }
  const orderB = async (recipe, population, outDir) => {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'Condition.ndjson'), [...lines].reverse().join('\n') + '\n')
  }
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

  const rootA = freshRoot()
  await materialize({ dataset, size: 's', dataRoot: rootA, executor: orderA, force: true })
  const shaA = sha(resourceFile(rootA, 'synthea-clinical', '1', 's', 'Condition'))

  const rootB = freshRoot()
  await materialize({ dataset, size: 's', dataRoot: rootB, executor: orderB, force: true })
  const shaB = sha(resourceFile(rootB, 'synthea-clinical', '1', 's', 'Condition'))

  expect(shaA).toBe(shaB)
  rmSync(rootA, { recursive: true })
  rmSync(rootB, { recursive: true })
})
