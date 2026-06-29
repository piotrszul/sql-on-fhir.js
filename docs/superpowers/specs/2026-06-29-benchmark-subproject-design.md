# Design: SQL-on-FHIR Benchmark Subproject

- **Date:** 2026-06-29
- **Status:** Draft for review
- **Scope:** Sub-project #1 of a decomposed effort (see *Decomposition* below)

## 1. Summary

Introduce a new top-level `benchmark/` subproject holding an
**implementation-agnostic benchmark artifact** for SQL-on-FHIR: a curated set of
ViewDefinitions paired with reproducible dataset specifications, plus a
*reference implementation* of data materialization. It is the performance analog
of the existing `tests/` conformance suite and inherits the same constitutional
rules (language-neutral, spec-faithful, stable public contracts, verified-green,
test-first).

The subproject lets an implementer **obtain reference views and materialize the
test data (generate or, in future, download)** so they can measure and track
their own performance. A later effort (out of scope here) standardizes the
environment and methodology needed for rigorous cross-implementation comparison.

## 2. Decomposition and scope

The original idea bundled three things of very different maturity. This spec
covers only the first; the others are explicitly deferred.

1. **The benchmark artifact (THIS SPEC):** inline benchmark case files (view +
   dataset recipe + expectations), a curated Synthea-based view set, a
   declarative dataset-recipe format, a light result-report schema, and a
   reference materialization tool.
2. **Benchmark report schema (lightly sketched here, §10):** analogous to
   `test-report.schema.json`, for implementers to record their own numbers.
   Defined minimally now; full treatment deferred.
3. **Standardized environment + measurement methodology (DEFERRED):** the basis
   for fair cross-implementation comparison. The report schema captures
   environment *metadata*, but standardizing it is a separate later effort.

### Explicitly out of scope / deferred to future extensions

- The benchmark **runner / timing loop / engine glue**. This repo ships **no**
  execution or measurement code; each implementation brings its own runner.
- **Referenced (shared-catalog) datasets** — the format is inline-first; a
  `{ "ref": "<id>" }` escape hatch to a shared catalog is a future extension.
- **The QuestionnaireResponse (QR) generator and QR-based cases** — Synthea-based
  cases only for now; QR is a future `kind`.
- **Downloaded / published datasets** — a future `kind: download`.
- **Result-content checksums** — require a canonical output-format spec first.
- **A stress-test view set** (aggregation/joins) and **distribution-preserving
  up-scaling** (VIG-style) — future, see §6 and §12.

## 3. Constitution alignment

- **I — Specification fidelity:** benchmark views are valid `ViewDefinition`s;
  semantics remain owned by the spec repo. The benchmark never redefines spec
  behaviour.
- **II — Language-neutral:** benchmark files and dataset recipes are declarative
  JSON. No language/runtime/storage assumptions leak into the artifact. Recipes
  describe *what* data, never *how* a particular tool produces it (see §4).
- **III — Test-first:** schemas and failing validation tests are written before
  catalog/suite content; meta-tests assert every benchmark file validates and
  every view is a structurally valid ViewDefinition.
- **IV — Stable public contracts:** the new `*.schema.json` files are versioned
  public contracts, evolved additively.
- **V — Verified green:** benchmark validation folds into the existing
  `bun test` / `bun run validate` / `check-fmt` pipeline.

## 4. Dataset recipe model — declarative, not executable

A dataset is described by a **declarative recipe**, never by an embedded shell
command or function call. This is a direct consequence of Principle II.

**WHAT vs HOW — the core split:**

- **WHAT** (in the shared, tracked benchmark file): declarative and portable —
  a `kind` discriminator, a pinned generator `version`, and `params`. Reproduces
  identically anywhere; usable by an implementation in any language. The `kind`
  enum is the extension point (add `qr`, `download`, … over time).
- **HOW** (in the materialization tool / local config, never in the spec):
  environment-specific execution — the path to the Synthea jar, the `java`
  binary, etc. This is where shelling out happens, keyed off `kind`.

Only output-affecting facts (generator version, seed, params) live in the
recipe. Environment-specific facts (jar location, binary names) live in tool
config.

```jsonc
// declarative recipe, embedded in a benchmark file (see §5)
"dataset": {
  "kind": "synthea",                 // declarative discriminator; extensible
  "version": "3.2.0",                // pinned for reproducibility
  "resources": ["Observation"],      // keep only the driving resource(s)
  "params": {
    "seed": 589,
    "clinicianSeed": 1652609873669,
    "referenceTime": 20240101,
    "yearsOfHistory": 1              // primary volume knob (see §6)
  },
  "sizes": { "s": { "population": 100 }, "m": { "population": 1000 } },
  "defaultSize": "m"
}
```

```jsonc
// tool-side local config (NOT part of the shared artifact)
{ "executors": { "synthea": { "jar": "bin/synthea-with-dependencies-3.2.0.jar",
                              "java": "java" } } }
```

Rejected alternatives and why:

