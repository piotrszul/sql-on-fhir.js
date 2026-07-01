## Context

This change is Wave 1 of the benchmark hardening effort. Wave 0
(`pin-synthea-end-date`) established that `recipe + generator version`
reproduces the same per-resource *counts* across environments by pinning
Synthea's `-e` end date and moving the output-affecting toggles into the recipe.
Wave 1 hardens the *contract* around that foundation: dataset identity, byte
reproducibility, a build-time lock/checksum artifact, structured implementation
identity, a defined measurement/statistics model, report provenance, and a
correctly-scoped correctness guard.

The five capabilities and two schemas touched:

| Capability                        | Schema                             | Change |
|-----------------------------------|------------------------------------|--------|
| `benchmark-suite-format`          | `benchmark.schema.json`            | MODIFIED |
| `benchmark-report-format`         | `benchmark-report.schema.json`     | MODIFIED |
| `benchmark-dataset-materialization` | (writes `data/…` + checkfile)    | MODIFIED |
| `benchmark-reference-runner`      | reads checkfile                    | MODIFIED |
| `benchmark-checkfile-format`      | `benchmark-checkfile.schema.json`  | NEW |

The reference harness at `/Users/szu004/dev/sof-benchmark` (a separate Python
implementation) is the concrete second implementation this contract is measured
against; several decisions below cite it. It already separates the implementation
under test from the spec, and binds dataset *roles* to identities rather than to
derived hashes — the model this change adopts.

## Goals / Non-Goals

**Goals**

- Make dataset identity an explicit, human-reviewed `name` + `version`, and
  remove every runtime content-hash derivation so any language can locate data.
- Make the generated NDJSON byte-identical across environments (TZ=UTC) so it can
  be checksummed and locked.
- Introduce a committed build-time checkfile that owns the generated facts
  (counts, checksums, result assertions), separating them from the authored
  benchmark file.
- Give the report a structured implementation identity, a defined measurement
  scenario + statistics model that maps to JMH SingleShotTime, and provenance
  that ties a number back to the exact suite and data.
- Reframe the row-count guard as work-verification and scope its invariance claim
  correctly.

**Non-Goals**

- Implementation code, tests, and schema edits — this is the authoring phase.
  Those are enumerated in `tasks.md` as implementation-phase steps.
- The one-time re-bless under TZ=UTC (implementation phase). No count numbers are
  invented in this change.
