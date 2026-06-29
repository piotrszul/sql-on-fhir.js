import { loadResources, timeEvaluate, statsOf } from './benchmark.js'
import { resourceFile } from '../../benchmark/tools/layout.js'

function recipeOf(dataset) {
  const { name, sizes, defaultSize, ...rest } = dataset
  return rest
}

function runCases({ benchmark, size, dataRoot }) {
  const recipe = recipeOf(benchmark.dataset)
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  return benchmark.cases.map((c) => {
    const path = resourceFile(dataRoot, benchmark.dataset.name, recipe, size, c.view.resource)
    const resources = loadResources(path)
    const { samplesMs, outputRows } = timeEvaluate(c.view, resources, { warmup, measurement })
    return { c, inputRows: resources.length, outputRows, samplesMs }
  })
}

export function buildReport({ benchmark, size, dataRoot, impl }) {
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  const cases = runCases({ benchmark, size, dataRoot }).map(({ c, inputRows, outputRows, samplesMs }) => {
    const expected = c.expectCount?.[size]
    const status = expected == null ? 'ok' : outputRows === expected ? 'ok' : 'count_mismatch'
    return { title: c.title, status, inputRows, outputRows, samplesMs, stats: statsOf(samplesMs) }
  })
  return {
    implementation: impl,
    measurement: { phases: ['execute', 'extract'], sink: 'memory', warmup, iterations: measurement },
    results: { [benchmark.title]: { size, fhirVersion: benchmark.fhirVersion, cases } },
  }
}

export function bless({ benchmark, size, dataRoot }) {
  const doc = structuredClone(benchmark)
  const observed = runCases({ benchmark, size, dataRoot })
  observed.forEach(({ outputRows }, i) => {
    doc.cases[i].expectCount = { ...(doc.cases[i].expectCount || {}), [size]: outputRows }
  })
  return doc
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const opts = { record: false, size: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--record') opts.record = true
    else if (args[i] === '--data') opts.dataRoot = args[++i]
    else opts.path = args[i]
  }
  const benchmark = JSON.parse(readFileSync(opts.path, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || new URL('../../benchmark/data', import.meta.url).pathname
  if (opts.record) {
    const blessed = bless({ benchmark, size, dataRoot })
    writeFileSync(opts.path, JSON.stringify(blessed, null, 2) + '\n')
    console.error(`blessed ${opts.path} for size ${size}`)
  } else {
    const report = buildReport({ benchmark, size, dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
    console.log(JSON.stringify(report, null, 2))
  }
}
