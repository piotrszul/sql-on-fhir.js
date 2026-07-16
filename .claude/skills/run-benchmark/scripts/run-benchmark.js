// Orchestrates a benchmark run against one or more staging hooks
// (benchmark/staging-hooks/*). Standard hooks run through the public harness
// CLI (tools/harness/cli.js), once per hook x declared scenario. A hook whose
// implementation.variant starts with "internal-" is a custom-plan hook and
// instead runs through its co-located "<dir>-driver.js" (e.g.
// flatquack-internal/flatquack-internal-driver.js), which natively accepts
// multiple --hook flags for A/B comparison.
//
//   bun run run-benchmark.js --benchmark clinical-wide --size m \
//     --hook benchmark/staging-hooks/flatquack/hook.json \
//     [--hook ...] [--scenario preloaded_repeated] [--scenario end_to_end] \
//     [--out <dir>] [--data <root>] [--strict] [--only <ids>] [--exclude <ids>]

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const HARNESS_CLI = join(REPO_ROOT, 'benchmark/tools/harness/cli.js')
const DEFAULT_SCENARIOS = ['preloaded_repeated', 'end_to_end']

function parseArgs(argv) {
  const opts = { hooks: [], scenarios: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--hook') opts.hooks.push(argv[++i])
    else if (a === '--scenario') opts.scenarios.push(argv[++i])
    else if (a === '--benchmark') opts.benchmark = argv[++i]
    else if (a === '--size') opts.size = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--data') opts.dataRoot = argv[++i]
    else if (a === '--only') opts.only = argv[++i]
    else if (a === '--exclude') opts.exclude = argv[++i]
    else if (a === '--strict') opts.strict = true
    else throw new Error(`unknown argument "${a}"`)
  }
  return opts
}

function resolveBenchmarkPath(spec) {
  const name = spec.endsWith('.json') ? spec : `${spec}.json`
  for (const c of [
    resolve(process.cwd(), name),
    resolve(REPO_ROOT, name),
    resolve(REPO_ROOT, 'benchmark', name),
  ]) {
    if (existsSync(c)) return c
  }
  throw new Error(`benchmark file not found: ${spec}`)
}

function resolveHookPath(spec) {
  if (!spec.endsWith('.json')) {
    const dir = resolve(REPO_ROOT, 'benchmark/staging-hooks', spec)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`no staging-hooks directory named "${spec}"`)
    }
    const hookFiles = readdirSync(dir).filter((f) => /^hook.*\.json$/.test(f))
    if (hookFiles.length !== 1) {
      throw new Error(
        `"${spec}" has ${hookFiles.length} hook file(s) (${hookFiles.join(', ') || 'none'}) — ` +
          `name one explicitly, e.g. --hook ${spec}/${hookFiles[0] || 'hook.json'}`,
      )
    }
    return join(dir, hookFiles[0])
  }
  for (const c of [
    resolve(process.cwd(), spec),
    resolve(REPO_ROOT, spec),
    resolve(REPO_ROOT, 'benchmark/staging-hooks', spec),
  ]) {
    if (existsSync(c)) return c
  }
  throw new Error(`hook file not found: ${spec}`)
}

function readVariant(hookPath) {
  const manifest = JSON.parse(readFileSync(hookPath, 'utf8'))
  return manifest.implementation?.variant
}

function driverPathFor(hookPath) {
  const dir = dirname(hookPath)
  return join(dir, `${basename(dir)}-driver.js`)
}