- The cross-engine invariance demonstration spike (deferred to a later wave).
- The JMH export itself (#11, Wave 3) — this change only shapes the statistics so
  that export is mechanical.
- A content-level correctness assertion (a stricter future guard) and a
  downloadable pinned dataset (#10).

## Decisions

### D-A. Structured implementation identity (#7)

Replace `implementation: { name, version }` with:

```json
"implementation": {
  "engine":  { "name": "duckdb", "version": "1.1.0" },
  "binding": { "name": "sof-py", "version": "0.3.0" },
  "variant": "columnar"
}
```

- `engine` (REQUIRED, `{ name, version }`): the thing that actually executes the
  work. For a Python wrapper over a JVM/Spark engine, the engine is the JVM/Spark
  engine — the wrapper is a `binding`, not a distinct engine.
- `binding` (OPTIONAL, `{ name, version }`): a language wrapper sharing the same
  engine. Present only when the runner is not the engine itself.
- `variant` (OPTIONAL, string): a free-form config/mode discriminator (e.g. a
  storage layout or an optimizer flag) for A/B comparisons of one engine.

Rationale: two rows in a leaderboard that share an `engine` but differ in
`binding` are the same engine measured through different front doors; conflating
them under one `name` loses that. This mirrors the reference harness's
`Implementation` separation.

Pre-production ⇒ this is a clean break with no back-compat alias. The old flat
`{ name, version }` is removed, not deprecated.

### D-B. Measurement scenarios (#5)

Add `measurement.scenario`, an enum layered on top of (not replacing) the
existing `load`/`execute`/`extract` phase vocabulary. `phases` still says *which*
phases are timed; `scenario` says *what kind of measurement* is being made.

| scenario | timed region (phases) | per-sample work | warmup | sink |
|----------|-----------------------|-----------------|--------|------|
| `end_to_end` | `load` + `execute` + `extract` | ONE full one-off NDJSON→CSV conversion | engine/server MAY be pre-warmed, but NOT with this dataset | `csv` (a written file) |
| `preloaded_repeated` | `execute` + `extract` | ONE query over data preloaded outside timing | query warmup iterations discarded | a materialized result (`table`/`memory`), never a lazy count |

Crucial clarification (a correction made during design): **"one-off" describes
the CONVERSION** — a single conversion happens per measured sample — **not a
single measurement.** BOTH scenarios collect a sufficient number of measured
samples for meaningful statistics and report the raw individual samples. This is
the distinction between "we convert once per timed sample" and "we only measure
once".

Both scenarios map to JMH **SingleShotTime (`ss`)**: we are measuring
time-per-operation on a relatively long-running operation (a conversion or a
query over a non-trivial dataset), NOT ops-per-time-unit throughput. We
deliberately never map to JMH `avgt` (average time, throughput-flavoured), which
assumes a short op run many times inside one measurement window. Recording the
JMH mode as `ss` in the report keeps Wave 3's #11 export a straight
serialization.

The distinction between the scenarios is *where the load boundary sits*:
`end_to_end` charges the load to every sample (it is the one-off cost being
measured); `preloaded_repeated` amortizes the load away and measures steady-state
query cost over a hot representation.

### D-C. Defined statistics + inputRows (#5)

Replace the free-form `stats: {}` with a defined object:

```json
"stats": {
  "mean": 0.0, "min": 0.0, "max": 0.0, "stddev": 0.0,
  "p50": 0.0, "p95": 0.0,
  "ci95": { "lo": 0.0, "hi": 0.0 }      // OPTIONAL
}
```

Required alongside `samplesMs` (the raw per-sample times). The shape is chosen so
a JMH `primaryMetric` is a mechanical projection:

| JMH primaryMetric field | source |
|-------------------------|--------|
| `score` | `stats.mean` |
| `scoreError` | half-width of `stats.ci95` (or omitted) |
| `scorePercentiles` | `{ "50.0": p50, "95.0": p95, "100.0": max, "0.0": min }` |
| `scoreUnit` | `ms/op` (SingleShotTime) |
| `rawData` | `samplesMs` |

**`inputRows` — precise definition.** `inputRows` is the number of input
resources **of the case's `view.resource` type** that were loaded for that
(case, size) — i.e. the count of source resources fed into the timed operation,
which is the denominator for throughput/normalization (rows/sec, ns/row). It is
NOT the output row count (`outputRows`), and it is NOT the total resource count
across all types in the dataset — only the case's resource type. For a case whose
`view.resource` is `Condition`, `inputRows` is the number of `Condition`
resources loaded at that size.

### D-D. Dataset identity, TZ=UTC, and the checkfile (#6)

**D-D.1 — Explicit `name` + `version`, no derived hash.** Dataset identity is
the pair (`dataset.name`, `dataset.version`), both human-maintained. `version` is
an intent tag: an author bumps it deliberately when they change what the data
should be (a new Synthea version, a changed population, a param change that
should re-generate). Data materializes to:

```
data/<name>/<version>/<size>/<ResourceType>.ndjson
```

The runtime content-hash derivation is REMOVED. This directly kills findings F1
and F6: the JS-only recipe canonicaliser, the `.slice(0, 8)` truncation, and the
array-order bug in the hash all disappear because nothing derives a hash anymore.
A runner in any language locates data purely by string identity — no
canonicalization contract to re-implement.

Trade-off: `version` is now a discipline (the author must bump it when the recipe
changes) rather than an automatic consequence of the recipe bytes. That is the
point — a data change becomes an explicit, reviewable decision recorded in the
diff and cross-checked by the checkfile's checksums, instead of a silent hash
flip. If the author forgets to bump `version` after changing `params`, the
checkfile checksums (D-D.3) catch the drift at verify time.

**D-D.2 — TZ=UTC for byte identity.** Wave 0 made counts reproducible but not the
bytes: Synthea renders the local timezone offset into emitted `dateTime`/
`instant` fields, so the same recipe on an AEST machine and a UTC machine
produces the same *number* of resources with *different* timestamp strings. The
materialization spec now requires the `synthea` executor to run with `TZ=UTC` in
its environment, so the emitted NDJSON is byte-identical across environments and
timezones. This is the same TZ/clock mechanism behind Wave 0's `-e` drift, closed
one layer down. Byte identity is the precondition that makes per-file sha256
checksums (D-D.3) meaningful.

**D-D.3 — The build-time checkfile (NEW capability + NEW schema).** A committed
lock/checksum artifact, produced by the benchmark build (the bless step),
post-generation. It is the home for everything *generated* — as opposed to the
benchmark file, which is everything *authored*. It records:

- dataset identity (`name`, `version`) and `syntheaVersion` (the generator
  version actually used — pinned in the recipe, echoed here for the lock);
- per-size resource counts — `{ "s": { "Condition": N, "Observation": M }, "m": { … } }`;
- per-size / per-file sha256 checksums (viable now because of TZ=UTC);
- the RESULT ASSERTIONS — the former inline `expectCount` per case per size,
  MOVED here.

Proposed shape:

```json
{
  "dataset": { "name": "synthea-clinical", "version": "1" },
  "syntheaVersion": "3.2.0",
  "sizes": {
    "s": {
      "resourceCounts": { "Condition": 0, "Observation": 0 },
      "files": {
        "Condition.ndjson":   { "sha256": "…" },
        "Observation.ndjson": { "sha256": "…" }
      }
    },
    "m": { "resourceCounts": { … }, "files": { … } }
  },
  "assertions": {
    "condition flat":        { "s": 0, "m": 0 },
    "observation components":{ "s": 0, "m": 0 }
  }
}
```

`assertions` is keyed by case title (the same key `results` uses in the report),
then by size, to the expected output row count. Counts are placeholders here —
the numbers are produced by the one-time re-bless in the implementation phase, not
invented in authoring.

**D-D.4 — The benchmark file is authored-intent-only.** After this change the
benchmark file carries only what a human authors: `title`/`name`, `version`,
dataset `params`/`resources`, `sizes`/`defaultSize`, and `cases` (the views). It
NO LONGER carries inline `expectCount`. This is the clean separation that #6
asks for: authored intent in the benchmark file, generated facts in the
checkfile.

**D-D.5 — Runner locates by identity, blesses the checkfile.** See D-E.

### D-E. Runner: identity, not hash (#6, rewrite of the old requirement)

The old `benchmark-reference-runner` requirement "Recipe-identity agreement with
the materializer" mandated the runner derive a hash by stripping `name`/`sizes`/
`defaultSize` from the dataset and reading `data/<name>_<hash>/`. That
requirement is REMOVED and replaced with:

- The runner locates materialized data at `data/<name>/<version>/<size>/` using
  the dataset's explicit `name` + `version`, and NEVER re-derives a hash. There
  is no shared canonicaliser to agree on — identity is the string pair.
- The runner reads the result assertions from the CHECKFILE (not from inline
  `expectCount`) and verifies each case's output row count against them
  (REQUIRED). Present + match ⇒ `ok`; present + mismatch ⇒ `count_mismatch`;
  absent ⇒ `ok`.
- The runner MAY additionally verify dataset checksums against the checkfile
  (strict mode, OPTIONAL) to detect data that drifted from the locked bytes.
- The `--record`/bless mode WRITES THE CHECKFILE — dataset counts, per-file
  checksums, and result assertions — instead of editing inline `expectCount`. The
  analytic cross-check on blessed counts is kept: for a single-resource flatten
  view the count is derivable (no `forEach`/`where` ⇒ input resource count;
  `forEach` over a collection ⇒ total collection-entry count; `where` ⇒ filtered
  count), and a blessed value that disagrees with the derivation is a bless-time
  error.

### D-F. Report provenance (#9)

The report SHALL record:

- the benchmark identity it ran — `benchmark: { name, version }`, generalizing
  the existing scalar `benchmarkVersion`;
- the dataset identity it ran against — `dataset: { name, version }`, which MUST
  match the checkfile the run verified against;
- the dataset resource counts observed at each size (mirroring the checkfile's
  `resourceCounts`), so a report is self-contained enough to sanity-check.

This makes any single report traceable to the exact suite version and the exact
data version that produced its numbers.

### D-G. Correctness-guard reframing + invariance restriction (#12)

**Reframing.** The row-count assertions (now in the checkfile) are a
benchmark-owned WORK-VERIFICATION guard, not a conformance check. Their job: since
the benchmark measures *speed*, prevent a fast-but-WRONG result from posting a
good time. Conformance is `tests/` — a different, non-exhaustive question. The
suite-format and runner specs state this explicitly so no implementer reads the
guard as a conformance signal.

**Invariance restriction.** The implicit claim "any two conformant engines
produce the same output row count" is only safe for references resolved in
**projection** (column) position. For a reference resolved inside a `where`
filter or a `forEach`, the empty-vs-null-vs-error behaviour is engine-specific and
can legitimately change the row count — so two conformant engines MAY differ, and
the guard MUST NOT auto-flag such a case as `count_mismatch`. Such cases are
labelled/guarded (e.g. a per-case marker the runner honours). The DEMONSTRATION
of this divergence (a cross-engine spike) is OUT OF SCOPE here; only the spec
restriction is written now.

## Finer points PROPOSED (confirm at review — do not block)

These are concrete, defensible proposals for the human to approve or adjust at
Gate A. Each is flagged "proposed, confirm at review."

- **Minimum sample count: `>= 7`** (proposed). Small enough to keep a full
  `end_to_end` conversion suite affordable, large enough that p95 and a stddev/CI
  are not dominated by a single outlier. The schema enforces `minItems: 7` on
  `samplesMs`. Rationale: below ~7 samples percentile/CI estimates are noise; a
  hard floor stops a report claiming statistics from 2 samples.

- **Checkfile location/name: `benchmark/<name>.check.json`** (proposed) — a
  sibling of the benchmark file, one checkfile per benchmark, discoverable by
  swapping the extension. Rejected alternative: a `benchmark/checkfiles/` dir
  (extra indirection for a 1:1 artifact). Confirm whether a suffix
  (`clinical-flat.check.json`) or a dir is preferred.

- **`environment` structure** (proposed): `{ os, arch, cpuModel, cpuCount,
  memoryBytes, runtime: { name, version } }`. `runtime` is the language runtime
  (e.g. `{ name: "bun", version: "1.x" }` or `{ name: "cpython", version:
  "3.14" }`); the *engine* lives in `implementation.engine`, so `runtime` and
  `engine` do not overlap. Kept as a permissive object with these as documented,
  optional properties (an unknown host detail should not fail a report).

- **`sink` enum values per scenario** (proposed): keep the existing enum
  `{ table, csv, memory, other }`. `end_to_end` ⇒ `csv` (a written file);
  `preloaded_repeated` ⇒ `table` or `memory` (a materialized result), never a
  lazy count. The schema keeps the union enum; the spec states the per-scenario
  expectation as a SHALL so a mismatched sink is a spec (not schema) violation.

- **Warmup semantics per scenario** (proposed):
  - `end_to_end`: NO dataset warmup. The engine/server MAY be pre-warmed
    generally (JIT, connection pools) but MUST NOT be warmed with THIS dataset —
    the first touch of the dataset is part of the measured one-off cost.
    `measurement.warmup` therefore refers to non-dataset warmup only.
  - `preloaded_repeated`: query warmup iterations ARE run and discarded;
    `measurement.warmup` counts those discarded query iterations.

## Risks / Trade-offs

- **`version` is now a human discipline, not automatic** → mitigated by the
  checkfile checksums, which catch a recipe change that forgot a `version` bump at
  verify time. The explicitness is the intended benefit (D-D.1).
- **Removing the content hash is a hard break** → intended and safe
  (pre-production, no external consumers). It deletes a whole class of
  cross-language reproduction bugs (F1/F6).
- **TZ=UTC changes the emitted bytes vs. Wave 0's AEST bless** → forces the
  one-time re-bless. Same one-time cost as any determinism pin; the numbers move
  into the checkfile where they belong.
- **Checkfile is a new committed artifact to keep in sync** → its writer is the
  bless step and its reader is the runner/verify; drift between it and the data is
  exactly what the checksums detect, so the artifact polices itself.
- **`minItems: 7` on `samplesMs` could reject legitimately cheap smoke runs** →
  acceptable; a smoke run is not a benchmark report. Confirm the floor at review.

## Open Questions (for Gate A)

- Confirm the five finer-point proposals above (sample minimum `>= 7`, checkfile
  location `benchmark/<name>.check.json`, `environment` shape, per-scenario
  `sink` values, per-scenario warmup semantics).
- Confirm `assertions` in the checkfile is keyed by **case title** (matching the
  report's `results` keys) rather than a stable case id — the benchmark file has
  no case ids today, only titles.
- Confirm whether `implementation.variant` should be a free string (proposed) or
  a constrained enum — free string is more flexible for A/B config labels but
  cannot be validated.
