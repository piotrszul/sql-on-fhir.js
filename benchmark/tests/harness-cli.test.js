import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'
import reportSchema from '../benchmark-report.schema.json'
import { runCli } from '../tools/harness/cli.js'
import { datasetDir } from '../tools/layout.js'

const validateReport = new Ajv({ strict: false }).compile(reportSchema)

const sofJsHook = join(import.meta.dir, '../../sof-js/hook.json')
const fakeHook = join(import.meta.dir, 'fixtures/hooks/fake.hook.json')

// The 5.5 smoke suite: real ViewDefinitions evaluated by the real sof-js engine
// through the real hook, driven by the real harness — materialized fixture data
// in, conforming verified report and JMH projection out.
const suite = {
  name: 'smoke',
  version: '1',
  title: 'harness smoke',
  fhirVersion: '4.0.1',
  iterations: { warmup: 1, measurement: 3 },
  dataset: {
    name: 'smoke-data',
    kind: 'synthea',
    version: '1',
    syntheaVersion: '3.2.0',
    resources: ['Observation'],
    sizes: { s: { population: 1 } },
    defaultSize: 's',
    params: { seed: 1 },
  },
  cases: [
    {
      id: 'obs',
      title: 'obs',
      view: {
        resource: 'Observation',
        select: [{ column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] }],
      },
    },
    {
      id: 'obs-components',
      title: 'observation components',
      view: {
        resource: 'Observation',
        select: [
          { column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] },
          { forEach: 'component', column: [{ name: 'c', path: 'code.coding.first().code', type: 'code' }] },
        ],
      },
    },
  ],
}

function seedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'smoke-'))
  const dataRoot = join(root, 'data')
  const dir = datasetDir(dataRoot, 'smoke-data', '1', 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'Observation.ndjson'),
    [
      JSON.stringify({
        resourceType: 'Observation',
        id: 'o1',
        component: [{ code: { coding: [{ code: 'a' }] } }, { code: { coding: [{ code: 'b' }] } }],
      }),
      JSON.stringify({
        resourceType: 'Observation',
        id: 'o2',
        component: [{ code: { coding: [{ code: 'c' }] } }],
      }),
    ].join('\n') + '\n',
  )
  const suitePath = join(root, 'smoke.json')
  writeFileSync(suitePath, JSON.stringify(suite))
  writeFileSync(
    join(root, 'smoke.check.json'),
    JSON.stringify({
      dataset: { name: 'smoke-data', version: '1' },
      syntheaVersion: '3.2.0',
      sizes: {},
      assertions: { obs: { s: 2 }, 'obs-components': { s: 3 } },
    }),
  )
  return { root, dataRoot, suitePath }
}

test('end-to-end smoke: fixture data -> harness + sof-js hook -> verified report -> JMH export', async () => {
  const { root, dataRoot, suitePath } = seedWorkspace()
  const reportPath = join(root, 'report.json')
  const jmhDir = join(root, 'jmh')
  await runCli([
    'run',
    '--hook',
    sofJsHook,
    suitePath,
    '--size',
    's',
    '--data',
    dataRoot,
    '--out',
    reportPath,
    '--jmh',
    jmhDir,
  ])
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  expect(validateReport(report)).toBe(true)
  expect(report.implementation.engine.name).toBe('sof-js')
  const cases = report.results['smoke'].cases
  expect(cases).toHaveLength(2)
  for (const c of cases) {
    expect(c.status).toBe('ok')
    expect(c.verified).toBe(true)
    expect(c.samplesMs).toHaveLength(3)
  }
  expect(cases.find((c) => c.id === 'obs').outputRows).toBe(2)
  expect(cases.find((c) => c.id === 'obs-components').outputRows).toBe(3)
  // one JMH file for the (benchmark, size, implementation) triple
  const jmhFiles = readdirSync(jmhDir)
  expect(jmhFiles).toHaveLength(1)
  expect(jmhFiles[0]).toMatch(/^smoke-s-sof-js.*\.jmh\.json$/)
  const entries = JSON.parse(readFileSync(join(jmhDir, jmhFiles[0]), 'utf8'))
  expect(entries.map((e) => e.benchmark).sort()).toEqual(['smoke.obs', 'smoke.obs-components'])
  rmSync(root, { recursive: true, force: true })
}, 20_000)

test('exec debug mode sends one command and prints its response', async () => {
  const resp = await runCli(['exec', '--hook', fakeHook, '{"cmd":"capabilities"}'])
  expect(resp.ok).toBe(true)
  expect(resp.scenarios).toContain('preloaded_repeated')
})