function labelFor(hookPath) {
  const dirName = basename(dirname(hookPath))
  const stem = basename(hookPath, '.json')
  const suffix = stem.replace(/^hook\.?/, '')
  return suffix ? `${dirName}-${suffix}` : dirName
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function runInternalGroup(driverPath, hookPaths, { benchmarkPath, size, outDir, dataRoot }, results) {
  const args = ['run', driverPath]
  for (const h of hookPaths) args.push('--hook', h)
  args.push(benchmarkPath, '--size', size, '--out', outDir)
  if (dataRoot) args.push('--data', dataRoot)
  console.log(`\n[internal] ${basename(driverPath)} <- ${hookPaths.map(labelFor).join(', ')}`)
  const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' })
  const ok = res.status === 0
  for (const h of hookPaths)
    results.push({ label: labelFor(h), scenario: 'internal:warm-table-sink', status: ok ? 'ok' : 'failed' })
  if (!ok) console.error(`[internal] ${basename(driverPath)} exited ${res.status}`)
}

function runStandardHook(
  hookPath,
  scenarios,
  { benchmarkPath, size, outDir, dataRoot, strict, only, exclude },
  results,
) {
  const label = labelFor(hookPath)
  for (const scenario of scenarios) {
    const outFile = join(outDir, `${label}-${scenario}.report.json`)
    const args = [
      'run',
      HARNESS_CLI,
      'run',
      '--hook',
      hookPath,
      benchmarkPath,
      '--size',
      size,
      '--scenario',
      scenario,
      '--out',
      outFile,
      '--jmh',
      outDir,
    ]
    if (dataRoot) args.push('--data', dataRoot)
    if (strict) args.push('--strict')
    if (only) args.push('--only', only)
    if (exclude) args.push('--exclude', exclude)
    console.log(`\n[${label}] scenario=${scenario}`)
    const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'pipe'] })
    const stderr = res.stderr?.toString() ?? ''
    if (stderr) process.stderr.write(stderr)
    if (res.status === 0) {
      results.push({ label, scenario, status: 'ok', file: outFile })
    } else if (stderr.includes('does not declare scenario')) {
      results.push({ label, scenario, status: 'skipped' })
      console.log(`[${label}] skipped ${scenario} — hook does not declare it`)
    } else {
      results.push({ label, scenario, status: 'failed' })
    }
  }
}

export function run(argv) {
  const opts = parseArgs(argv)
  if (!opts.hooks.length) throw new Error('at least one --hook is required')

  const benchmarkPath = resolveBenchmarkPath(opts.benchmark || 'clinical-wide')
  const size = opts.size || 'm'
  const benchmarkStem = basename(benchmarkPath, '.json')
  const outDir = opts.out
    ? resolve(process.cwd(), opts.out)
    : join(REPO_ROOT, '.local/benchmark-runs', `${timestamp()}-${benchmarkStem}-${size}`)
  mkdirSync(outDir, { recursive: true })

  const hookPaths = opts.hooks.map(resolveHookPath)
  const internalGroups = new Map() // driverPath -> hookPath[]
  const standardHooks = []
  for (const hookPath of hookPaths) {
    const variant = readVariant(hookPath)
    if (variant?.startsWith('internal-')) {
      const driverPath = driverPathFor(hookPath)
      if (!existsSync(driverPath)) {
        throw new Error(`${hookPath}: variant "${variant}" is internal but no driver found at ${driverPath}`)
      }
      if (!internalGroups.has(driverPath)) internalGroups.set(driverPath, [])
      internalGroups.get(driverPath).push(hookPath)
    } else {
      standardHooks.push(hookPath)
    }
  }

  if ((opts.strict || opts.only || opts.exclude) && internalGroups.size) {
    console.log(
      '[note] --strict/--only/--exclude apply only to standard hooks; the internal driver ignores them',
    )
  }
  const scenarios = opts.scenarios.length ? opts.scenarios : DEFAULT_SCENARIOS
  if (opts.scenarios.length && !standardHooks.length) {
    console.log('[note] --scenario is ignored — all selected hooks run their fixed internal plan')
  }

  const results = []
  const common = { benchmarkPath, size, outDir, dataRoot: opts.dataRoot }
  for (const [driverPath, hooks] of internalGroups) runInternalGroup(driverPath, hooks, common, results)
  for (const hookPath of standardHooks) {
    runStandardHook(
      hookPath,
      scenarios,
      { ...common, strict: opts.strict, only: opts.only, exclude: opts.exclude },
      results,
    )
  }

  const ok = results.filter((r) => r.status === 'ok').length
  const skipped = results.filter((r) => r.status === 'skipped').length
  const failed = results.filter((r) => r.status === 'failed').length
  console.log(`\n${ok} ok, ${skipped} skipped, ${failed} failed -> ${outDir}`)
  for (const r of results)
    console.log(`  ${r.status.padEnd(7)} ${r.label} ${r.scenario}${r.file ? ` -> ${r.file}` : ''}`)
  process.exitCode = failed > 0 ? 1 : 0
}

if (import.meta.main) {
  try {
    run(process.argv.slice(2))
  } catch (err) {
    console.error(String(err?.message ?? err))
    process.exit(1)
  }
}
