import { test, expect } from 'bun:test'
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  symlinkSync,
  realpathSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest } from '../tools/harness/manifest.js'
import { startConnector, WorkerCrash, WorkerTimeout, SetupError } from '../tools/harness/worker.js'

const fakeCliJs = join(import.meta.dir, 'fixtures/hooks/fake-cli.js')
const manifestPath = join(import.meta.dir, 'fixtures/hooks/fake-cli.hook.json')

// An inline manifest around the fixture engine, with a per-test spawn log.
// Template deliberately substitutes {outCsv} INSIDE an element (--out=...).
function cliManifest(workDir, runTemplate) {
  return {
    cli: { run: runTemplate ?? ['bun', fakeCliJs, '{dataDir}', '{viewFile}', '--out={outCsv}'] },
    env: { FAKE_CLI_LOG: join(workDir, 'spawns.log') },
    implementation: { engine: { name: 'fake-cli-engine', version: '0.0.1' } },
  }
}

function seed() {
  const workDir = mkdtempSync(join(tmpdir(), 'cli-conn-'))
  writeFileSync(join(workDir, 'Observation.ndjson'), '{"a":1}\n{"a":2}\n{"a":3}\n')
  return workDir
}

const spawnsOf = (workDir) => {
  const log = join(workDir, 'spawns.log')
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

test('the committed CLI fixture manifest loads and yields a cli connector', async () => {
  const m = readManifest(manifestPath)
  const conn = await startConnector(m)
  expect(conn.mode).toBe('cli')
  expect(conn.implementation.engine.name).toBe('fake-cli-engine')
  await conn.shutdown()
})

test('capabilities are synthesized as exactly end_to_end, without running anything', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  expect(conn.capabilities).toEqual({ ok: true, scenarios: ['end_to_end'] })
  const viaSend = await conn.send({ cmd: 'capabilities' })
  expect(viaSend).toEqual({ ok: true, scenarios: ['end_to_end'] })
  expect(spawnsOf(workDir)).toHaveLength(0)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('prepare and reset answer ok without spawning an engine process', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  expect((await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })).ok).toBe(true)
  expect((await conn.send({ cmd: 'reset' })).ok).toBe(true)
  expect(spawnsOf(workDir)).toHaveLength(0)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('run substitutes placeholders (inside elements too), spawns fresh, and answers after the CSV is complete', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  const outCsv = join(workDir, 'out.csv')
  const resp = await conn.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv },
    { timeoutMs: 10_000 },
  )
  expect(resp.ok).toBe(true)
  // the CSV is countable the moment the response arrives (child has exited)
  expect(readFileSync(outCsv, 'utf8').trim().split('\n')).toEqual(['id', 'row-0', 'row-1', 'row-2'])
  const spawns = spawnsOf(workDir)
  expect(spawns).toHaveLength(1)
  const [dataDirArg, viewFileArg, outArg] = spawns[0].argv
  expect(dataDirArg).toBe(workDir)
  expect(outArg).toBe(`--out=${outCsv}`) // substitution within an element
  // the harness wrote the view to a temp file and passed its path
  expect(JSON.parse(readFileSync(viewFileArg, 'utf8'))).toEqual({ resource: 'Observation' })

  // a second run spawns a second, fresh process
  await conn.send({ cmd: 'run', view: { resource: 'Observation' }, outCsv }, { timeoutMs: 10_000 })
  const again = spawnsOf(workDir)
  expect(again).toHaveLength(2)
  expect(again[1].pid).not.toBe(again[0].pid)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('the {viewFile} handed to the engine is a canonical path, even when tmpdir is a symlink', async () => {
  // macOS's default tmpdir lives behind a symlink (/var -> /private/var). A
  // symlink-y {viewFile} breaks engines that resolve or glob-walk the path
  // (found validating the flatquack staging hook), so the connector must hand
  // out physical paths. Force the situation on every platform: point TMPDIR
  // at a symlink to the real work area.
  const workDir = seed()
  const linkDir = join(workDir, 'tmp-link')
  symlinkSync(workDir, linkDir)
  const oldTmpdir = process.env.TMPDIR
  process.env.TMPDIR = linkDir
  try {
    const conn = await startConnector(cliManifest(workDir))
    await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
    await conn.send(
      { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(workDir, 'c.csv') },
      { timeoutMs: 10_000 },
    )
    const viewFileArg = spawnsOf(workDir)[0].argv[1]
    expect(viewFileArg).toBe(realpathSync(viewFileArg))
    await conn.shutdown()
  } finally {
    if (oldTmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = oldTmpdir
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('argv elements reach the engine literally: no shell interpretation', async () => {
  const workDir = seed()
  const template = ['bun', fakeCliJs, '{dataDir}', '{viewFile}', '--out={outCsv}', '$HOME and *']
  const conn = await startConnector(cliManifest(workDir, template))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  await conn.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(workDir, 'o.csv') },
    { timeoutMs: 10_000 },
  )
  expect(spawnsOf(workDir)[0].argv.at(-1)).toBe('$HOME and *')
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('a non-zero exit is an engine failure carrying the exit status and a stderr tail, and the connector stays usable', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  const bad = await conn.send(
    { cmd: 'run', view: { resource: 'BoomMe' }, outCsv: join(workDir, 'b.csv') },
    { timeoutMs: 10_000 },
  )
  expect(bad.ok).toBe(false)
  expect(bad.error).toMatch(/exit status 3/)
  expect(bad.error).toMatch(/engine exploded loudly/)
  // next run spawns fresh and succeeds
  const good = await conn.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(workDir, 'g.csv') },
    { timeoutMs: 10_000 },
  )
  expect(good.ok).toBe(true)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('a missing engine binary surfaces as WorkerCrash', async () => {
  const workDir = seed()
  const template = ['definitely-not-a-real-binary-xyz', '{dataDir}', '{viewFile}', '--out={outCsv}']
  const conn = await startConnector(cliManifest(workDir, template))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  await expect(
    conn.send(
      { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(workDir, 'o.csv') },
      { timeoutMs: 10_000 },
    ),
  ).rejects.toBeInstanceOf(WorkerCrash)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('a hung engine process maps to WorkerTimeout and its process group is killed', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  await expect(
    conn.send(
      { cmd: 'run', view: { resource: 'HangMe' }, outCsv: join(workDir, 'h.csv') },
      { timeoutMs: 400 },
    ),
  ).rejects.toBeInstanceOf(WorkerTimeout)
  const { pid } = spawnsOf(workDir)[0]
  // the connector kills the group (SIGTERM -> SIGKILL); poll until it is gone
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      break // gone
    }
    if (Date.now() > deadline) throw new Error(`engine process ${pid} survived the timeout kill`)
    await new Promise((r) => setTimeout(r, 50))
  }
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('reset is a no-op: a prepared dataset survives reset (cold by construction)', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  await conn.send({ cmd: 'reset' })
  const resp = await conn.send(
    { cmd: 'run', view: { resource: 'Observation' }, outCsv: join(workDir, 'o.csv') },
    { timeoutMs: 10_000 },
  )
  expect(resp.ok).toBe(true)
  expect(spawnsOf(workDir)).toHaveLength(1)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('kill escalates SIGTERM -> SIGKILL on an in-flight engine that ignores SIGTERM', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  await conn.send({ cmd: 'prepare', dataDir: workDir, resources: ['Observation'] })
  const outCsv = join(workDir, 'k.csv')
  const running = conn.send({ cmd: 'run', view: { resource: 'IgnoreTermMe' }, outCsv })
  running.catch(() => {}) // settled below; avoid an unhandled-rejection window
  // the engine writes the CSV only after its SIGTERM trap is installed
  while (!existsSync(outCsv)) await new Promise((r) => setTimeout(r, 20))
  conn.kill({ graceMs: 150 })
  await expect(running).rejects.toBeInstanceOf(WorkerCrash)
  const { pid } = spawnsOf(workDir)[0]
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      break // gone
    }
    if (Date.now() > deadline) throw new Error(`engine process ${pid} survived kill escalation`)
    await new Promise((r) => setTimeout(r, 50))
  }
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('an unknown placeholder fails setup loudly, before any engine process is spawned', async () => {
  const workDir = seed()
  const template = ['bun', fakeCliJs, '{dataDir}', '{viewfile}', '--out={outCsv}']
  await expect(startConnector(cliManifest(workDir, template))).rejects.toBeInstanceOf(SetupError)
  expect(spawnsOf(workDir)).toHaveLength(0)
  rmSync(workDir, { recursive: true, force: true })
})

test('a template that never uses {outCsv} fails setup loudly', async () => {
  const workDir = seed()
  const template = ['bun', fakeCliJs, '{dataDir}', '{viewFile}']
  await expect(startConnector(cliManifest(workDir, template))).rejects.toBeInstanceOf(SetupError)
  rmSync(workDir, { recursive: true, force: true })
})

test('run before any prepare is an engine failure, not a silent empty substitution', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  const resp = await conn.send({
    cmd: 'run',
    view: { resource: 'Observation' },
    outCsv: join(workDir, 'o.csv'),
  })
  expect(resp.ok).toBe(false)
  expect(resp.error).toMatch(/no dataset prepared/)
  expect(spawnsOf(workDir)).toHaveLength(0)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

test('an unknown command answers ok:false and the connector stays alive', async () => {
  const workDir = seed()
  const conn = await startConnector(cliManifest(workDir))
  const resp = await conn.send({ cmd: 'frobnicate' })
  expect(resp.ok).toBe(false)
  expect((await conn.send({ cmd: 'capabilities' })).ok).toBe(true)
  await conn.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})
