import { readFileSync } from 'node:fs'
import { evaluate } from './index.js'

export function loadResources(ndjsonPath) {
  return readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

export function timeEvaluate(view, resources, { warmup, measurement }) {
  for (let i = 0; i < warmup; i++) evaluate(view, resources)
  const samplesMs = []
  let outputRows = 0
  for (let i = 0; i < measurement; i++) {
    const t0 = performance.now()
    const rows = evaluate(view, resources)
    const t1 = performance.now()
    samplesMs.push(t1 - t0)
    outputRows = rows.length
  }
  return { samplesMs, outputRows }
}

export function statsOf(samplesMs) {
  const min = Math.min(...samplesMs)
  const mean = samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length
  return { min, mean }
}
