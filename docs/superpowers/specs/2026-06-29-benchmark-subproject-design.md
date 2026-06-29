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
   declarative dataset-recipe format, a light result-report schema, a
   reference materialization tool, and a **reference benchmark-runner in
   `sof-js`** (§11) that wires the artifact end-to-end and produces the first
   blessed `expectCount` values.
2. **Benchmark report schema (lightly sketched here, §10):** analogous to
   `test-report.schema.json`, for implementers to record their own numbers.
   Defined minimally now; full treatment deferred.
3. **Standardized environment + measurement methodology (DEFERRED):** the basis
   for fair cross-implementation comparison. The report schema captures
   environment *metadata*, but standardizing it is a separate later effort.

### Explicitly out of scope / deferred to future extensions

- A benchmark **runner / timing loop / engine glue inside the `benchmark/`
  artifact**. The artifact stays declarative and ships no execution code. The
  *reference* runner lives in `sof-js` (in scope, §11); every other
  implementation brings its own runner.
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
// benchmark/clinical-flat.json   (mirrors the shape of tests/basic.json)
{
  "title": "clinical-flat",
  "description": "Flatten clustered clinical resources from Synthea.",
  "group": "pathling",                       // flat label; coordinates multi-file benchmarks
  "fhirVersion": "4.0.1",                     // single version in v1 (what Synthea emits)
  "dataset": {
    "name": "synthea-clinical",               // human-readable; part of the on-disk dir key (§7)
    /* declarative recipe — see §4; `resources` may list several types;
       includes `sizes` + `defaultSize` */
    "resources": ["Condition", "Encounter", "Observation"]
  },
  "iterations": { "warmup": 1, "measurement": 5 },   // recommended defaults; runner may override
  "cases": [
    {
      "title": "condition flat",
      "view": { "resource": "Condition", "select": [ /* ViewDefinition */ ] },
      "expectCount": { "s": 6181, "m": 50035 }       // per (case, size); bless-populated
    },
    {
      "title": "observation flat",
      "view": { "resource": "Observation", "select": [ /* ViewDefinition */ ] },
      "expectCount": { "s": 11455, "m": 106608 }
    }
  ]
}
```

- **One dataset + N cases per file.** The dataset's `resources` may list multiple
  kept resource types; **each case's `view.resource` MUST be one of them**
  (validated). So the empirically-clustered clinical resources
  (Condition/Encounter/Observation) live in one file sharing one population and
  one materialization; Patient (needing a larger population) is a separate file.
- **v1 view restriction (validated invariant):** views are **single-root-resource
  flatten/projection only** — no `getReferenceKey`, no inter-query references, no
  cross-resource joins. This keeps "keep only the driving resource + no
  referential integrity" self-consistent; reference-resolving views are a future
  set on referentially-consistent datasets (§14). `bench:validate` rejects a view
  that references resource types other than its root.
- **Views:** a curated, benchmark-specific set. Conformance `tests/` views are
  **not** reused (different purpose: correctness probes on tiny data vs.
  representative workloads on large data).
- **`group`** is a flat string label. `bench:data --group <g> --size m`
  materializes every file in the group at tier `m`; validation requires all files
  in a group to declare the **same set of size-tier names**.
- **`fhirVersion`** is a single value (v1: `4.0.1`), validated and recorded in the
  report; it ties view validity and `expectCount` to one FHIR version.
- **`iterations`** are recommended warmup/measurement defaults; the runner may
  override but records the *actual* counts in the report (§10).
- **Correctness guard:** `expectCount` per `(case, size)`, blessed via
  `sof-js --record`, **cross-checked analytically** (flatten-only views make the
  count derivable — see §11), reviewed, and committed by PR. Implicitly keyed by
  the recipe's Synthea `version` (a version bump requires a re-bless, §13). A
  mismatch is recorded, not a hard failure. Content checksums deferred (need a
  canonical output-format spec).

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

**v1 demographic generation ceiling.** Synthea has no per-resource-type export
filter, so the materializer generates the full population and **prunes siblings**
afterward (keeping only `dataset.resources`). For clinical datasets this is cheap
(small population, 1-yr window). For demographic (Patient-rooted) datasets, N
Patients requires generating N patients — transiently materializing ~90× N
Observations before pruning. Since the `download` escape hatch is deferred (§14),
**v1 caps demographic dataset populations at 10,000 patients**; larger demographic
sizes are explicitly blocked until `kind: download` lands (not silently omitted —
Principle V). Clinical datasets keep their full size range.

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
- Materialize into the **untracked** `data/` directory under the layout contract
  below, with a provenance `manifest.json` (recipe params, generator
  version/identity, per-file row counts, timestamp).
- **Generate-then-prune:** Synthea exports all resource types; the materializer
  keeps only the recipe's selected `resources` and deletes the rest. (No
  per-resource-type export filter exists — hence the demographic ceiling, §6.)
- **Idempotent:** skip when the manifest matches and files are present;
  `--force` rebuilds. **Content-dedup** identical recipes across files via the
  layout key.

It ships **no** runner, timing, or engine code.

### On-disk layout contract (materializer ↔ runner interface)

```
data/<name>_<hash>/<size>/<ResourceType>.ndjson   # one JSON resource per line
data/<name>_<hash>/<size>/manifest.json           # provenance + per-file row counts
```

- `<name>` = the dataset's `name` (human-readable, on-disk legibility);
  `<hash>` = short content hash of the recipe. The full `name_hash` is the dedup
  key: identical `(name, recipe)` across files → one materialization; the hash
  guards against same-name/different-content collisions.
- `<size>` namespaces the tiers so `s`/`m`/`l` coexist without clobbering.
- Only the recipe's selected `resources` are present; one resource per NDJSON
  line (what Synthea bulk export already emits) — the lowest-common-denominator
  format every engine can ingest.
- The runner locates a case's input as
  `data/<name>_<hash>/<size>/<view.resource>.ndjson`.

Indicative interface (keyed by benchmark/group + size):

```bash
bun run bench:data <file-or-group> --size m   # generate → data/ + manifest
bun run bench:validate                        # schema-check all benchmark files & views
```

## 8. Repository layout

```
benchmark/
  README.md                     # the materialization + integration protocol (prose)
  benchmark.schema.json         # PUBLIC CONTRACT — inline benchmark file format
  benchmark-report.schema.json  # PUBLIC CONTRACT — result report format (light, §10)
  *.json                        # inline benchmark files (view + recipe + expectations)
  tools/                        # reference materialization tool + validators (NO runner)
  data/                         # materialized output — UNTRACKED (.gitignore)

