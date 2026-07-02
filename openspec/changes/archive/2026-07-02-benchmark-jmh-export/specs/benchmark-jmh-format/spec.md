## ADDED Requirements

### Requirement: JMH export is a lossy projection of the native report

The system SHALL be able to produce a JMH-compatible JSON export, consumable by
JMH Visualizer, as a LOSSY PROJECTION of a conforming
`benchmark-report.json` — the native report remains the sole source of truth, and
the export is a downstream, viewer-facing derivative that carries strictly less
than the report and invents nothing not derivable from it. The export SHALL be
computable purely from a conforming native report (its `benchmark`/`dataset`
identity, each result's `size`, and each case's `status`, `stats`, `samplesMs`,
and `outputRows`), with no dependency on the live run, the engine, the source
data, or the network, so it is regenerable from any archived report. Producing the
export is OPTIONAL — a conforming run need not emit it — but WHEN produced it SHALL
follow this format. This capability adds NO requirement to the native
`benchmark-report-format` and makes NO change to `benchmark-report.schema.json`.

#### Scenario: Export is derived only from a conforming report

- **WHEN** the projection is applied to a conforming `benchmark-report.json`
- **THEN** it produces the JMH export from that report alone — from the report's
  benchmark/dataset identity, each result's size, and each case's status, stats,
  samplesMs, and outputRows — without reading the engine, the source data, or the
  network

#### Scenario: Native report stays authoritative and complete

- **WHEN** an export is produced from a report
- **THEN** the native report is unchanged and remains the source of truth, and the
  export carries strictly less than the report (no failing cells, no phase samples,
  no environment) and adds nothing not derivable from the report

#### Scenario: Export is optional

- **WHEN** a run produces a conforming native report but emits no JMH export
- **THEN** the run is still conformant, because the export is OPTIONAL; and WHEN it
  does emit an export, that export follows this format

### Requirement: Only verified `ok` cells are exported

The JMH export SHALL include ONLY cases whose `status` is `ok` and which carry
usable `samplesMs`, and SHALL EXCLUDE every non-`ok` cell —
`count_mismatch`, `generation_error`, `execution_error`, `timeout`, and
`malformed` — which remains recorded only in the native report. A `count_mismatch`
cell in particular (a fast-but-wrong result) SHALL NOT appear in the export. An
`ok` case that carries no usable `samplesMs` is not exportable. WHEN no case in a
`(benchmark, size, implementation)` triple is exportable, the system SHALL write
NO export file for that triple.

#### Scenario: Only ok cells with samples reach the export

- **WHEN** a report contains a mix of `ok`, `count_mismatch`, `timeout`,
  `malformed`, `execution_error`, and `generation_error` cases
- **THEN** the JMH export contains an entry for each `ok` case that has usable
  `samplesMs`, and no entry for any non-`ok` case

#### Scenario: A count_mismatch is never exported

- **WHEN** a case reports `count_mismatch` (a result whose row count did not match
  its checkfile assertion)
- **THEN** it does NOT appear in the JMH export, and it remains recorded in the
  native report

#### Scenario: A triple with no exportable cell produces no file

- **WHEN** every case in a `(benchmark, size, implementation)` triple is non-`ok`
  (or `ok` but without usable samples)
- **THEN** no JMH export file is written for that triple

### Requirement: One export file per benchmark, size, and implementation triple

The system SHALL split the JMH export into ONE file per
`(benchmark, size, implementation)` triple, named so that running different
benchmarks — or the same benchmark at different sizes — against the same
implementation produces DISTINCT files that OVERLAY in JMH Visualizer rather than
overwrite one another. The file name SHALL incorporate all three of the benchmark,
the size, and the implementation (proposed `<benchmark>-<size>-<impl>.jmh.json`),
with each segment sanitized to be filename-safe.

#### Scenario: Two benchmarks on one implementation do not collide

- **WHEN** two different benchmarks are exported for the same implementation
- **THEN** the system writes a separate JMH file for each benchmark, and neither
  overwrites the other

#### Scenario: Two sizes of one benchmark do not collide

- **WHEN** the same benchmark is exported at two different sizes against the same
  implementation
- **THEN** the system writes a separate JMH file per size, and neither overwrites
  the other, so the two size points can be overlaid

#### Scenario: File name carries benchmark, size, and implementation

- **WHEN** a benchmark `<benchmark>` at size `<size>` against implementation
  `<impl>` is exported
- **THEN** the file name incorporates all three (e.g.
  `<benchmark>-<size>-<impl>.jmh.json`), with each segment sanitized to be
  filename-safe

### Requirement: Each ok case maps to a single-shot JMH primaryMetric

