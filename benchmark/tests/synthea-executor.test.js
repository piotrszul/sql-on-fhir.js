import { test, expect, mock, afterEach } from 'bun:test'
import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSyntheaExecutor, loadConfig } from '../tools/executors/synthea.js'

const config = loadConfig()
const guarded = config?.synthea?.jar && existsSync(config.synthea.jar) ? test : test.skip

guarded(
  'synthea executor generates Patient.ndjson for a tiny population',
  async () => {
    const exec = makeSyntheaExecutor({ config: config.synthea })
    const out = mkdtempSync(join(tmpdir(), 'synthea-it-'))
    await exec(
      {
        params: {
          seed: 589,
          endTime: 20250101,
          yearsOfHistory: 1,
          hospitalExport: false,
          practitionerExport: false,
          bulkData: true,
        },
      },
      1,
      out,
    )
    expect(existsSync(join(out, 'Patient.ndjson'))).toBe(true)
    rmSync(out, { recursive: true, force: true })
  },
  120000,
)

// --- Unit tests: capture the Synthea argument list without running Java ---

// Spy on spawnSync: record args, fake a successful run that produces a fhir/ dir.
let capturedArgs = null
let capturedOptions = null
function installSpawnSpy() {
  capturedArgs = null
  capturedOptions = null
  mock.module('node:child_process', () => ({
    spawnSync: (_java, args, options) => {
      capturedArgs = args
      capturedOptions = options
      // find the outDir from --exporter.baseDirectory=<dir> and stub a fhir/ output
      const baseArg = args.find((a) => String(a).startsWith('--exporter.baseDirectory='))
      const outDir = baseArg.slice('--exporter.baseDirectory='.length)
      mkdirSync(join(outDir, 'fhir'), { recursive: true })
      writeFileSync(join(outDir, 'fhir', 'Patient.ndjson'), '')
      return { status: 0 }
    },
  }))
}

afterEach(() => {
  mock.restore()
})

async function captureArgs(recipe) {
  await captureCall(recipe)
  return capturedArgs
}

