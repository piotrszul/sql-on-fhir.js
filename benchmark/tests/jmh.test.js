import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectJmh, writeJmhExports, implementationId } from '../tools/harness/jmh.js'

// A hand-computed fixture. samplesMs = [10, 12, 14, 16] for the ok case.
//
//   n = 4
//   mean (recomputed locally from samplesMs)           = 13
//   sample (n-1) stddev of [10,12,14,16]:
//       deviations from mean 13: -3, -1, 1, 3
//       squared: 9, 1, 1, 9 => sum 20; /(n-1)=/3 => 6.6666666667
//       sd = sqrt(20/3) = 2.581988897471611
//   scoreError = 1.959964 * sd / sqrt(n)
//              = 1.959964 * 2.581988897471611 / 2
//              = 5.060605287444049 / 2
//              = 2.5303026437220244
//   percentiles over sorted [10,12,14,16], rank = p/100*(n-1) = p/100*3:
//       0.0   -> rank 0     -> 10
//       50.0  -> rank 1.5   -> s[1]+(s[2]-s[1])*0.5 = 12 + 2*0.5 = 13
//       90.0  -> rank 2.7   -> s[2]+(s[3]-s[2])*0.7 = 14 + 2*0.7 = 15.4
//       95.0  -> rank 2.85  -> 14 + 2*0.85 = 15.7
//       99.0  -> rank 2.97  -> 14 + 2*0.97 = 15.94
//       99.9  -> rank 2.997 -> 14 + 2*0.997 = 15.994
//       100.0 -> rank 3     -> 16
function baseReport(overrides = {}) {
  return {
    implementation: { engine: { name: 'sof-js', version: '2.0.0' } },
    benchmark: { name: 'clinical-flat', version: '2' },
    dataset: { name: 'synthea-clinical', version: '1' },
    measurement: {
      scenario: 'preloaded_repeated',
      phases: ['execute', 'extract'],
      sink: 'csv',
      warmup: 0,
      iterations: 4,
    },
    results: {
      'clinical-flat': {
        size: 's',
        cases: [
          {
            id: 'obs',
            status: 'ok',
            outputRows: 42,
            samplesMs: [10, 12, 14, 16],
            stats: { mean: 13, stddev: 2.581988897471611, min: 10, max: 16, median: 13 },
          },
        ],
      },
    },
    ...overrides,
  }
}

const HALF_WIDTH = 2.5303026437220244

test('score/scoreConfidence are recomputed from samplesMs, not read from stats.mean', () => {
  // An EXTERNAL report whose stats.mean deliberately drifts from its own samplesMs.
  // The reference computes the mean freshly (statistics.fmean), so the export must
  // be centred on the SAMPLE mean (13), never on the drifted stats.mean (99).
  const r = baseReport()
  r.results['clinical-flat'].cases[0].samplesMs = [10, 12, 14, 16]
  r.results['clinical-flat'].cases[0].stats.mean = 99
  const e = JSON.parse(projectJmh(r)[0].content)[0]
  expect(e.primaryMetric.score).toBe(13)
  const err = e.primaryMetric.scoreError
  expect(e.primaryMetric.scoreConfidence).toEqual([13 - err, 13 + err])
})

test('measurementIterations is the per-cell sample count, not report.measurement.iterations', () => {
  // An EXTERNAL report whose declared iterations contradict the actual sample count.
  const r = baseReport()
  r.measurement.iterations = 99
  r.results['clinical-flat'].cases[0].samplesMs = [10, 12, 14, 16]
  const e = JSON.parse(projectJmh(r)[0].content)[0]
  expect(e.measurementIterations).toBe(4)
})

test('primaryMetric: mode ss, ms/op, score is the recomputed sample mean, rawData is nested samplesMs', () => {
  const files = projectJmh(baseReport())
  expect(files.length).toBe(1)
  const entries = JSON.parse(files[0].content)
  expect(entries.length).toBe(1)
  const e = entries[0]
  expect(e.mode).toBe('ss')
  expect(e.primaryMetric.scoreUnit).toBe('ms/op')
  expect(e.primaryMetric.score).toBe(13)
  expect(e.primaryMetric.rawData).toEqual([[10, 12, 14, 16]])
})

test('primaryMetric.scoreError is the hand-computed 95% half-width', () => {
  const files = projectJmh(baseReport())
  const e = JSON.parse(files[0].content)[0]
  expect(e.primaryMetric.scoreError).toBeCloseTo(HALF_WIDTH, 12)
  expect(e.primaryMetric.scoreConfidence).toEqual([
    13 - e.primaryMetric.scoreError,
    13 + e.primaryMetric.scoreError,
  ])
})

test('scoreError is 0 for a single-sample case', () => {
  const r = baseReport()
  r.results['clinical-flat'].cases[0].samplesMs = [10]
  r.results['clinical-flat'].cases[0].stats.mean = 10
  const e = JSON.parse(projectJmh(r)[0].content)[0]
  expect(e.primaryMetric.scoreError).toBe(0)
  // n == 1 percentile guard: every percentile equals the sole sample
  for (const v of Object.values(e.primaryMetric.scorePercentiles)) expect(v).toBe(10)
})

test('scorePercentiles are the hand-computed linear-interpolation values, string-keyed', () => {
  const e = JSON.parse(projectJmh(baseReport())[0].content)[0]
  const p = e.primaryMetric.scorePercentiles
  expect(p['0.0']).toBeCloseTo(10, 12)
  expect(p['50.0']).toBeCloseTo(13, 12)
  expect(p['90.0']).toBeCloseTo(15.4, 12)
  expect(p['95.0']).toBeCloseTo(15.7, 12)
  expect(p['99.0']).toBeCloseTo(15.94, 12)
  expect(p['99.9']).toBeCloseTo(15.994, 12)
  expect(p['100.0']).toBeCloseTo(16, 12)
})

