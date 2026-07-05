import { spawn } from 'node:child_process'

// A hook worker misbehaving in one of three distinguishable ways, each mapping
// onto the report status taxonomy differently (benchmark-harness spec):
// ProtocolError -> execution_error (the case fails; the worker is untrusted and
// killed), WorkerCrash -> execution_error, WorkerTimeout -> timeout.
export class ProtocolError extends Error {}
export class WorkerCrash extends Error {}
export class WorkerTimeout extends Error {}

// Spawn a hook worker per its manifest and expose the line-delimited JSON
// protocol (benchmark-hook-format): one command in flight at a time, exactly one
// response line per command. stdout belongs to the protocol; the worker's stderr
// passes through to the harness's stderr so engine logs stay visible.
export function spawnWorker(manifest) {
  const child = spawn(manifest.command[0], manifest.command.slice(1), {
    cwd: manifest.cwd,
    env: { ...process.env, ...(manifest.env || {}) },
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  let buffer = ''
  let pending = null // { resolve, reject, timer }
  let exited = false
  const exitWaiters = []

  // Resolve/reject the in-flight command exactly once, clearing its timer. Both
  // paths null `pending` first so a late timer or exit can never double-settle.
  function resolvePending(msg) {
    const p = pending
    pending = null
    if (p?.timer) clearTimeout(p.timer)
    p?.resolve(msg)
  }
  function rejectPending(err) {
    const p = pending
    pending = null
    if (p?.timer) clearTimeout(p.timer)
    p?.reject(err)
  }

  child.on('exit', () => {
    exited = true
    rejectPending(new WorkerCrash('worker exited while a command was in flight'))
    for (const w of exitWaiters.splice(0)) w()
  })

  // A spawn failure emits 'error' and never 'exit', so it must be terminal here:
  // otherwise the in-flight command burns its whole inactivity budget and
  // waitExit()/shutdown() hang forever on a process that never ran.
  child.on('error', (err) => {
    exited = true
    rejectPending(new WorkerCrash(`worker failed to start or died: ${err.message}`))
    for (const w of exitWaiters.splice(0)) w()
  })

  // A send racing worker death lands on a dead pipe: without a listener the
  // async EPIPE is an unhandled stream 'error' that kills the whole harness
  // under Node (Bun swallows it). Fail the command; 'exit' owns the lifecycle.
  child.stdin.on('error', (err) => {
    rejectPending(new WorkerCrash(`worker stdin closed mid-command: ${err.message}`))
  })

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (!line.trim()) continue
      if (!pending) continue // unsolicited line with nothing in flight: nothing to fail
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        rejectPending(new ProtocolError(`non-JSON protocol line on stdout: ${line.slice(0, 120)}`))
        continue
      }
      resolvePending(msg)
    }
  })

  return {
    get alive() {
      return !exited
    },
    implementation: manifest.implementation,

    // Send one command and await its single response line. timeoutMs is the
    // harness's own out-of-band inactivity budget: on expiry the promise rejects
    // with WorkerTimeout and the CALLER decides to kill/respawn.
    send(cmd, { timeoutMs } = {}) {
      if (exited) return Promise.reject(new WorkerCrash('worker is not running'))
      if (pending) return Promise.reject(new ProtocolError('a command is already in flight'))
      return new Promise((resolve, reject) => {
        const timer = timeoutMs
          ? setTimeout(() => rejectPending(new WorkerTimeout(`no response within ${timeoutMs}ms`)), timeoutMs)
          : null
        pending = { resolve, reject, timer }
        child.stdin.write(JSON.stringify(cmd) + '\n')
      })
    },

    // Ask the worker to exit (benchmark-hook-format: shutdown -> release + exit 0);
    // escalate to SIGTERM if it lingers, then SIGKILL, so a worker that traps or
    // ignores SIGTERM can never hang the harness. No response line is required.
    async shutdown({ graceMs = 2000 } = {}) {
      if (exited) return
      try {
        child.stdin.write(JSON.stringify({ cmd: 'shutdown' }) + '\n')
      } catch {
        // stdin already gone: fall through to the signal escalation below
      }
      const term = setTimeout(() => child.kill('SIGTERM'), graceMs)
      const kill = setTimeout(() => child.kill('SIGKILL'), graceMs * 2)
      await this.waitExit()
      clearTimeout(term)
      clearTimeout(kill)
    },

    kill({ graceMs = 2000 } = {}) {
      if (exited) return
      child.kill('SIGTERM')
      // Fire-and-forget escalation: unref'd so an already-dying worker never
      // keeps the harness process alive just to deliver a redundant SIGKILL.
      const kill = setTimeout(() => {
        if (!exited) child.kill('SIGKILL')
      }, graceMs)
      kill.unref?.()
    },

    waitExit() {
      return exited ? Promise.resolve() : new Promise((res) => exitWaiters.push(res))
    },
  }
}
