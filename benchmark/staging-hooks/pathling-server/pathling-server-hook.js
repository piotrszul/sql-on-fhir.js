// Pathling Server staging hook — a per-engine adapter, NOT contract code. It is
// the HTTP-hook analog of the CLI hooks' shims: an HTTP service (structured
// after sof-js/src/hook.js) that answers the benchmark protocol's five command
// endpoints and translates each into a call against a Pathling FHIR **server**'s
// REST API. Engine failures travel in the body ({"ok":false,"error":...}) with a
// 2xx status; the harness owns all timing, so the phasesMs here are advisory.
//
// Two deployments, distinguished by env (see hook.json variants):
//
//   connect mode — PATHLING_BASE points at an operator-managed Pathling server.
//     The adapter never touches that server's lifecycle. Because a long-lived
//     Spark server keeps its JVM/Spark/dataset caches warm across samples and
//     offers no REST bulk-clear, an end_to_end "cold" sample is not honestly
//     cold here; connect mode therefore declares only `preloaded_repeated`,
//     whose prepare is explicitly OUTSIDE the timed region (warm-by-design).
//
//   spawn mode — the adapter OWNS a Pathling container (docker), started with an
//     ephemeral warehouse so each fresh process is an empty store. The harness
//     restarts a fresh adapter per end_to_end sample, so coldness is by
//     construction; this deployment declares both scenarios.
//
// REST mapping (endpoints established against aehrc/pathling):
//   prepare  -> POST {base}/$import  (saveMode overwrite, Prefer: respond-async,
//               poll the $job URL to completion). Overwrite gives prepare its
//               REPLACE semantics: it deletes+replaces each type from NDJSON.
//   run      -> POST {base}/$viewdefinition-run (Accept text/csv, header row);
//               the CSV response is written verbatim to outCsv (one headed
//               file — the run-output contract).
//   reset    -> best-effort; no REST bulk-clear exists for a Spark server, so
//               freshness of the queried types is carried by prepare's
//               overwrite. Returns ok so connect-mode preloaded hygiene passes.
//   shutdown -> stop the owned container (spawn), then exit 0.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IMPORT_POLL_MS = 250 // $job status poll cadence (adapter-side, documented)
const IMPORT_BUDGET_MS = 300_000 // give up on a wedged import rather than loop forever

// --- deployment resolution --------------------------------------------------

const connectBase = process.env.PATHLING_BASE?.replace(/\/+$/, '')
const image = process.env.PATHLING_IMAGE || 'ghcr.io/aehrc/pathling:latest'
// The data root mounted into the container at an IDENTICAL absolute path, so the
// adapter can hand Pathling `file://<dataDir>/<Resource>.ndjson` verbatim with no
// path-translation contract. Defaults to this repo's benchmark data dir.
const dataRoot = process.env.HOOK_DATA_ROOT || fileURLToPath(new URL('../../data', import.meta.url))

const SCENARIOS = connectBase
  ? ['preloaded_repeated'] // long-lived server: cold end_to_end is not honest
  : ['preloaded_repeated', 'end_to_end']

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// First 300 chars of a failure response body — the detail carried in an error.
const errBody = async (res) => (await res.text()).slice(0, 300)

// The server's FHIR CapabilityStatement (throws until the server serves it).
async function fetchMetadata(base) {
  const res = await fetch(`${base}/metadata`, { headers: { accept: 'application/fhir+json' } })
  if (!res.ok) throw new Error(`metadata HTTP ${res.status}`)
  return res.json()
}

// --- spawn-mode container lifecycle -----------------------------------------

let container = null // { name, base }

