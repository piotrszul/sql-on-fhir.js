import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runJmhCli } from '../tools/harness/jmh-cli.js'

function report(cases) {
  return {
    implementation: { engine: { name: 'sof-js', version: '2.0.0' } },
    benchmark: { name: 'clinical-flat', version: '2' },
    dataset: { name: 'synthea-clinical', version: '1' },
    measurement: {
      scenario: 'preloaded_repeated',
      phases: ['execute', 'extract'],
      sink: 'csv',
      warmup: 0,
      iterations: 2,
    },
    results: { 'clinical-flat': { size: 's', cases } },
  }
}

test('CLI reads a report file and writes JMH files to the output dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jmh-cli-'))
  try {
    const reportPath = join(dir, 'report.json')
    const outDir = join(dir, 'out')
    writeFileSync(
      reportPath,
      JSON.stringify(
        report([
          {
            id: 'obs',
            status: 'ok',
            outputRows: 3,
            samplesMs: [10, 12],
            stats: { mean: 11, stddev: 1.4142135623730951, min: 10, max: 12, median: 11 },
          },
        ]),
      ),
    )
    const written = runJmhCli([reportPath, outDir])
    expect(written.length).toBe(1)
    const listed = readdirSync(outDir)
    expect(listed).toEqual(['clinical-flat-s-sof-js-2.0.0.jmh.json'])
    const entries = JSON.parse(readFileSync(join(outDir, listed[0]), 'utf8'))
    expect(entries[0].benchmark).toBe('clinical-flat.obs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI writes nothing when the report has no ok cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jmh-cli-'))
  try {
    const reportPath = join(dir, 'report.json')
    const outDir = join(dir, 'out')
    writeFileSync(reportPath, JSON.stringify(report([{ id: 'x', status: 'timeout', message: 'nope' }])))
    const written = runJmhCli([reportPath, outDir])
    expect(written).toEqual([])
    expect(readdirSync(outDir)).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI errors when given too few arguments', () => {
  expect(() => runJmhCli(['only-one'])).toThrow()
})
