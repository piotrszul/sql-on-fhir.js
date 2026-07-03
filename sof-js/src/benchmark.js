import { readFileSync } from 'node:fs'

// Shared NDJSON loading for the sof-js hook (src/hook.js) and bless mode
// (src/benchmark-run.js). The measurement loop and statistics live in the
// shared harness (benchmark/tools/harness), not here.
export function loadResources(ndjsonPath) {
  return readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}
