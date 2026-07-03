// The report's defined basic-statistics shape (benchmark-report-format):
// mean/stddev/min/max/median required, computed by the harness so every
// implementation's report carries identically-computed statistics. Richer
// percentiles and confidence intervals are recomputed downstream from the raw
// samplesMs the report always carries.

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

export function statsOf(samplesMs) {
  const n = samplesMs.length
  const min = Math.min(...samplesMs)
  const max = Math.max(...samplesMs)
  const mean = samplesMs.reduce((a, b) => a + b, 0) / n
  const variance = n > 1 ? samplesMs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
  const stddev = Math.sqrt(variance)
  const sorted = [...samplesMs].sort((a, b) => a - b)
  return { mean, stddev, min, max, median: percentile(sorted, 50) }
}
