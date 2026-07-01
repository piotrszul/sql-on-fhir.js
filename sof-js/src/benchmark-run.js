import { loadResources, timeEvaluate, statsOf } from './benchmark.js'
import { fhirpath_evaluate } from './path.js'
import { resourceFile, checkfileFor } from '../../benchmark/tools/layout.js'
import {
  readCheckfile,
  writeCheckfile,
  buildCheckfile,
  assertionFor,
  verifyChecksums,
} from '../../benchmark/tools/checkfile.js'

// The runner locates a case's data at data/<name>/<version>/<size>/ using the
// dataset's explicit name + version — it NEVER re-derives a content hash.
function resolveResourceFile(benchmark, size, dataRoot, resourceType) {
  return resourceFile(dataRoot, benchmark.dataset.name, benchmark.dataset.version, size, resourceType)
}

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
// Independent of the timed evaluate() so it is a genuine cross-check of the bless.
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

function runCases({ benchmark, size, dataRoot }) {
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  return benchmark.cases.map((c) => {
    const path = resolveResourceFile(benchmark, size, dataRoot, c.view.resource)
    const resources = loadResources(path)
    const { samplesMs, outputRows } = timeEvaluate(c.view, resources, { warmup, measurement })
    return { c, inputRows: resources.length, outputRows, samplesMs }
  })
}

// Count the loaded resources of each declared resource type at this size — the
// dataset resourceCounts the report records for traceability (mirrors the checkfile).
function observeResourceCounts({ benchmark, size, dataRoot }) {
  const counts = {}
  for (const r of benchmark.dataset.resources) {
    const path = resolveResourceFile(benchmark, size, dataRoot, r)
    counts[r] = loadResources(path).length
  }
  return counts
}

export function buildReport({
  benchmark,
  size,
  dataRoot,
  checkfilePath,
  impl,
  scenario = 'preloaded_repeated',
}) {
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  const checkfile = checkfilePath ? readCheckfile(checkfilePath) : null
  const cases = runCases({ benchmark, size, dataRoot }).map(({ c, inputRows, outputRows, samplesMs }) => {
    const expected = assertionFor(checkfile, c.id, size)
    // Work-verification guard: present+match => ok; present+mismatch => count_mismatch;
    // absent => ok. A countVariancePermitted case (where/forEach-position reference)
    // is NOT auto-flagged, honouring the restricted invariance claim.
    let status = 'ok'
    if (expected != null && outputRows !== expected && !c.countVariancePermitted) status = 'count_mismatch'
    return { id: c.id, status, inputRows, outputRows, samplesMs, stats: statsOf(samplesMs) }
  })
  // end_to_end times load + execute + extract; preloaded_repeated excludes load.
  // The sink is csv for BOTH scenarios (benchmark-report-format): timeEvaluate
  // serializes the evaluated rows to CSV inside the timed region, so extract cost
  // genuinely reflects sink: 'csv' and an optimizer cannot prune it. The scenario
  // distinction is PURELY the load boundary, not the sink.
  const phases = scenario === 'end_to_end' ? ['load', 'execute', 'extract'] : ['execute', 'extract']
  return {
    implementation: impl,
    // Benchmark identity sourced DIRECTLY from the authored suite name/version,
    // not invented from a pinned tag and not the dataset version.
    benchmark: { name: benchmark.name, version: benchmark.version },
    dataset: { name: benchmark.dataset.name, version: benchmark.dataset.version },
    measurement: {
      scenario,
      phases,
      sink: 'csv',
      warmup,
      iterations: measurement,
    },
    // The results map is keyed by the stable suite name, consistent with
    // report.benchmark.name, the case id, and dataset name/version — never the
    // mutable title.
    results: {
      [benchmark.name]: {
        size,
        fhirVersion: benchmark.fhirVersion,
        resourceCounts: observeResourceCounts({ benchmark, size, dataRoot }),
        cases,
      },
    },
  }
}

// Bless mode WRITES THE CHECKFILE (counts, checksums, assertions), never the
// benchmark file. Each blessed assertion is analytically cross-checked before it
// is committed; a disagreement is a bless-time error. Other sizes are preserved.
export function blessCheckfile({ benchmark, size, dataRoot, checkfilePath }) {
  const observed = runCases({ benchmark, size, dataRoot })
  const assertions = {}
  for (const { c, inputRows, outputRows } of observed) {
    const resources = loadResources(resolveResourceFile(benchmark, size, dataRoot, c.view.resource))
    const derived = deriveExpectedCount(c.view, resources)
    if (derived !== outputRows) {
      throw new Error(
        `bless cross-check failed for case "${c.id}" size ${size}: observed ${outputRows} rows but analytic derivation is ${derived}`,
      )
    }
    void inputRows
    assertions[c.id] = { [size]: outputRows }
  }
  const previous = readCheckfile(checkfilePath)
  const dataset = {
    ...benchmark.dataset,
    syntheaVersion: benchmark.dataset.syntheaVersion ?? benchmark.dataset.version,
  }
  const checkfile = buildCheckfile({ dataRoot, dataset, sizes: [size], assertions, previous })
  writeCheckfile(checkfilePath, checkfile)
  return checkfile
}

if (import.meta.main) {
  const { readFileSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const opts = { record: false, size: undefined, strict: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--record') opts.record = true
    else if (args[i] === '--strict') opts.strict = true
    else if (args[i] === '--data') opts.dataRoot = args[++i]
    else opts.path = args[i]
  }
  const benchmark = JSON.parse(readFileSync(opts.path, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || new URL('../../benchmark/data', import.meta.url).pathname
  const checkfilePath = checkfileFor(opts.path)
  if (opts.record) {
    blessCheckfile({ benchmark, size, dataRoot, checkfilePath })
    console.error(`blessed checkfile ${checkfilePath} for size ${size}`)
  } else {
    if (opts.strict) {
      const cf = readCheckfile(checkfilePath)
      if (cf) {
        const drift = verifyChecksums({ dataRoot, checkfile: cf, size })
        if (drift.length) {
          console.error('checksum drift detected:')
          drift.forEach((d) => console.error(`  - ${d}`))
          process.exit(1)
        }
      }
    }
    const report = buildReport({
      benchmark,
      size,
      dataRoot,
      checkfilePath,
      impl: { engine: { name: 'sof-js', version: '2.0.0' } },
    })
    console.log(JSON.stringify(report, null, 2))
  }
}
