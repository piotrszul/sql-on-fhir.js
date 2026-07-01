All tasks below are IMPLEMENTATION-PHASE work (this change authored the specs
only). Per Constitution III (test-first, NON-NEGOTIABLE), every behavioral change
is preceded by a failing test that is observed red for the right reason before
any implementation code is written. Sections are ordered so each red step
precedes its green step.

## 0. Gate A — design sign-off (blocks all below)

- [x] 0.1 Gate A RESOLVED: checkfile location `benchmark/<name>.check.json`,
  `environment` shape, per-scenario `sink` values, and per-scenario warmup
  semantics ACCEPTED as proposed; sample minimum `>= 7` ACCEPTED as ADVISORY (not
  a schema `minItems` floor); cases carry a stable `id` and both checkfile
  `assertions` and report results key on `id` (not title);
  `implementation.variant` is a free string
- [ ] 0.2 Human approves the one-time re-bless under `TZ=UTC` (counts will move
  off the Wave 0 AEST values and relocate into the checkfile)

## 1. Schemas (public contracts) — TDD

- [x] 1.1 (RED) Write failing schema-validation tests: a benchmark file with
  inline `expectCount` is REJECTED; a case without a stable `id` is REJECTED; a
  benchmark file with an explicit dataset `version`, cases each carrying an `id`,
  and no `expectCount` is ACCEPTED
- [x] 1.2 (RED) Write failing schema-validation tests for
  `benchmark-report.schema.json`: a report with the structured `implementation`
  (required `engine`, optional `binding`/`variant`) is ACCEPTED; one with the old
  flat `{ name, version }` is REJECTED; `measurement.scenario` outside
  `{ end_to_end, preloaded_repeated }` is REJECTED; a free-form `stats` missing
  the defined fields is REJECTED (the `>= 7` sample minimum is ADVISORY prose, NOT
  a schema `minItems` floor, so a low sample count is NOT schema-rejected)
- [x] 1.3 (RED) Write failing schema-validation tests for the NEW
  `benchmark-checkfile.schema.json`: a well-formed checkfile (dataset identity,
  `syntheaVersion`, per-size `resourceCounts`, per-file `sha256`, `assertions`) is
  ACCEPTED; missing required fields and unknown top-level properties are REJECTED
- [x] 1.4 (RED) Confirm 1.1–1.3 fail for the right reason (schemas not yet
  updated / checkfile schema absent) — the mandatory red step
- [x] 1.5 (GREEN) Update `benchmark/benchmark.schema.json`: remove `expectCount`
  from cases; add a required stable case `id`; keep dataset `version` required;
  keep `additionalProperties: false`
- [x] 1.6 (GREEN) Restructure `implementation`, add `measurement.scenario`,
  replace `stats` with the defined shape, add benchmark + dataset provenance,
  dataset resource counts, and a required per-case `id` in
  `benchmark/benchmark-report.schema.json`; do NOT add a `minItems` floor on
  `samplesMs` (the `>= 7` minimum is advisory)
- [x] 1.7 (GREEN) Author the NEW `benchmark/benchmark-checkfile.schema.json`
  public contract per `benchmark-checkfile-format`
- [x] 1.8 (GREEN) Confirm 1.1–1.3 now pass

## 2. Suite-format invariant validator — TDD

- [x] 2.1 (RED) Write failing tests: the invariant validator flags a case that
  carries `expectCount`; the `defaultSize`/`group` size-tier checks still hold;
  the former `expectCount`-key-versus-size check is gone from the suite validator
- [x] 2.2 (RED) Confirm the tests fail for the right reason
- [x] 2.3 (GREEN) Update the benchmark invariant validator accordingly; confirm
  the tests pass

## 3. Executor TZ=UTC pinning — TDD

- [x] 3.1 (RED) Write a failing unit test for the Synthea executor (stub/spy the
  spawn, do NOT run Java) asserting `TZ=UTC` is set in the child process
  environment, alongside the existing `-e`/`-r`/`-s`/`-cs`/`--generate.thread_count=1`
  and recipe-sourced export toggles
- [x] 3.2 (RED) Confirm it fails for the right reason (`TZ` not set)
- [x] 3.3 (GREEN) In `benchmark/tools/executors/synthea.js`, set `TZ=UTC` in the
  executor's process environment; confirm the test passes

## 4. Materializer identity-keyed layout (no hash) — TDD

- [ ] 4.1 (RED) Write failing tests: the materializer writes
  `data/<name>/<version>/<size>/` and derives NO content hash; the JS-only
  recipe canonicaliser / `.slice(0, 8)` / array-order hash path is removed (assert
  it is no longer called)
