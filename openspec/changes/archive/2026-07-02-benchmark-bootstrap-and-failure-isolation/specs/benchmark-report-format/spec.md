## MODIFIED Requirements

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
