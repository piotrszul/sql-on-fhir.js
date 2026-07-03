// Bless mode — the reference-implementation privilege that remains in sof-js
// after the measurement loop, report emission and JMH projection moved to the
// shared harness (benchmark/tools/harness). Minting checkfile assertions stays
// here because the analytic cross-check needs a FHIRPath evaluator, and the
// artifact must not depend on an implementation (design.md D5).

import { evaluate } from './index.js'
import { loadResources } from './benchmark.js'
import { fhirpath_evaluate } from './path.js'
import { resourceFile, checkfileFor } from '../../benchmark/tools/layout.js'
import { readCheckfile, writeCheckfile, buildCheckfile } from '../../benchmark/tools/checkfile.js'

// Detect whether a view uses forEach/forEachOrNull or a view-level where.
function collectSelects(sel, acc) {
  if (!sel) return acc
  for (const s of sel) {
    acc.push(s)
    if (s.select) collectSelects(s.select, acc)
    if (s.unionAll) collectSelects(s.unionAll, acc)
  }
  return acc
}

// Analytic cross-check for a single-resource flatten view (benchmark-reference-runner):
//   no forEach/where       => the input resource count
//   forEach over a path    => the total collection-entry count
//   view-level where       => the filtered count
// Independent of the observed evaluate() so it is a genuine cross-check of the bless.
export function deriveExpectedCount(view, resources) {
  const selects = collectSelects(view.select, [])
  const forEachSel = selects.find((s) => s.forEach || s.forEachOrNull)
  const whereClauses = view.where

  if (forEachSel) {
    const expr = forEachSel.forEach || forEachSel.forEachOrNull
    return resources.reduce((sum, r) => sum + fhirpath_evaluate(r, expr).length, 0)
  }
  if (whereClauses && whereClauses.length) {
    return resources.filter((r) => whereClauses.every((w) => fhirpath_evaluate(r, w.path)[0] === true)).length
  }
  return resources.length
}

// Bless mode WRITES THE CHECKFILE (counts, checksums, assertions), never the
// benchmark file. All-or-nothing by design — a checkfile must never be written
// from an incomplete run, so any failure here is a hard failure, in deliberate
// contrast to the harness's per-case record-and-continue. Each blessed assertion
// is analytically cross-checked before it is committed; other sizes' recorded
// values are preserved.
export function blessCheckfile({ benchmark, size, dataRoot, checkfilePath }) {
  const dataset = benchmark.dataset
  if (!dataset.syntheaVersion) {
    throw new Error(
      `recipe "${dataset.name}" declares no syntheaVersion; refusing to bless without a pinned generator version`,
    )
  }
  const assertions = {}
  for (const c of benchmark.cases) {
    const resources = loadResources(
      resourceFile(dataRoot, dataset.name, dataset.version, size, c.view.resource),
    )
    const outputRows = evaluate(c.view, resources).length
    const derived = deriveExpectedCount(c.view, resources)
    if (derived !== outputRows) {
      throw new Error(
        `bless cross-check failed for case "${c.id}" size ${size}: observed ${outputRows} rows but analytic derivation is ${derived}`,
      )
    }
    assertions[c.id] = { [size]: outputRows }
  }
  const previous = readCheckfile(checkfilePath)
  const checkfile = buildCheckfile({ dataRoot, dataset, sizes: [size], assertions, previous })
  writeCheckfile(checkfilePath, checkfile)
  return checkfile
}

if (import.meta.main) {
  const { readFileSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const opts = { record: false, size: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--record') opts.record = true
    else if (args[i] === '--data') opts.dataRoot = args[++i]
    else opts.path = args[i]
  }
  if (!opts.record) {
    console.error('benchmark-run is bless-only: pass --record to write the checkfile.')
    console.error(
      'To measure, use the harness: bun run bench:harness -- run --hook sof-js/hook.json <file> --size <s>',
    )
    process.exit(2)
  }
  const benchmark = JSON.parse(readFileSync(opts.path, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || new URL('../../benchmark/data', import.meta.url).pathname
  const checkfilePath = checkfileFor(opts.path)
  blessCheckfile({ benchmark, size, dataRoot, checkfilePath })
  console.error(`blessed checkfile ${checkfilePath} for size ${size}`)
}
