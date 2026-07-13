## Why

The benchmark's machinery is deep (four schemas, three lifecycle modes, two
scenarios, JMH export) but the coverage it drives is thin: one benchmark file
(`clinical-flat`), two flatten cases, and a largest tier of 10k patients. Three
gaps limit what the benchmark can say about a real engine:

- **No large tier.** The largest size is `l` (10k). Bless holds the whole
  dataset and the whole result set in memory (`readFileSync` + a full
  `evaluate()` array just to read `.length`), so a bigger tier is not merely
  absent — it is unblessable as written.
- **Thin view vocabulary.** The two cases exercise only shallow `forEach`. A
  richer, portable set of views (nested `forEach`, `unionAll`, a US Core
  profile view) already exists and has been run against Pathling; it is not
  represented here.
- **All-or-nothing runs.** A run always executes every case. Iterating on one
  view, or blessing a subset, forces the whole suite.

## What Changes

- **New benchmark file `clinical-wide.json`** (+ `clinical-wide.check.json`): a
  new Synthea recipe (its **own** dataset identity, reusing `clinical-flat`'s
  seed/params/`syntheaVersion`) over `Patient`, `Encounter`, `Condition`,
  `Observation` and six cases imported from the Pathling view set —
  `ConditionFlat`, `EncounterFlat`, `PatientAddresses`,
  `PatientAndContactAddressUnion`, `PatientDemographics`, and the **inlined**
  `UsCoreBloodPressures`. The `QuestionnaireResponse` view is excluded (QR
  datasets are a deferred v1 extension). `clinical-flat.json` is left untouched.
- **Export-filtered generation.** The materializer passes the recipe's
  `resources` to Synthea's `exporter.fhir.included_resources` so generation emits
  only the needed resource types instead of every type (today it generates all
  and prunes to a couple). Prune is retained as a safety net for Synthea's
  force-exported `Patient`/`Encounter`. Byte-safe for kept resources, so
  `clinical-flat`'s existing checksums are unaffected.
- **New `xl` (100k) size tier**, added to `clinical-wide` (and available to any
  recipe). The v1 demographic 10k ceiling is re-scoped so a high-multiplicity
  clinical dataset may exceed it; the README note is updated.
- **Streaming bless.** Bless mode processes NDJSON one resource at a time —
  summing `evaluate(view, [r]).length` and the analytic cardinality per
  resource — so memory is bounded by a single resource and its rows, not the
  dataset. Input sha256 and line counts are computed by streaming too.
- **Generalized analytic cross-check.** `deriveExpectedCount` is replaced by a
  recursive row-cardinality derivation over the select tree (nested `forEach` /
  `forEachOrNull`, `unionAll`, sibling `select` cross-join, view-level `where`)
  so the bless cross-check survives the richer views. The check remains
  count-only and independent of `evaluate()`'s row-composition code, and is
  self-protecting: a mismatch only ever *blocks* a bless, it can never write a
  wrong count into the checkfile.
- **Case selection.** `--only <ids>` / `--exclude <ids>` on both the harness
  `run` CLI and the bless CLI, built on the `caseFilter` the runner already
  accepts. Filters select a subset of cases to run or bless; other cases and
  other sizes are left untouched.

## Capabilities

### New Capabilities

<!-- None. This change extends existing capabilities. -->

### Modified Capabilities

- **benchmark-reference-runner** — bless streams per resource; the analytic
  cross-check generalizes to the full row-cardinality algebra; the bless CLI
  gains case selection.
- **benchmark-harness** — the `run` CLI gains `--only` / `--exclude` case
  selection, threading the runner's existing `caseFilter`.
- **benchmark-dataset-materialization** — generation is export-filtered to the
  recipe's `resources` (prune retained as a safety net); the v1 10k ceiling is
  re-scoped to purely low-multiplicity datasets so a clinical dataset may declare
  an `xl` (100k) tier; hashing and line-counting are streaming.

## Deferred (out of scope)

- **Cross-benchmark generation reuse.** Because Synthea force-exports
  `Patient`/`Encounter`, `clinical-flat`'s generation already yields
  `clinical-wide`'s full resource set, so the two runs are dedupable. Sharing a
  single generation (a shared dataset, or a raw-generation cache) is deliberately
  left to a **separate change**; here each benchmark generates independently.

## Impact

- New: `benchmark/clinical-wide.json`, `benchmark/clinical-wide.check.json`.
- `sof-js/src/benchmark.js` (streaming NDJSON reader), `sof-js/src/benchmark-run.js`
  (streaming bless + generalized cardinality + `--only`/`--exclude`).
- `benchmark/tools/harness/cli.js` (parse + thread case filter),
  `benchmark/tools/checkfile.js` (streaming sha256 / line count if not already).
- `benchmark/tools/executors/synthea.js` (pass `included_resources`),
  `benchmark/tools/materialize.js` (prune stays as safety net).
- `benchmark/README.md` (xl tier, ceiling note, case-selection flags).
- New tests across `sof-js/tests` and `benchmark/tests`; re-blessed checkfiles.
- No public-contract schema change: `xl` is an open `sizes` key; the report and
  checkfile formats are unchanged.
