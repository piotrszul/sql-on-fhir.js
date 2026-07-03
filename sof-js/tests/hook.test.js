import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest } from '../../benchmark/tools/harness/manifest.js'
import { spawnWorker } from '../../benchmark/tools/harness/worker.js'

// Protocol-level tests: drive the sof-js hook (the reference example of
// benchmark-hook-format) through the real harness worker client.

const manifestPath = join(import.meta.dir, '../hook.json')

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

test('capabilities declares both scenarios', async () => {
  const worker = spawnWorker(readManifest(manifestPath))
  const caps = await worker.send({ cmd: 'capabilities' }, { timeoutMs: 10000 })
  expect(caps.ok).toBe(true)
  expect(caps.scenarios.sort()).toEqual(['end_to_end', 'preloaded_repeated'])
  await worker.shutdown()
})

test('prepare + run evaluates the view and fully writes the CSV before responding', async () => {
  const dataDir = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
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

test('a failing view yields ok:false and the worker stays alive', async () => {
  const dataDir = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
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

test('an unknown cmd is an error response, not an exit', async () => {
  const worker = spawnWorker(readManifest(manifestPath))
  const resp = await worker.send({ cmd: 'frobnicate' }, { timeoutMs: 10000 })
  expect(resp.ok).toBe(false)
  expect(worker.alive).toBe(true)
  await worker.shutdown()
})