- **Shell-call recipe** (`"command": "java -jar …"`): bakes in OS/shell/jar/JVM;
  unusable cross-language; reproducible only on the author's machine; a security
  risk for a spec meant to be run by strangers.
- **JS-function recipe:** bakes in the Bun/JS runtime even harder.

## 5. Benchmark file format — inline-first, self-contained

Benchmark data can never be inlined (millions of rows are the point), so a
benchmark file is a *recipe-bearing spec*, not a literal fixture. "Self-contained"
therefore means **view + dataset recipe + expectations in one file** — mirroring
how a `tests/*.json` file groups one `resources` block with many `tests`. The
benchmark file swaps the literal `resources` array for a `dataset` recipe.

```jsonc
// benchmark/observation-flat.json   (mirrors the shape of tests/basic.json)
{
  "title": "observation-flat",
  "description": "Flatten US-Core blood-pressure Observations from Synthea.",
  "dataset": { /* declarative recipe — see §4, includes `sizes` + `defaultSize` */ },
  "cases": [
    {
      "title": "blood pressure components",
      "view": { "resource": "Observation", "select": [ /* ViewDefinition */ ] },
      "expectCount": { "s": 11455, "m": 106608 }   // per-size; bless-populated
    }
  ]
}
```

- **Views:** a curated, benchmark-specific set. Conformance `tests/` views are
  **not** reused (different purpose: correctness probes on tiny data vs.
  representative workloads on large data).
- **Grouping:** files are organized around one dataset shape (one population /
  resource selection). A *named multi-resource benchmark* (e.g. "pathling")
  spans several files sharing a `group` label and shared size-tier names, so a
  single materialization request produces a coherent cross-resource benchmark.
- **Correctness guard:** `expectCount` per `(case, size)`, populated by a "bless"
  run, reviewed, and committed. A mismatch is recorded (not a hard failure).
  Content checksums are deferred (need a canonical output-format spec).

### Why inline-first (vs. a normalized catalog)

Inline optimizes for authoring/reading and format-consistency with the existing
suite; a normalized catalog optimizes for cross-file dataset reuse and
publishable catalogs. We choose inline-first and recover reuse via:

- a future `{ "ref": "<id>" }` escape hatch for genuinely heavy/shared datasets;
- **content-deduplication** in the materializer (hash the recipe) so two files
  declaring the same recipe materialize once.

## 6. Scaling model — size is a parameter, evidence-based

