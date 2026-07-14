// Staging driver for the flatquack DuckDB-session internal benchmark (design.md
// add-measurement-plans D3/D6). It constructs the internal warm-table-sink plan,
// drives it through the harness's custom-plan module entry point (runPlanSuite —
// NOT the public CLI), and writes the self-describing internal record plus its
// JMH projection for each implementation identity. Comparing two identities
// (two flatquack refs and/or two duckdb versions) is the point: pass --hook more
// than once and load the JMH files into JMH Visualizer side by side.
//
//   bun run flatquack-internal-driver.js \
//     --hook hook.json [--hook hook.other.json] <benchmark.json> \
//     [--size s] [--data <root>] [--out <dir>]
//
// Honesty guard (D6): the driver REFUSES a manifest whose implementation.variant
// lacks the `internal-` prefix, so an internal run can never be mislabelled with
// an official-looking identity in a JMH overlay.

import { readFileSync } from 'node:fs'
import { runPlanSuite } from '../../tools/harness/runner.js'
import { writeInternalReport } from '../../tools/harness/internal-report.js'
import { writeJmhExports } from '../../tools/harness/jmh.js'
import { readManifest } from '../../tools/harness/manifest.js'
import { checkfileFor, pathFrom } from '../../tools/layout.js'
import { readCheckfile } from '../../tools/checkfile.js'

const SCENARIO_ID = 'internal:warm-table-sink'

// The combination no official binding reaches: fork-per-trial (a fresh warmed
// session per case), load inside the timed region into an in-engine table sink,
// warmups discarded, verification by the untimed engine-reported count.
const WARM_PLAN = {
  forkLevel: 'trial',
  trialSetup: 'prepare-lazy',
  invocationSetup: 'none',
  timedRegion: ['run'],
  sink: 'table',
  verification: 'post-loop-count',
  warmup: 'iterations',
}

// The timed region loads the source NDJSON and executes into the sink; CSV
// serialization is excluded (count is engine-reported; extract, if used, is
// untimed). The truthful phases the internal record stamps.
const PHASES = ['load', 'execute']

function parseArgs(argv) {
  const opts = { hooks: [], positional: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hook') opts.hooks.push(argv[++i])
    else if (argv[i] === '--size') opts.size = argv[++i]
    else if (argv[i] === '--data') opts.dataRoot = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else opts.positional.push(argv[i])
  }
  return opts
}

export async function runDriver(argv) {
  const opts = parseArgs(argv)
  const [suitePath] = opts.positional
  if (!opts.hooks.length || !suitePath) {
    throw new Error(
      'usage: flatquack-internal-driver.js --hook <hook.json> [--hook …] <benchmark.json> [--size s] [--data <root>] [--out <dir>]',
    )
  }
  const benchmark = JSON.parse(readFileSync(suitePath, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || pathFrom(import.meta.url, '../../data')
  const checkfile = readCheckfile(checkfileFor(suitePath))
  const outDir = opts.out || '.'

  for (const hookPath of opts.hooks) {
    const manifest = readManifest(hookPath)
    const variant = manifest.implementation?.variant
    if (!variant?.startsWith('internal-')) {
      throw new Error(
        `${hookPath}: implementation.variant must start with "internal-" for a custom-plan run; got ${JSON.stringify(variant)}`,
      )
    }
    const record = await runPlanSuite({
      plan: WARM_PLAN,
      scenarioId: SCENARIO_ID,
      phases: PHASES,
      benchmark,
      size,
      dataRoot,
      manifest,
      checkfile,
    })
    const recordPath = writeInternalReport(record, outDir)
    const jmhPaths = writeJmhExports(record, outDir)
    const cases = record.results[benchmark.name].cases
    const verified = cases.filter((c) => c.verified).length
    console.error(
      `${variant}: ${verified}/${cases.length} verified -> ${recordPath} (+${jmhPaths.length} JMH)`,
    )
  }
}

if (import.meta.main) {
  runDriver(process.argv.slice(2)).catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