async function startContainer() {
  const hostPort = await freePort()
  const name = `pathling-hook-${hostPort}`
  const args = [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-p',
    `${hostPort}:8080`,
    // Identity mount + allowlist so file:// URLs resolve inside the container.
    // --mount (not -v): the -v "src:dst:ro" form is mis-parsed for absolute
    // paths, landing the bind at the wrong destination.
    '--mount',
    `type=bind,source=${dataRoot},target=${dataRoot},readonly`,
    '-e',
    // Trailing slash: allowableSources is a case-sensitive URL-prefix allowlist.
    `pathling.import.allowableSources=${pathToFileURL(dataRoot).href}/`,
    image,
  ]
  const res = spawnSync('docker', args, { encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`docker run failed (${res.status}): ${res.stderr || res.stdout}`)
  }
  const base = `http://127.0.0.1:${hostPort}/fhir`
  container = { name, base }
  return waitForServer(base) // resolves to the CapabilityStatement once serving
}

// Stop the owned container (idempotent) and exit; the single teardown path for
// both the shutdown command and process signals.
function cleanupAndExit() {
  stopContainer()
  process.exit(0)
}

function stopContainer() {
  if (!container) return
  spawnSync('docker', ['rm', '-f', container.name], { stdio: 'ignore' })
  container = null
}

// Readiness: poll until the FHIR CapabilityStatement is served, returning it so
// the caller reads the engine version from the same fetch (no second round-trip).
async function waitForServer(base, budgetMs = 300_000) {
  const deadline = Date.now() + budgetMs
  for (;;) {
    try {
      return await fetchMetadata(base)
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) throw new Error(`Pathling server not ready within ${budgetMs}ms`)
    await sleep(500)
  }
}

const engineVersion = (cs) => cs?.software?.version || 'unknown'

// The report's engine version comes from the manifest's static
// implementation.engine.version, which the harness copies verbatim — but the
// spawn image defaults to :latest, so a moved image (or a mislabelled operator
// server in connect mode) would make that reported version a silent lie. Read
// the version this deployment's manifest declares and warn loudly if the live
// server disagrees, mirroring the connect-mode unreachable-backend warning.
function warnIfVersionDrifted(cs) {
  if (!cs) return
  const live = engineVersion(cs)
  const manifest = connectBase ? 'hook.connect.json' : 'hook.spawn.json'
  try {
    const declared = JSON.parse(readFileSync(new URL(`./${manifest}`, import.meta.url)))?.implementation
      ?.engine?.version
    if (declared && declared !== live) {
      console.error(
        `pathling-server-hook: WARNING ${manifest} declares engine version ${declared} but the running ` +
          `server reports ${live}; the benchmark report will carry the stale declared value.`,
      )
    }
  } catch (err) {
    console.error(
      `pathling-server-hook: WARNING could not verify engine version against ${manifest}: ${err.message}`,
    )
  }
}

// --- REST translations -------------------------------------------------------

// Build a bulk-import Parameters body: one `input` part per resource type, each
// pointing at its NDJSON file by file:// URL, overwrite so a repeat prepare
// REPLACES the type's contents.
function importBody(dataDir, resources) {
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'inputFormat', valueCode: 'application/fhir+ndjson' },
      { name: 'saveMode', valueCode: 'overwrite' },
      ...resources.map((r) => ({
        name: 'input',
        part: [
          { name: 'resourceType', valueCode: r },
          // pathToFileURL, not string concat: correctly encodes spaces and other
          // characters so the source matches the allowableSources prefix.
          { name: 'url', valueUrl: pathToFileURL(join(dataDir, `${r}.ndjson`)).href },
        ],
      })),
    ],
  }
}

