// Writing the internal measurement record (design.md add-measurement-plans D5).
// A custom-plan run emits a lossless, report-shaped record under a filename
// DISTINCT from the native report's — `<stem>.internal-report.json` — so it is
// never mistaken for a conforming report even by name. The stem reuses the JMH
// naming (benchmark-size-impl) so a record and its JMH projection share a stem.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { outputStem, implementationId } from './jmh.js'

// The <benchmark>-<size>-<impl> stem, derived exactly as the JMH export names
// its files, so an internal record and its JMH files sit side by side.
export function internalReportStem(record) {
  const [benchmarkName] = Object.keys(record.results)
  const { size } = record.results[benchmarkName]
  return outputStem(benchmarkName, size, implementationId(record.implementation))
}

// Write the record to `<dir>/<stem>.internal-report.json`; returns the path.
export function writeInternalReport(record, dir) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${internalReportStem(record)}.internal-report.json`)
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n')
  return path
}
