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

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

// The defined basic-statistics shape (benchmark-report-format): mean/min/max/stddev
// plus p50/p95, all in the same unit as samplesMs. Shaped to project onto a JMH
// primaryMetric without recomputation.
export function statsOf(samplesMs) {
  const n = samplesMs.length
  const min = Math.min(...samplesMs)
  const max = Math.max(...samplesMs)
  const mean = samplesMs.reduce((a, b) => a + b, 0) / n
  const variance = n > 1 ? samplesMs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
  const stddev = Math.sqrt(variance)
  const sorted = [...samplesMs].sort((a, b) => a - b)
  return { mean, min, max, stddev, p50: percentile(sorted, 50), p95: percentile(sorted, 95) }
}
