## Why

The repository validates SQL-on-FHIR implementations for *correctness* via the
shared `tests/` conformance suite, but offers nothing for *performance*.
Implementers have no shared, reproducible way to measure how fast their engine
executes representative ViewDefinitions over realistic FHIR data, to track that
over time, or (eventually) to compare implementations. This change introduces a
`benchmark/` subproject — the performance analog of `tests/` — that is
implementation-agnostic and inherits the project's constitution (language-neutral
artifacts, stable public contracts, test-first, verified-green).

The full design rationale lives in
`docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`; this proposal
distils it into OpenSpec form.

## What Changes

- A new top-level `benchmark/` subproject holding declarative, inline benchmark
  files: each pairs a Synthea **dataset recipe** with one or more ViewDefinition
  **cases** and per-size **expected row counts**, mirroring how a `tests/*.json`
  file groups one `resources` block with many `tests`.
- Two public-contract JSON Schemas: `benchmark.schema.json` (the benchmark file
  format) and `benchmark-report.schema.json` (the result report format).
- A cross-field invariant validator (`tools/validate-benchmarks.js`) chained
  into `bench:validate`, enforcing rules JSON Schema cannot express.
- A reference **data-materialization tool** (Bun/JS) that turns a declarative
  recipe into materialized NDJSON: a pluggable `kind → executor` registry (the
  `synthea` executor shells out to the Synthea jar), generate-then-prune, a
  content-hashed on-disk layout with a provenance manifest, idempotency, and
  content-deduplication. Environment specifics (jar path, `java`) live only in a
  gitignored tool-side config, never in the artifact.
- A reference **benchmark-runner** in `sof-js`: it loads the materialized NDJSON,
  times `evaluate()` as a reverse-ETL, verifies output row counts against the
  blessed `expectCount`, and emits a conforming report. A `--record` bless mode
  populates `expectCount`.
- A first benchmark file, `clinical-flat.json` (Condition + Observation
  single-resource flatten views), with expected counts blessed and analytically
  cross-checked at sizes `s` (100 patients) and `m` (1000 patients).
- Pipeline wiring: root `test`, `validate`, and `check-fmt` extended to cover the
  benchmark subproject.

This change ships **no** benchmark runner/timing/engine code inside the
`benchmark/` artifact itself; the only reference runner is an `sof-js`
implementation. Referenced (shared-catalog) datasets, QR/download `kind`s,
referentially-consistent multi-resource datasets, and result-content checksums
are explicitly deferred as future extensions.

## Capabilities

### New Capabilities

- `benchmark-suite-format`: the inline benchmark file format — a declarative
  dataset recipe plus ViewDefinition cases and per-size expected row counts —
  its `benchmark.schema.json` public contract, and the cross-field invariants
  (`view.resource` membership, the single-resource-by-measurement-setup rule,
  size/expectCount/defaultSize/group consistency, fixed FHIR version).
- `benchmark-dataset-materialization`: declarative dataset recipes and the
  reference materialization tool — the WHAT/HOW split, the content-hashed
  on-disk layout contract and provenance manifest, generate-then-prune,
  idempotency and content-dedup, the pluggable `kind → executor` registry, and
  size-as-parameter with the v1 demographic generation ceiling.
- `benchmark-report-format`: the `benchmark-report.schema.json` public contract —
  the reverse-ETL measurement model (load/execute/extract) and `measurement`
  descriptor, the status taxonomy, and size as a result dimension for scaling
  curves.
- `benchmark-reference-runner`: the `sof-js` reference benchmark-runner — single-
  view reverse-ETL timing, the row-count correctness guard, `--record` bless mode
  with analytic cross-check, recipe-identity agreement with the materializer, and
  the language-neutral runner contract any implementation follows.

### Modified Capabilities

<!-- None: openspec/specs/ has no prior coverage of benchmarking. -->

## Acceptance Criteria

- A well-formed benchmark file validates against `benchmark.schema.json`; a file
  missing a required field (e.g. `fhirVersion`) or carrying an unknown top-level
  property is rejected.
- The invariant validator rejects a case whose `view.resource` is not in its
  `dataset.resources`, an `expectCount` key that is not a declared size, a
  `defaultSize` that is not a declared size, and a `group` whose member files
  declare differing size-tier names; it **allows** views using `getResourceKey()`
  and `getReferenceKey()`.
- Materializing a recipe writes only the recipe's selected resources to
  `data/<name>_<hash>/<size>/<ResourceType>.ndjson` with a `manifest.json`
  recording per-file row counts; siblings are pruned; the recipe content hash is
  independent of JSON key order; a second materialization with a matching
  manifest skips regeneration.
- The `sof-js` runner's `recipeOf` derives the same recipe (and therefore the
  same on-disk directory) as the materializer's, so the runner reads the data the
  materializer wrote.
- For `clinical-flat.json`, the blessed `expectCount` equals the analytic
  derivation: the no-`forEach` Condition view = the Condition row count; the
  `forEach: component` Observation view = the total `component` entry count —
  confirmed at sizes `s` and `m`.
- A non-record runner pass over `clinical-flat.json` reports every case `ok`; a
  deliberately wrong `expectCount` yields `count_mismatch`.
- A report validates against `benchmark-report.schema.json`; an invalid `status`
  value is rejected.
- `bun run validate`, `bun run check-fmt`, and the benchmark Bun test suite are
  green, and `check-fmt`/`validate` cover the `benchmark/` subproject.

## Impact

- New `benchmark/` subproject: `package.json`, `.gitignore`, `benchmark.schema.json`,
  `benchmark-report.schema.json`, `clinical-flat.json`, `README.md`, and
  `tools/` (`layout.js`, `materialize.js`, `cli.js`, `validate-benchmarks.js`,
  `executors/synthea.js`, `executors.config.sample.json`), plus a Bun test suite.
- `sof-js/src/benchmark.js` and `sof-js/src/benchmark-run.js` (reference runner)
  with tests and a fixture; consumes the existing `evaluate()` and
  `benchmark/tools/layout.js` (`recipeOf`, `resourceFile`).
- Root `package.json`: `bench:*` scripts; `test`, `validate`, `check-fmt`
  extended to include the benchmark subproject.
- Untracked at runtime: `benchmark/data/` and `benchmark/tools/executors.config.json`
  (both gitignored).
- No new runtime dependencies for the engine; the materializer uses `ajv`
  (already present) and shells out to a locally-provided Synthea jar + Java.

Out of scope (deferred): referenced shared-catalog datasets, `kind: qr` and
`kind: download`, referentially-consistent multi-resource datasets, result-content
checksums, and a standardized cross-implementation measurement environment.
