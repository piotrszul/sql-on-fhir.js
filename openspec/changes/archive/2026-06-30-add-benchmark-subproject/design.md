## Context

The repository pairs a reference engine (`sof-js`) with a language-neutral
conformance suite (`tests/`) and a report site. There is no performance artifact.
This change adds a `benchmark/` subproject — the performance analog of `tests/` —
under the same constitution (Principle II language-neutral, IV stable public
contracts, III test-first, V verified-green). The detailed rationale, including an
empirical Synthea study, is in
`docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`.

## Goals / Non-Goals

**Goals**
- A declarative, implementation-agnostic benchmark artifact any engine can consume.
- Reproducible data via generation; a reference materializer and runner in JS.
- Let implementers measure and track their own performance against a fixed workload.

**Non-Goals (deferred)**
- Cross-implementation comparison and a standardized measurement environment.
- Referenced shared-catalog datasets; `kind: qr`; `kind: download`.
- Referentially-consistent multi-resource (join) workloads; result-content checksums.
- Any runner/timing/engine code inside the `benchmark/` artifact.

## Decisions

- **Declarative recipe, WHAT vs HOW (Principle II).** A dataset is described by a
  declarative recipe (`kind`, pinned `version`, `params`) — never an embedded
  shell/JS call. Environment-specific facts (jar path, `java`) live only in
  tool-side config. The `kind` enum is the extension point.
- **Inline-first, self-contained files.** Data cannot be inlined, so a benchmark
  file is a recipe-bearing spec: view + dataset recipe + expectations in one file,
  mirroring `tests/*.json`. Referenced datasets are a future escape hatch.
- **Size is a benchmark parameter, not a separate benchmark.** Named tiers
  (`s`/`m`/…) with a `defaultSize`; `expectCount` keyed by tier; size is a result
  dimension so runtime-vs-size scaling curves are possible. Tier labels are shared
  across a group; concrete population is per-dataset.
- **Single resource by measurement setup, not by syntax.** The benchmark times one
  ViewDefinition over one materialized resource type as a reverse-ETL. Views may
  use any FHIRPath, including `getResourceKey()` and `getReferenceKey()`; a
  reference function over a non-materialized sibling yields null and does not
  change the row count. The only validated view invariant is
  `view.resource ∈ dataset.resources`.
- **Scaling is honest.** Down = smaller population or shuffle-sample; up = larger
  population or (future) download. Naive replication is rejected (frozen NDV can
  flatter dictionary/compression/value-cache engines unpredictably).
- **Generate-then-prune + 10k demographic ceiling.** Synthea has no per-resource
  export filter, so the materializer generates the full population and prunes to
  the recipe's `resources`. Demographic (Patient-rooted) datasets are capped at
  10k patients in v1; larger sizes await `kind: download`.
- **Content-hashed layout + manifest.** `data/<name>_<hash>/<size>/<Type>.ndjson`
  + `manifest.json`. `<hash>` is a key-order-independent content hash of the
  recipe; identical recipes dedupe; sizes coexist. Materialization is idempotent.
- **Reference runner lives in `sof-js`, not the artifact.** Because timing requires
  an engine, the reference runner is an implementation, mirroring how `sof-js`
  hosts the reference test-runner. Every other implementation brings its own.
- **Row-count correctness guard, analytically cross-checked.** `expectCount` per
  (case, size), blessed via `sof-js --record`. Because v1 views are single-resource
  flatten, counts are derivable (no `forEach`/`where` ⇒ resource count; `forEach`
  ⇒ sum of collection sizes; `where` ⇒ filtered count), so each blessed value is
  cross-checked, not self-blessed. Content checksums are deferred.

## Contracts / External Interfaces

### `benchmark.schema.json` (public contract)
Inline benchmark file: `title`, `fhirVersion` (v1 fixed `4.0.1`), optional `group`
and `iterations`, a `dataset` (name/kind/version/resources/params/sizes/defaultSize),
and `cases` (each with a `view` ViewDefinition and optional per-size `expectCount`).

### `benchmark-report.schema.json` (public contract)
`implementation`, optional `benchmarkVersion`/`environment`, a `measurement`
descriptor (`phases` ⊆ load/execute/extract, `sink`, `warmup`, `iterations`), and
`results` keyed by benchmark title → `{ size, fhirVersion, cases[] }` with per-case
`status` (`ok`/`count_mismatch`/`generation_error`/`execution_error`),
`inputRows`/`outputRows`, `samplesMs`, `stats`, optional `phaseSamplesMs`.

### Materialization tool (`benchmark/tools/`)
- `layout.js`: `recipeHash`, `recipeOf` (strips `name`/`sizes`/`defaultSize`),
  `datasetKey`, `datasetDir`, `resourceFile`, `manifestFile`.
- `materialize.js`: `materialize({ dataset, size, dataRoot, executor, force })` →
  manifest; generate-then-prune, idempotent, content-dedup.
- `executors/synthea.js`: `makeSyntheaExecutor(config)`, `loadConfig()`.
- `cli.js`: `run({ target, size, group, force, dir, dataRoot, registry })`;
  `bun run data <file|--group> --size <tier>`.
- `validate-benchmarks.js`: `validateSchema`, `validateBenchmark`, `validateGroup`,
  `main` (chained as `bench:validate`).

### Reference runner (`sof-js/src/`)
- `benchmark.js`: `loadResources`, `timeEvaluate` (times only `evaluate`,
  warmup discarded), `statsOf`.
- `benchmark-run.js`: `buildReport`, `bless`; CLI
  `bun run bench:run -- <file> --size <tier> [--record]`. Shares `recipeOf` with
  the materializer via `layout.js`.

## Risks / Trade-offs

- **`recipeOf` coupling.** The runner and materializer must derive the identical
  recipe or the runner reads the wrong directory. Mitigated by exporting a single
  `recipeOf` from `layout.js` (no duplicated copies).
- **Synthea cross-environment determinism (assumed).** Committed `expectCount`
  assumes a fixed-seed recipe yields identical counts across OS/JVM. Assumed for
  v1; must be verified across environments (see Open Questions). `expectCount` is
  implicitly keyed by the pinned generator `version` — a bump requires a re-bless.
- **Pipeline coupling.** Root `test` chains `sof-js` then `bench:test` with `&&`;
  pre-existing `sof-js` conformance failures (unrelated to this change) can
  short-circuit it. Tracked separately from this feature.

## Migration Plan

Additive. The benchmark subproject is new; nothing existing changes behavior. The
engine gains no new runtime dependency. `benchmark/data/` and the local executor
config are gitignored.

## Open Questions

- Verify Synthea cross-environment determinism; fall back to a manifest-relative
  count check if it does not hold.
- When to introduce `kind: download` (unblocks demographic sizes above 10k) and a
  published-dataset host.
- Whether to decouple `bench:test` from `sof-js`'s suite so benchmark verification
  is never masked by unrelated pre-existing failures.
