// flatquack DuckDB-session benchmark hook — staging scaffolding, NOT contract
// code (design.md add-measurement-plans D7). A spawn-mode HTTP hook (Bun,
// structured after sof-js/src/hook.js and the pathling-server staging adapter)
// that holds ONE persistent duckdb CLI child and answers the benchmark protocol
// plus the two staging-scoped post-loop verbs:
//
//   capabilities -> declares the single internal scenario the driver gates on.
//   prepare      -> record the dataset dir (no load — load rides inside run).
//   run          -> compile the ViewDefinition via flatquack ONCE (memoized,
//                   untimed), then materialize it in-engine each sample:
//                   CREATE OR REPLACE TEMP TABLE _sink AS (<compiled SELECT>).
//                   flatquack's macros are defined once at session start.
//   count        -> SELECT count(*) FROM _sink (untimed, engine-reported).
//   extract      -> COPY _sink TO '<outCsv>' (untimed; the harness counts it).
//   reset        -> DROP the sink (unused by the warm plan; provided anyway).
//   shutdown     -> close the duckdb child, exit 0.
//
// The harness owns all timing; the phasesMs reported here are advisory (the
// hook's own view of the CREATE-TABLE region — the .timer cross-check).

import { writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeEngineTempDir } from '../../tools/harness/tempdir.js'
import { DuckSession } from './duck-session.js'
import {
  requireEnv,
  previewArgs,
  stripNoise,
  wrapSink,
  countSql,
  extractSql,
  parseCount,
  memoKey,
} from './hook-lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCENARIO = 'internal:warm-table-sink'
const DUCKDB_BIN = requireEnv(process.env, 'DUCKDB_BIN', 'absolute path to a duckdb CLI binary')
const FLATQUACK_CLI = requireEnv(process.env, 'FLATQUACK_CLI', 'absolute path to flatquack src/cli.js')
const MACROS_TEMPLATE = join(here, 'flatquack-macros.sql')
const TABLE_TEMPLATE = join(here, 'flatquack-table.sql')

let dataDir = null
let session = null
let macrosLoaded = false
const compiled = new Map() // memoKey(view) -> CREATE TABLE _sink AS (...) SQL

// Render one flatquack template against a single-view directory, capturing the
// generated SQL (stdout). Runs under node like the CLI hook (preview needs no
// duckdb, but node is flatquack's supported launcher).
function compile(template, view) {
  if (!dataDir) throw new Error('run before prepare: no dataset dir recorded')
  const viewDir = makeEngineTempDir('fqi-view-')
  try {
    writeFileSync(join(viewDir, 'view.json'), JSON.stringify(view))
    const res = spawnSync('node', previewArgs({ cli: FLATQUACK_CLI, template, viewDir, dataDir }), {
      encoding: 'utf8',
    })
    if (res.status !== 0) {
      throw new Error(`flatquack preview failed (exit ${res.status}): ${(res.stderr || '').trim()}`)
    }
    return stripNoise(res.stdout)
  } finally {
    rmSync(viewDir, { recursive: true, force: true })
  }
}

// Optional per-identity engine tuning knobs (design D6/D7): a `;`-separated list
// of extra SET statements applied once at session start, so two manifests can
// compare DuckDB configurations (e.g. `SET threads=1`) as distinct identities.
const EXTRA_PRAGMAS = (process.env.DUCKDB_PRAGMAS || '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

async function ensureSession() {
  if (!session) {
    session = new DuckSession(DUCKDB_BIN)
    // Match the retired rig: insertion order is not preserved, trading a stable
    // row order (irrelevant to a count/materialization benchmark) for speed.
    await session.run('SET preserve_insertion_order=false;')
    for (const pragma of EXTRA_PRAGMAS) await session.run(`${pragma};`)
  }
  return session
}

async function doRun(view) {
  const s = await ensureSession()
  if (!macrosLoaded) {
    await s.run(compile(MACROS_TEMPLATE, view)) // define flatquack's macros once, untimed
    macrosLoaded = true
  }
  const key = memoKey(view)
  if (!compiled.has(key)) compiled.set(key, wrapSink(compile(TABLE_TEMPLATE, view)))
  const t0 = performance.now()
  await s.run(compiled.get(key)) // the timed region: load + execute -> in-engine sink
  return { ok: true, phasesMs: { execute: performance.now() - t0 } }
}

async function handle(name, body) {
  switch (name) {
    case 'capabilities':
      return { ok: true, scenarios: [SCENARIO], verbs: ['count', 'extract'] }
    case 'prepare':
      dataDir = body.dataDir
      await ensureSession()
      return { ok: true }
    case 'run':
      return doRun(body.view)
    case 'count': {
      const rows = parseCount(await (await ensureSession()).run(countSql()))
      return { ok: true, rows }
    }
    case 'extract':
      await (await ensureSession()).run(extractSql(body.outCsv))
      return { ok: true }
    case 'reset':
      if (session) await session.run(`DROP TABLE IF EXISTS _sink;`)
      return { ok: true }
    case 'shutdown':
      await session?.close()
      return { ok: true }
    default:
      return { ok: false, error: `unknown command endpoint: ${name}` }
  }
}

console.error(`flatquack-internal-hook: duckdb=${DUCKDB_BIN}`)

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.HOOK_PORT || 0),
  async fetch(req) {
    const name = new URL(req.url).pathname.replace(/^\/+/, '')
    let body = {}
    if (req.method !== 'GET') {
      try {
        body = await req.json()
      } catch {
        body = {}
      }
    }
    let resp
    try {
      resp = await handle(name, body)
    } catch (err) {
      resp = { ok: false, error: String(err?.message ?? err) }
    }
    const response = Response.json(resp)
    if (name === 'shutdown') setTimeout(() => process.exit(0), 10)
    return response
  },
})