test('secondaryMetrics.rows carries outputRows in a rows unit', () => {
  const e = JSON.parse(projectJmh(baseReport())[0].content)[0]
  expect(e.secondaryMetrics.rows.score).toBe(42)
  expect(e.secondaryMetrics.rows.scoreUnit).toBe('rows')
})

test('benchmark name is <benchmark.name>.<case.id>; params carry size only, not implementation', () => {
  const e = JSON.parse(projectJmh(baseReport())[0].content)[0]
  expect(e.benchmark).toBe('clinical-flat.obs')
  expect(e.params).toEqual({ size: 's' })
})

test('only ok cells with samples are exported; count_mismatch never appears', () => {
  const r = baseReport()
  r.results['clinical-flat'].cases = [
    {
      id: 'ok1',
      status: 'ok',
      outputRows: 5,
      samplesMs: [10, 12, 14, 16],
      stats: { mean: 13, stddev: 2.581988897471611, min: 10, max: 16, median: 13 },
    },
    {
      id: 'mismatch',
      status: 'count_mismatch',
      outputRows: 3,
      samplesMs: [1, 2, 3],
      stats: { mean: 2, stddev: 1, min: 1, max: 3, median: 2 },
    },
    { id: 'timeout', status: 'timeout', message: 'exceeded budget' },
    { id: 'malformed', status: 'malformed', message: 'bad' },
    { id: 'exec', status: 'execution_error', message: 'boom' },
    { id: 'gen', status: 'generation_error', message: 'boom' },
  ]
  const entries = JSON.parse(projectJmh(r)[0].content)
  const names = entries.map((e) => e.benchmark)
  expect(names).toEqual(['clinical-flat.ok1'])
  expect(names.some((n) => n.includes('mismatch'))).toBe(false)
})

test('an ok case with empty/absent samplesMs produces no entry, and no file for an empty triple', () => {
  const r = baseReport()
  r.results['clinical-flat'].cases = [
    {
      id: 'nosamples',
      status: 'ok',
      outputRows: 0,
      samplesMs: [],
      stats: { mean: 0, stddev: 0, min: 0, max: 0, median: 0 },
    },
    { id: 'absent', status: 'ok', outputRows: 0 },
  ]
  expect(projectJmh(r)).toEqual([])
})

test('two benchmarks against one implementation write distinct, non-colliding files', () => {
  const r = baseReport({
    results: {
      'clinical-flat': {
        size: 's',
        cases: [
          {
            id: 'obs',
            status: 'ok',
            outputRows: 1,
            samplesMs: [10, 12],
            stats: { mean: 11, stddev: 1.4142135623730951, min: 10, max: 12, median: 11 },
          },
        ],
      },
      'other-bench': {
        size: 's',
        cases: [
          {
            id: 'x',
            status: 'ok',
            outputRows: 1,
            samplesMs: [10, 12],
            stats: { mean: 11, stddev: 1.4142135623730951, min: 10, max: 12, median: 11 },
          },
        ],
      },
    },
  })
  const files = projectJmh(r)
  const names = files.map((f) => f.filename).sort()
  expect(names).toEqual(['clinical-flat-s-sof-js-2.0.0.jmh.json', 'other-bench-s-sof-js-2.0.0.jmh.json'])
})

test('file name segments are sanitized filename-safe', () => {
  const r = baseReport({
    implementation: { engine: { name: 'sof/js', version: '2.0 rc1' } },
    results: {
      'clinical/flat': {
        size: 's m',
        cases: [
          {
            id: 'obs',
            status: 'ok',
            outputRows: 1,
            samplesMs: [10, 12],
            stats: { mean: 11, stddev: 1.4142135623730951, min: 10, max: 12, median: 11 },
          },
        ],
      },
    },
  })
  const files = projectJmh(r)
  expect(files[0].filename).toBe('clinical_flat-s_m-sof_js-2.0_rc1.jmh.json')
})

test('implementationId composes engine, optional binding, optional variant, sanitized', () => {
  expect(implementationId({ engine: { name: 'sof-js', version: '2.0.0' } })).toBe('sof-js-2.0.0')
  expect(
    implementationId({ engine: { name: 'duckdb', version: '1.5.3' }, binding: { name: 'fq', version: '9' } }),
  ).toBe('duckdb-1.5.3-fq-9')
  expect(
    implementationId({
      engine: { name: 'duckdb', version: '1.5.3' },
      binding: { name: 'fq', version: '9' },
      variant: 'v5-struct',
    }),
  ).toBe('duckdb-1.5.3-fq-9-v5-struct')
  expect(implementationId({ engine: { name: 'duckdb', version: '1.5.3' }, variant: 'master' })).toBe(
    'duckdb-1.5.3-master',
  )
})

test('writeJmhExports writes the projected files to a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jmh-'))
  try {
    const written = writeJmhExports(baseReport(), dir)
    expect(written.length).toBe(1)
    const listed = readdirSync(dir)
    expect(listed).toEqual(['clinical-flat-s-sof-js-2.0.0.jmh.json'])
    const entries = JSON.parse(readFileSync(join(dir, listed[0]), 'utf8'))
    expect(entries[0].benchmark).toBe('clinical-flat.obs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeJmhExports writes nothing when there are no ok cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jmh-'))
  try {
    const r = baseReport()
    r.results['clinical-flat'].cases = [{ id: 'x', status: 'timeout', message: 'nope' }]
    const written = writeJmhExports(r, dir)
    expect(written).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
