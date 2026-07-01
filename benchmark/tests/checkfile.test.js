import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'
import schema from '../benchmark-checkfile.schema.json'
import {
  buildCheckfile,
  writeCheckfile,
  readCheckfile,
  assertionFor,
  verifyChecksums,
} from '../tools/checkfile.js'

const validate = new Ajv({ strict: false }).compile(schema)

function seedDataRoot() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'checkfile-'))
  for (const [size, n] of [
    ['s', 2],
    ['m', 5],
  ]) {
    const dir = join(dataRoot, 'synthea-clinical', '1', size)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Condition.ndjson'), '{"resourceType":"Condition"}\n'.repeat(n))
    writeFileSync(join(dir, 'Observation.ndjson'), '{"resourceType":"Observation"}\n'.repeat(n * 2))
  }
  return dataRoot
}

const dataset = { name: 'synthea-clinical', version: '1', syntheaVersion: '3.2.0', resources: ['Condition', 'Observation'] }

// ---- WRITER ----

test('buildCheckfile records identity, syntheaVersion, per-size counts and per-file sha256', () => {
  const dataRoot = seedDataRoot()
  const cf = buildCheckfile({
    dataRoot,
    dataset,
    sizes: ['s', 'm'],
    assertions: { 'condition-flat': { s: 2, m: 5 } },
  })
  expect(cf.dataset).toEqual({ name: 'synthea-clinical', version: '1' })
  expect(cf.syntheaVersion).toBe('3.2.0')
  expect(cf.sizes.s.resourceCounts).toEqual({ Condition: 2, Observation: 4 })
  expect(cf.sizes.m.resourceCounts).toEqual({ Condition: 5, Observation: 10 })
  const expected = createHash('sha256')
    .update(readFileSync(join(dataRoot, 'synthea-clinical', '1', 's', 'Condition.ndjson')))
    .digest('hex')
  expect(cf.sizes.s.files['Condition.ndjson'].sha256).toBe(expected)
  expect(cf.assertions['condition-flat']).toEqual({ s: 2, m: 5 })
  expect(validate(cf)).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('writeCheckfile persists and blessing one size leaves other sizes untouched', () => {
  const dataRoot = seedDataRoot()
  const out = join(dataRoot, 'clinical-flat.check.json')
  const cf1 = buildCheckfile({ dataRoot, dataset, sizes: ['s', 'm'], assertions: { c: { s: 2, m: 5 } } })
  writeCheckfile(out, cf1)
  expect(existsSync(out)).toBe(true)

  // re-bless only size s with a new count; m must survive from the prior checkfile
  const existing = readCheckfile(out)
  const cf2 = buildCheckfile({
    dataRoot,
    dataset,
    sizes: ['s'],
    assertions: { c: { s: 99 } },
    previous: existing,
  })
  expect(cf2.assertions.c.s).toBe(99)
  expect(cf2.assertions.c.m).toBe(5) // preserved from previous
  expect(cf2.sizes.m).toBeDefined() // size m checksums preserved
  rmSync(dataRoot, { recursive: true, force: true })
})

// ---- READER ----

test('assertionFor reads the expected count by case id and size', () => {
  const cf = { assertions: { 'condition-flat': { s: 2, m: 5 } } }
  expect(assertionFor(cf, 'condition-flat', 's')).toBe(2)
  expect(assertionFor(cf, 'condition-flat', 'm')).toBe(5)
  expect(assertionFor(cf, 'missing', 's')).toBeUndefined()
})

test('verifyChecksums surfaces drift when a file changes by a byte', () => {
  const dataRoot = seedDataRoot()
  const cf = buildCheckfile({ dataRoot, dataset, sizes: ['s'], assertions: {} })
  expect(verifyChecksums({ dataRoot, checkfile: cf, size: 's' })).toEqual([])
  // mutate one file
  const f = join(dataRoot, 'synthea-clinical', '1', 's', 'Condition.ndjson')
  writeFileSync(f, readFileSync(f, 'utf8') + '{"resourceType":"Condition"}\n')
  const drift = verifyChecksums({ dataRoot, checkfile: cf, size: 's' })
  expect(drift.some((d) => d.includes('Condition.ndjson'))).toBe(true)
  rmSync(dataRoot, { recursive: true, force: true })
})
