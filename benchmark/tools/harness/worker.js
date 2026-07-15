import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { killProcessGroup, terminateGroup } from './proc.js'

// A hook misbehaving in one of three distinguishable ways, each mapping onto
// the report status taxonomy differently (benchmark-harness spec):
// ProtocolError (non-2xx status, unparseable body) -> execution_error;
// WorkerCrash (connection refused/reset, process death) -> execution_error;
// WorkerTimeout (the harness's own inactivity budget) -> timeout.
export class ProtocolError extends Error {}
export class WorkerCrash extends Error {}
export class WorkerTimeout extends Error {}

// The hook could not be brought up at all (spawn failure, readiness budget
// exhausted, connect-mode endpoint unreachable): the RUN's setup fails loudly
// rather than recording per-case noise (benchmark-harness spec).
export class SetupError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// One protocol request (benchmark-hook-format): `capabilities` is a GET, every
// other command a POST of the command object (minus `cmd`) as the JSON body.
// Engine failures travel in the body ({"ok":false}) and are the CALLER's to
// interpret; only transport-level failures throw here.
async function request(base, cmd, timeoutMs) {
  const { cmd: name, ...body } = cmd
  const ctl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null
  let res, text
  try {
    res = await fetch(
      `${base}/${name}`,
      name === 'capabilities'
        ? { signal: ctl.signal }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal,
          },
    )
    text = await res.text()
  } catch (err) {
    if (ctl.signal.aborted) throw new WorkerTimeout(`no response to ${name} within ${timeoutMs}ms`)
    throw new WorkerCrash(
      `transport failure on ${name}: ${String(err?.cause?.message ?? err?.message ?? err)}`,
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!res.ok) throw new ProtocolError(`hook answered ${name} with HTTP ${res.status}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new ProtocolError(`hook answered ${name} with an unparseable body: ${text.slice(0, 120)}`)
  }
}

// At most one protocol request in flight per hook (benchmark-hook-format).
function makeSend(base, isDead) {
  let inFlight = false
  return (cmd, { timeoutMs } = {}) => {
    if (isDead()) return Promise.reject(new WorkerCrash('hook is not running'))
    if (inFlight) return Promise.reject(new ProtocolError('a command is already in flight'))
    inFlight = true
    return request(base, cmd, timeoutMs).finally(() => {
      inFlight = false
    })
  }
}

// The manifest's lifecycle mode (benchmark-hook-format): `endpoint` names an
// operator-managed connect-mode service the harness must never restart;
// `cli` a per-invocation CLI hook; otherwise `command` names a service the
// harness spawns and terminates. The single source of the manifest->mode
// mapping — startConnector dispatches through it, and the runner keys
// mode-dependent choreography off the same answer.
export function lifecycleMode(manifest) {
  if (manifest.endpoint) return 'connect'
  if (manifest.cli) return 'cli'
  return 'spawn'
}

// Bring up a connector per the manifest's lifecycle mode (the connector SPI,
// benchmark-harness spec): connect -> HTTP connect, cli -> the CLI connector
// (fresh engine process per run), spawn -> HTTP spawn (service started with an
// OS-allocated port in HOOK_PORT, readiness polled). Resolves once
// `capabilities` has answered (spawn and readiness are untimed by every
// scenario); the response is kept on the returned connector so callers gate
// scenarios without a second round-trip.
export async function startConnector(manifest, opts = {}) {
  const mode = lifecycleMode(manifest)
  if (mode === 'connect') return connectHook(manifest)
  if (mode === 'cli') return (await import('./cli-connector.js')).startCliConnector(manifest)
  return spawnHook(manifest, opts)
}

// Pre-SPI name, kept so the original worker test suite runs verbatim as the
// behaviour-preservation regression guard.
export const startWorker = startConnector

async function connectHook(manifest) {
  const base = manifest.endpoint.replace(/\/+$/, '')
  let capabilities
  try {
    capabilities = await request(base, { cmd: 'capabilities' }, 10_000)
  } catch (err) {
    throw new SetupError(`cannot reach the hook service at ${manifest.endpoint}: ${err.message}`)
  }
  if (capabilities.ok !== true) {
    throw new SetupError(`the service at ${manifest.endpoint} did not answer capabilities validly`)
  }
  return {
    mode: 'connect',
    capabilities,
    implementation: manifest.implementation,
    // The harness never ends an operator-managed service: alive is not its to
    // observe, shutdown is never sent, and no signal is ever delivered.
    get alive() {
      return true
    },
    send: makeSend(base, () => false),
    async shutdown() {},
    kill() {},
    waitExit: () => Promise.resolve(),
  }
}

async function spawnHook(manifest, { readinessMs = 30_000 } = {}) {
  const port = await freePort()
  const child = spawn(manifest.command[0], manifest.command.slice(1), {
    cwd: manifest.cwd,
    env: { ...process.env, ...(manifest.env || {}), HOOK_PORT: String(port) },
    // stdout/stderr carry no protocol duties: pass both through as diagnostics.
    stdio: ['ignore', 'inherit', 'inherit'],
    // Own process group, so terminating the hook also reaps anything it spawned
    // and an abandoned group can be signalled as one unit.
    detached: true,
  })

  let exited = false
  let spawnError = null
  const exitWaiters = []
  const settle = () => {
    exited = true
    for (const w of exitWaiters.splice(0)) w()
  }
  child.on('exit', settle)
  // A spawn failure (missing binary) emits 'error' and never 'exit'.
  child.on('error', (err) => {
    spawnError = err
    settle()
  })

  const killGroup = (signal) => killProcessGroup(child, signal)

  // Readiness: poll GET /capabilities until a VALID body arrives (ok:true — so
  // "something else answered on that port" never reads as ready) within the
  // budget. A hook that never gets there fails the run's setup loudly.
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + readinessMs
  let capabilities
  for (;;) {
    if (exited) {
      throw new SetupError(`hook exited before becoming ready${spawnError ? `: ${spawnError.message}` : ''}`)
    }
    try {
      const resp = await request(base, { cmd: 'capabilities' }, 1000)
      if (resp.ok === true) {
        capabilities = resp
        break
      }
    } catch {
      // not listening yet (or answered invalidly): keep polling until the budget
    }
    if (Date.now() >= deadline) {
      killGroup('SIGKILL')
      throw new SetupError(`hook did not become ready on port ${port} within ${readinessMs}ms`)
    }
    await sleep(50)
  }

  const waitExit = () => (exited ? Promise.resolve() : new Promise((res) => exitWaiters.push(res)))

  return {
    mode: 'spawn',
    capabilities,
    implementation: manifest.implementation,
    get alive() {
      return !exited
    },
    send: makeSend(base, () => exited),

    // Ask the hook service to exit (benchmark-hook-format: shutdown -> release
    // + exit 0); escalate to SIGTERM then SIGKILL on the process group, so a
    // hook that ignores the command or traps SIGTERM can never hang the harness.
    async shutdown({ graceMs = 2000 } = {}) {
      if (exited) return
      try {
        await request(base, { cmd: 'shutdown' }, graceMs)
      } catch {
        // dead or unresponsive already: the signal escalation below owns it
      }
      if (exited) return
      const term = setTimeout(() => killGroup('SIGTERM'), graceMs)
      const kill = setTimeout(() => killGroup('SIGKILL'), graceMs * 2)
      await waitExit()
      clearTimeout(term)
      clearTimeout(kill)
    },

    kill({ graceMs = 2000 } = {}) {
      terminateGroup(child, () => exited, { graceMs })
    },

    waitExit,
  }
}
