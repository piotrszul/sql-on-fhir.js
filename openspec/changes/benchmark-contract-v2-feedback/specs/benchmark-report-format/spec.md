## MODIFIED Requirements

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
recordable. How `results` is keyed is unchanged by this requirement.

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
free-form object: the REQUIRED fields are `mean`, `stddev`, `min`, `max`, and
`median` (all in the same time unit as `samplesMs`), where `median` is the middle
value (the statistic formerly required as `p50`, renamed for clarity). Richer
percentiles (e.g. `p95`) and `ci95` are OPTIONAL. `stats` SHALL be reported
alongside the raw `samplesMs`, which SHALL remain REQUIRED so that any consumer —
including the JMH export — can recompute whatever percentiles it wants from the
raw data. The report SHOULD carry at least a RECOMMENDED minimum of 7 samples for
the statistics to be meaningful; this minimum is ADVISORY guidance and SHALL NOT
be enforced as a hard `minItems` floor in the report schema. The shape SHALL be
projectable onto a JMH `primaryMetric` (score = `mean`, scoreError from `ci95`
when present, scorePercentiles from `median` plus any optional percentiles present
plus `min`/`max` — with a consumer free to recompute richer percentiles from
`samplesMs` — and rawData = `samplesMs`). `inputRows` SHALL be defined precisely
as the number of input resources OF THE CASE'S `view.resource` TYPE that were
loaded for that (case, size) — the denominator for throughput/normalization —
distinct from `outputRows` and from the total resource count across all types.

#### Scenario: stats has the defined shape

- **WHEN** a case reports `stats`
- **THEN** it contains the required `mean`, `stddev`, `min`, `max`, and `median`,
  and MAY additionally carry optional richer percentiles (e.g. `p95`) and `ci95`,
  not an arbitrary free-form object

#### Scenario: Required median, optional richer percentiles

- **WHEN** a case's `stats` omits `median` (or another required field)
- **THEN** schema validation fails; and a `stats` that carries the required fields
  but omits `p95` and `ci95` is accepted, because richer percentiles and the
  confidence interval are OPTIONAL

#### Scenario: Raw samples remain available for recomputation

- **WHEN** a consumer needs a percentile that `stats` does not precompute
- **THEN** it recomputes it from the REQUIRED raw `samplesMs`, which the report
  always carries

#### Scenario: stats feeds a JMH primaryMetric

- **WHEN** the statistics are exported to a JMH `primaryMetric`
- **THEN** `score` maps from `mean`, `scoreError` from `ci95` (when present),
  `scorePercentiles` from `median` plus any optional percentiles plus `min`/`max`
  (or recomputed from `samplesMs`), and `rawData` from `samplesMs`

#### Scenario: inputRows counts the case's resource type

- **WHEN** a case whose `view.resource` is `Condition` reports `inputRows`
- **THEN** `inputRows` is the number of `Condition` resources loaded at that
  size, not the output row count and not the total across all resource types
