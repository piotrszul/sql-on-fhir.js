// Thin adapter around flatquack for the benchmark CLI hook. Not implementation
// code the contract requires — a per-engine shim, the same role sof-js/hook.js
// plays for the HTTP contract. The harness spawns it directly (never via a
// shell); it does two pure-adapter jobs:
//
//   1. View isolation. flatquack selects input by directory + glob, never by a
//      single file, and the harness hands us one {viewFile} in a work dir that
//      accumulates views across the session. We copy that one view into a
//      fresh temp dir and point flatquack at it with its real, documented CLI
//      (`--view-path <dir> --view-pattern '*.json'`).
//
//   2. Honest success signalling. A run succeeds iff flatquack exits 0 AND the
//      output CSV was written. The exit-code half is trustworthy now that
//      flatquack runs its `run` mode under node (aehrc/flatquack#42: Bun's
//      duckdb native-addon teardown intermittently segfaulted after a correct
//      write — the fixed CLI launches under node instead). The CSV half still
//      guards aehrc/flatquack#43 (flatquack exits 0 with no output on a SQL
//      failure). We delete any prior CSV first so a stale file from an earlier
//      sample at the same path cannot mask a current failure; the harness then
//      counts the file's rows against the checkfile.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function fail(msg) {
  console.error(`flatquack-hook: ${msg}`)
  process.exit(1)
}

const [dataDir, viewFile, outCsv] = process.argv.slice(2)
if (!dataDir || !viewFile || !outCsv) fail('usage: flatquack-hook.js <dataDir> <viewFile> <outCsv>')

// The one machine-local knob: the path to flatquack's src/cli.js, supplied via
// the manifest's `env` (see hook.json). The SQL template ships beside us.
const cli = process.env.FLATQUACK_CLI
if (!cli) fail('FLATQUACK_CLI is not set (absolute path to flatquack src/cli.js)')
const template = join(import.meta.dir, 'flatquack-hook.sql')

rmSync(outCsv, { force: true })
// Canonicalize like the harness does for its own temp dirs (tools/harness/
// tempdir.js): on macOS tmpdir() is a /var→/private/var symlink, and flatquack
// glob-walks --view-path. An uncanonicalized dir re-opens the symlink defect
// that finding 1 fixed for {viewFile}; safe under node's symlink-following
// glob, but we don't want to depend on that.
const viewDir = realpathSync(mkdtempSync(join(tmpdir(), 'flatquack-view-')))
let result
try {
  copyFileSync(viewFile, join(viewDir, 'view.json'))
  // Launch flatquack under node (see job 2 / #42), in this wrapper's process
  // group (no `detached`) so the harness's timeout group-kill reaps it too.
  result = spawnSync(
    'node',
    [
      cli,
      '--mode',
      'run',
      '--strict',
      '--template',
      template,
      '--view-path',
      viewDir,
      '--view-pattern',
      '*.json',
      '--param',
      `fq_input_dir=${dataDir}`,
      '--param',
      `fq_out_csv=${outCsv}`,
    ],
    { stdio: 'inherit' },
  )
} finally {
  rmSync(viewDir, { recursive: true, force: true })
}

if (result.status === 0 && existsSync(outCsv) && statSync(outCsv).size > 0) process.exit(0)
fail(`flatquack failed (exit ${result.status ?? result.signal}) or wrote no output CSV`)
