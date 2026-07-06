import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { terminateGroup } from './proc.js'
import { WorkerCrash, WorkerTimeout, SetupError, ProtocolError } from './worker.js'

// The CLI connector (benchmark-hook-format "CLI hook mode"): a stateless
// command-line implementation described entirely by the manifest's argv
// template. There is no service — the connector answers the protocol verbs
// itself and spawns ONE fresh engine process per `run`, so every invocation
// is dataset-cold by construction. Capabilities are synthesized as exactly
// end_to_end: a per-invocation process cannot hold prepared state across run
// round-trips, so preloaded_repeated would be structurally dishonest here.

const PLACEHOLDERS = ['dataDir', 'viewFile', 'outCsv']
const STDERR_TAIL = 2000

// Template hygiene is a SETUP concern: a typo'd placeholder must fail the run
// loudly before any case, never surface as N identical per-case failures.
function checkTemplate(template) {
  for (const el of template) {
    for (const [, token] of el.matchAll(/\{([^}]*)\}/g)) {
      if (!PLACEHOLDERS.includes(token)) {
        throw new SetupError(
          `cli.run template uses unknown placeholder {${token}}; known placeholders: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`,
        )
      }
    }
  }
  if (!template.some((el) => el.includes('{outCsv}'))) {
    throw new SetupError('cli.run template never uses {outCsv}, so the harness could not collect any output')
  }
}

export function startCliConnector(manifest) {
  const template = manifest.cli.run
  checkTemplate(template)
  const workDir = mkdtempSync(join(tmpdir(), 'sof-cli-hook-'))
  const capabilities = { ok: true, scenarios: ['end_to_end'] }
  let dataDir = null
  let inFlight = null // the currently running engine child, if any
  let viewSeq = 0

  function runOnce({ view, outCsv }, timeoutMs) {
    if (template.some((el) => el.includes('{dataDir}')) && dataDir == null) {
      return Promise.resolve({ ok: false, error: 'no dataset prepared: the run template uses {dataDir}' })
    }
    const viewFile = join(workDir, `view-${viewSeq++}.json`)
    writeFileSync(viewFile, JSON.stringify(view))
    const values = { dataDir, viewFile, outCsv }
    const argv = template.map((el) => el.replace(/\{([^}]*)\}/g, (_, token) => values[token]))

    return new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: manifest.cwd,
        env: { ...process.env, ...(manifest.env || {}) },
        // stderr is captured for the failure tail; stdout passes through as
        // diagnostics, same as an HTTP hook's.
        stdio: ['ignore', 'inherit', 'pipe'],
        detached: true, // own process group, so a timeout kill reaps helpers too
      })
      inFlight = child
      let stderrTail = ''
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL)
      })

      let settled = false
      let timedOut = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        inFlight = null
        fn(value)
      }
      const timer = timeoutMs
        ? setTimeout(() => {
            timedOut = true
            terminateGroup(child, () => child.exitCode !== null)
            settle(reject, new WorkerTimeout(`engine process produced no exit within ${timeoutMs}ms`))
          }, timeoutMs)
        : null

      child.on('error', (err) => settle(reject, new WorkerCrash(`cannot run engine command: ${err.message}`)))
      child.on('exit', (code, signal) => {
        if (timedOut) return
        if (code === 0) return settle(resolve, { ok: true })
        if (code != null) {
          const tail = stderrTail.trim()
          return settle(resolve, { ok: false, error: `exit status ${code}${tail ? `: ${tail}` : ''}` })
        }
        settle(reject, new WorkerCrash(`engine process was killed by ${signal}`))
      })
    })
  }

  return {
    mode: 'cli',
    capabilities,
    implementation: manifest.implementation,
    // No long-lived process exists: the connector is usable whenever asked,
    // because the next run spawns fresh.
    get alive() {
      return true
    },
    send(cmd, { timeoutMs } = {}) {
      if (inFlight) return Promise.reject(new ProtocolError('a command is already in flight'))
      switch (cmd.cmd) {
        case 'capabilities':
          return Promise.resolve({ ...capabilities })
        case 'prepare':
          dataDir = cmd.dataDir
          return Promise.resolve({ ok: true })
        case 'reset':
          // No-op: every run spawns fresh, so the connector is cold by
          // construction. The prepared dataset location survives reset.
          return Promise.resolve({ ok: true })
        case 'run':
          return runOnce(cmd, timeoutMs)
        case 'shutdown':
          return Promise.resolve({ ok: true })
        default:
          return Promise.resolve({ ok: false, error: `unknown command: ${cmd.cmd}` })
      }
    },
    async shutdown() {
      if (inFlight) terminateGroup(inFlight, () => inFlight?.exitCode !== null)
      rmSync(workDir, { recursive: true, force: true })
    },
    kill({ graceMs = 2000 } = {}) {
      const child = inFlight
      if (child) terminateGroup(child, () => child.exitCode !== null, { graceMs })
    },
    waitExit: () => Promise.resolve(),
  }
}
