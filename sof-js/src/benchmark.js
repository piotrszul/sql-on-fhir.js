import { readFileSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

// Shared NDJSON loading for the sof-js hook (src/hook.js) and bless mode
// (src/benchmark-run.js). The measurement loop and statistics live in the
// shared harness (benchmark/tools/harness), not here.

// Batch loader: the whole file parsed into an array. Used by the hook, which
// prepares an in-memory table per resource before the timed region.
export function loadResources(ndjsonPath) {
  return readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

// Streaming loader for the bless path: yields one parsed resource per NDJSON
// line without ever holding the whole file (or the whole parsed array) in
// memory. This is what bounds bless memory at the xl (100k) tier — see
// blessCheckfile in benchmark-run.js.
export async function* streamResources(ndjsonPath) {
  const rl = createInterface({ input: createReadStream(ndjsonPath), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.trim().length > 0) yield JSON.parse(line)
    }
  } finally {
    rl.close()
  }
}
