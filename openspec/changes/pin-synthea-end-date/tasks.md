## 1. Pin the end date and moved toggles in the recipe (contract)

- [ ] 1.1 Add `endTime: 20250101` to `benchmark/clinical-flat.json` recipe
  `params` (see `design.md` Decision 2 for the value + rationale — pending human
  gate approval)
- [ ] 1.2 Add the moved export toggles to `params` at their current-behaviour
  values: `hospitalExport: false`, `practitionerExport: false`, `bulkData: true`
  (`yearsOfHistory: 1` already present); do NOT yet touch `expectCount`
- [ ] 1.3 Confirm `benchmark/benchmark.schema.json` accepts the new `params`
  fields (it is permissive on `params` today); adjust only if it would reject
  them, without weakening any check

## 2. Executor-invocation test (TDD — write FIRST, observe it FAIL)

- [ ] 2.1 Write a failing unit test for `makeSyntheaExecutor` that captures the
  Synthea argument list (stub/spy `spawnSync`, do NOT run Java) and asserts the
  args include `-e 20250101` (from `params.endTime`), `--generate.thread_count=1`,
  and `--exporter.hospital.fhir.export=false`,
  `--exporter.practitioner.fhir.export=false`, `--exporter.fhir.bulk_data=true`,
  `--exporter.years_of_history=1` sourced from `params` — with NO output-affecting
  flag hardcoded
- [ ] 2.2 Write a failing unit test asserting that a `synthea` recipe with
  `params.endTime` omitted is rejected by the benchmark invariant validator
- [ ] 2.3 Run the new tests with `bun test` and CONFIRM they fail for the right
  reason (missing `-e`, missing `--generate.thread_count=1`, toggles still
  hardcoded, validator not enforcing `endTime`) — not on import/syntax errors.
  This is the mandatory red step (Constitution Principle III)

## 3. Executor + validator implementation (make the tests pass)

- [ ] 3.1 In `benchmark/tools/executors/synthea.js`, add `-e String(p.endTime)`
  to the args alongside `-r`; do not fall back to a wall-clock default (a missing
  `endTime` should surface via the validator, per 3.3)
- [ ] 3.2 Add `--generate.thread_count=1` to the args
- [ ] 3.3 Replace the hardcoded `--exporter.hospital.fhir.export=false`,
  `--exporter.practitioner.fhir.export=false`, `--exporter.fhir.bulk_data=true`
  with values read from `params` (`hospitalExport`, `practitionerExport`,
  `bulkData`); keep `--exporter.fhir.export=true` as an executor invariant (mode
  selector, not a dataset dial — see `design.md` Decision 3)
- [ ] 3.4 Add the `synthea`-recipe `endTime`-required check to the benchmark
  invariant validator
- [ ] 3.5 Run `bun test` and CONFIRM the tests from section 2 now pass (green
  step)

## 4. Re-bless once against the pinned end date

- [ ] 4.1 With a configured `tools/executors.config.json` (Synthea 3.2.0 jar),
  materialize the recipe at sizes `s` and `m` with `force`, letting the new
  `endTime`-pinned executor run
- [ ] 4.2 Re-bless `expectCount` for every case at every size via the reference
  runner's bless path (do NOT hand-edit counts); record the new `m` counts
  (expected to move off 50090/106613; `s` expected unchanged but verify)
- [ ] 4.3 Confirm the content hash / `data/<name>_<hash>/` directory changed
  because `params` changed, and the new `manifest.json` counts match the
  re-blessed `expectCount`
- [ ] 4.4 Add/confirm a determinism check: materializing twice (or simulating
  two wall-clock dates by fixing the clock) yields identical manifest counts

## 5. Verify green before merge

- [ ] 5.1 Run `bun test` — all pass
- [ ] 5.2 Run `bun run validate` — all `tests/*.json` valid against
  `tests.schema.json` (unaffected, but must stay green)
- [ ] 5.3 Run `bun run check-fmt` — clean
- [ ] 5.4 Run `openspec validate pin-synthea-end-date --strict` — valid
