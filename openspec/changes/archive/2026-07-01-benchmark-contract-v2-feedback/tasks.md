All tasks below are IMPLEMENTATION-PHASE work (this change authored the specs
only). Per Constitution III (test-first, NON-NEGOTIABLE), every behavioral change
is preceded by a failing test that is observed red for the right reason before
any implementation code is written. Sections are ordered so each red step
precedes its green step.

NO Synthea re-bless is needed. This change is contract/report-shape only: the
checkfile (`benchmark/clinical-flat.check.json`), the materialized data, and the
per-file sha256 checksums are UNTOUCHED. No count moves, no `--record` run.

## 0. Gate A — design sign-off (blocks all below)

- [x] 0.1 Human approves the three refinements as encoded: (1) authored suite
  `name` + `version` sourcing `report.benchmark.{name,version}` (with
  `report.results` keying explicitly out of scope); (2) both scenarios use
  `sink: csv`, scenario distinction is purely the load boundary; (3) required
  `stats` becomes `{mean, stddev, min, max, median}` with `p95`/`ci95` optional
  and `samplesMs` still required

## 1. Suite schema — authored suite identity (public contract) — TDD

- [x] 1.1 (RED) Write failing schema-validation tests for `benchmark.schema.json`:
  a benchmark file that omits the top-level suite `name` is REJECTED; one that
  omits the suite `version` is REJECTED; a file declaring both a stable suite
  `name` and an authored `version` (alongside `title`/`group`) is ACCEPTED
- [x] 1.2 (RED) Confirm 1.1 fails for the right reason (schema does not yet
  require suite `name`/`version`)
- [x] 1.3 (GREEN) Update `benchmark/benchmark.schema.json`: add a required
  top-level suite `name` and a required `version` (string), mirroring
  `dataset.name`/`dataset.version`; keep `additionalProperties: false`; confirm
  1.1 passes

## 2. Report schema — reduced stats set (public contract) — TDD

- [x] 2.1 (RED) Write failing schema-validation tests for
  `benchmark-report.schema.json`: a case whose `stats` carries
  `{mean, stddev, min, max, median}` is ACCEPTED; a `stats` that omits `median`
  (or another required field) is REJECTED; a `stats` that carries the required
  fields but omits `p95` and `ci95` is ACCEPTED (both OPTIONAL); a report that
  omits `samplesMs` is REJECTED (raw samples stay required); the advisory `>= 7`
  minimum is NOT enforced as a `minItems` floor (a low sample count is NOT
  schema-rejected)
- [x] 2.2 (RED) Confirm 2.1 fails for the right reason (schema still requires
  `p50`/`p95` and does not require `median`)
- [x] 2.3 (GREEN) Update `benchmark/benchmark-report.schema.json`: change the
  `stats` required set to `{mean, stddev, min, max, median}`; add `median` as a
  number property; move `p95` from required to an OPTIONAL property; keep `ci95`
  optional; keep `samplesMs` required with no `minItems` floor; keep the `sink`
  enum UNCHANGED (`{table, csv, memory, other}` — the per-scenario `csv` guidance
  is spec prose, not schema); confirm 2.1 passes

## 3. Suite-format invariant validator — TDD

- [x] 3.1 (RED) Write failing tests: the invariant validator flags a benchmark
  file that omits the suite `name` or the suite `version`; the existing checks
  (case resource membership, `defaultSize`/`group` size-tiers, `expectCount`
  rejection) still hold
- [x] 3.2 (RED) Confirm the tests fail for the right reason (validator does not
  yet require suite `name`/`version`)
- [x] 3.3 (GREEN) Update the benchmark invariant validator to require suite `name`
  and `version`; confirm the tests pass

## 4. Runner report emission — provenance, stats, sink — TDD

- [x] 4.1 (RED) Write failing tests: the reference runner emits
  `report.benchmark.name`/`report.benchmark.version` SOURCED from the authored
  suite `name`/`version` in the benchmark file (not from a pinned tag); the
  emitted `stats` carries `median` (and the required `{mean, stddev, min, max}`)
  computed from `samplesMs`; `measurement.sink` is `csv` for BOTH scenarios; the
  `results` map is keyed by the suite `name` (not the `title`)
- [x] 4.2 (RED) Confirm the tests fail for the right reason (runner still invents
  benchmark identity / emits `p50` / defaults a non-csv sink for
  `preloaded_repeated` / keys `results` by `title`)
- [x] 4.3 (GREEN) Update the runner's report emission: read suite `name`/`version`
  from the benchmark file into `report.benchmark`; compute and emit `median` in
  `stats`; default `sink: csv` for both `end_to_end` and `preloaded_repeated`;
  key the `results` map by the suite `name`; confirm the tests pass and the
  emitted report validates against the updated report schema

## 5. Add authored suite identity to the benchmark file (data migration)

- [x] 5.1 In `benchmark/clinical-flat.json`: add a top-level suite `name` (a
  stable machine id, e.g. `clinical-flat`) and an authored `version` (e.g. `"1"`),
  alongside the existing `title`/`group`
- [x] 5.2 Confirm the updated benchmark file validates against the updated
  `benchmark.schema.json` and passes the invariant validator

## 6. Confirm no re-bless is required

- [x] 6.1 Confirm the checkfile (`benchmark/clinical-flat.check.json`), the
  materialized data, and the per-file sha256 checksums are UNCHANGED by this
  change — it is contract/report shape only, so no `--record` run and no count
  movement occur

## 7. Verify green before merge (Constitution V)

- [x] 7.1 `bun test` — all pass
- [x] 7.2 `bun run validate` — all `tests/*.json` valid against `tests.schema.json`
  (unaffected, must stay green)
- [x] 7.3 `bun run check-fmt` — clean
- [x] 7.4 `openspec validate benchmark-contract-v2-feedback --strict` — valid
