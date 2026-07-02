import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { materialize } from './materialize.js'
import { makeSyntheaExecutor, loadConfig } from './executors/synthea.js'

function loadBenchmarks(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'package.json')
    .map((f) => {
      try {
        return { file: f, doc: JSON.parse(readFileSync(join(dir, f), 'utf8')) }
      } catch {
        return null
      }
    })
    .filter((x) => x && x.doc.dataset && x.doc.cases)
}

function defaultRegistry() {
  // tools/executors.config.json is an OPTIONAL override now: with a config its jar /
  // java win; with no config the executor auto-fetches the pinned Synthea jar.
  const cfg = loadConfig()
  return { synthea: makeSyntheaExecutor({ config: cfg?.synthea ?? null }) }
}

export async function run({
  target,
  size,
  group,
  force = false,
  dir,
  dataRoot = join(dir, 'data'),
  registry,
}) {
  registry = registry || defaultRegistry()
  const all = loadBenchmarks(dir)
  const selected = group
    ? all.filter((b) => b.doc.group === group)
    : all.filter((b) => b.file === target || b.doc.title === target)
  if (selected.length === 0) throw new Error(`no benchmark matched target=${target} group=${group}`)

  const manifests = []
  for (const { doc } of selected) {
    const sz = size || doc.dataset.defaultSize
    const executor = registry[doc.dataset.kind]
    if (!executor) throw new Error(`no executor for kind "${doc.dataset.kind}"`)
    manifests.push(await materialize({ dataset: doc.dataset, size: sz, dataRoot, executor, force }))
  }
  return manifests
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const opts = { dir: new URL('..', import.meta.url).pathname }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--group') opts.group = args[++i]
    else if (args[i] === '--force') opts.force = true
    else opts.target = args[i]
  }
  const manifests = await run(opts)
  console.log(JSON.stringify(manifests, null, 2))
}