The system SHALL map each exported case to one JMH benchmark entry with
`mode: "ss"` (SingleShotTime — both measurement scenarios are single-shot) and a
`primaryMetric` whose `scoreUnit` is `"ms/op"`. Within `primaryMetric`: `score`
SHALL be the case's `stats.mean`; `scoreError` SHALL be the 95% confidence
half-width of the mean RECOMPUTED from the raw `samplesMs` (the native report's
`stats` deliberately carries no confidence interval); `scorePercentiles` SHALL be a
percentile map RECOMPUTED from the raw `samplesMs`; and `rawData` SHALL be the raw
`samplesMs` in JMH's nested array-of-arrays shape (a single inner array holding the
samples). The recomputation methods are pinned so exports are comparable across
implementations: `scoreError` SHALL be `1.959964 * stddev / sqrt(n)` using the
sample (n−1) standard deviation, and SHALL be `0` when `n < 2` — a
normal-approximation two-sided 95% half-width, NOT a Student-t interval;
`scorePercentiles` SHALL be computed over the sorted samples at the fixed set
`{0.0, 50.0, 90.0, 95.0, 99.0, 99.9, 100.0}` by linear interpolation between ranks
(`rank = p/100 * (n − 1)`), keyed by the percentile as a string. Both recomputation
methods mirror the reference harness (`dev/sof-benchmark` `results-reporting`)
verbatim.

#### Scenario: Entry is single-shot in ms/op

- **WHEN** an `ok` case is exported
- **THEN** its JMH entry has `mode: "ss"` and `primaryMetric.scoreUnit: "ms/op"`

#### Scenario: score is the reported mean, rawData is the raw samples

- **WHEN** an `ok` case with `stats.mean` `m` and `samplesMs` `[…]` is exported
- **THEN** `primaryMetric.score` equals `m` and `primaryMetric.rawData` is the raw
  `samplesMs` in JMH's nested array shape (a single inner array of the samples)

#### Scenario: scoreError is recomputed from samplesMs by the pinned method

- **WHEN** an `ok` case is exported
- **THEN** `primaryMetric.scoreError` equals `1.959964 * stddev / sqrt(n)` over the
  raw `samplesMs` (sample n−1 standard deviation), and equals `0` when fewer than
  two samples are present — recomputed from `samplesMs`, not read from the report,
  which carries no confidence interval

#### Scenario: scorePercentiles are recomputed from samplesMs by the pinned method

- **WHEN** an `ok` case is exported
- **THEN** `primaryMetric.scorePercentiles` is computed over the sorted
  `samplesMs` at `{0.0, 50.0, 90.0, 95.0, 99.0, 99.9, 100.0}` by linear
  interpolation between ranks, keyed by the percentile as a string, recomputed from
  the raw samples rather than read from a precomputed field

### Requirement: Row count is carried as a secondary metric

The system SHALL carry each exported case's output row count as a JMH
`secondaryMetrics.rows` metric, sourced from the case's `outputRows`, so the
produced row count is visible alongside the timed score without being conflated
with it. The `rows` metric's `score` SHALL be the `outputRows` count with a
`scoreUnit` naming it a row count (e.g. `"rows"`).

#### Scenario: outputRows becomes secondaryMetrics.rows

- **WHEN** an `ok` case with `outputRows` `r` is exported
- **THEN** its JMH entry carries `secondaryMetrics.rows` whose `score` is `r` and
  whose `scoreUnit` names it a row count, distinct from the timed `primaryMetric`

### Requirement: JMH benchmark name and axes carry our identity

The system SHALL compose each JMH entry's `benchmark` NAME from this project's
identity as `<benchmark.name>.<case.id>` — the authored suite `name` (the stable
machine id, from `report.benchmark.name`) joined to the stable case `id` — and
SHALL make the `size` and the `implementation` recoverable from the entry so the
Visualizer can axis on them (proposed: as JMH `params` AND encoded in the file
name). The implementation axis SHALL be fed by the structured `implementation`
(`engine`, optional `binding`, optional `variant`) the native report carries, from
which a stable, filename-safe implementation identifier is derived.

#### Scenario: benchmark name joins suite name and case id

- **WHEN** a case `id` `c` from a benchmark whose suite `name` is `b` is exported
- **THEN** the JMH entry's `benchmark` name is `b.c` (the authored suite `name`
  joined to the stable case `id`), not a title or an invented label

#### Scenario: size and implementation are recoverable as axes

- **WHEN** an entry is exported for size `<size>` and a structured
  `implementation`
- **THEN** both the `size` and the implementation are recoverable from the entry
  (as JMH `params` and/or the file name) so the Visualizer can group and axis on
  them

#### Scenario: Implementation axis derives from structured implementation identity

- **WHEN** the report's `implementation` declares an `engine` and optionally a
  `binding` and a `variant`
- **THEN** the export derives a stable, filename-safe implementation identifier
  from that structured identity to feed the implementation axis
