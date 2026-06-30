## 1. Subproject scaffold & benchmark file schema

- [x] 1.1 Create `benchmark/` with `package.json` (Bun, ESM, `ajv`), `.gitignore` (`data/`, `tools/executors.config.json`)
- [x] 1.2 Author `benchmark.schema.json` (public contract: title/fhirVersion/group/iterations/dataset/cases) and a schema test (accept good, reject missing-required, reject unknown-property)
- [x] 1.3 Add root `bench:test` and `bench:validate` scripts

## 2. Cross-field invariant validator

- [x] 2.1 `tools/validate-benchmarks.js`: `validateBenchmark` (view.resource ∈ dataset.resources; expectCount keys are declared sizes; defaultSize is a declared size), `validateGroup` (shared size-tier names), `main`
- [x] 2.2 Tests for each invariant
- [x] 2.3 (Design change) Allow reference functions in views — single-resource is a measurement-setup property; remove the reference-function ban; test asserts `getResourceKey`/`getReferenceKey` are allowed
- [x] 2.4 (Fix) Scope schema validation to benchmark files — fold `validateSchema` into the JS validator so `bench:validate` only checks recognized benchmark files, not schema/package JSON

## 3. Report schema

- [x] 3.1 Author `benchmark-report.schema.json` (implementation/measurement/results; reverse-ETL phases; status taxonomy) and a validation test (accept good, reject invalid status)

## 4. Layout & recipe identity

- [x] 4.1 `tools/layout.js`: `recipeHash` (key-order-independent), `datasetKey`, `datasetDir`, `resourceFile`, `manifestFile`; tests for hash stability/sensitivity and path layout
- [x] 4.2 (Fix) Export a single shared `recipeOf` from `layout.js` so the materializer and runner cannot drift

## 5. Materialization orchestration

- [x] 5.1 `tools/materialize.js`: `materialize(...)` — generate via injected executor, prune to selected resources, write manifest with per-file counts, idempotent skip on matching manifest; tests with a fake executor (generate-then-prune + idempotency)

## 6. Synthea executor

- [x] 6.1 `tools/executors/synthea.js`: `makeSyntheaExecutor(config)` (build the `java -jar` command, throw on non-zero exit, lift `fhir/*.ndjson` to the output dir), `loadConfig()` (gitignored config, null when absent, guards malformed JSON); `executors.config.sample.json`
- [x] 6.2 Guarded integration test (skips unless a real jar is configured)

## 7. Materialization CLI

- [x] 7.1 `tools/cli.js`: `run(...)` — resolve a benchmark file or `--group`, materialize each dataset via the executor registry; lazy `defaultRegistry()`; clear errors on no-match / unknown kind; `bun run data` entrypoint; tests with a fake registry

## 8. First benchmark file

- [x] 8.1 Author `clinical-flat.json` (Condition + Observation single-resource flatten views, sizes s/m, group, fhirVersion 4.0.1, iterations); validate against schema + invariants

## 9. Reference runner core (sof-js)

- [x] 9.1 `sof-js/src/benchmark.js`: `loadResources`, `timeEvaluate` (times only `evaluate`, warmup discarded, output row count from the result), `statsOf`; tests with a fixture NDJSON

## 10. Reference runner report/verify/bless (sof-js)

- [x] 10.1 `sof-js/src/benchmark-run.js`: `buildReport` (status ok/count_mismatch vs `expectCount`; conforms to report schema), `bless` (fills `expectCount[size]` immutably); shares `recipeOf` and `resourceFile` from `layout.js`; CLI `bench:run`; tests (ok, count_mismatch, bless)

## 11. Bless clinical-flat counts

- [x] 11.1 Materialize `clinical-flat.json` at sizes s and m (locally-configured Synthea jar)
- [x] 11.2 `--record` bless both sizes; analytically cross-check (condition flat = Condition count; observation components = total `component` entries); confirm a non-record run is all `ok`; commit only the blessed file (data/config gitignored)

## 12. Documentation

- [x] 12.1 `benchmark/README.md`: layout, materialization, the runner contract, recommended measurement, v1 scope

## 13. Pipeline wiring

- [x] 13.1 Extend root `validate` and `test` to include the benchmark subproject
- [x] 13.2 (Final-review fix) Extend root `check-fmt` to cover `benchmark/` (Principle V); tighten `sizes`/report inner-object schemas (`additionalProperties: false`)
