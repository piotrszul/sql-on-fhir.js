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
public contract: it SHALL declare an `implementation` (name and version), a
`measurement` descriptor, and `results` keyed by benchmark title. Each result
SHALL declare its `size` and a `cases` array; each case SHALL declare a `status`
that is one of `ok`, `count_mismatch`, `generation_error`, or `execution_error`,
and MAY declare `inputRows`, `outputRows`, `samplesMs`, `stats`, and
`phaseSamplesMs`.

#### Scenario: Well-formed report is accepted

- **WHEN** a report with `implementation`, `measurement`, and `results` is
  validated against `benchmark-report.schema.json`
- **THEN** validation passes

#### Scenario: Invalid status is rejected

- **WHEN** a case `status` is a value outside the defined taxonomy
- **THEN** schema validation fails

### Requirement: Reverse-ETL measurement model

The report SHALL describe work as a reverse-ETL of three phases — `load` (source
JSON into the implementation's internal representation, possibly empty),
`execute` (evaluate the ViewDefinition), and `extract` (materialize the flat
output). The `measurement` descriptor SHALL declare which `phases` the samples
cover, the `sink`, and the `warmup` and `iterations` counts actually used. The
recommended timed region SHALL be `execute + extract` with a full materialization
of the result (a table or CSV), not a lazy count.

#### Scenario: Measurement declares its timed region and sink

- **WHEN** a report is produced
- **THEN** its `measurement` declares `phases` (a subset of load/execute/extract),
  a `sink`, and the `warmup`/`iterations` used

### Requirement: Size is a result dimension

A report SHALL record the `size` of each result so that runtime can be plotted
against size for a fixed (benchmark, implementation), enabling scaling-curve
analysis. The benchmark version and FHIR version the numbers were produced
against SHALL be recordable.

#### Scenario: Results are size-keyed for scaling curves

- **WHEN** the same benchmark is run at sizes `s` and `m`
- **THEN** each result records its `size`, so the two points can be compared as a
  scaling curve
