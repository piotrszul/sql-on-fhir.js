## Context

This is a small follow-up to the merged `benchmark-contract-v2` change,
encoding three pre-implementation refinements the Pathling (Java + Python)
implementer raised in issue #18 after reviewing contract v2. All three are
ACCEPTED. The project is pre-production, so each is a clean contract refinement
with no back-compat shim or version signalling.

The touched capabilities and schema:

| Capability                | Schema                          | Change |
|---------------------------|---------------------------------|--------|
| `benchmark-suite-format`  | `benchmark.schema.json`         | MODIFIED |
| `benchmark-report-format` | `benchmark-report.schema.json`  | MODIFIED |

## Goals / Non-Goals

**Goals**

- Give the authored suite file an explicit identity (`name` + `version`) so
  `report.benchmark.{name,version}` sources from the inputs, not an out-of-band
  tag.
- Make the two measurement scenarios directly comparable by fixing the sink to
  `csv` for both, so they differ ONLY by whether load is timed.
- Trim the required `stats` set to the stable summary and keep richer percentiles
  optional, while keeping the raw `samplesMs` required.

**Non-Goals**

- Implementation code, tests, and schema edits — this is the authoring phase;
  they are enumerated in `tasks.md`.
- Re-keying `report.results` — explicitly out of scope (D-1 below).
- Any change to the dataset, the checkfile, or the materialized bytes — no
  re-bless (contract/report shape only).
- The JMH export itself (#11) — this only reshapes the stats it will consume.

## Decisions

### D-1. Authored suite identity `name` + `version` (#9, #18.1)

Contract v2 gave the report `benchmark: {name, version}` provenance but left the
authored suite with no identity beyond `title`/`group`; only the *dataset*
carried a `version`. So `report.benchmark.version` had to be invented from
outside the contract (the pinned submodule tag/SHA, like the old scalar
`benchmarkVersion`). We add a top-level authored suite identity that mirrors the
existing `dataset.name`/`dataset.version` and the case `id`/`title` split:

- `name` (REQUIRED, string): the stable machine id of the suite. Distinct from
  `group` (a flat label coordinating multi-file benchmarks) and from `title`.
- `version` (REQUIRED, string): the authored suite revision, human-maintained and
  bumped deliberately when the suite changes — the same intent-tag discipline as
  `dataset.version`.
- `title` is unchanged: the free-text human label that MAY change freely.

`report.benchmark.{name,version}` SHALL source directly from these authored
fields. The invariant validator SHALL require both. Chosen over option (b) in
#18 (document `report.benchmark.version` as the pinned tag and derive `name` from
`group`/`title`): the implementer preferred (a), and an explicit authored
identity keeps the report self-describing from its inputs, consistent with how
`dataset.{name,version}` already works.

**Out of scope — `report.results` keying.** Contract v2's report-structure
requirement describes `results` as "keyed by benchmark title". This change does
NOT touch that keying. The new suite `name` is provenance carried in
`report.benchmark`; it is not repurposed as the `results` map key. Any re-keying
of `results` is a separate future decision. (Minor tension: the merged report
spec's prose says "keyed by benchmark title" — this change deliberately leaves
that sentence as-is rather than opening the keying question here.)

### D-2. Both scenarios use `sink: csv`; scenario distinction is the load boundary (#5, #18.2)

Contract v2 paired `end_to_end` → `sink: csv` and `preloaded_repeated` →
`sink: table`/`memory`. Two problems: a `table`/`memory` result can be something
a query optimizer prunes or under-measures (defeating the point of a timed
extract), and it measures extract cost on a DIFFERENT basis from `end_to_end`, so
the scenarios differ by more than the load boundary and their numbers are not
directly comparable.

Change: BOTH scenarios SHALL use (and the spec SHALL recommend) `sink: csv` — a
full materialization of the result to a written file. This makes the timed region
always include a real materialization the optimizer cannot prune, and measures
extract on the same basis for both. The scenario distinction becomes PURELY the
load boundary:

| scenario | timed region (phases) | load timed? | sink |
|----------|-----------------------|-------------|------|
| `end_to_end` | `load` + `execute` + `extract` | yes (the one-off cost being measured) | `csv` |
| `preloaded_repeated` | `execute` + `extract` | no (load excluded, amortized) | `csv` |

The `sink` enum stays `{table, csv, memory, other}` — no schema change. The
per-scenario `csv` expectation is a spec-level SHALL, so a mismatched sink is a
spec violation, not a schema-validation failure. Warmup semantics are unchanged
from contract v2 (`end_to_end`: no dataset warmup; `preloaded_repeated`: query
warmup iterations discarded).

### D-3. Reduce the required `stats` set; keep `samplesMs` (#5, #18.3)

Contract v2 required `stats: {mean, min, max, stddev, p50, p95}` plus optional
`ci95`. At the small SingleShotTime sample counts (advisory `>= 7`), `p50`/`p95`
are noisy and carry little signal. Change the REQUIRED set to:

```json
"stats": {
  "mean": 0.0, "stddev": 0.0, "min": 0.0, "max": 0.0, "median": 0.0,
  "p95": 0.0,                        // OPTIONAL
  "ci95": { "lo": 0.0, "hi": 0.0 }   // OPTIONAL
}
```

- `median` REPLACES `p50` in the required set — a clearer name for the required
  middle value. (`p50` and `median` are the same statistic; the required field is
  now named `median`.)
- Richer percentiles (`p95`, and any others) and `ci95` become OPTIONAL.
- Raw `samplesMs` stays REQUIRED (unchanged), so any consumer — including the #11
  JMH export — can recompute whatever percentiles it wants from the raw data.

Updated JMH `primaryMetric` projection:

| JMH primaryMetric field | source |
|-------------------------|--------|
| `score` | `stats.mean` |
| `scoreError` | half-width of `stats.ci95` (if present, else omitted) |
| `scorePercentiles` | `{ "50.0": median, "100.0": max, "0.0": min }` plus any optional percentiles present (e.g. `"95.0": p95`); a consumer MAY recompute richer percentiles from `samplesMs` |
| `scoreUnit` | `ms/op` (SingleShotTime) |
| `rawData` | `samplesMs` |

## Risks / Trade-offs

- **Dropping required `p95`/`p50` loses a precomputed percentile for consumers
  that relied on it** → mitigated: `samplesMs` stays required, so any percentile
  is recomputable; and at these sample counts the precomputed percentile was noise
  anyway. `p95` remains OPTIONAL for producers that still want to publish it.
- **`sink: csv` for `preloaded_repeated` adds a real file write to every timed
  query sample** → intended: it is precisely the materialization we want inside
  the timed region so the optimizer cannot prune it, and it keeps the two
  scenarios comparable.
- **Authored suite `version` is a human discipline** → same trade-off as
  `dataset.version` (contract v2 D-D.1): explicitness is the benefit; the author
  bumps it deliberately when the suite changes.

## Out of scope

- Re-keying `report.results` (D-1) — unchanged from contract v2.
- Any dataset / checkfile / byte change — no re-bless.
- The JMH export (#11) — this only reshapes the stats it consumes.
