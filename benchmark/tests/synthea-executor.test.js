import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSyntheaExecutor, loadConfig } from '../tools/executors/synthea.js'

const config = loadConfig()
const guarded = config?.synthea?.jar && existsSync(config.synthea.jar) ? test : test.skip

guarded('synthea executor generates Patient.ndjson for a tiny population', async () => {
  const exec = makeSyntheaExecutor(config.synthea)
  const out = mkdtempSync(join(tmpdir(), 'synthea-it-'))
  await exec({ params: { seed: 589, yearsOfHistory: 1 } }, 1, out)
  expect(existsSync(join(out, 'Patient.ndjson'))).toBe(true)
  rmSync(out, { recursive: true, force: true })
}, 120000)
