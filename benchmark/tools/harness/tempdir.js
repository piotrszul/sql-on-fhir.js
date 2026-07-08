import { mkdtempSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Create a harness temp directory whose path is canonical (symlink-free).
// Paths built under it — {viewFile}, {outCsv} — are handed to engine
// processes as strings, and an engine that resolves or glob-walks such a path
// must observe the same file the harness wrote. macOS's default tmpdir sits
// behind /var -> /private/var, so mkdtempSync alone yields a symlinked path;
// realpathSync collapses it once, at creation.
export function makeEngineTempDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}
