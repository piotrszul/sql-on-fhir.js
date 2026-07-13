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
  countLines,
  hashAndCountLines,
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

const dataset = {
  name: 'synthea-clinical',
  version: '1',
  syntheaVersion: '3.2.0',
  resources: ['Condition', 'Observation'],
}

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

test('re-blessing drops assertions for case ids no longer in the benchmark', () => {
  const dataRoot = seedDataRoot()
  const out = join(dataRoot, 'clinical-flat.check.json')
  // first bless with two cases
  const cf1 = buildCheckfile({
    dataRoot,
    dataset,
    sizes: ['s'],
    assertions: { keep: { s: 2 }, gone: { s: 4 } },
  })
  writeCheckfile(out, cf1)
  const existing = readCheckfile(out)
  expect(existing.assertions.gone).toBeDefined()

  // re-bless with only the surviving case id
  const cf2 = buildCheckfile({
    dataRoot,
    dataset,
    sizes: ['s'],
    assertions: { keep: { s: 2 } },
    previous: existing,
  })
  expect(cf2.assertions.keep).toBeDefined()
  expect(cf2.assertions.gone).toBeUndefined()
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

// The streaming hashAndCountLines and the whole-file countLines lock the SAME
// counts (the checkfile's resourceCounts and the harness's report counts must
// never disagree), so pin their parity across the edge cases the prose comment
// claims: an empty file, a file with no trailing newline, and a normal one.
test('countLines and hashAndCountLines agree across line-ending edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linecount-'))
  const cases = [
    ['empty', '', 0],
    ['unterminated', '{"a":1}\n{"a":2}', 2],
    ['terminated', '{"a":1}\n{"a":2}\n', 2],
    ['single-no-newline', '{"a":1}', 1],
    ['single-newline', '{"a":1}\n', 1],
  ]
  for (const [name, content, expected] of cases) {
    const p = join(dir, `${name}.ndjson`)
    writeFileSync(p, content)
    expect(countLines(p), `countLines(${name})`).toBe(expected)
    expect(hashAndCountLines(p).lines, `hashAndCountLines(${name})`).toBe(expected)
  }
  rmSync(dir, { recursive: true, force: true })
})

test('hashAndCountLines sha256 matches a whole-file hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linehash-'))
  const content = '{"a":1}\n{"a":2}\n{"a":3}\n'
  const p = join(dir, 'x.ndjson')
  writeFileSync(p, content)
  const whole = createHash('sha256').update(content).digest('hex')
  expect(hashAndCountLines(p).sha256).toBe(whole)
  rmSync(dir, { recursive: true, force: true })
})

// Both readers stream the file in fixed-size byte chunks (never a whole-file
// string — an xl resource file exceeds the engine's max string length), so their
// count/hash must stitch correctly when a newline OR a multibyte UTF-8 character
// straddles a chunk boundary. Forcing tiny chunk sizes lands both mid-character.
test('countLines and hashAndCountLines are chunk-boundary correct with tiny chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chunk-'))
  const p = join(dir, 'x.ndjson')
  // café + 😀 are multibyte; the final line has no trailing newline.
  const content = '{"n":"café"}\n{"n":"😀😀"}\n{"n":"a"}\n{"n":"tail-no-newline"}'
  writeFileSync(p, content)
  const wholeHash = createHash('sha256').update(readFileSync(p)).digest('hex')
  for (const chunkBytes of [1, 2, 3, 5, 7, 64]) {
    expect(countLines(p, { chunkBytes }), `countLines@${chunkBytes}`).toBe(4)
    const r = hashAndCountLines(p, { chunkBytes })
    expect(r.lines, `lines@${chunkBytes}`).toBe(4)
    expect(r.sha256, `sha256@${chunkBytes}`).toBe(wholeHash)
  }
  rmSync(dir, { recursive: true, force: true })
})
