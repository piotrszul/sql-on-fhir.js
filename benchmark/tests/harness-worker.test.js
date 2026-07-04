import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest } from '../tools/harness/manifest.js'
import { spawnWorker, ProtocolError, WorkerCrash, WorkerTimeout } from '../tools/harness/worker.js'

const manifestPath = join(import.meta.dir, 'fixtures/hooks/fake.hook.json')

function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'hook-'))
  writeFileSync(join(dataRoot, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  return dataRoot
}

// ---- manifest loading (2.2) ----

test('readManifest validates against the hook schema and resolves cwd to the manifest dir', () => {
  const m = readManifest(manifestPath)
  expect(m.command).toEqual(['bun', 'fake-hook.js'])
  expect(m.cwd).toBe(join(import.meta.dir, 'fixtures/hooks'))
  expect(m.implementation.engine.name).toBe('fake-engine')
})

test('readManifest rejects a manifest that fails the hook schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
  writeFileSync(join(dir, 'bad.hook.json'), JSON.stringify({ command: [] }))
  expect(() => readManifest(join(dir, 'bad.hook.json'))).toThrow(/schema|invalid/i)
  rmSync(dir, { recursive: true, force: true })
})

// ---- protocol client (2.3) ----

test('send() returns the parsed response line; manifest env reaches the worker', async () => {
  const worker = spawnWorker(readManifest(manifestPath))
  const caps = await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  expect(caps.ok).toBe(true)
  expect(caps.scenarios).toContain('preloaded_repeated')
  expect(caps.token).toBe('tok') // env from the manifest merged into the worker
  await worker.shutdown()
})

test('commands are answered in order, one response line each', async () => {
  const dataRoot = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
  const caps = await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  expect(caps.ok).toBe(true)
  const prep = await worker.send(
    { cmd: 'prepare', dataDir: dataRoot, resources: ['Observation'] },
    { timeoutMs: 5000 },
  )
  expect(prep.ok).toBe(true)
  const outCsv = join(dataRoot, 'out.csv')
  const run = await worker.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv },
    { timeoutMs: 5000 },
  )
  expect(run.ok).toBe(true)
  expect(run.outputRows).toBe(3)
  await worker.shutdown()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('an unknown cmd yields an ok:false response and the worker stays alive', async () => {
  const worker = spawnWorker(readManifest(manifestPath))
  const resp = await worker.send({ cmd: 'frobnicate' }, { timeoutMs: 5000 })
  expect(resp.ok).toBe(false)
  const caps = await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  expect(caps.ok).toBe(true)
  await worker.shutdown()
})

// ---- failure mapping raw material (2.4) ----

test('a worker that crashes mid-command rejects with WorkerCrash', async () => {
  const dataRoot = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'prepare', dataDir: dataRoot, resources: ['Observation'] }, { timeoutMs: 5000 })
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'CrashMe' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 5000 },
    ),
  ).rejects.toBeInstanceOf(WorkerCrash)
  expect(worker.alive).toBe(false)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a worker that never responds rejects with WorkerTimeout after the budget', async () => {
  const dataRoot = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'HangMe' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 200 },
    ),
  ).rejects.toBeInstanceOf(WorkerTimeout)
  worker.kill()
  await worker.waitExit()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a non-JSON stdout line rejects with ProtocolError', async () => {
  const dataRoot = seedData()
  const worker = spawnWorker(readManifest(manifestPath))
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'PolluteMe' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 5000 },
    ),
  ).rejects.toBeInstanceOf(ProtocolError)
  worker.kill()
  await worker.waitExit()
  rmSync(dataRoot, { recursive: true, force: true })
})

function stubbornManifest(dir) {
  const manifest = {
    command: ['bun', join(import.meta.dir, 'fixtures/hooks/fake-hook.js')],
    env: { FAKE_IGNORE_SIGTERM: '1' },
    implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
  }
  writeFileSync(join(dir, 'stubborn.hook.json'), JSON.stringify(manifest))
  return readManifest(join(dir, 'stubborn.hook.json'))
}

test('shutdown escalates to SIGKILL when the worker ignores shutdown and traps SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stubborn-'))
  const worker = spawnWorker(stubbornManifest(dir))
  await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  await worker.shutdown({ graceMs: 50 }) // must resolve, not hang the harness forever
  expect(worker.alive).toBe(false)
  rmSync(dir, { recursive: true, force: true })
}, 10_000)

test('kill() escalates to SIGKILL when the worker traps SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stubborn-'))
  const worker = spawnWorker(stubbornManifest(dir))
  await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  worker.kill({ graceMs: 50 })
  await worker.waitExit() // must resolve once the escalation lands
  expect(worker.alive).toBe(false)
  rmSync(dir, { recursive: true, force: true })
}, 10_000)

test('a spawn failure (missing command binary) rejects with WorkerCrash instead of crashing the harness', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nospawn-'))
  const manifest = {
    command: ['definitely-not-a-real-binary-6f2a', 'hook.js'],
    implementation: { engine: { name: 'ghost', version: '0.0.1' } },
  }
  writeFileSync(join(dir, 'ghost.hook.json'), JSON.stringify(manifest))
  const worker = spawnWorker(readManifest(join(dir, 'ghost.hook.json')))
  await expect(worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })).rejects.toBeInstanceOf(WorkerCrash)
  expect(worker.alive).toBe(false)
  await worker.waitExit() // resolves: spawn failure is terminal, not a hang
  await worker.shutdown() // returns immediately on a dead worker
  rmSync(dir, { recursive: true, force: true })
})

test('shutdown asks the worker to exit and it does', async () => {
  const worker = spawnWorker(readManifest(manifestPath))
  await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  await worker.shutdown()
  expect(worker.alive).toBe(false)
})
