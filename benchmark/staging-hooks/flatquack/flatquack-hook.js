// Thin adapter around flatquack for the benchmark CLI hook. Not implementation
// code the contract requires — a per-engine shim, the same role sof-js/hook.js
// plays for the HTTP contract. The harness spawns it directly (never via a
// shell); it does two pure-adapter jobs:
//
//   1. View isolation. flatquack selects input by directory + glob, never by a
//      single file, and the harness hands us one {viewFile} in a work dir that
//      accumulates views across the session. We copy that one view into a
//      fresh temp dir and point flatquack at it with its real, documented CLI
//      (`--view-path <dir> --view-pattern '*.json'`) — no reliance on the
//      fragile `..{viewFile}` glob idiom.
//
//   2. Honest success signalling. Success is the OUTPUT: the CSV is written.
//      flatquack currently exits 133 on an intermittent teardown segfault
//      AFTER a correct write (aehrc/flatquack#42) and exits 0 with no output
//      on a SQL failure (aehrc/flatquack#43) — both violate the CLI-hook
//      contract. We ignore flatquack's own exit code and report success iff
//      the CSV exists and is non-empty. The harness still counts the file's
//      rows against the checkfile, so a truncated write fails as
//      count_mismatch rather than a false pass.
//
// CAVEAT: masking #42 unblocks size-`m` contract validation (row counts
// verify), but the timed region then carries Bun's panic/backtrace on crashed
// samples, so timing from this wrapper is NOT trustworthy flatquack
// performance until #42 is fixed upstream. See FINDINGS.md.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, rmSync, existsSync, statSync } from 'node:fs'
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

const viewDir = mkdtempSync(join(tmpdir(), 'flatquack-view-'))
try {
  copyFileSync(viewFile, join(viewDir, 'view.json'))
  // flatquack runs in this wrapper's process group (no `detached`), so the
  // harness's timeout group-kill reaps it too. Exit code intentionally
  // ignored — see job 2 above.
  spawnSync(
    'bun',
    [
      'run',
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

if (existsSync(outCsv) && statSync(outCsv).size > 0) process.exit(0)
fail('flatquack produced no output CSV')