- [ ] 4.2 (RED) Confirm the tests fail for the right reason (still hash-keyed)
- [ ] 4.3 (GREEN) Rework the materializer to key by `name`/`version`; delete the
  content-hash canonicaliser (kills F1/F6); update `manifest.json` writing;
  confirm the tests pass
- [ ] 4.4 (RED→GREEN) Byte-identity test: materializing under two simulated
  timezones yields identical per-file sha256 (relies on §3)

## 5. Checkfile writer + reader — TDD

- [ ] 5.1 (RED) Write failing tests for the checkfile WRITER (bless step):
  writing a checkfile produces dataset identity, `syntheaVersion`, per-size
  `resourceCounts`, per-file `sha256`, and per-case per-size `assertions`; the
  blessed assertion equals the analytic derivation (no `forEach`/`where` ⇒ input
  resource count; `forEach` ⇒ total collection-entry count; `where` ⇒ filtered
  count)
- [ ] 5.2 (RED) Write failing tests for the checkfile READER used by the runner:
  it reads assertions by case `id` + size; strict mode compares per-file sha256
  to the checkfile and surfaces drift
- [ ] 5.3 (RED) Confirm 5.1–5.2 fail for the right reason (no writer/reader yet)
- [ ] 5.4 (GREEN) Implement the checkfile writer in the benchmark build (bless
  path) and the reader in the runner; confirm the tests pass

## 6. Runner relocation from hash to name+version — TDD

- [ ] 6.1 (RED) Write failing tests: the runner resolves
  `data/<name>/<version>/<size>/` from the dataset `name`/`version` with NO hash
  derivation; it reads expected counts from the CHECKFILE (not inline
  `expectCount`); a `where`/`forEach`-labelled variance-permitted case is NOT
  auto-flagged `count_mismatch`; `--record` WRITES the checkfile and does not edit
  the benchmark file
- [ ] 6.2 (RED) Confirm the tests fail for the right reason (still hash/inline)
- [ ] 6.3 (GREEN) Rewrite the runner's data resolution and guard to use identity +
  checkfile; wire bless mode to the checkfile writer; confirm the tests pass

## 7. Report emission (implementation identity, scenario, stats, provenance) — TDD

- [ ] 7.1 (RED) Write failing tests: the reference runner emits a report with the
  structured `implementation` (engine required), a `measurement.scenario`, the
  a per-case `id`, the defined `stats` shape computed from `samplesMs` (advisory
  `>= 7`), correct `inputRows` (count of the case's `view.resource` type), and
  benchmark + dataset
  provenance and resource counts
- [ ] 7.2 (RED) Confirm the tests fail for the right reason
- [ ] 7.3 (GREEN) Update the runner's report emission; confirm the tests pass and
  the emitted report validates against the updated report schema

## 8. Move expectCount out of the benchmark file (data migration)

- [ ] 8.1 In `benchmark/clinical-flat.json`: add a stable `id` to each case (e.g.
  `condition-flat`, `observation-components`) and remove the inline `expectCount`
  maps (which relocate to the checkfile in §9)
- [ ] 8.2 Confirm the stripped benchmark file validates against the updated
  `benchmark.schema.json`

## 9. One-time re-bless under TZ=UTC (implementation-phase, run once)

- [ ] 9.1 With a configured `tools/executors.config.json` (Synthea 3.2.0 jar),
  materialize `clinical-flat` at sizes `s` and `m` with `force` under the
  `TZ=UTC` executor, writing `data/synthea-clinical/<version>/<size>/`
- [ ] 9.2 Bless via the runner's `--record` path to WRITE
  `benchmark/clinical-flat.check.json` — recording per-size resource counts,
  per-file sha256, and the result assertions (do NOT hand-edit counts; do NOT
  reintroduce inline `expectCount`)
- [ ] 9.3 Record that the counts moved off the Wave 0 AEST values (condition-flat
  s=6406/m=48483, observation-components s=4366/m=39336) — the exact new UTC
  numbers are the output of this bless, captured in the checkfile
- [ ] 9.4 Re-run materialization to confirm byte identity: the per-file sha256 in
  the checkfile reproduce, and the manifest counts match the checkfile

## 10. Verify green before merge (Constitution V)

- [ ] 10.1 `bun test` — all pass
- [ ] 10.2 `bun run validate` — all `tests/*.json` valid against
  `tests.schema.json` (unaffected, must stay green)
- [ ] 10.3 `bun run check-fmt` — clean
- [ ] 10.4 `openspec validate benchmark-contract-v2 --strict` — valid
