// Process-group control shared by the connectors that own child processes
// (HTTP spawn mode's hook service, the CLI connector's per-run engine
// process). Children are spawned detached, so the group id is the child's
// pid and signalling the group reaches anything the child itself spawned.

export function killProcessGroup(child, signal) {
  if (child.pid == null) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {}
  }
}

// Fire-and-forget SIGTERM -> SIGKILL escalation: unref'd so an already-dying
// child never keeps the harness process alive just to deliver a redundant
// SIGKILL.
export function terminateGroup(child, isExited, { graceMs = 2000 } = {}) {
  if (isExited()) return
  killProcessGroup(child, 'SIGTERM')
  const kill = setTimeout(() => {
    if (!isExited()) killProcessGroup(child, 'SIGKILL')
  }, graceMs)
  kill.unref?.()
}
