// A persistent DuckDB CLI session (design.md add-measurement-plans D7). One
// long-lived `duckdb` child holds the in-memory `_sink` temp table across a
// case's warmup + measured samples, so load+execute are measured while the child
// process boot is not. Statement completion is detected event-driven: after each
// statement the session writes a `.print <sentinel>`, and the statement is done
// when that sentinel appears as a whole stdout line. Errors travel on stderr and
// (unlike `.bail on`) leave the session alive, so a bad statement is a per-case
// failure, not a dead session — the brittleness the staging exercise exists to
// surface (FINDINGS.md).
//
// The child is spawned WITHOUT `detached`, so it shares the hook's process group:
// the harness's timeout group-kill reaps the duckdb child too, no orphan.

import { spawn } from 'node:child_process'
import { sentinelFor } from './hook-lib.js'

// DuckDB colorizes warnings (e.g. flatquack's `->` lambda deprecation on 1.5.2)
// even when stdout is a pipe, and the trailing color-reset lands on the SAME
// line as the following `.print` sentinel — so a naive `line === sentinel` never
// matches and the session hangs. Strip ANSI SGR codes from every stdout line
// before matching. (A real staging finding; see FINDINGS.md.)
// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\x1b\[[0-9;]*m/g

export class DuckSession {
  constructor(duckdbBin) {
    // A fresh in-memory database (no path argument). csv output with headers off
    // makes a scalar count print as a bare number.
    this.child = spawn(duckdbBin, ['-csv', '-noheader'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.seq = 0
    this.inflight = null // { sentinel, resolve, reject } — one statement at a time
    this.stdoutBuf = '' // unconsumed partial stdout line
    this.acc = [] // completed stdout lines for the in-flight command
    this.errBuf = '' // stderr since the in-flight command started
    this.deadReason = null

    this.child.stdout.on('data', (chunk) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk) => {
      this.errBuf += chunk
    })
    this.child.on('exit', (code, signal) => this.onExit(code, signal))
    this.child.on('error', (err) => this.onExit(null, null, err))
  }

  onStdout(chunk) {
    this.stdoutBuf += chunk
    let nl
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).replace(ANSI_SGR, '')
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1)
      if (this.inflight && line === this.inflight.sentinel) {
        const { resolve } = this.inflight
        this.inflight = null
        const error = this.errBuf.trim()
        const lines = this.acc
        this.acc = []
        resolve({ lines, error })
      } else {
        this.acc.push(line)
      }
    }
  }

  onExit(code, signal, err) {
    this.deadReason = err ? err.message : `duckdb exited (code ${code}, signal ${signal})`
    if (this.inflight) {
      const { reject } = this.inflight
      this.inflight = null
      reject(new Error(this.deadReason))
    }
  }

  // Run one statement (or dot-command) and resolve once its sentinel returns,
  // with { lines, error }: `lines` are the stdout rows it produced, `error` is
  // any stderr it wrote (empty on success).
  exec(sql) {
    if (this.deadReason) return Promise.reject(new Error(`duckdb session is dead: ${this.deadReason}`))
    if (this.inflight) return Promise.reject(new Error('duckdb session busy: one statement at a time'))
    const sentinel = sentinelFor(++this.seq)
    this.errBuf = '' // stderr belongs to the statement about to run
    return new Promise((resolve, reject) => {
      this.inflight = { sentinel, resolve, reject }
      this.child.stdin.write(`${sql}\n.print ${sentinel}\n`)
    })
  }

  // Run a statement and throw if it wrote anything to stderr; returns its lines.
  async run(sql) {
    const { lines, error } = await this.exec(sql)
    if (error) throw new Error(error)
    return lines
  }

  async close() {
    if (this.deadReason) return
    try {
      this.child.stdin.end('.quit\n')
    } catch {
      // already gone
    }
  }
}
