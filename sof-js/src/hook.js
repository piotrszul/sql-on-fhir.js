// The sof-js benchmark hook — the reference example of benchmark-hook-format.
// An HTTP service the harness starts per sof-js/hook.json (spawn mode): it
// listens on 127.0.0.1:$HOOK_PORT and answers the protocol's five command
// endpoints with JSON bodies. Engine failures travel in the body
// ({"ok":false,"error":...}) with a 2xx status. The harness owns all timing;
// the phasesMs this hook reports are advisory diagnostics.

import { join } from 'node:path'
import { evaluate } from './index.js'
import { loadResources } from './benchmark.js'
import { writeCsvFile } from './csv.js'

let prepared = {} // resourceType -> parsed resources

function handle(name, body) {
  switch (name) {
    case 'capabilities':
      return { ok: true, scenarios: ['preloaded_repeated', 'end_to_end'] }
    case 'prepare': {
      // Replace-semantics (benchmark-hook-format): a prepare discards whatever
      // was prepared before, so a long-lived service never accumulates data.
      const next = {}
      for (const r of body.resources) next[r] = loadResources(join(body.dataDir, `${r}.ndjson`))
      prepared = next
      return { ok: true }
    }
    case 'run': {
      if (!(body.view.resource in prepared)) {
        return { ok: false, error: `resource type "${body.view.resource}" was not prepared` }
      }
      const t0 = performance.now()
      const rows = evaluate(body.view, prepared[body.view.resource])
      const t1 = performance.now()
      writeCsvFile(body.outCsv, rows)
      const t2 = performance.now()
      return {
        ok: true,
        outputRows: rows.length,
        phasesMs: { execute: t1 - t0, extract: t2 - t1 },
      }
    }
    case 'reset':
      // Discard the prepared dataset so a subsequent prepare re-does the full
      // ingest (the trusted-reset contract for connect-mode end_to_end).
      prepared = {}
      return { ok: true }
    case 'shutdown':
      // Answer first; the response is flushed well within the grace window the
      // harness allows before it escalates to signals.
      setTimeout(() => process.exit(0), 50)
      return { ok: true }
    default:
      return { ok: false, error: `unknown command endpoint: ${name}` }
  }
}

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
        body = {} // an empty/non-JSON body reads as no arguments
      }
    }
    let resp
    try {
      resp = handle(name, body)
    } catch (err) {
      resp = { ok: false, error: String(err?.message ?? err) }
    }
    return Response.json(resp)
  },
})