**Size is a parameter of a benchmark, not a separate benchmark.** A benchmark's
identity is its workload (the view); size is just N (input rows). Treating size
as a result dimension is what enables scaling-curve analysis ("how does this
view's runtime grow from 100k → 1M rows?") and avoids duplicating the view per
scale. This matches TPC (scale factor) and JSONBench (row count).

- `sizes` is a per-file map of **named tiers** (`s`/`m`/`l`); `defaultSize` makes
  a bare run well-defined; `expectCount` is keyed by tier.
- Tier labels are **shared across a group, but their concrete population is
  per-dataset**, because different resources reach a meaningful size at different
  populations (see findings below). So `--size m` materializes each dataset at
  the population that makes *it* meaningful.

### Empirical findings (Synthea 3.2.0, fixed seeds)

We measured per-resource counts for the four Synthea resources the initial views
use (Patient, Condition, Encounter, Observation) across populations 100 & 1000
and history windows 1/3/5/10/all years. Ratios are per-Patient.

| Window | C:P | E:P | O:P (pop 100) | O:P (pop 1000) |
|-------:|----:|----:|--------------:|---------------:|
| 1 yr   | 49× | 63× | 92×           | 90×            |
| 3 yr   | 54× | 77× | 299×          | 262×           |
| 5 yr   | 58× | 98× | 532×          | 428×           |
| 10 yr  | 68× | 125×| 1011×         | 771×           |
| all    | 111×| 226×| 2371×         | 1863×          |

Conclusions that shape the design:

1. **Ratios are population-invariant** — counts scale ~linearly with population;
   only N changes, not the mix. (Note: Synthea writes extra deceased patients, so
   actual Patient counts run slightly above the `-p` target, e.g. 125 for `-p 100`.)
2. **`years_of_history` is the primary volume knob**, and it is integer-only
   (`0` means "keep everything"; fractional values throw `NumberFormatException`).
   So **1 year is the smallest positive window** — no sub-year control via this
   knob.
3. **A short window clusters the clinical resources.** At 1 year,
   Condition/Encounter/Observation land within ~2× of each other, so a single
   short-window population gives all three meaningful, comparable counts — no
   per-resource population needed for them.
4. **Window-limiting cannot rescue Patient.** Patient stays ~40–90× below the
   clinical resources at every window. Patient-rooted (demographic) views need a
   *separately, larger-sized* dataset.

So the scaling model is a **hybrid**: clinical-resource views share one
short-window population; demographic views get their own larger population. Both
are expressed as the same `sizes` tiers, with per-dataset populations.

### Scaling toolkit (asymmetric, all honest)

| Direction | Lever | Honest? |
|---|---|---|
| Down (fewer rows) | smaller population, or **shuffle-sample** a resource file to a target | ✅ real subset, distribution preserved |
| Up (more rows) | larger population, or (future) **download** a pre-built dataset | ✅ real data |
| Up via replication | — | ❌ rejected (freezes NDV; flatters dictionary/compression/value-cache engines unpredictably; cannot be guaranteed neutral) |
| Sub-year time window | not available (`years_of_history` integer-only) | n/a |

No cross-resource referential integrity is promised (out of scope). The
workload is projection/flatten only (no aggregation/joins), which is precisely
what makes honest sub-sampling safe and replication unnecessary.

## 7. Reference materialization implementation

The repo ships a **reference implementation of materialization** — a Bun/JS tool
— standing alongside `sof-js` (the reference view-runner). The declarative recipe
is the language-neutral *contract*; this tool is one runnable realization of it.
Most implementers run it directly to obtain byte-identical data (guaranteeing
comparability); only those who cannot run Bun reimplement from the recipe.

Responsibilities:

- Resolve a benchmark file (or group) + size → the dataset recipe(s) it needs.
- Execute each recipe via a **pluggable `kind → executor` registry** (the
  `synthea` executor shells out to the Synthea jar using local config from §4).
- Materialize into an **untracked** `data/` directory with a provenance
  `manifest.json` (records recipe params, generator version/identity, per-file
  row counts, timestamp).
- **Idempotent:** skip when the manifest matches and files are present;
  `--force` rebuilds. **Content-dedup** identical recipes across files.
- Keep only the recipe's selected `resources` (discard siblings to save disk).

It ships **no** runner, timing, or engine code.

Indicative interface (keyed by benchmark/group + size, per earlier decision):

```bash
bun run bench:data <file-or-group> --size m   # generate → data/ + manifest
bun run bench:validate                        # schema-check all benchmark files & views
```

## 8. Repository layout

```
benchmark/
  README.md                     # the materialization + measurement protocol (prose)
  benchmark.schema.json         # PUBLIC CONTRACT — inline benchmark file format
  benchmark-report.schema.json  # PUBLIC CONTRACT — result report format (light, §10)
  *.json                        # inline benchmark files (view + recipe + expectations)
  tools/                        # reference materialization tool + validators (NO runner)
  data/                         # materialized output — UNTRACKED (.gitignore)
```

`benchmark.schema.json` may extend `tests.schema.json` concepts additively where
it makes sense (the file shape deliberately mirrors a conformance file).

## 9. Validation & test-first

- Write `benchmark.schema.json` + a failing validation test first; observe it
  fail; then add benchmark files.
- Meta-tests assert: every benchmark file validates against the schema; every
  `view` is a structurally valid ViewDefinition; every `expectCount` key matches
  a declared size; `defaultSize` exists.
- Fold `bench:validate` into `bun run validate`; keep formatting under
  `check-fmt`. No check is weakened or skipped (Principle V).

## 10. Result report schema (light)

A public contract analogous to `test-report.schema.json`, for implementers to
record their own numbers. Captures per-case timing samples, a status taxonomy
(`ok` / `count_mismatch` / `generation_error` / `execution_error`), input/output
rows, and a free-form **environment metadata** block. Standardizing that
environment is sub-project #3, not this spec.

```jsonc
{
  "implementation": { "name": "sof-js", "version": "2.0.0" },
  "environment": { "...": "free-form metadata for now" },
  "results": {
    "observation-flat": {
      "size": "m",
      "cases": [
        { "title": "blood pressure components", "status": "ok",
          "inputRows": 106608, "outputRows": 106608,
          "samplesMs": [1234, 1240, 1229], "stats": { "min": 1229, "mean": 1234 } }
      ]
    }
  }
}
```

`size` is a result dimension so runtime-vs-size scaling curves can be plotted
per `(benchmark, size, implementation)`.

## 11. Use cases

1. **Self-tracking:** an implementer materializes the reference data, runs their
   own harness, and tracks their performance over time against a fixed workload.
2. **(Future) Comparison:** with a standardized environment + methodology
   (sub-project #3) and the report schema, results become comparable across
   implementations.

## 12. Open questions (to resolve later, not blocking)

1. **QR generator:** reimplement in JS (drift risk vs. the Java original) vs.
   ship/invoke the Pathling Java generator (heavier dependency).
2. **Result content verification:** define a canonical output format
   (column/row ordering, type formatting) before adding checksums.
3. **Stress-test view set** (aggregation/joins) would resurrect NDV/referential
   concerns and need a stronger scaler.
4. **Download host / published-dataset repository** for `kind: download`
   (touches sub-project #3).
5. **Synthea jar provenance** — pin by hash in the manifest.

## 13. Future extensions (deliberately deferred)

- Referenced shared-catalog datasets (`{ "ref": "<id>" }`).
- `kind: qr` and QR-based cases.
- `kind: download` for pre-built datasets.
- Result-content checksums.
- VIG-style distribution-preserving up-scaling, if generation/download proves
  too costly at extreme sizes.