async function captureCall(recipe) {
  installSpawnSpy()
  // re-import after mocking so the executor picks up the spy
  const { makeSyntheaExecutor: make } = await import('../tools/executors/synthea.js')
  const exec = make({ config: { java: 'java', jar: '/fake/synthea.jar' } })
  const out = mkdtempSync(join(tmpdir(), 'synthea-args-'))
  try {
    await exec(recipe, 1, out)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
  return { args: capturedArgs, options: capturedOptions, out }
}

test('synthea executor sets TZ=UTC in the child process environment', async () => {
  // Synthea renders the local timezone offset into emitted dateTime/instant fields.
  // Pinning TZ=UTC makes the NDJSON byte-identical across environments, which is the
  // precondition for the checkfile's per-file sha256 checksums to be meaningful.
  const { options } = await captureCall({
    params: {
      seed: 589,
      endTime: 20250101,
      yearsOfHistory: 1,
      hospitalExport: false,
      practitionerExport: false,
      bulkData: true,
    },
  })
  expect(options?.env?.TZ).toBe('UTC')
})

test('synthea executor passes -e from params.endTime', async () => {
  const args = await captureArgs({ params: { endTime: 20250101, yearsOfHistory: 1 } })
  const eIdx = args.indexOf('-e')
  expect(eIdx).toBeGreaterThanOrEqual(0)
  expect(args[eIdx + 1]).toBe('20250101')
})

test('synthea executor pins --generate.thread_count=1 for deterministic export order', async () => {
  const args = await captureArgs({ params: { endTime: 20250101 } })
  expect(args).toContain('--generate.thread_count=1')
})

test('synthea executor sources export toggles from params (none hardcoded)', async () => {
  const args = await captureArgs({
    params: {
      endTime: 20250101,
      yearsOfHistory: 1,
      hospitalExport: false,
      practitionerExport: false,
      bulkData: true,
    },
  })
  expect(args).toContain('--exporter.hospital.fhir.export=false')
  expect(args).toContain('--exporter.practitioner.fhir.export=false')
  expect(args).toContain('--exporter.fhir.bulk_data=true')
  expect(args).toContain('--exporter.years_of_history=1')
})

test('synthea executor toggles follow params, not hardcoded defaults', async () => {
  // flip every toggle away from the recipe default; the executor must honour params
  const args = await captureArgs({
    params: {
      endTime: 20250101,
      yearsOfHistory: 3,
      hospitalExport: true,
      practitionerExport: true,
      bulkData: false,
    },
  })
  expect(args).toContain('--exporter.hospital.fhir.export=true')
  expect(args).toContain('--exporter.practitioner.fhir.export=true')
  expect(args).toContain('--exporter.fhir.bulk_data=false')
  expect(args).toContain('--exporter.years_of_history=3')
})

test('synthea executor keeps --exporter.fhir.export=true as an invariant', async () => {
  const args = await captureArgs({ params: { endTime: 20250101 } })
  expect(args).toContain('--exporter.fhir.export=true')
})

test('no synthea arg leaks the literal "undefined" for a fully-declared recipe', async () => {
  // Regression guard: every output-affecting param is required by the invariant
  // validator precisely because a missing one would interpolate `undefined` into
  // the CLI (silently read as false / wall-clock). With the full param set declared,
  // no captured arg may contain the substring "undefined".
  const args = await captureArgs({
    params: {
      seed: 589,
      endTime: 20250101,
      yearsOfHistory: 1,
      hospitalExport: false,
      practitionerExport: false,
      bulkData: true,
    },
  })
  expect(args.every((a) => !String(a).includes('undefined'))).toBe(true)
})

// --- Wave 2 (#10 / #4): isolated CWD + auto-fetch wiring ---

test('synthea executor runs in an isolated working directory, not the repo root', async () => {
  // Synthea scatters db.sqlite and public/export/ into its PROCESS CWD. The executor
  // must set cwd to the exact staging dir (outDir) it was handed — an isolated scratch
  // dir outside the repo tree — so those artifacts never land in the repo root.
  const { options, out } = await captureCall({ params: { endTime: 20250101 } })
  expect(options?.cwd).toBeDefined()
  // pin the behaviour: cwd is precisely the outDir the executor is called with,
  // not merely "somewhere that isn't the repo root".
  expect(options.cwd).toBe(out)
})

test('makeSyntheaExecutor with no config jar auto-fetches the pinned jar via resolveSyntheaJar', async () => {
  installSpawnSpy()
  const { makeSyntheaExecutor: make } = await import('../tools/executors/synthea.js')
  const mkdtemp = mkdtempSync(join(tmpdir(), 'synthea-cache-'))
  let resolved = null
  // inject a fetchImpl-backed resolve path by pointing at a fake pinned jar the
  // executor will treat as the resolved jar; no config jar is supplied.
  const fakeJar = join(mkdtemp, 'fake-synthea.jar')
  writeFileSync(fakeJar, 'jar')
  const exec = make({
    config: null,
    resolveJar: async ({ syntheaVersion }) => {
      resolved = syntheaVersion
      return { jar: fakeJar, java: 'java', fetched: true }
    },
  })
  const out = mkdtempSync(join(tmpdir(), 'synthea-out-'))
  try {
    await exec({ params: { endTime: 20250101 }, syntheaVersion: '3.2.0' }, 1, out)
  } finally {
    rmSync(out, { recursive: true, force: true })
    rmSync(mkdtemp, { recursive: true, force: true })
  }
  expect(resolved).toBe('3.2.0') // the pinned version was resolved
  expect(capturedArgs).toContain(fakeJar) // the resolved jar was passed to java -jar
})

test('makeSyntheaExecutor with a config jar uses it and never triggers a network fetch', async () => {
  // config-wins is enforced inside resolveSyntheaJar (unit-tested in
  // synthea-releases.test.js). Here we drive the REAL resolver with an injected
  // fetchImpl and assert the config jar is used and the network fetch never fires.
  installSpawnSpy()
  const { makeSyntheaExecutor: make } = await import('../tools/executors/synthea.js')
  const { resolveSyntheaJar } = await import('../tools/executors/synthea-releases.js')
  let fetched = false
  const exec = make({
    config: { jar: '/opt/synthea.jar', java: 'java' },
    resolveJar: (a) =>
      resolveSyntheaJar({ ...a, fetchImpl: async () => ((fetched = true), Buffer.from('x')) }),
  })
  const out = mkdtempSync(join(tmpdir(), 'synthea-out-'))
  try {
    await exec({ params: { endTime: 20250101 }, syntheaVersion: '3.2.0' }, 1, out)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
  expect(fetched).toBe(false) // config short-circuits the network fetch
  expect(capturedArgs).toContain('/opt/synthea.jar')
})

test('synthea invocation is wall-clock-independent: same recipe → identical args', async () => {
  // The dataset window is fully pinned by params; the executor must never inject a
  // wall-clock date. Two invocations of the same recipe yield byte-identical args,
  // and the current date/year never leaks into the argument list.
  const recipe = {
    params: {
      seed: 589,
      referenceTime: 20240101,
      endTime: 20250101,
      yearsOfHistory: 1,
      hospitalExport: false,
      practitionerExport: false,
      bulkData: true,
    },
  }
  const first = await captureArgs(recipe)
  const second = await captureArgs(recipe)
  // baseDirectory is a per-run temp dir, so compare everything else.
  const strip = (a) => a.filter((x) => !String(x).startsWith('--exporter.baseDirectory='))
  expect(strip(first)).toEqual(strip(second))
  const currentYear = String(new Date().getFullYear())
  expect(strip(first).some((x) => String(x).includes(currentYear))).toBe(false)
})
