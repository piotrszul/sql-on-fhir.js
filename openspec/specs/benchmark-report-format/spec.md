# benchmark-report-format Specification

## Purpose

Defines the benchmark result report format — a public contract
(`benchmark-report.schema.json`) that any implementation emits after running the
suite. The format captures the implementation under test, a reverse-ETL
measurement descriptor, and size-keyed results so that runtime can be analysed as
a scaling curve.
## Requirements
### Requirement: Report structure and status taxonomy

A benchmark result report SHALL conform to the `benchmark-report.schema.json`
public contract: it SHALL declare an `implementation`, a `measurement`
descriptor, and `results` keyed by benchmark title. The `implementation` SHALL
separate the execution engine from an optional language binding and an optional
variant: `implementation.engine` (`{ name, version }`, REQUIRED) is the thing
that actually runs the work; `implementation.binding` (`{ name, version }`,
OPTIONAL) is a language wrapper sharing that same engine (a Python wrapper over a
JVM engine is a binding, not a distinct engine); `implementation.variant`
(string, OPTIONAL) is a config/mode discriminator. Each result SHALL declare its
`size` and a `cases` array; each case SHALL declare its `id` (matching the
benchmark file's case `id` and the checkfile assertion key) and a `status` that is
one of `ok`, `count_mismatch`, `generation_error`, or `execution_error`, and MAY
declare `inputRows`, `outputRows`, `samplesMs`, `stats`, and `phaseSamplesMs`.

#### Scenario: Well-formed report is accepted

- **WHEN** a report with a structured `implementation` (a required `engine`), a
  `measurement`, and `results` is validated against
  `benchmark-report.schema.json`
- **THEN** validation passes

#### Scenario: Engine is required, binding and variant are optional

- **WHEN** a report declares `implementation.engine` but omits `binding` and
  `variant`
- **THEN** validation passes; and a report that omits `implementation.engine`
  fails validation

#### Scenario: Invalid status is rejected

- **WHEN** a case `status` is a value outside the defined taxonomy
- **THEN** schema validation fails

#### Scenario: Case result carries its id

- **WHEN** a report's per-case result is inspected
- **THEN** it declares the `id` of the benchmark case it corresponds to, matching
  the checkfile assertion key, so results tie to assertions by a stable id rather
  than a mutable title

### Requirement: Reverse-ETL measurement model

The report SHALL describe work as a reverse-ETL of three phases — `load` (source
JSON into the implementation's internal representation, possibly empty),
`execute` (evaluate the ViewDefinition), and `extract` (materialize the flat
output). The `measurement` descriptor SHALL declare a `scenario`, which `phases`
the samples cover, the `sink`, and the `warmup` and `iterations` counts actually
used. `scenario` SHALL be one of:

- `end_to_end`: each measured sample times ONE full one-off conversion of the
  source NDJSON to CSV, covering phases `load` + `execute` + `extract`. "One-off"
  describes the CONVERSION — a single conversion happens per measured sample —
  NOT a single measurement. The engine/server MAY be pre-warmed generally but
  MUST NOT be warmed with this dataset; `sink` SHALL be `csv` (a written file).
- `preloaded_repeated`: the data is preloaded into the implementation's most
  suitable representation with that load EXCLUDED from timing, and each measured
  sample times the query (phases `execute` + `extract`) over the preloaded data.
  Query warmup iterations are discarded; `sink` SHALL be a materialized result
  (`table` or `memory`), never a lazy count.

BOTH scenarios SHALL collect a sufficient number of measured samples for
meaningful statistics and SHALL report the raw individual samples in `samplesMs`.
BOTH scenarios SHALL be understood as JMH SingleShotTime (`ss`) — time
per-operation on a relatively long-running operation — and SHALL NOT be reported
as throughput (`avgt`).

#### Scenario: Measurement declares its scenario, timed region, and sink

- **WHEN** a report is produced
- **THEN** its `measurement` declares a `scenario` (`end_to_end` or
  `preloaded_repeated`), the `phases` that scenario times, a `sink`, and the
  `warmup`/`iterations` used

#### Scenario: end_to_end times a full one-off conversion per sample

- **WHEN** a report declares `scenario: end_to_end`
- **THEN** each `samplesMs` entry is the time of one full NDJSON→CSV conversion
  (`load` + `execute` + `extract`) with `sink: csv`, and there are enough samples
  for meaningful statistics — not a single measurement

#### Scenario: preloaded_repeated excludes load and materializes each sample

- **WHEN** a report declares `scenario: preloaded_repeated`
- **THEN** the load is excluded from every `samplesMs` entry (only `execute` +
  `extract` are timed), each sample materializes a result (`table`/`memory`, not
  a lazy count), and query warmup iterations are discarded

### Requirement: Size is a result dimension and reports are traceable

A report SHALL record the `size` of each result so that runtime can be plotted
against size for a fixed (benchmark, implementation), enabling scaling-curve
analysis. The report SHALL also be traceable to the exact suite and data that
produced it: it SHALL record the benchmark identity it ran
(`benchmark.name`/`benchmark.version`, generalizing the former scalar
`benchmarkVersion`), the dataset identity it ran against
(`dataset.name`/`dataset.version`, matching the checkfile it verified), and the
dataset resource counts observed at each size (mirroring the checkfile's
`resourceCounts`). The FHIR version the numbers were produced against SHALL be
recordable.

#### Scenario: Results are size-keyed for scaling curves

- **WHEN** the same benchmark is run at sizes `s` and `m`
- **THEN** each result records its `size`, so the two points can be compared as a
  scaling curve

#### Scenario: Report records benchmark and dataset identity

- **WHEN** a report is produced
- **THEN** it records the benchmark `name`/`version` it ran and the dataset
  `name`/`version` it ran against, matching the checkfile, so the numbers are
  traceable to the exact suite and data

#### Scenario: Report records dataset resource counts

- **WHEN** a report is produced at size `m`
- **THEN** it records the dataset resource counts observed at `m`, mirroring the
  checkfile's `resourceCounts`

### Requirement: Defined statistics and inputRows

A case's `stats` SHALL conform to a defined basic-statistics shape rather than a
free-form object: `mean`, `min`, `max`, `stddev`, `p50`, and `p95` (all in the
same time unit as `samplesMs`), plus an OPTIONAL `ci95`. `stats` SHALL be
reported alongside the raw `samplesMs`. The report SHOULD carry at least a
RECOMMENDED minimum of 7 samples for the statistics to be meaningful; this minimum
is ADVISORY guidance and SHALL NOT be enforced as a hard `minItems` floor in the
report schema. The shape SHALL be
projectable onto a JMH `primaryMetric` (score = `mean`, scoreError from `ci95`,
scorePercentiles from `p50`/`p95`/`min`/`max`, rawData = `samplesMs`).
`inputRows` SHALL be defined precisely as the number of input resources OF THE
CASE'S `view.resource` TYPE that were loaded for that (case, size) — the
denominator for throughput/normalization — distinct from `outputRows` and from
the total resource count across all types.

#### Scenario: stats has the defined shape

- **WHEN** a case reports `stats`
- **THEN** it contains `mean`, `min`, `max`, `stddev`, `p50`, and `p95` (and
  optionally `ci95`), not an arbitrary free-form object

#### Scenario: stats feeds a JMH primaryMetric

- **WHEN** the statistics are exported to a JMH `primaryMetric`
- **THEN** `score` maps from `mean`, `scoreError` from `ci95`,
  `scorePercentiles` from the percentiles, and `rawData` from `samplesMs`,
  without recomputation

#### Scenario: inputRows counts the case's resource type

- **WHEN** a case whose `view.resource` is `Condition` reports `inputRows`
- **THEN** `inputRows` is the number of `Condition` resources loaded at that
  size, not the output row count and not the total across all resource types

