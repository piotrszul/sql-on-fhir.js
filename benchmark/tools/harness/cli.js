// The reference harness CLI (benchmark-harness capability).
//
//   run  --hook <hook.json> <benchmark.json> [--size <s>] [--scenario <name>]
//        [--data <root>] [--strict] [--jmh <dir>] [--out <report.json>]
//     Measure the suite against the hook and emit the native report (stdout, or
//     --out). --strict verifies the materialized data against the checkfile's
//     sha256 locks first. --jmh also writes the JMH projection.
//
//   exec --hook <hook.json> '<json-command>'
//     Single-command debug mode: bring up the hook per its lifecycle mode, send
//     one protocol command, print the JSON response, shut down (spawn mode).

import { readFileSync, writeFileSync } from 'node:fs'
import { readManifest } from './manifest.js'
import { startWorker } from './worker.js'
import { runSuite } from './runner.js'
import { writeJmhExports } from './jmh.js'
import { checkfileFor, pathFrom } from '../layout.js'
import { readCheckfile, verifyChecksums } from '../checkfile.js'
import { validateSchema } from '../validate-benchmarks.js'
import { buildCaseFilter } from '../case-filter.js'

function parseArgs(argv) {
  const opts = { positional: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hook') opts.hook = argv[++i]
    else if (argv[i] === '--size') opts.size = argv[++i]
    else if (argv[i] === '--scenario') opts.scenario = argv[++i]
    else if (argv[i] === '--data') opts.dataRoot = argv[++i]
    else if (argv[i] === '--jmh') opts.jmhDir = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else if (argv[i] === '--only') opts.only = argv[++i]
    else if (argv[i] === '--exclude') opts.exclude = argv[++i]
    else if (argv[i] === '--strict') opts.strict = true
    else opts.positional.push(argv[i])
  }
  return opts
}

export async function runCli(argv) {
  const [mode, ...rest] = argv
  const opts = parseArgs(rest)
  if (!opts.hook) throw new Error('usage: cli.js <run|exec> --hook <hook.json> …')
  const manifest = readManifest(opts.hook)

  if (mode === 'exec') {
    const [commandJson] = opts.positional
    if (!commandJson) throw new Error("usage: cli.js exec --hook <hook.json> '<json-command>'")
    const worker = await startWorker(manifest)
    try {
      const resp = await worker.send(JSON.parse(commandJson), { timeoutMs: 60_000 })
      console.log(JSON.stringify(resp))
      return resp
    } finally {
      await worker.shutdown()
    }
  }

  if (mode !== 'run') throw new Error(`unknown mode "${mode}" (expected run or exec)`)
  const [suitePath] = opts.positional
  if (!suitePath) throw new Error('usage: cli.js run --hook <hook.json> <benchmark.json> …')
  const benchmark = JSON.parse(readFileSync(suitePath, 'utf8'))
  // Refuse a schema-invalid suite up front: unvalidated input (e.g. a zero
  // measurement count) otherwise flows through to a schema-violating report.
  const schemaErrs = validateSchema(benchmark)
  if (schemaErrs.length) {
    throw new Error(
      `${suitePath} fails benchmark.schema.json:\n${schemaErrs.map((e) => `  - ${e}`).join('\n')}`,
    )
  }
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || pathFrom(import.meta.url, '../../data')
  const checkfile = readCheckfile(checkfileFor(suitePath))

  // --strict promises the data was verified against locked bytes, so anything
  // unverifiable (no checkfile, no entry for this size) must fail loudly rather
  // than silently skip the check.
  if (opts.strict) {
    if (!checkfile) {
      throw new Error(`--strict: no checkfile at ${checkfileFor(suitePath)}; nothing to verify against`)
    }
    if (!Object.keys(checkfile.sizes?.[size]?.files || {}).length) {
      throw new Error(`--strict: the checkfile locks no files for size "${size}"; nothing to verify against`)
    }
    const drift = verifyChecksums({ dataRoot, checkfile, size })
    if (drift.length) {
      throw new Error(`checksum drift detected:\n${drift.map((d) => `  - ${d}`).join('\n')}`)
    }
  }

  // --only / --exclude select a subset of cases; an unknown id fails loudly here
  // (before any worker is started) rather than silently running nothing.
  const caseFilter = buildCaseFilter({
    only: opts.only,
    exclude: opts.exclude,
    knownIds: benchmark.cases.map((c) => c.id),
  })

  const report = await runSuite({
    benchmark,
    size,
    dataRoot,
    manifest,
    checkfile,
    ...(caseFilter ? { caseFilter } : {}),
    ...(opts.scenario ? { scenario: opts.scenario } : {}),
  })
  const json = JSON.stringify(report, null, 2)
  if (opts.out) writeFileSync(opts.out, json + '\n')
  else console.log(json)
  if (opts.jmhDir) {
    const written = writeJmhExports(report, opts.jmhDir)
    console.error(`wrote ${written.length} JMH file(s) to ${opts.jmhDir}`)
  }
  return report
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
