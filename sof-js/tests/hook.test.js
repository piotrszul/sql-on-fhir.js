import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest } from '../../benchmark/tools/harness/manifest.js'
import { startWorker } from '../../benchmark/tools/harness/worker.js'

// Protocol-level tests: drive the sof-js hook (the reference example of
// benchmark-hook-format) through the real harness worker client, over HTTP.

const manifestPath = join(import.meta.dir, '../hook.json')

// The manifest identity is copied verbatim into every published report and JMH
// export, so a version drifting from package.json misattributes every result.
test('hook.json engine version matches the sof-js package version', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8'))
  expect(manifest.implementation.engine.version).toBe(pkg.version)
})

const view = {
  resource: 'Observation',
  select: [
    { column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] },
    {
      forEach: 'component',
      column: [{ name: 'comp_code', path: 'code.coding.first().code', type: 'string' }],
    },
  ],
}

function seedData() {
  const dir = mkdtempSync(join(tmpdir(), 'sofhook-'))
  copyFileSync(join(import.meta.dir, 'fixtures/Observation.ndjson'), join(dir, 'Observation.ndjson'))
  return dir
}

test('the hook comes up on the assigned HOOK_PORT and declares both scenarios', async () => {
  const worker = await startWorker(readManifest(manifestPath))
  expect(worker.mode).toBe('spawn')
  expect(worker.capabilities.ok).toBe(true)
  expect(worker.capabilities.scenarios.sort()).toEqual(['end_to_end', 'preloaded_repeated'])
  await worker.shutdown()
})

test('prepare + run evaluates the view and fully writes the CSV before responding', async () => {
  const dataDir = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  const prep = await worker.send(
    { cmd: 'prepare', dataDir, resources: ['Observation'] },
    { timeoutMs: 10000 },
  )
  expect(prep.ok).toBe(true)
  const outCsv = join(dataDir, 'out.csv')
  const run = await worker.send({ cmd: 'run', view, outCsv }, { timeoutMs: 10000 })
  expect(run.ok).toBe(true)
  expect(run.outputRows).toBe(3) // 2 components on o1 + 1 on o2
  // the response arrived only after the CSV was complete on disk
  const lines = readFileSync(outCsv, 'utf8').split('\n')
  expect(lines[0].split(',').sort()).toEqual(['comp_code', 'id'])
  expect(lines).toHaveLength(4) // header + 3 rows
  // advisory phase splits for the tuning use case
  expect(run.phasesMs).toHaveProperty('execute')
  expect(run.phasesMs).toHaveProperty('extract')
  await worker.shutdown()
  rmSync(dataDir, { recursive: true, force: true })
})

test('a failing view yields ok:false and the hook stays alive', async () => {
  const dataDir = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'prepare', dataDir, resources: ['Observation'] }, { timeoutMs: 10000 })
  const bad = await worker.send(
    {
      cmd: 'run',
      view: { resource: 'Observation', select: [{ column: [{ name: 'x', path: '!!!' }] }] },
      outCsv: join(dataDir, 'x.csv'),
    },
    { timeoutMs: 10000 },
  )
  expect(bad.ok).toBe(false)
  expect(typeof bad.error).toBe('string')
  const good = await worker.send({ cmd: 'run', view, outCsv: join(dataDir, 'y.csv') }, { timeoutMs: 10000 })
  expect(good.ok).toBe(true)
  await worker.shutdown()
  rmSync(dataDir, { recursive: true, force: true })
})

test('a run against a resource type that was never prepared is ok:false, not a silent 0-row ok', async () => {
  const dataDir = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'prepare', dataDir, resources: ['Observation'] }, { timeoutMs: 10000 })
  const resp = await worker.send(
    {
      cmd: 'run',
      view: { resource: 'Patient', select: [{ column: [{ name: 'id', path: 'id', type: 'string' }] }] },
      outCsv: join(dataDir, 'p.csv'),
    },
    { timeoutMs: 10000 },
  )
  expect(resp.ok).toBe(false)
  expect(resp.error).toMatch(/Patient/)
  expect(worker.alive).toBe(true)
  await worker.shutdown()
  rmSync(dataDir, { recursive: true, force: true })
})

test('reset discards the prepared dataset; a fresh prepare re-does the ingest', async () => {
  const dataDir = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'prepare', dataDir, resources: ['Observation'] }, { timeoutMs: 10000 })
  const reset = await worker.send({ cmd: 'reset' }, { timeoutMs: 10000 })
  expect(reset.ok).toBe(true)
  // the prepared dataset is gone, not silently retained
  const stale = await worker.send({ cmd: 'run', view, outCsv: join(dataDir, 'x.csv') }, { timeoutMs: 10000 })
  expect(stale.ok).toBe(false)
  // prepare after reset performs the full ingest again
  await worker.send({ cmd: 'prepare', dataDir, resources: ['Observation'] }, { timeoutMs: 10000 })
  const rerun = await worker.send({ cmd: 'run', view, outCsv: join(dataDir, 'y.csv') }, { timeoutMs: 10000 })
  expect(rerun.ok).toBe(true)
  expect(rerun.outputRows).toBe(3)
  await worker.shutdown()
  rmSync(dataDir, { recursive: true, force: true })
})

test('prepare replaces the previously prepared dataset, not extends it', async () => {
  const dataDir = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'prepare', dataDir, resources: ['Observation'] }, { timeoutMs: 10000 })
  // a second prepare for a disjoint resource set drops Observation entirely
  await worker.send({ cmd: 'prepare', dataDir, resources: [] }, { timeoutMs: 10000 })
  const resp = await worker.send({ cmd: 'run', view, outCsv: join(dataDir, 'x.csv') }, { timeoutMs: 10000 })
  expect(resp.ok).toBe(false)
  await worker.shutdown()
  rmSync(dataDir, { recursive: true, force: true })
})

test('an unknown command endpoint is an error response, not an exit', async () => {
  const worker = await startWorker(readManifest(manifestPath))
  const resp = await worker.send({ cmd: 'frobnicate' }, { timeoutMs: 10000 })
  expect(resp.ok).toBe(false)
  expect(worker.alive).toBe(true)
  await worker.shutdown()
})