// $import is mandatory-async: POST returns 202 + Content-Location ($job URL);
// poll it (202 running, 200 done) to completion.
async function runImport(base, dataDir, resources) {
  const res = await fetch(`${base}/$import`, {
    method: 'POST',
    headers: {
      'content-type': 'application/fhir+json',
      accept: 'application/fhir+json',
      prefer: 'respond-async',
    },
    body: JSON.stringify(importBody(dataDir, resources)),
  })
  if (res.status !== 202) {
    throw new Error(`$import did not accept (HTTP ${res.status}): ${await errBody(res)}`)
  }
  const jobUrl = res.headers.get('content-location')
  if (!jobUrl) throw new Error('$import returned 202 without a Content-Location job URL')
  const deadline = Date.now() + IMPORT_BUDGET_MS
  for (;;) {
    const poll = await fetch(jobUrl, { headers: { accept: 'application/fhir+json' } })
    if (poll.status === 200) return
    if (poll.status !== 202) {
      throw new Error(`$import job failed (HTTP ${poll.status}): ${await errBody(poll)}`)
    }
    if (Date.now() >= deadline) throw new Error(`$import job did not finish within ${IMPORT_BUDGET_MS}ms`)
    await sleep(IMPORT_POLL_MS)
  }
}

// $viewdefinition-run is synchronous and returns the flat result as one CSV
// document (header row, per the run-output contract). Read the whole body:
// Bun.write(outCsv, res) would stream, but it spins on Pathling's chunked
// transfer encoding, so the body is buffered and written in one call.
async function runView(base, view) {
  const body = {
    resourceType: 'Parameters',
    parameter: [
      { name: 'viewResource', resource: { resourceType: 'ViewDefinition', ...view } },
      { name: '_format', valueString: 'text/csv' },
      { name: 'header', valueBoolean: true },
    ],
  }
  const res = await fetch(`${base}/$viewdefinition-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/fhir+json', accept: 'text/csv' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`$viewdefinition-run failed (HTTP ${res.status}): ${await errBody(res)}`)
  return res.text()
}

// --- protocol -----------------------------------------------------------------

function base() {
  return connectBase || container?.base
}

async function handle(name, body) {
  switch (name) {
    case 'capabilities':
      return { ok: true, scenarios: SCENARIOS }
    case 'prepare': {
      await runImport(base(), body.dataDir, body.resources)
      return { ok: true }
    }
    case 'run': {
      // execute = time to the query result; extract = writing it to disk. Both
      // advisory; the harness owns the wall clock and counts the written CSV's
      // rows authoritatively (so the adapter reports no outputRows of its own).
      const t0 = performance.now()
      const csv = await runView(base(), body.view)
      const t1 = performance.now()
      writeFileSync(body.outCsv, csv)
      const t2 = performance.now()
      return { ok: true, phasesMs: { execute: t1 - t0, extract: t2 - t1 } }
    }
    case 'reset':
      // No REST bulk-clear for a Spark server; freshness of the queried types is
      // carried by prepare's overwrite. Honest no-op so connect-mode preloaded
      // hygiene (an untimed reset before prepare) passes.
      return { ok: true }
    case 'shutdown':
      setTimeout(cleanupAndExit, 50) // answer first, then tear down and exit
      return { ok: true }
    default:
      return { ok: false, error: `unknown command endpoint: ${name}` }
  }
}

// --- bring-up -----------------------------------------------------------------

// In spawn mode, own the Pathling container and only start listening once it is
// ready — so the port opens (harness readiness passes) exactly when the server
// can serve. In connect mode, the operator guarantees Pathling is up already.
let capabilityStatement
if (connectBase) {
  capabilityStatement = await fetchMetadata(connectBase).catch((err) => {
    // Don't hard-fail (the operator may start the adapter before Pathling), but
    // make a down/misconfigured backend loud rather than a silent "unknown".
    console.error(`pathling-server-hook: WARNING cannot reach ${connectBase}: ${err.message}`)
    return null
  })
} else {
  // Register cleanup BEFORE the (blocking) container boot, so a signal during
  // startup still tears the container down instead of orphaning it.
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, cleanupAndExit)
  capabilityStatement = await startContainer()
}

console.error(`pathling-server-hook: ${connectBase ? 'connect' : 'spawn'} mode, base ${base()}`)
console.error(`pathling-server-hook: engine version ${engineVersion(capabilityStatement)}`)
warnIfVersionDrifted(capabilityStatement)

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
    return Response.json(resp)
  },
})
