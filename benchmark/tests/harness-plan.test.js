import { test, expect } from 'bun:test'
import { bindingFor, validatePlan, OFFICIAL_SCENARIOS, warmupCount } from '../tools/harness/plan.js'
import { SetupError } from '../tools/harness/worker.js'

// The decomposition table from design.md is the contract these bindings encode:
// each official (scenario × lifecycle mode) resolves to exactly one closed plan.

test('preloaded_repeated binds to a suite-fork, lazy-prepare, in-run-csv plan', () => {
  const b = bindingFor('preloaded_repeated', 'spawn')
  expect(b.scenario).toBe('preloaded_repeated')
  expect(b.phases).toEqual(['execute', 'extract'])
  expect(b.plan).toEqual({
    forkLevel: 'suite',
    trialSetup: 'prepare-lazy',
    invocationSetup: 'none',
    timedRegion: ['run'],
    sink: 'csv',
    verification: 'in-run-csv',
    warmup: 'iterations',
  })
})

test('preloaded_repeated binds identically in connect mode (mode-independent)', () => {
  expect(bindingFor('preloaded_repeated', 'connect').plan).toEqual(
    bindingFor('preloaded_repeated', 'spawn').plan,
  )
})

test('end_to_end (spawn/cli) binds to an invocation-fork, prepare+run, zero-warmup plan', () => {
  for (const mode of ['spawn', 'cli']) {
    const b = bindingFor('end_to_end', mode)
    expect(b.scenario).toBe('end_to_end')
    expect(b.phases).toEqual(['load', 'execute', 'extract'])
    expect(b.plan).toEqual({
      forkLevel: 'invocation',
      trialSetup: 'none',
      invocationSetup: 'none',
      timedRegion: ['prepare', 'run'],
      sink: 'csv',
      verification: 'in-run-csv',
      warmup: 'zero',
    })
  }
})

test('end_to_end (connect) binds to a suite-fork, reset-per-invocation plan', () => {
  const b = bindingFor('end_to_end', 'connect')
  expect(b.plan).toEqual({
    forkLevel: 'suite',
    trialSetup: 'none',
    invocationSetup: 'reset',
    timedRegion: ['prepare', 'run'],
    sink: 'csv',
    verification: 'in-run-csv',
    warmup: 'zero',
  })
})

test('an unknown scenario has no binding', () => {
  expect(bindingFor('end-to-end', 'spawn')).toBeNull()
  expect(OFFICIAL_SCENARIOS).toEqual(['preloaded_repeated', 'end_to_end'])
})

// Every official binding's plan is itself valid.
test('official binding plans all pass validation', () => {
  for (const scenario of OFFICIAL_SCENARIOS) {
    for (const mode of ['spawn', 'connect', 'cli']) {
      expect(() => validatePlan(bindingFor(scenario, mode).plan)).not.toThrow()
    }
  }
})

// The internal warm-table-sink cell — the combination no official binding reaches.
test('the internal warm-table-sink plan is valid', () => {
  expect(() =>
    validatePlan({
      forkLevel: 'trial',
      trialSetup: 'prepare-lazy',
      invocationSetup: 'none',
      timedRegion: ['run'],
      sink: 'table',
      verification: 'post-loop-count',
      warmup: 'iterations',
    }),
  ).not.toThrow()
})

test('post-loop-extract with a table sink is valid', () => {
  expect(() =>
    validatePlan({
      forkLevel: 'trial',
      trialSetup: 'prepare-lazy',
      invocationSetup: 'none',
      timedRegion: ['run'],
      sink: 'table',
      verification: 'post-loop-extract',
      warmup: 'iterations',
    }),
  ).not.toThrow()
})

// -- validation: malformed plans are loud setup failures --

test('a plan with an unknown enum value is rejected as a SetupError', () => {
  const base = bindingFor('preloaded_repeated', 'spawn').plan
  expect(() => validatePlan({ ...base, forkLevel: 'process' })).toThrow(SetupError)
  expect(() => validatePlan({ ...base, verification: 'guess' })).toThrow(SetupError)
  expect(() => validatePlan({ ...base, timedRegion: ['run', 'run'] })).toThrow(SetupError)
})

test('a plan missing a required field is rejected as a SetupError', () => {
  const { sink, ...missingSink } = bindingFor('preloaded_repeated', 'spawn').plan
  expect(() => validatePlan(missingSink)).toThrow(SetupError)
})

// -- validation: the anti-laziness soundness guard --

test('post-loop-count with a non-materializing (csv) sink is rejected', () => {
  expect(() =>
    validatePlan({
      forkLevel: 'trial',
      trialSetup: 'prepare-lazy',
      invocationSetup: 'none',
      timedRegion: ['run'],
      sink: 'csv',
      verification: 'post-loop-count',
      warmup: 'iterations',
    }),
  ).toThrow(SetupError)
})

test('in-run-csv verification requires a csv sink', () => {
  const base = bindingFor('preloaded_repeated', 'spawn').plan
  expect(() => validatePlan({ ...base, sink: 'table' })).toThrow(SetupError)
})

test('invocation fork with a post-loop verb is rejected (no worker survives the sample loop)', () => {
  // A fresh worker per sample is shut down after each sample, so there is no
  // materialized sink left for an untimed post-loop count/extract to read.
  for (const verification of ['post-loop-count', 'post-loop-extract']) {
    expect(() =>
      validatePlan({
        forkLevel: 'invocation',
        trialSetup: 'none',
        invocationSetup: 'none',
        timedRegion: ['run'],
        sink: 'table',
        verification,
        warmup: 'zero',
      }),
    ).toThrow(SetupError)
  }
  // the official invocation plan (in-run-csv) stays valid
  expect(() => validatePlan(bindingFor('end_to_end', 'spawn').plan)).not.toThrow()
})

// warmupCount maps the plan's warmup policy onto the benchmark's configured count.
test('warmupCount honours the plan policy', () => {
  expect(warmupCount('iterations', 3)).toBe(3)
  expect(warmupCount('zero', 3)).toBe(0)
})
