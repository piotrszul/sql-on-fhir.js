import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readManifest } from '../tools/harness/manifest.js'
import {
  startWorker,
  ProtocolError,
  WorkerCrash,
  WorkerTimeout,
  SetupError,
} from '../tools/harness/worker.js'

const manifestPath = join(import.meta.dir, 'fixtures/hooks/fake.hook.json')
const fakeHookJs = join(import.meta.dir, 'fixtures/hooks/fake-hook.js')

function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'hook-'))
  writeFileSync(join(dataRoot, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  return dataRoot
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// An operator-managed hook service for connect-mode tests: the TEST owns the
// process (the harness must never terminate it).
async function startService(env = {}) {
  const port = await freePort()
  const child = spawn('bun', [fakeHookJs], {
    env: { ...process.env, HOOK_PORT: String(port), ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/capabilities`)
      if (r.ok) break
    } catch {}
    if (Date.now() > deadline) throw new Error('fake service never became ready')
    await new Promise((r) => setTimeout(r, 25))
  }
  return {
    endpoint: `http://127.0.0.1:${port}`,
    alive: () => child.exitCode === null && !child.killed,
    stop: () => child.kill('SIGKILL'),
  }
}

// ---- manifest loading (7.x) ----

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

test('readManifest passes a connect-mode manifest through without inventing a cwd', () => {
  const m = readManifest(join(import.meta.dir, 'fixtures/hooks/fake-connect.hook.json'))
  expect(m.endpoint).toBe('http://127.0.0.1:8095')
  expect(m.cwd).toBeUndefined()
})

// ---- spawn-mode lifecycle and protocol client (8.2, 8.4) ----

test('startWorker spawns on an assigned HOOK_PORT, polls readiness, and exposes capabilities', async () => {
  const worker = await startWorker(readManifest(manifestPath))
  expect(worker.mode).toBe('spawn')
  expect(worker.capabilities.ok).toBe(true)
  expect(worker.capabilities.scenarios).toContain('preloaded_repeated')
  expect(worker.capabilities.token).toBe('tok') // env from the manifest merged into the hook
  await worker.shutdown()
})

test('prepare and run round-trip over HTTP', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
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

test('an unknown command endpoint yields an ok:false response and the hook stays alive', async () => {
  const worker = await startWorker(readManifest(manifestPath))
  const resp = await worker.send({ cmd: 'frobnicate' }, { timeoutMs: 5000 })
  expect(resp.ok).toBe(false)
  const caps = await worker.send({ cmd: 'capabilities' }, { timeoutMs: 5000 })
  expect(caps.ok).toBe(true)
  await worker.shutdown()
})

test('reset discards prepared state; prepare has replace-semantics', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  const runCmd = { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(dataRoot, 'out.csv') }
  await worker.send({ cmd: 'prepare', dataDir: dataRoot, resources: ['Observation'] }, { timeoutMs: 5000 })
  expect((await worker.send(runCmd, { timeoutMs: 5000 })).outputRows).toBe(3)
  // reset: the prepared dataset is gone
  await worker.send({ cmd: 'reset' }, { timeoutMs: 5000 })
  expect((await worker.send(runCmd, { timeoutMs: 5000 })).outputRows).toBe(0)
  // replace-semantics: a second prepare does not accumulate onto the first
  await worker.send({ cmd: 'prepare', dataDir: dataRoot, resources: ['Observation'] }, { timeoutMs: 5000 })
  await worker.send({ cmd: 'prepare', dataDir: dataRoot, resources: [] }, { timeoutMs: 5000 })
  expect((await worker.send(runCmd, { timeoutMs: 5000 })).outputRows).toBe(0)
  await worker.shutdown()
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- failure mapping raw material (8.4) ----

test('a hook that crashes mid-command rejects with WorkerCrash', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'CrashMe' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 5000 },
    ),
  ).rejects.toBeInstanceOf(WorkerCrash)
  await worker.waitExit()
  expect(worker.alive).toBe(false)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a hook that never responds rejects with WorkerTimeout after the budget', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
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

test('a non-2xx response rejects with ProtocolError', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'Http500Me' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 5000 },
    ),
  ).rejects.toBeInstanceOf(ProtocolError)
  await worker.shutdown()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('an unparseable 2xx body rejects with ProtocolError', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  await expect(
    worker.send(
      { cmd: 'run', view: { resource: 'GarbageMe' }, outCsv: join(dataRoot, 'x.csv') },
      { timeoutMs: 5000 },
    ),
  ).rejects.toBeInstanceOf(ProtocolError)
  await worker.shutdown()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a slow but valid response inside the budget succeeds', async () => {
  const dataRoot = seedData()
  const worker = await startWorker(readManifest(manifestPath))
  const resp = await worker.send(
    { cmd: 'run', view: { resource: 'SlowMe' }, outCsv: join(dataRoot, 'x.csv') },
    { timeoutMs: 5000 },
  )
  expect(resp.ok).toBe(true)
  await worker.shutdown()
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- spawn-mode termination (8.2) ----

test('shutdown asks the hook service to exit and it does', async () => {
  const worker = await startWorker(readManifest(manifestPath))
  await worker.shutdown()
  expect(worker.alive).toBe(false)
})

function stubbornManifest(dir) {
  const manifest = {
    command: ['bun', fakeHookJs],
    env: { FAKE_IGNORE_SIGTERM: '1' },
    implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
  }
  writeFileSync(join(dir, 'stubborn.hook.json'), JSON.stringify(manifest))
  return readManifest(join(dir, 'stubborn.hook.json'))
}

test('shutdown escalates to SIGKILL when the hook ignores shutdown and traps SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stubborn-'))
  const worker = await startWorker(stubbornManifest(dir))
  await worker.shutdown({ graceMs: 50 }) // must resolve, not hang the harness forever
  expect(worker.alive).toBe(false)
  rmSync(dir, { recursive: true, force: true })
}, 10_000)

