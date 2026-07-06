import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-hook.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodManifest = {
  command: ['bun', 'src/hook.js'],
  implementation: { engine: { name: 'sof-js', version: '2.0.0' } },
}

test('a minimal spawn-mode manifest (command + engine) passes the schema', () => {
  expect(validate(goodManifest)).toBe(true)
})

test('a connect-mode manifest (endpoint + engine) passes the schema', () => {
  const m = structuredClone(goodManifest)
  delete m.command
  m.endpoint = 'http://127.0.0.1:8095'
  expect(validate(m)).toBe(true)
})

test('a CLI-mode manifest (cli.run template + engine) passes the schema', () => {
  const m = structuredClone(goodManifest)
  delete m.command
  m.cli = { run: ['flatquack', '--input', '{dataDir}', '--view', '{viewFile}', '--output', '{outCsv}'] }
  expect(validate(m)).toBe(true)
})

test('a manifest declaring both command and endpoint is rejected', () => {
  const bad = structuredClone(goodManifest)
  bad.endpoint = 'http://127.0.0.1:8095'
  expect(validate(bad)).toBe(false)
})

test('a manifest declaring any two of command, endpoint and cli is rejected', () => {
  for (const extra of [
    { cli: { run: ['tool', '{outCsv}'] } },
    { endpoint: 'http://127.0.0.1:8095', ...{} },
  ]) {
    const bad = { ...structuredClone(goodManifest), ...extra }
    expect(validate(bad)).toBe(false)
  }
  const cliPlusEndpoint = structuredClone(goodManifest)
  delete cliPlusEndpoint.command
  cliPlusEndpoint.cli = { run: ['tool', '{outCsv}'] }
  cliPlusEndpoint.endpoint = 'http://127.0.0.1:8095'
  expect(validate(cliPlusEndpoint)).toBe(false)
})

test('an empty cli.run template is rejected', () => {
  const bad = structuredClone(goodManifest)
  delete bad.command
  bad.cli = { run: [] }
  expect(validate(bad)).toBe(false)
})

test('a cli object without a run template is rejected', () => {
  const bad = structuredClone(goodManifest)
  delete bad.command
  bad.cli = {}
  expect(validate(bad)).toBe(false)
})

test('an unknown key inside cli is rejected', () => {
  const bad = structuredClone(goodManifest)
  delete bad.command
  bad.cli = { run: ['tool', '{outCsv}'], shell: true }
  expect(validate(bad)).toBe(false)
})

test('a full manifest with binding, variant, cwd and env passes the schema', () => {
  const m = structuredClone(goodManifest)
  m.implementation.binding = { name: 'sof-py', version: '0.3.0' }
  m.implementation.variant = 'columnar'
  m.cwd = '.'
  m.env = { JAVA_OPTS: '-Xmx4g' }
  expect(validate(m)).toBe(true)
})

test('a manifest declaring neither command nor endpoint is rejected', () => {
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

test('the committed fixture manifests (spawn and connect) validate', async () => {
  for (const f of ['fake.hook.json', 'fake-connect.hook.json', 'fake-cli.hook.json']) {
    const manifest = await Bun.file(new URL(`./fixtures/hooks/${f}`, import.meta.url)).json()
    expect(validate(manifest)).toBe(true)
  }
})
