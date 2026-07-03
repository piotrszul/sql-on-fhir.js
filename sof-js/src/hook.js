// The sof-js benchmark hook — the reference example of benchmark-hook-format.
// A worker process the harness spawns per sof-js/hook.json: line-delimited JSON
// commands on stdin, exactly one response line per command on stdout (flushed
// per line), logs to stderr only. The harness owns all timing; the phasesMs
// this worker reports are advisory diagnostics.

import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate } from './index.js'
import { loadResources } from './benchmark.js'
import { serializeCsv } from './csv.js'

const prepared = {} // resourceType -> parsed resources

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function handle(msg) {
  switch (msg.cmd) {
    case 'capabilities':
      return { ok: true, scenarios: ['preloaded_repeated', 'end_to_end'] }
    case 'prepare':
      for (const r of msg.resources) prepared[r] = loadResources(join(msg.dataDir, `${r}.ndjson`))
      return { ok: true }
    case 'run': {
      const t0 = performance.now()
      const rows = evaluate(msg.view, prepared[msg.view.resource] || [])
      const t1 = performance.now()
      writeFileSync(msg.outCsv, serializeCsv(rows))
      const t2 = performance.now()
      return {
        ok: true,
        outputRows: rows.length,
        phasesMs: { execute: t1 - t0, extract: t2 - t1 },
      }
    }
    case 'shutdown':
      process.exit(0)
    default:
      return { ok: false, error: `unknown cmd: ${msg.cmd}` }
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch (err) {
    respond({ ok: false, error: `unparseable command line: ${String(err?.message ?? err)}` })
    return
  }
  try {
    respond(handle(msg))
  } catch (err) {
    respond({ ok: false, error: String(err?.message ?? err) })
  }
})
