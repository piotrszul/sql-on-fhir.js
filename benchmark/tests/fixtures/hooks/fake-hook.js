// Scripted fake hook for harness tests: a protocol-conformant worker whose
// per-case behavior is selected by the view's `resource` marker, so one manifest
// can exercise good cases and every failure mode in a single run.
//
//   CrashMe     -> exit mid-command without responding (worker crash)
//   HangMe      -> never respond (harness inactivity budget -> timeout)
//   FailMe      -> {"ok":false,"error":...} and stay alive
//   PolluteMe   -> emit a non-JSON stdout line while the command is in flight
//   MisreportMe -> write the CSV but over-report outputRows by 5
//   anything else -> write a CSV with one row per prepared NDJSON line
//
// capabilities echoes FAKE_TOKEN so tests can observe manifest env merging.

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const counts = {}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function csvOf(rows) {
  const lines = ['id']
  for (let i = 0; i < rows; i++) lines.push(`row-${i}`)
  return lines.join('\n')
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  switch (msg.cmd) {
    case 'capabilities': {
      const scenarios = process.env.FAKE_SCENARIOS
        ? process.env.FAKE_SCENARIOS.split(',')
        : ['preloaded_repeated', 'end_to_end']
      respond({ ok: true, scenarios, token: process.env.FAKE_TOKEN ?? null })
      break
    }
    case 'prepare':
      for (const r of msg.resources) {
        const txt = readFileSync(join(msg.dataDir, `${r}.ndjson`), 'utf8')
        counts[r] = txt.split('\n').filter((l) => l.trim().length > 0).length
      }
      respond({ ok: true })
      break
    case 'run': {
      const marker = msg.view.resource
      if (marker === 'CrashMe') process.exit(3)
      if (marker === 'HangMe') break // no response; stay alive
      if (marker === 'PolluteMe') {
        process.stdout.write('LOG: engines gonna engine\n')
        respond({ ok: true, outputRows: 0 })
        break
      }
      if (marker === 'FailMe') {
        respond({ ok: false, error: 'engine exploded' })
        break
      }
      const rows = counts[marker] ?? 0
      writeFileSync(msg.outCsv, csvOf(rows))
      const reported = marker === 'MisreportMe' ? rows + 5 : rows
      respond({ ok: true, outputRows: reported, phasesMs: { execute: 1.0, extract: 0.5 } })
      break
    }
    case 'shutdown':
      process.exit(0)
    default:
      respond({ ok: false, error: `unknown cmd: ${msg.cmd}` })
  }
})
