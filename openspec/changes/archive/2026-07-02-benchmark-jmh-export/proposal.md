## Why

The native benchmark report (`benchmark-report.schema.json`) is the source of
truth: it records EVERY case a run touched — successes and failures alike — with
raw per-sample timings, statistics, row counts, and a status taxonomy. It is a
faithful, lossless record. It is NOT, however, a format any existing tooling
visualizes: to compare implementations, sizes, and runs on a chart, an
implementer today has to hand-roll their own plotting.

The reference harness (`dev/sof-benchmark` `results-reporting`) already solved
this by emitting a second, LOSSY projection of its native log in the format that
[JMH Visualizer](https://github.com/jzillmann/jmh-visualizer) consumes — a
mature, off-the-shelf viewer for JMH JSON. Because both our measurement scenarios
(`end_to_end`, `preloaded_repeated`) are already defined as JMH SingleShotTime
(`ss`, `ms/op`) and the native report retains raw `samplesMs` precisely so a
consumer can recompute whatever it needs, our report is directly projectable onto
JMH's `primaryMetric` shape. This change specifies that projection so this
reference implementation — like the reference harness — ships a viewer-ready
export alongside the native report, and so any other implementation can produce
the same export from its own conforming report.

The problems this change fixes:

- **No viewer-ready output.** The native report is the right source of truth but
  the wrong format for a human comparing runs on a chart. There is a standard
  viewer (JMH Visualizer) and a standard format (JMH JSON); we do not emit it.

- **`stats` deliberately dropped `ci95`/`p95` (the #22-era change).** The native
  report's `stats` is exactly `{mean, stddev, min, max, median}` with
  `additionalProperties: false` — a consumer that wants a 95% confidence interval
  or richer percentiles MUST recompute them from the raw `samplesMs`, which the
  report retains for exactly this reason. Nothing in this project yet SPECIFIES
  how that recomputation is done for the JMH `scoreError`/`scorePercentiles`,
  leaving it to each implementer to guess. The reference harness pins a method
  (normal-approximation 95% half-width, JMH-style linear-interpolation
  percentiles); this change adopts it so exports are comparable.

- **Failures must not pollute the chart.** The native report keeps failing cells
  (`count_mismatch`, `timeout`, `malformed`, `execution_error`,
  `generation_error`); a benchmark chart must show only VERIFIED numbers. There is
  no specified rule that failures are excluded from the export. The reference
  harness excludes all non-`ok` cells; this change states that rule.

## What Changes

This change ADDS ONE new capability spec, `benchmark-jmh-format`, defining a
JMH-compatible JSON export as a LOSSY PROJECTION of the native benchmark report.
It touches NO existing spec's requirements and makes NO change to
`benchmark-report.schema.json` — the native report remains the sole source of
truth (see `design.md`, D1 for why this is a new capability rather than a delta on
`benchmark-report-format`).

### A. A JMH-compatible export alongside the native report — new capability

Define the JMH export as a pure, lossy PROJECTION of a conforming
`benchmark-report.json`: the native report stays authoritative and complete; the
export is a viewer-facing derivative that carries LESS than the report (no
failures, no phase samples, no environment) and INVENTS nothing not derivable from
the report. Emitting the export is OPTIONAL — a conforming run need not produce it
— but WHEN produced it SHALL follow this format.

### B. Verified cells only

Only cases with `status: ok` are exported. Every non-`ok` cell —
`count_mismatch`, `generation_error`, `execution_error`, `timeout`, `malformed` —
is EXCLUDED from the JMH export and remains only in the native report. A cell with
no usable `samplesMs` is likewise not exportable. A report with no `ok` cells for
a given triple produces no export file for that triple.

### C. One file per (benchmark, size, implementation) triple

The export SHALL be split into one file per `(benchmark, size, implementation)`
triple, named so that multiple runs — different benchmarks, different sizes, or the
same benchmark at different sizes against the same implementation — OVERLAY in the
Visualizer rather than overwrite one another. The proposed name is
`<benchmark>-<size>-<impl>.jmh.json` (mirroring the reference harness
`output_stem`), each segment sanitized for filename safety.

### D. JMH `primaryMetric` mapping (score / scoreError / percentiles / rawData)

Each exported case becomes one JMH benchmark entry with `mode: "ss"`,
`scoreUnit: "ms/op"`, and a `primaryMetric` in which:

- `score` = the case's `stats.mean`;
- `scoreError` = the 95% confidence half-width of the mean, RECOMPUTED from
  `samplesMs` (NOT read from the report, which no longer carries a CI);
- `scorePercentiles` = the JMH percentile map, RECOMPUTED from `samplesMs`;
- `rawData` = the raw `samplesMs`, in JMH's nested `[[...]]` shape.

A `secondaryMetrics.rows` metric carries the case's `outputRows`. The JMH
`benchmark` name is composed from our identity as `<benchmark.name>.<case.id>`,
and the size and implementation are carried as JMH `params` (and in the filename)
so the Visualizer can axis on them.

## Capabilities

### Added Capabilities

- `benchmark-jmh-format`: a JMH-compatible JSON export — a lossy projection of the
  native benchmark report — that includes only `ok`, row-count-verified cells; is
  split one file per `(benchmark, size, implementation)` triple so runs overlay in
  JMH Visualizer; maps each case to a `mode: ss`, `ms/op` `primaryMetric` whose
  `score` is `stats.mean`, whose `scoreError` and `scorePercentiles` are RECOMPUTED
  from the raw `samplesMs`, and whose `rawData` is the raw `samplesMs`; carries
  `outputRows` as a `secondaryMetrics.rows` metric; and names each JMH benchmark
  `<benchmark.name>.<case.id>` with size and implementation as `params`.

## Acceptance Criteria

- Given a native report with a mix of statuses, the projection emits JMH entries
  for the `ok` cells ONLY; no `count_mismatch`, `generation_error`,
  `execution_error`, `timeout`, or `malformed` cell appears in any export file.
- A report with no `ok` cells for a triple produces NO export file for that triple.
- Each JMH entry has `mode: "ss"`, `primaryMetric.scoreUnit: "ms/op"`,
  `primaryMetric.score` = the case's `stats.mean`, `primaryMetric.rawData` = the
  case's `samplesMs` (in JMH's nested array shape), and `secondaryMetrics.rows` =
  the case's `outputRows`.
- `primaryMetric.scoreError` equals the 95% confidence half-width RECOMPUTED from
  `samplesMs` by the pinned method (`design.md` D4), matching a hand-computed
  fixture; `scorePercentiles` is RECOMPUTED from `samplesMs` by the pinned method,
  matching a hand-computed fixture.
- Exports are split one file per `(benchmark, size, implementation)` triple, named
  so two benchmarks, or two sizes of one benchmark against one implementation, do
  not overwrite one another.
- The JMH `benchmark` name is `<benchmark.name>.<case.id>`, and size and
  implementation are recoverable from the entry (`params` and/or filename).
- No re-bless: the projection READS an existing report and touches no data, no
  checkfile, and `benchmark-report.schema.json` is unchanged.
- `bun test`, `bun run validate`, `bun run check-fmt`, and
  `openspec validate benchmark-jmh-export --strict` are all green.

## Impact

- NEW spec `benchmark-jmh-format` — authored by this change.
- `benchmark-report.schema.json`: UNCHANGED — the export is a projection, not a
  schema change. The native report remains the source of truth.
- Implementation phase (enumerated in `tasks.md`): a pure projection FUNCTION that
  reads a conforming `benchmark-report.json` and writes the JMH files, plus a thin
  CLI/flag to invoke it. No change to the runner's measurement or the report shape.

Out of scope (cross-referenced, NOT designed here):

- Any change to the native report format or `benchmark-report.schema.json` — the
  export is downstream of it and adds no requirements to it.
- A JMH export SCHEMA of our own — the format is JMH Visualizer's existing input
  contract, not a contract this project defines or validates.
- Publishing/hosting the exports or wiring them into the test-report site.
