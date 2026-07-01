## Why

Contract v2 (`benchmark-contract-v2`, merged) hardened the benchmark contract:
authored-intent-only suite files, a build-time checkfile, structured
implementation identity, a defined measurement/statistics model, and report
provenance. While updating the Pathling (Java + Python) runner to that contract,
the Pathling implementer raised three pre-implementation refinements (issue #18,
under the #3 hardening story). All three are ACCEPTED. Because the project is
pre-production (no external consumers of these formats yet), they are encoded as
clean contract refinements with no back-compat shims or version signalling.

The three problems this change fixes:

- **`report.benchmark.{name,version}` has no authored source (#9, #18.1).**
  Contract v2 made the report carry `benchmark: {name, version}` as suite
  provenance, and `dataset: {name, version}` sourced from the authored
  `dataset.name`/`dataset.version`. But the authored benchmark file has NO suite
  identity — only `title`/`group`, and only the *dataset* carries a `version`.
  A runner that wants to populate `report.benchmark.version` therefore has to
  invent it from outside the contract (e.g. the pinned submodule tag/SHA, as the
  old scalar `benchmarkVersion` did). The report should be self-describing from
  its inputs.

- **Scenario is coupled to sink; the two scenarios' numbers are not directly
  comparable (#5, #18.2).** Contract v2 paired `end_to_end` → `sink: csv` and
  `preloaded_repeated` → `sink: table`/`memory`. A `table`/`memory` sink can be
  a result a query optimizer prunes or under-measures, and it measures extract
  cost on a different basis from `end_to_end`, so the two scenarios differ by
  MORE than whether load is timed. The distinction should be purely the load
  boundary.

- **The required `stats` set carries noisy percentiles (#5, #18.3).** Contract v2
  required `stats: {mean, min, max, stddev, p50, p95}` (+ optional `ci95`). At
  the small SingleShotTime sample counts these benchmarks use (advisory `>= 7`),
  `p50`/`p95` carry little signal and are noisy. The required set should be the
  stable summary; richer percentiles stay optional; the raw `samplesMs` stay
  required so any consumer can recompute whatever percentiles it wants.

## What Changes

This is ONE follow-up change refining the merged contract v2 across two
capabilities and one public schema. It ALSO re-keys `report.results` by the
stable suite `name` (decision #4 below).

### 1. Authored suite identity — `name` + `version` (#9, #18.1) — suite format + suite schema + report format

Add an authored suite identity to the SUITE format: a stable machine `name` and
an authored suite `version`, mirroring the existing `dataset.name`/
`dataset.version` and the case `id`/`title` split. `title` remains the free-text
human label; `name` is the stable machine id; `version` is the authored suite
revision (bumped deliberately when the suite changes). `report.benchmark.{name,
version}` SHALL source DIRECTLY from these authored fields — no more inventing it
from a pinned tag. The invariant validator SHALL require suite `name` and
`version`.

The new suite `name` is carried as provenance in `report.benchmark` AND is the
key of the `results` map (see decision #4).

### 2. Both scenarios use `sink: csv`; decouple sink from scenario (#5, #18.2) — report format

BOTH `end_to_end` and `preloaded_repeated` SHALL use (and the spec SHALL
recommend) `sink: csv` — a full materialization of the result to a written file —
so that (a) the timed region always includes a real materialization a query
optimizer cannot prune or under-measure, and (b) extract cost is measured on the
same basis across scenarios, keeping their numbers directly comparable. The
scenario distinction becomes PURELY whether the `load` phase is inside the timed
region: `end_to_end` times `load` + `execute` + `extract`; `preloaded_repeated`
excludes load and times `execute` + `extract`. The `sink` enum itself is
unchanged (`{table, csv, memory, other}`); the per-scenario expectation is spec
prose (a SHALL), not a schema change.

### 3. Reduce the required `stats` set (#5, #18.3) — report format + report schema

Change the REQUIRED `stats` set from `{mean, min, max, stddev, p50, p95}` to
`{mean, stddev, min, max, median}`. `median` REPLACES `p50` in the required set
(a clearer name for the required middle value). Richer percentiles (e.g. `p95`)
and `ci95` become OPTIONAL. Raw `samplesMs` stays REQUIRED, so any consumer
(including the #11 JMH export) can recompute whatever percentiles it wants. The
JMH projection updates accordingly: `scorePercentiles` derive from `median` plus
any optional percentiles plus `min`/`max`, and a consumer MAY recompute from
`samplesMs`.

### 4. Re-key `report.results` by the stable suite `name` — report format

Contract v2's report-structure requirement described `results` as "keyed by
benchmark title". With suite `name` now an authored stable identity (decision 1),
`report.results` SHALL instead be keyed by the suite `name` — the same stable id
`report.benchmark.name` sources from, and consistent with how a case is
referenced by its stable `id` (not `title`) and a dataset by `name`/`version`.
The `title` remains a free-text human label that MAY change freely; keying on it
made the map key mutable. The reference runner keys `results` by suite `name`.

## Capabilities

### Modified Capabilities

- `benchmark-suite-format`: the benchmark file gains an authored suite identity —
  a stable `name` and an authored `version` — alongside the existing `title` and
  `group`, mirroring `dataset.name`/`dataset.version`; the invariant validator
  requires both.
- `benchmark-report-format`: both measurement scenarios use `sink: csv` (scenario
  distinction is purely the load boundary), `report.benchmark.{name,version}` is
  sourced from the authored suite identity, and the required `stats` set becomes
  `{mean, stddev, min, max, median}` with richer percentiles / `ci95` optional
  and the JMH projection updated.

## Acceptance Criteria

- The benchmark file declares a stable suite `name` and an authored suite
  `version`; a file that omits either is rejected by the invariant validator, and
  the updated `benchmark.schema.json` requires both.
- `report.benchmark.{name,version}` is sourced directly from the authored suite
  `name`/`version`, not invented from a pinned tag.
- `report.results` is keyed by the stable suite `name` (not the mutable
  `title`), consistent with `report.benchmark.name`, the case `id`, and the
  dataset `name`/`version`; the reference runner emits it so.
- Both `end_to_end` and `preloaded_repeated` are described as (and recommended to)
  use `sink: csv`; the scenario distinction is purely whether `load` is inside the
  timed region. The `sink` enum is unchanged.
- A case's required `stats` shape is `{mean, stddev, min, max, median}`; `p95`
  and `ci95` are OPTIONAL; `samplesMs` stays REQUIRED. A report whose `stats`
  omits `median` (or another required field) is rejected; one that omits `p95` is
  accepted.
- No Synthea re-bless is needed: this change touches the contract/report shape
  only; the checkfile and the materialized data are untouched.
- `bun test`, `bun run validate`, `bun run check-fmt`, and
  `openspec validate benchmark-contract-v2-feedback --strict` are all green.

## Impact

- `benchmark/benchmark.schema.json`: dataset already has `name`/`version`; the
  top-level suite gains a required stable `name` and a required authored
  `version` (mirroring `dataset.name`/`dataset.version`) — implementation phase.
- `benchmark/benchmark-report.schema.json`: `stats` required set becomes
  `{mean, stddev, min, max, median}`; `p95` moves from required to optional;
  `ci95` stays optional; `samplesMs` stays required. The `sink` enum is
  UNCHANGED (the per-scenario `csv` guidance is spec prose, not schema) —
  implementation phase.
- The benchmark invariant validator: require suite `name` + `version` —
  implementation phase.
- The reference runner report emission: source `report.benchmark.{name,version}`
  from the authored suite fields; emit `median` in `stats`; default `sink: csv`
  for BOTH scenarios; key the `results` map by the suite `name` (not `title`) —
  implementation phase.
- `benchmark/clinical-flat.json`: add the authored suite `name` + `version` —
  implementation phase.

Out of scope: any change to the dataset, checkfile, or materialized bytes (no
re-bless); the JMH export itself (#11 — this only reshapes the stats it
consumes).
