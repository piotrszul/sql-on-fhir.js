// Pure helpers for the flatquack DuckDB-session hook (design.md
// add-measurement-plans D7). No I/O, no duckdb binary, no flatquack worktree —
// sentinel/line parsing, SQL assembly, memoization keying, and env resolution,
// all unit-testable in isolation. The session I/O (duck-session.js) and the
// protocol server (flatquack-internal-hook.js) build on these.

// The in-engine sink the timed region materializes; count/extract read it.
export const SINK = '_sink'

// A per-command completion marker echoed by DuckDB's `.print`, matched as a whole
// stdout line to detect that the preceding statement finished (event-driven, no
// polling). Unique per sequence number so stale output can never satisfy a later
// command's wait.
export function sentinelFor(seq) {
  return `__SOF_SENTINEL_${seq}__`
}

// flatquack's preview mode prefixes each view with a `*** compiling <path> ***`
// progress line on stdout; it is not SQL. Drop those, keep everything else.
export function stripNoise(previewStdout) {
  return previewStdout
    .split('\n')
    .filter((l) => !l.startsWith('***'))
    .join('\n')
    .trim()
}

// Wrap a flatquack-compiled SELECT so the timed region materializes it in-engine
// (load + execute inside the clock; no CSV serialization). Idempotent across
// samples via CREATE OR REPLACE.
export function wrapSink(querySql) {
  return `CREATE OR REPLACE TEMP TABLE ${SINK} AS (\n${querySql.trim()}\n);`
}

// The untimed post-loop count verb: the engine's own count of the materialized
// sink (sound because the table sink already forced full materialization inside
// the timed region — design.md D4).
export const COUNT_SQL = `SELECT count(*) FROM ${SINK};`

// The untimed post-loop extract verb: write the sink to the CSV the harness
// named (same output-format contract as run), so the harness counts the file.
// Single quotes in the path are doubled per SQL string-literal escaping.
export function extractSql(outCsv) {
  return `COPY ${SINK} TO '${outCsv.replace(/'/g, "''")}' (FORMAT CSV, HEADER);`
}

// Read the one numeric line a headers-off csv `count(*)` prints. Anything else
// (no rows, extra rows, non-numeric) is a protocol error the caller surfaces.
export function parseCount(lines) {
  const nums = lines.map((l) => l.trim()).filter((l) => /^\d+$/.test(l))
  if (nums.length !== 1) {
    throw new Error(`expected exactly one count line, got ${JSON.stringify(lines)}`)
  }
  return Number(nums[0])
}

// Memoize compiled SQL per view: the dataset dir is constant across a run, so a
// view compiles once and every sample reuses it.
export function memoKey(view) {
  return JSON.stringify(view)
}

// The single machine-local knobs arrive via the manifest's env (like the CLI
// hook's FLATQUACK_CLI). Missing ones fail the hook loudly at start-up.
export function requireEnv(env, name, hint) {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set${hint ? ` (${hint})` : ''}`)
  return value
}

// flatquack preview argv: render the template against the one-view directory,
// substituting the per-run input dir. Selection is directory + glob (flatquack
// never selects a single file — see the CLI hook's finding 2).
export function previewArgs({ cli, template, viewDir, dataDir }) {
  return [
    cli,
    '--mode',
    'preview',
    '--template',
    template,
    '--view-path',
    viewDir,
    '--view-pattern',
    '*.json',
    '--param',
    `fq_input_dir=${dataDir}`,
  ]
}
