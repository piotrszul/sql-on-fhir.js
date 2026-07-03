import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-hook.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodManifest = {
  command: ['bun', 'src/hook.js'],
  implementation: { engine: { name: 'sof-js', version: '2.0.0' } },
}

test('a minimal manifest (command + engine) passes the schema', () => {
  expect(validate(goodManifest)).toBe(true)
})

test('a full manifest with binding, variant, cwd and env passes the schema', () => {
  const m = structuredClone(goodManifest)
  m.implementation.binding = { name: 'sof-py', version: '0.3.0' }
  m.implementation.variant = 'columnar'
  m.cwd = '.'
  m.env = { JAVA_OPTS: '-Xmx4g' }
  expect(validate(m)).toBe(true)
})

test('a manifest omitting command is rejected', () => {
  const bad = structuredClone(goodManifest)
  delete bad.command
  expect(validate(bad)).toBe(false)
})

test('an empty command argv is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.command = []
  expect(validate(bad)).toBe(false)
})

test('a manifest omitting implementation.engine is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.implementation = { binding: { name: 'sof-py', version: '0.3.0' } }
  expect(validate(bad)).toBe(false)
})

test('an engine without a version is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.implementation.engine = { name: 'sof-js' }
  expect(validate(bad)).toBe(false)
})

test('an unknown top-level property is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.timeout = 60
  expect(validate(bad)).toBe(false)
})

test('an unknown key inside implementation is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.implementation.vendor = 'acme'
  expect(validate(bad)).toBe(false)
})

test('the committed sof-js hook manifest validates', async () => {
  const manifest = await Bun.file(new URL('../../sof-js/hook.json', import.meta.url)).json()
  expect(validate(manifest)).toBe(true)
})
