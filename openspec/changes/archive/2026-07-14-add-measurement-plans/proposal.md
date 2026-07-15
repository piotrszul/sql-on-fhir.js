# Proposal: add-measurement-plans

## Why

The benchmark exists to compare implementations, but its assets (datasets,
checkfiles, stats, JMH export) and its harness are also the natural base for
**internal performance tuning** — the first concrete case being the retirement
of the standalone `dev/sof-benchmark` rig, which A/B-compares flatquack
versions × DuckDB CLI versions on a well-warmed engine with the result-CSV
serialization excluded from the timed region. Today that measurement is
inexpressible: `runner.js` hand-writes one closure per (scenario × lifecycle
mode), bundling the axes that vary — worker fork level, what setup is untimed,
what the clock wraps, when verification happens, whether warmup applies. The
internal cell needs the missing combination (fork-per-case, warmups discarded,
load inside the clock, verification after the loop), and no configuration of
the existing closures reaches it. Rather than grow the public scenario
vocabulary for a single consumer (comparability semantics should not move for
intra-stack tuning), the measurement loop itself should become a generic,
JMH-like plan executor that the official scenarios are named bindings of —
and this exercise validates that reuse story against a real internal
benchmark, staging-hooks style.

## What Changes

- **Refactor the measurement loop into a plan-driven core.** Extract from
  `benchmark/tools/harness/runner.js` a generic single-shot executor over a
  declarative `MeasurementPlan` — fork level (suite | trial | invocation),
  untimed trial setup, untimed per-invocation setup, timed region,
  untimed trial teardown, warmup policy, verification point. The existing
  scenarios (`preloaded_repeated`; `end_to_end` in spawn, connect, and CLI
  modes) are re-expressed as plan bindings with **zero observable change**:
  existing contract tests, schemas, and report output are untouched and are
  the regression net. The plan vocabulary is closed (derived from the known
  rows), not a plugin system.
- **Add the plan capabilities the internal cell needs**, exercised only via
  plans (not reachable from any official scenario): fork-per-trial, in-engine
  `table` sink during timed samples with post-loop untimed verification, and
  warmup on a plan that times load. Verification is a plan choice between two
  staging-scoped hook verbs: `count` (engine-reported `count(*)` on the
  materialized sink — sound here because the table sink already forces full
  materialization inside the timed region; the record stamps the provenance)
  and `extract` (untimed CSV handover the harness counts itself; kept for
  diffing/debugging). The internal cell defaults to `count`, matching the
  retired rig and avoiding untimed multi-GB CSV writes at large sizes.
- **Honesty guard (profile form):** a report never claims semantics it does
  not have. The official scenario stamp is *derived* from a scenario binding
  and is never settable on a raw plan; a directly-constructed plan emits a
  **lossless report-shaped record** that self-describes its actual measurement
  (plan descriptor: fork level, timed region, sink, warmup, verification
  point) under a clearly non-official scenario string (e.g.
  `internal:warm-table-sink`), plus the JMH export. Such a record is
  deliberately non-conforming: the published report schema's closed scenario
  enum makes every existing consumer reject it (fail-closed, zero contract
  changes). This mirrors how benchmark case views are base ViewDefinitions
  constrained by the ShareableViewDefinition profile: base format = truthful
  lossless data; official comparability = added constraints.
- **Add the staging internal benchmark** under `benchmark/staging-hooks/`-style
  scaffolding (per its README rules): a flatquack DuckDB-session hook (spawn
  mode; holds one `duckdb-<version>` CLI child per case; compiles the
  ViewDefinition via flatquack once, memoized/untimed; timed samples
  `CREATE OR REPLACE TEMP TABLE _sink AS …` so load+execute are measured and
  CSV extract is not), plus a driver invocation comparing at least two
  implementation identities (e.g. two DuckDB versions or two flatquack refs)
  on an existing benchmark at sizes `s`/`m`, with checkfile row counts
  verified via the post-loop extraction.
- **Record every friction point** in the staging directory's `FINDINGS.md`
  using the established taxonomy; any contract/harness/doc fix a finding
  forces is implemented in this change, test-first, with a delta spec.
- The hook and driver **migrate to flatquack's repository** once the harness
  adjustments settle (same exit criterion as the validation-cycle changes);
  `dev/sof-benchmark` retires after migration. A possible **later**,
  findings-informed contract change — explicitly out of scope here — would
  formalize the base-format-vs-comparability-profile split in
  `benchmark-report-format` (widened/open `scenario` plus a recorded plan
  descriptor and a conformance marker, with official tooling requiring the
  profile); that change would subsume promoting the internal measurement to
  an official scenario and graduating the post-loop verification verbs
  (`count`/`extract`) into `benchmark-hook-format` — `count` only with its
  anti-laziness analysis made explicit.

Also out of scope: a first-class compile step with `GENERATION_ERROR` status,
a download/extract dataset kind for `qr_*` datasets, manifest
parameterization for version-matrix sweeps.

## Capabilities

### New Capabilities

None planned: the plan vocabulary stays internal harness architecture until
the internal benchmark's migration shows which parts are load-bearing for
external reuse.

### Modified Capabilities

- `benchmark-harness`: scenario execution is re-expressed through measurement
  plans (analogous to the existing connector-SPI requirement for transports);
  observable scenario semantics are unchanged, and the delta records the
  plan-binding invariant plus the honesty guard (custom plans cannot claim an
  official scenario in a conforming report).

Findings may add further deltas (most plausibly `benchmark-hook-format` if the
`extract` verb proves general); if the pass forces none, that outcome is
recorded in FINDINGS.md.

## Impact

- `benchmark/tools/harness/runner.js` (decomposed), new plan/executor
  module(s) under `benchmark/tools/harness/`; `worker.js`/connector routing
  for the staging `extract` verb.
- `benchmark/tests/` — refactor safety net (existing tests must stay green
  unmodified) plus new plan-executor and extraction tests, test-first.
- `benchmark/staging-hooks/<target>/` — temporary scaffolding: hook source,
  session driver, `hook.json`, `FINDINGS.md` (deleted at migration).
- No changes planned to `benchmark-hook.schema.json`,
  `benchmark-report.schema.json`, benchmark files, or checkfiles; any
  findings-forced schema change follows Principle IV (additive, called out).
- Downstream: enables retiring `dev/sof-benchmark`; JMH export and
  materialization are consumed as-is (their reusability is part of what this
  exercise validates).

Workflow: implemented on `feat/add-measurement-plans` off
`origin/staging/benchmark`, following the validation-cycle procedure
(explore → artifacts → apply with findings → verify → simplify/code-review →
in-PR archive → PR against `staging/benchmark`).
