// Measurement plans (design.md add-measurement-plans D1/D2): a closed data
// record the generic executor interprets, and the official scenario bindings
// that resolve to plans. The plan is DATA ONLY — every field a closed enum
// whose values are exactly the behaviours the four known decomposition-table
// rows need — so a plan is trivially loggable (it *is* the internal record's
// plan descriptor), diffable in tests, and cannot smuggle choreography past the
// honesty guard. Scenario names live only on bindings; the executor never sees
// them, so no code path can stamp an official scenario onto a raw plan.

import { SetupError } from './worker.js'

// The report's phase vocabulary per timed region: preloaded times a query over
// preloaded data (no load); end_to_end times one full load->execute->extract.
const OFFICIAL_PHASES = {
  preloaded_repeated: ['execute', 'extract'],
  end_to_end: ['load', 'execute', 'extract'],
}

export const OFFICIAL_SCENARIOS = ['preloaded_repeated', 'end_to_end']

const ENUMS = {
  forkLevel: ['suite', 'trial', 'invocation'],
  trialSetup: ['prepare-lazy', 'none'],
  invocationSetup: ['reset', 'none'],
  sink: ['csv', 'table'],
  verification: ['in-run-csv', 'post-loop-count', 'post-loop-extract'],
  warmup: ['iterations', 'zero'],
}

// The two timed regions the known rows need: a query-only round-trip, or a
// load+query round-trip. Compared structurally (order matters).
const TIMED_REGIONS = [['run'], ['prepare', 'run']]

// Resolve an official (scenario × lifecycle mode) to its binding: the scenario
// name, the schema-pinned phases stamp, and the closed plan. Returns null for
// an unknown scenario so callers can reject it with the valid names. The plan is
// mode-independent except for end_to_end, whose dataset-coldness is achieved by
// a fresh worker per sample (spawn/cli) or an untimed reset per sample (connect).
export function bindingFor(scenario, mode) {
  if (scenario === 'preloaded_repeated') {
    return {
      scenario,
      phases: OFFICIAL_PHASES.preloaded_repeated,
      plan: {
        forkLevel: 'suite',
        trialSetup: 'prepare-lazy',
        invocationSetup: 'none',
        timedRegion: ['run'],
        sink: 'csv',
        verification: 'in-run-csv',
        warmup: 'iterations',
      },
    }
  }
  if (scenario === 'end_to_end') {
    const connect = mode === 'connect'
    return {
      scenario,
      phases: OFFICIAL_PHASES.end_to_end,
      plan: {
        forkLevel: connect ? 'suite' : 'invocation',
        trialSetup: 'none',
        invocationSetup: connect ? 'reset' : 'none',
        timedRegion: ['prepare', 'run'],
        sink: 'csv',
        verification: 'in-run-csv',
        warmup: 'zero',
      },
    }
  }
  return null
}

function isTimedRegion(region) {
  return (
    Array.isArray(region) &&
    TIMED_REGIONS.some((r) => r.length === region.length && r.every((cmd, i) => cmd === region[i]))
  )
}

// Reject, as a loud setup failure before any case runs, a plan that is malformed
// or whose sink/verification combination is unsound. The soundness rule is the
// anti-laziness guard: post-loop-count trusts an engine-reported count(*), which
// is only meaningful when the timed region has already materialized the result
// in-engine (a table sink) — counting a streamed-away csv sink would report on
// nothing. Symmetrically in-run-csv needs the run to have written the csv it
// counts. Both verbs that read a materialized table require a table sink.
export function validatePlan(plan) {
  if (plan == null || typeof plan !== 'object') {
    throw new SetupError('measurement plan must be an object')
  }
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(plan[field])) {
      throw new SetupError(
        `measurement plan.${field} is "${plan[field]}"; valid values: ${allowed.join(', ')}`,
      )
    }
  }
  if (!isTimedRegion(plan.timedRegion)) {
    throw new SetupError(
      `measurement plan.timedRegion is invalid; valid regions: ${TIMED_REGIONS.map((r) => `[${r}]`).join(', ')}`,
    )
  }
  const wantsCsv = plan.verification === 'in-run-csv'
  if (wantsCsv && plan.sink !== 'csv') {
    throw new SetupError('measurement plan: in-run-csv verification requires a csv sink')
  }
  if (!wantsCsv && plan.sink !== 'table') {
    throw new SetupError(
      `measurement plan: ${plan.verification} verification requires a materializing table sink`,
    )
  }
  // A post-loop verb reads the sink AFTER the sample loop, so the worker (and its
  // materialized sink) must survive the loop. Invocation fork shuts a fresh
  // worker down after every sample, leaving nothing to count/extract — reject it
  // here rather than fail obscurely at row-count time.
  if (!wantsCsv && plan.forkLevel === 'invocation') {
    throw new SetupError(
      `measurement plan: ${plan.verification} verification is unreachable under invocation fork (no worker survives the sample loop)`,
    )
  }
  return plan
}

// The plan's warmup policy against the benchmark's configured warmup count.
export function warmupCount(policy, configured) {
  return policy === 'iterations' ? configured : 0
}
