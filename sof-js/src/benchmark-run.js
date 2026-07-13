// Bless mode — the reference-implementation privilege that remains in sof-js
// after the measurement loop, report emission and JMH projection moved to the
// shared harness (benchmark/tools/harness). Minting checkfile assertions stays
// here because the analytic cross-check needs a FHIRPath evaluator, and the
// artifact must not depend on an implementation (design.md D3).

import { existsSync } from 'node:fs'
import { evaluate, normalize } from './index.js'
import { streamResources } from './benchmark.js'
import { fhirpath_evaluate } from './path.js'
import { resourceFile, checkfileFor, pathFrom } from '../../benchmark/tools/layout.js'
import { readCheckfile, writeCheckfile, buildCheckfile } from '../../benchmark/tools/checkfile.js'
import { buildCaseFilter } from '../../benchmark/tools/case-filter.js'

// Analytic row-cardinality derivation over the (normalized) select tree. It
// mirrors evaluate()'s structure so the two must agree row-for-row, but it only
// ever COUNTS — it uses FHIRPath solely to measure forEach collection lengths and
// evaluate where predicates, never to extract, type or compose column values. It
// is therefore independent of the row-composition code (the layer most prone to
// combinatorial bugs) while sharing only the FHIRPath layer.
//
//   column              -> 1 (a column block contributes exactly one row unit)
//   select node         -> Π cardinality(child) over select[]   (cross-join)
//                          filtered to 0 when a view-level where or resource
//                          guard rejects the focus
//   unionAll            -> Σ cardinality(branch)                 (sum)
//   forEach expr        -> Σ over elements of expr(focus)        (sum)
//   forEachOrNull expr  -> same, but an empty collection contributes 1 (null row)
function countChildren(children, node, def, envVars) {
  return (children || []).reduce((prod, s) => prod * countRows(s, node, def, envVars), 1)
}

function countRows(nnode, node, def, envVars) {
  switch (nnode.type) {
    case 'column':
      return 1
    case 'select': {
      if (
        nnode.where &&
        !nnode.where.every((w) => fhirpath_evaluate(node, w.path, def.constant, envVars)[0] === true)
      ) {
        return 0
      }
      if (nnode.resource && nnode.resource !== node.resourceType) return 0
      return countChildren(nnode.select, node, def, envVars)
    }
    case 'forEach':
    case 'forEachOrNull': {
      const path = nnode.forEach || nnode.forEachOrNull
      let elems = fhirpath_evaluate(node, path, def.constant, envVars)
      // forEachOrNull over an empty collection still emits one all-null row.
      if (nnode.type === 'forEachOrNull' && elems.length === 0) elems = [{}]
      return elems.reduce(
        (sum, el, index) => sum + countChildren(nnode.select, el, def, { ...envVars, rowIndex: index }),
        0,
      )
    }
    case 'unionAll':
      return (nnode.unionAll || []).reduce((sum, b) => sum + countRows(b, node, def, envVars), 0)
    default:
      // repeat and any future construct: refuse rather than silently miscount.
      // Bless hard-fails on the resulting cross-check mismatch anyway, so this is
      // a clearer signal than a wrong number.
      throw new Error(`cardinality: unsupported select node type "${nnode.type}"`)
  }
}

// Normalizing a view is a pure function of the view object, but bless calls
// cardinality() once per resource (millions of times at xl). Memoize the
// normalized tree per view object so the structuredClone + normalize runs once,
// not once per resource. Keyed weakly so it never keeps a view alive. The key is
// object identity, so a caller that MUTATES a view between calls would read a
// stale tree — callers must treat views as immutable (bless does).
const normalizedViews = new WeakMap()
function normalizedView(view) {
  let normal = normalizedViews.get(view)
  if (!normal) {
    normal = normalize(structuredClone(view))
    normalizedViews.set(view, normal)
  }
  return normal
}

// The row count evaluate() would produce for a single resource, derived
// analytically. Σ cardinality(view, r) over the dataset === evaluate(view, all).length.
export function cardinality(view, resource) {
  return countRows(normalizedView(view), resource, view, { rowIndex: 0 })
}

// Bless mode WRITES THE CHECKFILE (counts, checksums, assertions), never the
// benchmark file. All-or-nothing by design — a checkfile must never be written
// from an incomplete run, so any failure here is a hard failure, in deliberate
// contrast to the harness's per-case record-and-continue. Each blessed assertion
// is analytically cross-checked before it is committed; other sizes' and
// unselected cases' recorded values are preserved.
//
// Bless streams the dataset one NDJSON resource at a time (the v1 single-resource
// scope makes every output row derive from exactly one input resource), so its
// memory is bounded by a single resource and its output rows rather than by the
// dataset — this is what makes the xl (100k) tier blessable at all.
//
// `derive` is an injectable seam (defaults to the real cardinality) so a test can
// force a cross-check disagreement and prove bless refuses to write.
export async function blessCheckfile({
  benchmark,
  size,
  dataRoot,
  checkfilePath,
  caseFilter,
  derive = cardinality,
}) {
  const dataset = benchmark.dataset
  if (!dataset.syntheaVersion) {
    throw new Error(
      `recipe "${dataset.name}" declares no syntheaVersion; refusing to bless without a pinned generator version`,
    )
  }
  const cases = caseFilter ? benchmark.cases.filter(caseFilter) : benchmark.cases
  const assertions = {}
  for (const c of cases) {
    const path = resourceFile(dataRoot, dataset.name, dataset.version, size, c.view.resource)
    if (!existsSync(path)) {
      throw new Error(`no materialized data for case "${c.id}" size ${size}: ${path}`)
    }
    let outputRows = 0
    let derived = 0
    for await (const r of streamResources(path)) {
      outputRows += evaluate(c.view, [r]).length
      derived += derive(c.view, r)
    }
    if (derived !== outputRows) {
      throw new Error(
        `bless cross-check failed for case "${c.id}" size ${size}: observed ${outputRows} rows but analytic derivation is ${derived}`,
      )
    }
    assertions[c.id] = { [size]: outputRows }
  }
  const previous = readCheckfile(checkfilePath)
  // Every current case id is kept (unselected cases carry their prior assertions
  // forward); only ids no longer in the benchmark are pruned.
  const keepIds = benchmark.cases.map((c) => c.id)
  const checkfile = buildCheckfile({ dataRoot, dataset, sizes: [size], assertions, previous, keepIds })
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
    else if (args[i] === '--only') opts.only = args[++i]
    else if (args[i] === '--exclude') opts.exclude = args[++i]
    else opts.path = args[i]
  }
  if (!opts.record) {
    console.error('benchmark-run is bless-only: pass --record to write the checkfile.')
    console.error(
      'To measure, use the harness: bun run bench:harness run --hook sof-js/hook.json <file> --size <s>',
    )
    process.exit(2)
  }
  const benchmark = JSON.parse(readFileSync(opts.path, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || pathFrom(import.meta.url, '../../benchmark/data')
  const checkfilePath = checkfileFor(opts.path)
  const caseFilter = buildCaseFilter({
    only: opts.only,
    exclude: opts.exclude,
    knownIds: benchmark.cases.map((c) => c.id),
  })
  await blessCheckfile({ benchmark, size, dataRoot, checkfilePath, caseFilter })
  console.error(`blessed checkfile ${checkfilePath} for size ${size}`)
}
