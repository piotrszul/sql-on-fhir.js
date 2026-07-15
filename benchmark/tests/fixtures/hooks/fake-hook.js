// Scripted fake hook for harness tests: a protocol-conformant HTTP hook service
// whose per-case behavior is selected by the view's `resource` marker, so one
// manifest can exercise good cases and every failure mode in a single run.
//
//   CrashMe     -> exit mid-request without responding (hook process crash)
//   HangMe      -> never respond (harness inactivity budget -> timeout)
//   FailMe      -> 2xx {"ok":false,"error":...} and stay alive
//   Http500Me   -> a non-2xx status (transport-level protocol violation)
//   GarbageMe   -> a 2xx response whose body is not JSON
//   SlowMe      -> respond ok after a 100ms delay (slow but valid)
//   MisreportMe -> write the CSV but over-report outputRows by 5
//   anything else -> write a CSV with one row per prepared NDJSON line
//
// The service listens on 127.0.0.1:$HOOK_PORT (spawn mode assigns it; connect-
// mode tests spawn this script themselves with a port they picked).
// capabilities echoes FAKE_TOKEN so tests can observe manifest env merging.
// FAKE_SCENARIOS narrows the declared scenarios. FAKE_IGNORE_SIGTERM makes the
// service ignore both the shutdown command and SIGTERM, so tests can exercise
// the harness's SIGKILL escalation. FAKE_NEVER_READY makes it never listen at
// all (readiness-budget tests). FAKE_LOG appends one "<METHOD> <path>" line per
// handled request so tests can assert command order (e.g. reset-before-prepare).

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.FAKE_IGNORE_SIGTERM) process.on('SIGTERM', () => {})
if (process.env.FAKE_NEVER_READY) {
  setInterval(() => {}, 1 << 30) // stay alive, never listen
} else {
  serve()
}

function serve() {
  let counts = {}
  // The last table-sink run's row count, materialized in-engine (design.md D4):
  // a table-sink `run` (no outCsv) records it here; `count` reports it and
  // `extract` writes it out, both untimed and outside every sample.
  let sinkRows = null

  const server = createServer((req, res) => {
    if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${req.method} ${req.url}\n`)
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const reply = (obj, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      try {
        handle(req, res, raw ? JSON.parse(raw) : {}, reply)
      } catch (err) {
        // A handled engine failure travels in the body with a 2xx status.
        reply({ ok: false, error: String(err?.message ?? err) })
      }
    })
  })

  server.listen(Number(process.env.HOOK_PORT), '127.0.0.1')

  function handle(req, res, body, reply) {
    switch (req.url) {
      case '/capabilities': {
        const scenarios = process.env.FAKE_SCENARIOS
          ? process.env.FAKE_SCENARIOS.split(',')
          : ['preloaded_repeated', 'end_to_end']
        return reply({ ok: true, scenarios, token: process.env.FAKE_TOKEN ?? null })
      }
      case '/prepare':
        // Replace-semantics: a prepare discards whatever was prepared before.
        counts = {}
        for (const r of body.resources) {
          const txt = readFileSync(join(body.dataDir, `${r}.ndjson`), 'utf8')
          counts[r] = txt.split('\n').filter((l) => l.trim().length > 0).length
        }
        return reply({ ok: true })
      case '/run': {
        const marker = body.view.resource
        if (marker === 'CrashMe') process.exit(3)
        if (marker === 'HangMe') return // no response; stay alive
        if (marker === 'Http500Me') return reply({ boom: true }, 500)
        if (marker === 'GarbageMe') {
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end('LOG: engines gonna engine')
        }
        if (marker === 'FailMe') return reply({ ok: false, error: 'engine exploded' })
        const rows = counts[marker] ?? 0
        // Table sink (no outCsv): materialize in-engine, write no CSV; the row
        // count is read later by the untimed count/extract verbs.
        if (body.outCsv == null) {
          sinkRows = rows
          return reply({ ok: true, phasesMs: { execute: 1.0 } })
        }
        writeFileSync(body.outCsv, csvOf(rows))
        const reported = marker === 'MisreportMe' ? rows + 5 : rows
        const finish = () =>
          reply({ ok: true, outputRows: reported, phasesMs: { execute: 1.0, extract: 0.5 } })
        if (marker === 'SlowMe') return void setTimeout(finish, 100)
        return finish()
      }
      // Post-loop verification verbs (design.md D4), both untimed. count reports
      // the engine's own count of the materialized sink; extract writes the sink
      // to a CSV the harness counts itself.
      case '/count':
        return reply({ ok: true, rows: sinkRows ?? 0 })
      case '/extract':
        writeFileSync(body.outCsv, csvOf(sinkRows ?? 0))
        return reply({ ok: true })
      case '/reset':
        counts = {}
        sinkRows = null
        return reply({ ok: true })
      case '/shutdown':
        if (process.env.FAKE_IGNORE_SIGTERM) return reply({ ok: true }) // misbehave: acknowledge, never exit
        res.writeHead(200, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify({ ok: true }), () => process.exit(0))
      default:
        return reply({ ok: false, error: `unknown command endpoint: ${req.url}` })
    }
  }
}

function csvOf(rows) {
  const lines = ['id']
  for (let i = 0; i < rows; i++) lines.push(`row-${i}`)
  return lines.join('\n')
}