sof-js/
  …                             # the reference benchmark-runner lives here (§11),
                                # NOT in the benchmark/ artifact
```

`benchmark.schema.json` may extend `tests.schema.json` concepts additively where
it makes sense (the file shape deliberately mirrors a conformance file). The
reference benchmark-runner is an *implementation* and therefore lives in
`sof-js`, keeping the `benchmark/` artifact free of execution code.

## 9. Validation & test-first

- Write `benchmark.schema.json` + a failing validation test first; observe it
  fail; then add benchmark files.
- Meta-tests assert the invariants: every benchmark file validates against the
  schema; every `view` is a structurally valid ViewDefinition; **every case's
  `view.resource` ∈ `dataset.resources`**; **every view is single-root-resource
  flatten only** (no cross-resource reference / `getReferenceKey` / inter-query
  references — Q5/§5); every `expectCount` key matches a declared size;
  `defaultSize` exists; all files sharing a `group` declare the same size-tier
  names; `fhirVersion` is present (v1: `4.0.1`).
- Fold `bench:validate` into `bun run validate`; keep formatting under
  `check-fmt`. No check is weakened or skipped (Principle V).

## 10. Result report schema (light)

A public contract analogous to `test-report.schema.json`, for implementers to
record their own numbers. Captures per-case timing samples, a status taxonomy
(`ok` / `count_mismatch` / `generation_error` / `execution_error`), input/output
rows, a free-form **environment metadata** block, and a **measurement
descriptor** that makes each number self-interpreting.

**Measurement boundary is implementer-chosen (Q1).** Cross-implementation
comparison is deferred (sub-project #3), so each implementer times what fits
their engine. The *recommended* formulation, grounded in DB-benchmark practice,
is **execution + a full materialization of the result** (a `CREATE TABLE AS`-style
table, or CSV output) — never a lazy `count(*)` or returned iterator, which lets
an optimizer skip producing columns and understates cost. Work is framed as a
**reverse ETL**: `load` (source JSON → the implementation's internal
representation; *may be empty*), `execute` (evaluate the ViewDefinition),
`extract` (materialize the flat output). The recommended timed region is
`execute + extract`; `load` is the engine-specific, possibly-empty phase.

The `measurement` descriptor declares which phases the samples cover, the sink,
and the actual iteration counts (recommended defaults come from the benchmark
file's `iterations`, Q8). `phaseSamplesMs` is optional, for engines that can
separate phases (valuable precisely because `load` is empty for one engine and
dominant for another).

```jsonc
{
  "implementation": { "name": "sof-js", "version": "2.0.0" },
  "benchmarkVersion": "<git tag of the artifact>",
  "environment": { "...": "free-form metadata for now" },
  "measurement": {
    "phases": ["execute", "extract"],   // timed region: subset of load | execute | extract
    "sink": "table",                     // table | csv | memory | other
    "warmup": 1, "iterations": 5         // actual counts used
  },
  "results": {
    "clinical-flat": {
      "size": "m",
      "fhirVersion": "4.0.1",
      "cases": [
        { "title": "observation flat", "status": "ok",
          "inputRows": 106608, "outputRows": 106608,
          "samplesMs": [1234, 1240, 1229], "stats": { "min": 1229, "mean": 1234 },
          "phaseSamplesMs": { "load": [], "execute": [923], "extract": [311] } }  // optional
      ]
    }
  }
}
```

`size` is a result dimension so runtime-vs-size scaling curves can be plotted
per `(benchmark, size, implementation)`; `benchmarkVersion` and `fhirVersion`
pin what the numbers are valid against.

## 11. Packaging, distribution & integration

The benchmark reuses the conformance suite's distribution and integration model
(README §"Implement a test runner" / §"Generate a test report"), adding one step
— materialization — that the reference tool absorbs. The artifact is consumed
*directly from this repo* (checkout / git submodule / sparse-checkout), pinned by
a **git tag/release**; there is no package-manager publish, exactly as `tests/`
works today.

### Three distribution layers

| Layer | What | How distributed | Required? |
|---|---|---|---|
| **1. Spec artifact** | `benchmark/*.json` + `benchmark.schema.json` + `benchmark-report.schema.json` | Direct from repo, pinned by tag. Language-neutral JSON is the contract. | always |
| **2. Reference materializer** | the Bun/JS tool + executor config (`benchmark/tools/`) | Ships in-repo; run it, or reimplement from the declarative recipe | convenience |
| **3. Materialized data** | the NDJSON itself | **Not shipped initially** — generated locally by layer 2. Future `kind: download` publishes prebuilt data to an official host | future |

Versioning (Principle IV): a report names the benchmark tag it ran against;
changing a `view` or an `expectCount` is a versioned change, so reports stay
comparable.

### The benchmark-runner contract (what an author implements)

Paralleling the existing test-runner contract, an implementation in any language:

1. **Obtain** the `benchmark/` artifact at a pinned tag (submodule/checkout), the
   same way it already vendors `tests/`.
2. **Materialize** the data: `bun run bench:data <file|group> --size m` →
   `data/.../*.ndjson` + `manifest.json` (byte-identical across consumers). If it
   cannot run Bun, it reimplements from the recipe; later, it downloads prebuilt
   data.
3. **Run** its engine: for each `benchmark/*.json`, execute each `case.view`
   (a ViewDefinition) over the materialized NDJSON for the chosen size **using
   its own runner + timing harness** (warmup/measurement). This is the
   engine-specific part the artifact deliberately omits.
4. **Verify** the output row count against `expectCount[size]` → `ok` /
   `count_mismatch`.
5. **Emit** `benchmark-report.json` per `benchmark-report.schema.json` (timing
   samples, status, input/output rows, environment metadata, and the data
   version from the manifest).
6. **(Future)** submit the report to a `releases`-branch aggregation for
   comparison — mirroring how conformance results are collected today.

The repo provides the views, recipes, reference materializer, schemas, and
blessed expected counts. The author provides only the runner and timing.

### The `sof-js` reference benchmark-runner (in scope)

`sof-js` is already the reference *view-runner*, so it hosts the reference
*benchmark-runner*: it materializes (via the layer-2 tool), evaluates each
benchmark view, times it, checks the row count, and emits a conforming
`benchmark-report.json`. This:

- dogfoods the artifact end-to-end and gives authors a concrete template, just
  as `sof-js` demonstrates the test-runner;
- produces the **first blessed `expectCount` values** (a `--record`/bless mode).
  Blessing does **not** let `sof-js` silently define truth: each value is
  **cross-checked analytically** before commit — the v1 single-resource flatten
  restriction (§5) makes the count derivable (no `forEach`/`where` ⇒ output rows =
  input resource count; `forEach` over a collection ⇒ sum of collection sizes;
  `where` ⇒ filtered count), and the reviewer verifies the blessed number against
  that reasoning and the manifest's input counts for at least the smallest size.
  Values land by reviewed PR. Requiring a *second implementation* to agree is
  deferred (§13);
- keeps execution code in an *implementation*, never in the `benchmark/`
  artifact — consistent with Principles II and the runner separation above.

## 12. Use cases

1. **Self-tracking:** an implementer materializes the reference data, runs their
   own harness, and tracks their performance over time against a fixed workload.
2. **(Future) Comparison:** with a standardized environment + methodology
   (sub-project #3) and the report schema, results become comparable across
   implementations.

## 13. Open questions (to resolve later, not blocking)

1. **QR generator:** reimplement in JS (drift risk vs. the Java original) vs.
   ship/invoke the Pathling Java generator (heavier dependency).
2. **Result content verification:** define a canonical output format
   (column/row ordering, type formatting) before adding checksums.
3. **Stress-test view set** (aggregation/joins) would resurrect NDV/referential
   concerns and need a stronger scaler.
4. **Download host / published-dataset repository** for `kind: download`
   (touches sub-project #3).
5. **Synthea jar provenance** — pin by hash in the manifest.
6. **Synthea cross-environment determinism (FOLLOW-UP — verify):** the
   committed `expectCount` guard assumes a fixed-seed recipe materializes
   identical row counts across OS/JVM. Assumed for now; must be empirically
   verified across at least two environments before the guard is relied upon.
   If it does not hold, fall back to a relative check against the local
   manifest's recorded counts. `expectCount` is implicitly keyed by the recipe's
   pinned generator `version`, so a version bump requires a re-bless rather than
   silently invalidating counts.

## 14. Future extensions (deliberately deferred)

- Referenced shared-catalog datasets (`{ "ref": "<id>" }`).
- `kind: qr` and QR-based cases.
- `kind: download` for pre-built datasets (also unblocks demographic sizes
  above the v1 10k ceiling, §6).
- **Reference-resolving / inter-query-reference views** on referentially-consistent
  datasets (relaxing the v1 single-resource flatten restriction, §5).
- **Second-implementation agreement** as a stronger bless gate for `expectCount`
  (v1 uses analytic cross-check only, §11).
- Multi-version benchmarking (v1 fixes `fhirVersion: "4.0.1"`, §5).
- Result-content checksums.
- VIG-style distribution-preserving up-scaling, if generation/download proves
  too costly at extreme sizes.
