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
    const exec = makeSyntheaExecutor(config.synthea)
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
function installSpawnSpy() {
  capturedArgs = null
  mock.module('node:child_process', () => ({
    spawnSync: (_java, args) => {
      capturedArgs = args
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
  installSpawnSpy()
  // re-import after mocking so the executor picks up the spy
  const { makeSyntheaExecutor: make } = await import('../tools/executors/synthea.js')
  const exec = make({ java: 'java', jar: '/fake/synthea.jar' })
  const out = mkdtempSync(join(tmpdir(), 'synthea-args-'))
  try {
    await exec(recipe, 1, out)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
  return capturedArgs
}

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
