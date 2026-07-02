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
descriptor, and `results` keyed by the stable suite `name` (the authored
machine id, NOT the mutable `title`), consistent with how a case is referenced
by its stable `id` and a dataset by its `name`/`version`. The `implementation`
SHALL separate the execution engine from an optional language binding and an
optional variant: `implementation.engine` (`{ name, version }`, REQUIRED) is the
thing that actually runs the work; `implementation.binding` (`{ name, version }`,
OPTIONAL) is a language wrapper sharing that same engine (a Python wrapper over a
JVM engine is a binding, not a distinct engine); `implementation.variant`
(string, OPTIONAL) is a config/mode discriminator. Each result SHALL declare its
`size` and a `cases` array; each case SHALL declare its `id` (matching the
benchmark file's case `id` and the checkfile assertion key) and a `status` that is
one of `ok`, `count_mismatch`, `generation_error`, `execution_error`, `timeout`,
or `malformed`, and MAY declare `inputRows`, `outputRows`, `samplesMs`, `stats`,
`phaseSamplesMs`, and an OPTIONAL free-text `message`. The status values are
defined as: `ok` (the case ran and its output row count matched its checkfile
assertion, or none was present); `count_mismatch` (the output row count differed
from a present, non-variance-permitted checkfile assertion); `generation_error`
(generation failed to produce the case's input data); `execution_error` (the
engine ran and raised while executing the case); `timeout` (the case exceeded a
time budget on generation or execution and was abandoned — distinct from
`execution_error`, where the engine actually ran and raised); and `malformed` (the
case's inputs or outputs were structurally invalid — for example a materialized
resource that will not parse, or a result that cannot be materialized to the sink
— distinct from `generation_error`, where generation produced no data at all). The
OPTIONAL `message` is a short human-readable explanation of a non-`ok` outcome
(most useful for `generation_error`, `execution_error`, `timeout`, and
`malformed`); it is advisory context for a human reader, never a machine-parsed
field, and an `ok` case omits it. A report containing only the cases a run
completed — each with its status — is schema-valid and meaningful, so a partial or
interrupted run still produces a conforming report.

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

#### Scenario: timeout and malformed are accepted statuses

- **WHEN** a case reports `status` `timeout` or `malformed`
- **THEN** schema validation passes, because both are members of the six-value
  taxonomy `{ok, count_mismatch, generation_error, execution_error, timeout,
  malformed}`

#### Scenario: message is optional

- **WHEN** a failed case carries a free-text `message` explaining the failure
- **THEN** schema validation passes; and a case that omits `message` also validates,
  because `message` is OPTIONAL

#### Scenario: Partial run report is valid

- **WHEN** a report contains only the cases a run completed before it was
  interrupted, each with its status
- **THEN** it validates against `benchmark-report.schema.json` and is meaningful —
  a failing or interrupted case does not invalidate the report

#### Scenario: Case result carries its id

- **WHEN** a report's per-case result is inspected
- **THEN** it declares the `id` of the benchmark case it corresponds to, matching
  the checkfile assertion key, so results tie to assertions by a stable id rather
  than a mutable title

#### Scenario: Results are keyed by the stable suite name

- **WHEN** a report is produced from a benchmark file that declares suite
  `name` and `title`
- **THEN** the `results` map is keyed by the authored suite `name`, not by the
  free-text `title`, so the key is stable across title edits and consistent with
  `report.benchmark.name`

### Requirement: Reverse-ETL measurement model

The report SHALL describe work as a reverse-ETL of three phases — `load` (source
JSON into the implementation's internal representation, possibly empty),
`execute` (evaluate the ViewDefinition), and `extract` (materialize the flat
output). The `measurement` descriptor SHALL declare a `scenario`, which `phases`
the samples cover, the `sink`, and the `warmup` and `iterations` counts actually
used. BOTH scenarios SHALL use — and the spec RECOMMENDS — `sink: csv`: a full
materialization of the result to a written file, so that the timed region always
includes a real materialization a query optimizer cannot prune or under-measure,
and so that extract cost is measured on the same basis across scenarios (keeping
their numbers directly comparable). The scenario distinction is PURELY whether the
`load` phase is inside the timed region, NOT the sink. `scenario` SHALL be one of:

- `end_to_end`: each measured sample times ONE full one-off conversion of the
  source NDJSON to CSV, covering phases `load` + `execute` + `extract`. "One-off"
  describes the CONVERSION — a single conversion happens per measured sample —
  NOT a single measurement. The engine/server MAY be pre-warmed generally but
  MUST NOT be warmed with this dataset; `sink` SHALL be `csv` (a written file).
- `preloaded_repeated`: the data is preloaded into the implementation's most
  suitable representation with that load EXCLUDED from timing, and each measured
  sample times the query (phases `execute` + `extract`) over the preloaded data.
  Query warmup iterations are discarded; `sink` SHALL be `csv` (a written file) —
  a full materialization each iteration, never a lazy count and never an
  optimizer-prunable in-memory result.

BOTH scenarios SHALL collect a sufficient number of measured samples for
meaningful statistics and SHALL report the raw individual samples in `samplesMs`.
BOTH scenarios SHALL be understood as JMH SingleShotTime (`ss`) — time
per-operation on a relatively long-running operation — and SHALL NOT be reported
as throughput (`avgt`). The `sink` enum itself is unchanged
(`{table, csv, memory, other}`); the per-scenario `csv` expectation is a
spec-level SHALL, so a mismatched sink is a spec (not schema) violation.

#### Scenario: Measurement declares its scenario, timed region, and sink

- **WHEN** a report is produced
- **THEN** its `measurement` declares a `scenario` (`end_to_end` or
  `preloaded_repeated`), the `phases` that scenario times, a `sink`, and the
  `warmup`/`iterations` used

#### Scenario: Both scenarios use a csv sink

- **WHEN** a report declares either `scenario`
- **THEN** its `sink` is `csv` (a full materialization to a written file), so the
  timed region includes a real materialization and extract cost is comparable
  across scenarios

#### Scenario: Scenario distinction is the load boundary, not the sink

- **WHEN** an `end_to_end` report and a `preloaded_repeated` report are compared
- **THEN** they differ only in whether the `load` phase is inside the timed region
  (`end_to_end` times `load` + `execute` + `extract`; `preloaded_repeated` times
  `execute` + `extract`), and NOT in their `sink`, which is `csv` for both

#### Scenario: end_to_end times a full one-off conversion per sample

- **WHEN** a report declares `scenario: end_to_end`
- **THEN** each `samplesMs` entry is the time of one full NDJSON→CSV conversion
  (`load` + `execute` + `extract`) with `sink: csv`, and there are enough samples
  for meaningful statistics — not a single measurement

#### Scenario: preloaded_repeated excludes load and materializes each sample to csv

- **WHEN** a report declares `scenario: preloaded_repeated`
- **THEN** the load is excluded from every `samplesMs` entry (only `execute` +
  `extract` are timed), each sample materializes the result to `csv` (not a lazy
  count and not an optimizer-prunable in-memory result), and query warmup
  iterations are discarded

### Requirement: Size is a result dimension and reports are traceable

A report SHALL record the `size` of each result so that runtime can be plotted
against size for a fixed (benchmark, implementation), enabling scaling-curve
analysis. The report SHALL also be traceable to the exact suite and data that
produced it: it SHALL record the benchmark identity it ran
(`benchmark.name`/`benchmark.version`), SOURCED DIRECTLY from the authored suite
`name`/`version` in the benchmark file (not invented from a pinned tag/commit
outside the contract); the dataset identity it ran against
(`dataset.name`/`dataset.version`, matching the checkfile it verified); and the
dataset resource counts observed at each size (mirroring the checkfile's
`resourceCounts`). The FHIR version the numbers were produced against SHALL be
recordable. The `results` map is keyed by the authored suite `name` (see the
Report structure requirement), the same stable identity `report.benchmark.name`
sources from.

#### Scenario: Results are size-keyed for scaling curves

- **WHEN** the same benchmark is run at sizes `s` and `m`
- **THEN** each result records its `size`, so the two points can be compared as a
  scaling curve

#### Scenario: Report records benchmark and dataset identity

- **WHEN** a report is produced
- **THEN** it records the benchmark `name`/`version` it ran — sourced directly
  from the authored suite `name`/`version` — and the dataset `name`/`version` it
  ran against, matching the checkfile, so the numbers are traceable to the exact
  suite and data

#### Scenario: Report records dataset resource counts

- **WHEN** a report is produced at size `m`
- **THEN** it records the dataset resource counts observed at `m`, mirroring the
  checkfile's `resourceCounts`

### Requirement: Defined statistics and inputRows

A case's `stats` SHALL conform to a defined basic-statistics shape rather than a
free-form object: the fields are EXACTLY `mean`, `stddev`, `min`, `max`, and
`median` (all in the same time unit as `samplesMs`), where `median` is the middle
value (the statistic formerly required as `p50`, renamed for clarity). These five
are the only permitted fields — the schema sets `additionalProperties` false, so a
`stats` carrying any other key (for example `p95` or `ci95`) is rejected. `stats`
SHALL be reported alongside the raw `samplesMs`, which SHALL remain REQUIRED so
that any consumer — including the JMH export — can recompute whatever percentiles
it wants from the raw data. The report SHOULD carry at least a RECOMMENDED minimum
of 7 samples for the statistics to be meaningful; this minimum is ADVISORY guidance
and SHALL NOT be enforced as a hard `minItems` floor in the report schema. The
shape SHALL be projectable onto a JMH `primaryMetric` (score = `mean`,
scorePercentiles from `median` plus `min`/`max`, and rawData = `samplesMs`);
`scoreError` is NOT a precomputed field — a consumer recomputes it, along with any
richer percentiles, from the raw `samplesMs`. `inputRows` SHALL be defined
precisely as the number of input resources OF THE CASE'S `view.resource` TYPE that
were loaded for that (case, size) — the denominator for throughput/normalization —
distinct from `outputRows` and from the total resource count across all types.

#### Scenario: stats has the defined shape

- **WHEN** a case reports `stats`
- **THEN** it contains exactly `mean`, `stddev`, `min`, `max`, and `median`, and no
  other field, not an arbitrary free-form object

#### Scenario: Required fields enforced; any extra field rejected

- **WHEN** a case's `stats` omits `median` (or another required field)
- **THEN** schema validation fails; and a `stats` that carries any field beyond the
  five (for example `p95` or `ci95`) is also rejected, because the shape is exactly
  `{mean, stddev, min, max, median}`

#### Scenario: Raw samples remain available for recomputation

- **WHEN** a consumer needs a percentile that `stats` does not precompute
- **THEN** it recomputes it from the REQUIRED raw `samplesMs`, which the report
  always carries

#### Scenario: stats feeds a JMH primaryMetric

- **WHEN** the statistics are exported to a JMH `primaryMetric`
- **THEN** `score` maps from `mean`, `scorePercentiles` from `median` plus
  `min`/`max` (with richer percentiles recomputed from `samplesMs`), and `rawData`
  from `samplesMs`; `scoreError` is recomputed from `samplesMs` rather than read
  from a precomputed field

#### Scenario: inputRows counts the case's resource type

- **WHEN** a case whose `view.resource` is `Condition` reports `inputRows`
- **THEN** `inputRows` is the number of `Condition` resources loaded at that
  size, not the output row count and not the total across all resource types

