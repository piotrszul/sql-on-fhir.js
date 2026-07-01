## Why

Wave 0 pinned the Synthea end date and moved the output-affecting toggles into
the recipe, so `recipe + generator version` now reproduces the same per-resource
row *counts* across environments. Wave 1 hardens the rest of the benchmark
*contract* around that foundation, closing a cluster of related defects (issues
#5, #6, #7, #9, #12) in one coherent restructure. Because the project is
pre-production (Constitution IV notwithstanding, there are no external consumers
of these formats yet), the contract can be restructured cleanly without
back-compat shims or version signalling — we call the breaks out here instead.

The problems this change fixes:

- **Dataset identity is derived, and derived badly (#6, F1/F6).** Today both the
  materializer and the runner locate data at `data/<name>_<hash>/` by computing a
  content hash of the recipe at runtime. The hash is produced by a JS-only
  canonicaliser with a `.slice(0, 8)` truncation and an array-order bug, so it is
  neither reproducible across languages nor stable. A recipe change that *should*
  be an explicit, reviewed decision is instead an implicit hash flip. Any
  non-JS runner has to re-implement the exact canonicaliser to find the data.

- **Timestamps still drift (#6).** Wave 0 fixed counts, but Synthea renders the
  local timezone offset into the emitted `dateTime` fields, so the NDJSON is not
  byte-identical across environments — only count-identical. Without byte
  identity we cannot checksum the data or lock it.

- **Implementation identity conflates engine and binding (#7).** The report's
  flat `implementation: { name, version }` cannot distinguish the execution
  engine (what actually runs the work) from a language binding wrapping the same
  engine. A Python wrapper over a JVM engine is *the engine*, not a distinct
  implementation, and the format should say so.

- **Measurement semantics are under-specified (#5).** The report describes which
  phases are timed but not *what kind of measurement* is being made. There is no
  vocabulary to distinguish a one-off end-to-end conversion from a
  preloaded-then-repeated query, no defined statistics shape, and no mapping to a
  standard microbenchmark model (JMH), which Wave 3's #11 export will need.

- **Reports are not traceable (#9).** A report records `benchmarkVersion` but not
  the dataset identity or dataset resource counts it ran against, so a number
  cannot be tied back to the exact suite and the exact data that produced it.

- **The correctness guard is mis-framed and over-claims (#12).** `expectCount`
  lives inline in the authored benchmark file, mixing authored intent with a
  generated/blessed artifact. The guard is described as if it were conformance
  (it is not — `tests/` is), and the implicit cross-engine row-count-invariance
  claim is too strong for references resolved in `where`/`forEach` position,
  where empty-vs-null-vs-error is legitimately engine-specific.

## What Changes

This is ONE umbrella change spanning five capabilities (four existing specs plus
one new spec) and two public schemas.

### A. Implementation identity (#7) — report format + report schema

Replace the flat `implementation: { name, version }` with a structured shape
that separates the execution engine from an optional language binding and an
optional free-form variant:

```
implementation:
  engine:  { name, version }   # REQUIRED — what actually runs the work
  binding: { name, version }   # OPTIONAL — a language wrapper over that engine
  variant: string              # OPTIONAL — a config/mode discriminator
```

Rationale: a Python wrapper sharing a JVM/Spark engine is not a distinct
implementation — that JVM engine is the engine. This matches the `Implementation`
shape in the reference harness at `/Users/szu004/dev/sof-benchmark`.

### B. Measurement scenarios (#5) — report format + reference-runner + report schema

Add a `measurement.scenario` enum with two members, each pinning its timed
region and warmup semantics on top of the existing load/execute/extract phase
vocabulary:

- **`end_to_end`** — each measured sample times ONE full one-off conversion of
  NDJSON→CSV (phases `load` + `execute` + `extract`). "One-off" describes the
  *conversion* (a single conversion per sample), NOT a single measurement. The
  engine/server MAY be pre-warmed, but NOT with this dataset. `sink` = `csv` (a
  written file).
- **`preloaded_repeated`** — the data is preloaded into the implementation's most
  suitable representation and that load is EXCLUDED from timing. Each measured
  sample times the query (`execute` + `extract`) over the preloaded data. Query
  warmup iterations are discarded. `sink` = a materialized result each iteration
  (`table`/`memory`), never a lazy count.

BOTH scenarios collect enough measured samples for meaningful statistics
(proposed minimum: `>= 7`), report the raw individual `samplesMs`, and BOTH map
to JMH **SingleShotTime (`ss`)** — we measure time-per-operation on a
relatively long-running operation, never ops-per-time-unit throughput (never
`avgt`).

### C. Statistics + inputRows (#5) — report format + report schema

- Replace the free-form `stats` object with a DEFINED basic-stats shape:
  `{ mean, min, max, stddev, p50, p95 }` plus optional `ci95`, required
  alongside the raw `samplesMs` array. It is shaped to feed a JMH `primaryMetric`
  cleanly (score = mean, scoreError = CI, scorePercentiles = the percentiles,
  rawData = `samplesMs`), which is what Wave 3's #11 export consumes.
- Define `inputRows` precisely: the number of input resources of the case's
  `view.resource` type that were loaded — the denominator for
  throughput/normalization.

### D. Dataset identity + build-time checkfile (#6) — suite + materialization + runner + NEW checkfile spec + NEW checkfile schema

1. **Dataset identity = explicit `name` + `version`** (human-maintained; the
   `version` tag expresses INTENT to change the data). Data lives at
   `data/<name>/<version>/<size>/`. The runtime content-hash derivation is
   REMOVED entirely (killing F1/F6 — the JS-only canonicaliser, the
   `.slice(0, 8)`, and the array-order bug). Any runner in any language locates
   data by `name` + `version` with no re-derivation.
2. **Pin `TZ=UTC` for the Synthea executor** so the generated NDJSON is
   BYTE-IDENTICAL across environments/timezones (Synthea otherwise renders local
   timezone offsets into emitted timestamps — the same TZ mechanism behind Wave
   0's `-e` drift).
3. **NEW build-time checkfile** — a committed lock/checksum artifact with its own
   public schema (`benchmark-checkfile.schema.json`) and a new capability
   `benchmark-checkfile-format`. Produced by the benchmark build (bless step),
   post-generation, it records: dataset identity (`name`, `version`) and
   `syntheaVersion`; per-size resource counts; per-size/per-file sha256 checksums
   (now viable because of TZ=UTC); and the RESULT ASSERTIONS (the former inline
   `expectCount` per case per size), MOVED here out of the benchmark file.
4. **The benchmark file now holds ONLY AUTHORED INTENT**: `name`, `version`,
   dataset `params`/`resources`, `sizes`, and `cases` (views). It NO LONGER
   carries inline `expectCount`.
5. **Runner locates data by `name` + `version`, never re-derives a hash.** It
   reads result assertions from the CHECKFILE, verifies output counts against
   them (required), and MAY verify dataset checksums (strict, optional). The
   `--record`/bless mode WRITES THE CHECKFILE (not inline `expectCount`), keeping
   the analytic cross-check.

### E. Report provenance (#9) — report format + report schema

The report SHALL record the benchmark identity it ran (`name` + `version`;
generalizing the existing `benchmarkVersion`), the dataset identity it ran
against (`name` + `version`, matching the checkfile), and the dataset resource
counts — so any report is traceable to the exact suite and exact data.

### F. Correctness-guard reframing + invariance restriction (#12) — suite + reference-runner

- Reframe the row-count guard (assertions now in the checkfile) as a
  benchmark-owned **work-verification** guard: because the benchmark measures
  speed, it needs a guard so a fast-but-WRONG result cannot post a good time. It
  is NOT spec conformance — that is `tests/`, which is non-exhaustive and answers
  a different question. The analytic cross-check for blessed counts is kept.
- RESTRICT the cross-engine row-count-invariance claim to references in
  **projection** position. For a reference resolved inside a `where` filter or
  `forEach`, empty-vs-null-vs-error is engine-specific and can legitimately
  change the count, so two conformant engines MAY differ and MUST NOT be
  auto-flagged as `count_mismatch`. Those cases are labelled/guarded. The
  DEMONSTRATION (a cross-engine spike) is explicitly OUT OF SCOPE here.
- The content-assertion roadmap (a stricter future guard) is a non-goal here.

## Capabilities

### Modified Capabilities

- `benchmark-suite-format`: the benchmark file becomes authored-intent-only —
  dataset identity is an explicit `name` + `version`, `expectCount` is removed
  from cases (relocated to the checkfile), and the row-count guard is reframed as
  work-verification with the invariance claim restricted to projection-position
  references.
- `benchmark-report-format`: structured `implementation` (engine/binding/
  variant), a `measurement.scenario` enum mapping both scenarios to JMH `ss`, a
  defined basic-stats shape feeding a JMH `primaryMetric`, a precise `inputRows`
  definition, and benchmark + dataset provenance (identities and resource
  counts).
- `benchmark-dataset-materialization`: on-disk layout keyed by explicit
  `name`/`version` at `data/<name>/<version>/<size>/` (no content hash), and a
  `TZ=UTC`-pinned Synthea executor producing byte-identical NDJSON.
- `benchmark-reference-runner`: locates data by `name` + `version` (never
  re-derives a hash), reads result assertions and optional checksums from the
  checkfile, and blesses by WRITING THE CHECKFILE.

### New Capabilities

- `benchmark-checkfile-format`: a committed, language-neutral build-time
  lock/checksum artifact (`benchmark-checkfile.schema.json`) recording dataset
  identity + `syntheaVersion`, per-size resource counts, per-size/per-file sha256
  checksums, and the result assertions moved out of the benchmark file.

## Acceptance Criteria

- The benchmark file validates against the updated `benchmark.schema.json` with
  NO `expectCount` anywhere and an explicit dataset `version`; a file that still
  carries inline `expectCount` is rejected.
- No code in any language derives a content hash to locate data; the materializer
  writes and the runner reads `data/<name>/<version>/<size>/`.
- Materializing the same recipe in two different timezones produces
  byte-identical NDJSON (identical per-file sha256), not merely identical counts.
- A checkfile validates against `benchmark-checkfile.schema.json` and carries
  dataset identity + `syntheaVersion`, per-size resource counts, per-file sha256
  checksums, and per-case per-size result assertions.
- The runner locates data by `name`/`version`, verifies output counts against the
  checkfile assertions (required), and MAY verify checksums (strict, optional);
  bless mode writes the checkfile, not inline `expectCount`.
- A report validates against the updated `benchmark-report.schema.json` with a
  structured `implementation` (required `engine`), a `measurement.scenario` in
  `{ end_to_end, preloaded_repeated }`, a defined `stats` shape, and benchmark +
  dataset provenance.
- A reference resolved in `where`/`forEach` position is NOT auto-flagged
  `count_mismatch` on cross-engine divergence.
- `bun test`, `bun run validate`, `bun run check-fmt`, and
  `openspec validate benchmark-contract-v2 --strict` are all green.

## Impact

- `benchmark/benchmark.schema.json`: dataset gains a required explicit `version`
  semantics tag; `expectCount` removed from cases; document authored-intent-only
  shape.
- `benchmark/benchmark-report.schema.json`: restructure `implementation`; add
  `measurement.scenario`; replace `stats` with the defined shape; add provenance
  (benchmark + dataset identity, dataset resource counts).
- `benchmark/benchmark-checkfile.schema.json` (NEW): the checkfile contract.
- `benchmark/clinical-flat.json`: remove inline `expectCount` (moves to the
  checkfile) — implementation phase.
- `benchmark/tools/executors/synthea.js`: pin `TZ=UTC` in the executor
  environment — implementation phase.
- The materializer: write `data/<name>/<version>/<size>/`, drop the content-hash
  canonicaliser (F1/F6) — implementation phase.
- The reference runner: locate data by `name`/`version`, read assertions +
  optional checksums from the checkfile, write the checkfile in bless mode —
  implementation phase.
- The benchmark build: a checkfile writer (bless step) — implementation phase.
- **One-time re-bless under `TZ=UTC` (implementation phase, NOT authoring).** The
  counts Wave 0 blessed inline (in AEST) will very likely shift under UTC and
  relocate into the checkfile. The exact new numbers are an output of that
  re-bless and are not invented here.

Out of scope: the cross-engine invariance DEMONSTRATION spike (deferred); the
JMH export itself (#11, Wave 3, this only shapes the stats to feed it); a
content-level correctness assertion (stricter future guard); a downloadable
pinned dataset (#10).
