import { test, expect } from 'bun:test'
import {
  SINK,
  sentinelFor,
  stripNoise,
  wrapSink,
  countSql,
  extractSql,
  parseCount,
  memoKey,
  requireEnv,
  previewArgs,
} from '../staging-hooks/flatquack-internal/hook-lib.js'

// The pure parts of the DuckDB-session hook, unit-tested without a duckdb binary
// or a flatquack worktree (tasks 5.2–5.4): sentinel/line parsing, SQL assembly,
// memoization keying, and env resolution.

test('sentinelFor is unique per sequence number and shaped for exact-line matching', () => {
  expect(sentinelFor(1)).toBe('__SOF_SENTINEL_1__')
  expect(sentinelFor(2)).not.toBe(sentinelFor(1))
})

test("stripNoise drops flatquack's *** compiling *** progress lines, keeps SQL", () => {
  const out = ['*** compiling /tmp/v/view.json ***', 'WITH transformed AS (', '  SELECT 1', ')'].join('\n')
  expect(stripNoise(out)).toBe('WITH transformed AS (\n  SELECT 1\n)')
})

test('wrapSink wraps a query as CREATE OR REPLACE TEMP TABLE _sink', () => {
  const sql = wrapSink('SELECT 1 AS x')
  expect(sql).toContain(`CREATE OR REPLACE TEMP TABLE ${SINK} AS (`)
  expect(sql).toContain('SELECT 1 AS x')
  expect(sql.trimEnd().endsWith(');')).toBe(true)
})

test('countSql and extractSql target the sink; extract escapes single quotes in the path', () => {
  expect(countSql()).toBe(`SELECT count(*) FROM ${SINK};`)
  expect(extractSql('/tmp/o.csv')).toBe(`COPY ${SINK} TO '/tmp/o.csv' (FORMAT CSV, HEADER);`)
  expect(extractSql("/tmp/o'x.csv")).toContain("'/tmp/o''x.csv'")
})

test('parseCount reads the single numeric result line (headers-off csv)', () => {
  expect(parseCount(['6406'])).toBe(6406)
  expect(parseCount(['', '42', ''])).toBe(42)
})

test('parseCount rejects a result that is not exactly one count', () => {
  expect(() => parseCount([])).toThrow()
  expect(() => parseCount(['a', 'b'])).toThrow()
  expect(() => parseCount(['1', '2'])).toThrow()
})

test('memoKey is stable per view and distinguishes different views', () => {
  const a = { resource: 'Condition', select: [{ column: [{ name: 'id', path: 'id' }] }] }
  const b = { resource: 'Observation', select: [{ column: [{ name: 'id', path: 'id' }] }] }
  expect(memoKey(a)).toBe(memoKey({ ...a }))
  expect(memoKey(a)).not.toBe(memoKey(b))
})

test('requireEnv returns a set value and throws a helpful error when missing', () => {
  expect(requireEnv({ DUCKDB_BIN: '/x/duckdb' }, 'DUCKDB_BIN')).toBe('/x/duckdb')
  expect(() => requireEnv({}, 'FLATQUACK_CLI', 'path to src/cli.js')).toThrow(/FLATQUACK_CLI.*cli\.js/)
})

test('previewArgs builds the flatquack preview argv (directory + glob + input param)', () => {
  expect(previewArgs({ cli: '/fq/cli.js', template: '/t.sql', viewDir: '/v', dataDir: '/d' })).toEqual([
    '/fq/cli.js',
    '--mode',
    'preview',
    '--template',
    '/t.sql',
    '--view-path',
    '/v',
    '--view-pattern',
    '*.json',
    '--param',
    'fq_input_dir=/d',
  ])
})
