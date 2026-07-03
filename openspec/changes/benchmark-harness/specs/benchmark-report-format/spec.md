# benchmark-report-format Specification (delta)

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
`phaseSamplesMs`, and an OPTIONAL free-text `message`. The status taxonomy is
AVAILABLE-not-REQUIRED: `execution_error` is the ALWAYS-CONFORMANT DEFAULT for ANY
failure to load, prepare, or evaluate a case, and a runner that records every
non-`ok` failure as `execution_error` is fully conformant. `timeout` and
`malformed` are OPTIONAL refinements a runner MAY apply WHEN it can cheaply
distinguish them; producing the finer statuses is a quality-of-diagnostics nicety,
NOT a contract obligation. Classification is BEST-EFFORT: a runner MAY report
`execution_error` for a failure it cannot cheaply prove is `malformed` (or
`timeout`) — for example, on a lazy, strongly-typed engine an unparseable input and
an engine evaluation error are indistinguishable at the catch site, so a runner is
not obliged to build a permissive non-lazy parser purely to tell them apart. The
status values are defined as: `ok` (the case ran and its output row count matched
its checkfile assertion, or none was present); `count_mismatch` (the output row
count differed from a present, non-variance-permitted checkfile assertion);
`generation_error` (generation failed to produce the case's input data);
`execution_error` (the engine ran and raised while executing the case, OR — as the
conformant default — any load/prepare/evaluate failure a runner does not further
classify); `timeout` (an OPTIONAL label a runner MAY apply when it abandons a case
under its OWN out-of-band wall-clock budget, e.g. to stop a runaway — keyed off the
runner's own budget, NOT any authored/contract budget field, of which there is
none); and `malformed` (an OPTIONAL label a runner MAY apply when it can cheaply
establish that the case's inputs or outputs were structurally invalid — for example
a materialized resource that will not parse, or a result that cannot be
materialized to the sink — distinct from `generation_error`, where generation
produced no data at all). The OPTIONAL `message` is a short human-readable
explanation of a non-`ok` outcome (most useful for `generation_error`,
`execution_error`, `timeout`, and `malformed`); it is advisory context for a human
reader, never a machine-parsed field. An `ok` case NORMALLY omits `message`, but a
runner MAY attach one to an `ok` case to surface an advisory anomaly that does not
change the verdict — for example a hook-reported row count disagreeing with the
harness-derived count that the guard actually used. A report containing only the
cases a run completed — each with its status — is schema-valid and meaningful, so a
partial or interrupted run still produces a conforming report.

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

#### Scenario: execution_error is the conformant default for any failure

- **WHEN** a runner records every non-`ok` failure — a load failure, a prepare
  failure, or an engine evaluation error — as `execution_error`, applying neither
  `timeout` nor `malformed`
- **THEN** the report is fully conformant, because `timeout` and `malformed` are
  OPTIONAL refinements and `execution_error` is the always-conformant default

#### Scenario: Finer classification is best-effort, not required

- **WHEN** a runner cannot cheaply prove whether a failure was a structurally
  invalid input (`malformed`) or an engine evaluation error, as on a lazy
  strongly-typed engine where both surface at the same catch site
- **THEN** reporting the failure as `execution_error` is conformant; the runner is
  not obliged to distinguish `malformed` (or `timeout`)

#### Scenario: timeout is keyed off the runner's own out-of-band budget

- **WHEN** a runner abandons a runaway case under its OWN wall-clock budget and
  labels it `timeout`
- **THEN** that is conformant; `timeout` is keyed off the runner's own out-of-band
  budget, not off any authored/contract budget field — the contract defines no such
  budget field

#### Scenario: message is optional

- **WHEN** a failed case carries a free-text `message` explaining the failure
- **THEN** schema validation passes; and a case that omits `message` also validates,
  because `message` is OPTIONAL

#### Scenario: An ok case may carry an advisory message

- **WHEN** a runner attaches a `message` to an `ok` case to surface an advisory
  anomaly that did not change the verdict (for example a hook-reported row count
  disagreeing with the harness-derived count the guard used)
- **THEN** the report is conformant; the message remains advisory, never
  machine-parsed

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

### Requirement: Defined statistics and inputRows

A case's `stats` SHALL conform to a defined basic-statistics shape rather than a
free-form object: the REQUIRED fields are `mean`, `stddev`, `min`, `max`, and
`median` (all in the same time unit as `samplesMs`), where `median` is the middle
value (the statistic formerly required as `p50`, renamed for clarity). Fields
beyond the required five are PERMITTED (the schema does NOT set
`additionalProperties` false), so the shape can evolve additively and an
implementation may record extra statistics it already computes (for example
`p95`) — but a consumer SHALL NOT depend on any field beyond the required five,
and cross-implementation comparison SHALL use only the required fields and the
raw samples. `stats` SHALL be reported alongside the raw `samplesMs`, which
SHALL remain REQUIRED so that any consumer — including the JMH export — can
recompute whatever percentiles it wants from the raw data. The report SHOULD
carry at least a RECOMMENDED minimum of 7 samples for the statistics to be
meaningful; this minimum is ADVISORY guidance and SHALL NOT be enforced as a
hard `minItems` floor in the report schema. The shape SHALL be projectable onto
a JMH `primaryMetric` (score = `mean`, scorePercentiles from `median` plus
`min`/`max`, and rawData = `samplesMs`); `scoreError` is NOT a precomputed field
— a consumer recomputes it, along with any richer percentiles, from the raw
`samplesMs`. `inputRows` SHALL be defined precisely as the number of input
resources OF THE CASE'S `view.resource` TYPE that were loaded for that
(case, size) — the denominator for throughput/normalization — distinct from
`outputRows` and from the total resource count across all types.

#### Scenario: stats has the defined shape

- **WHEN** a case reports `stats`
- **THEN** it contains at least `mean`, `stddev`, `min`, `max`, and `median` —
  not an arbitrary free-form object

#### Scenario: Required fields enforced; extra fields permitted

- **WHEN** a case's `stats` omits `median` (or another required field)
- **THEN** schema validation fails; and a `stats` that carries a field beyond
  the five (for example `p95`) validates, because the shape is open for
  additive extension — though no consumer may rely on the extra field

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

## ADDED Requirements

### Requirement: Verified flag distinguishes verified from unverified ok

A verified `ok` SHALL be machine-distinguishable from an unverified one. A case
result MAY carry a boolean `verified` field recording whether the
work-verification guard actually consulted a checkfile assertion for that case
and size: `verified: true` means an assertion was present and the reported
status reflects a real comparison; `verified` false or absent means no
assertion was consulted, so an `ok` is UNVERIFIED — the case ran but its output
row count was not checked against a blessed expectation. This closes the
"assertion absent ⇒ silently ok" ambiguity: a run against a missing, stale, or
mis-keyed checkfile is distinguishable from a verified pass. The field is
OPTIONAL and ADDITIVE — reports that omit it remain valid — and a consumer MAY
treat unverified `ok` cells more conservatively (for example, a downstream
export MAY choose to exclude them).

#### Scenario: Verified pass carries the flag

- **WHEN** a case's output row count is compared against a present checkfile
  assertion and matches
- **THEN** the case is `ok` with `verified: true`

#### Scenario: Missing assertion yields unverified ok

- **WHEN** no checkfile assertion exists for a case and size (for example the
  checkfile is absent or the case `id` is not in it)
- **THEN** the case MAY be reported `ok`, but without `verified: true`, so the
  unverified pass is machine-distinguishable from a verified one

#### Scenario: Reports without the flag remain valid

- **WHEN** a report produced by an older runner carries cases with no
  `verified` field
- **THEN** it validates against `benchmark-report.schema.json`, because the
  field is optional and additive
