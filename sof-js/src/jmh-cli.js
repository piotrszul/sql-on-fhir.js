// Thin CLI over the pure JMH projection (src/jmh.js): read a native
// benchmark-report.json from disk, project it, and write the JMH files to an
// output directory. The projection logic is NOT duplicated here — this only does
// argument parsing and file I/O.
//
//   bun run jmh <report.json> <outdir>

import { readFileSync } from 'node:fs'
import { writeJmhExports } from './jmh.js'

export function runJmhCli(args) {
  const [reportPath, outDir] = args
  if (!reportPath || !outDir) {
    throw new Error('usage: bun run jmh <report.json> <outdir>')
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  return writeJmhExports(report, outDir)
}

if (import.meta.main) {
  const written = runJmhCli(process.argv.slice(2))
  for (const path of written) console.error(`wrote ${path}`)
  console.error(`wrote ${written.length} JMH file(s)`)
}
