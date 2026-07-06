// Scripted fake CLI engine for CLI-connector tests: one process per
// invocation, behaviour selected by the view's `resource` marker.
//
//   BoomMe        -> write diagnostics to stderr and exit 3
//   HangMe        -> never exit (harness inactivity budget -> timeout)
//   anything else -> write a CSV with one row per line of <dataDir>/<resource>.ndjson
//
// argv: <dataDir> <viewFile> --out=<outCsv> [extras...]
// FAKE_CLI_LOG appends one JSON line ({pid, argv}) per invocation so tests can
// count spawns and assert literal (shell-free) argv delivery.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
if (process.env.FAKE_CLI_LOG) {
  appendFileSync(process.env.FAKE_CLI_LOG, `${JSON.stringify({ pid: process.pid, argv })}\n`)
}

const [dataDir, viewFile] = argv
const outCsv = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length)
const view = JSON.parse(readFileSync(viewFile, 'utf8'))

if (view.resource === 'BoomMe') {
  process.stderr.write('engine exploded loudly\n')
  process.exit(3)
} else if (view.resource === 'HangMe') {
  setInterval(() => {}, 1 << 30)
} else {
  const txt = readFileSync(join(dataDir, `${view.resource}.ndjson`), 'utf8')
  const rows = txt.split('\n').filter((l) => l.trim().length > 0).length
  const lines = ['id']
  for (let i = 0; i < rows; i++) lines.push(`row-${i}`)
  writeFileSync(outCsv, lines.join('\n'))
}