test('kill() escalates to SIGKILL when the hook traps SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stubborn-'))
  const worker = await startWorker(stubbornManifest(dir))
  worker.kill({ graceMs: 50 })
  await worker.waitExit() // must resolve once the escalation lands
  expect(worker.alive).toBe(false)
  rmSync(dir, { recursive: true, force: true })
}, 10_000)

// ---- setup failures are loud, not per-case (8.2) ----

test('a spawn failure (missing command binary) rejects with SetupError', async () => {
  const manifest = {
    command: ['definitely-not-a-real-binary-6f2a', 'hook.js'],
    implementation: { engine: { name: 'ghost', version: '0.0.1' } },
  }
  await expect(startWorker(manifest)).rejects.toBeInstanceOf(SetupError)
})

test('a hook that never becomes ready fails setup within the readiness budget', async () => {
  const manifest = {
    command: ['bun', fakeHookJs],
    env: { FAKE_NEVER_READY: '1' },
    implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
  }
  await expect(startWorker(manifest, { readinessMs: 400 })).rejects.toBeInstanceOf(SetupError)
}, 10_000)

// ---- connect-mode lifecycle (8.3) ----

test('connect mode drives an operator-managed service and never terminates it', async () => {
  const dataRoot = seedData()
  const service = await startService()
  const manifest = {
    endpoint: service.endpoint,
    implementation: { engine: { name: 'fake-engine', version: '0.0.1' } },
  }
  const worker = await startWorker(manifest)
  expect(worker.mode).toBe('connect')
  expect(worker.capabilities.ok).toBe(true)
  await worker.send({ cmd: 'prepare', dataDir: dataRoot, resources: ['Observation'] }, { timeoutMs: 5000 })
  const run = await worker.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(dataRoot, 'out.csv') },
    { timeoutMs: 5000 },
  )
  expect(run.outputRows).toBe(3)
  // shutdown is a no-op in connect mode: no shutdown command, no termination
  await worker.shutdown()
  worker.kill()
  const after = await fetch(`${service.endpoint}/capabilities`)
  expect(after.ok).toBe(true)
  expect(service.alive()).toBe(true)
  service.stop()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('an initial connection refusal in connect mode rejects with SetupError', async () => {
  const port = await freePort() // nothing listens there
  const manifest = {
    endpoint: `http://127.0.0.1:${port}`,
    implementation: { engine: { name: 'ghost', version: '0.0.1' } },
  }
  await expect(startWorker(manifest)).rejects.toBeInstanceOf(SetupError)
})
