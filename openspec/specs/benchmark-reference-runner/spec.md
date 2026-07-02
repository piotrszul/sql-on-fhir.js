# benchmark-reference-runner Specification

## Purpose

Defines the reference benchmark-runner provided by `sof-js`: how it times a
single-view reverse-ETL over materialized data, guards output row counts against
blessed expectations, supports a bless (`--record`) mode, and stays in agreement
with the materializer on recipe identity. It also fixes the language-neutral
contract any implementation must satisfy to act as a runner.
## Requirements
### Requirement: Reference runner times a single-view reverse-ETL

`sof-js` SHALL provide a reference benchmark-runner that loads a case's
materialized NDJSON, evaluates its `view` over the loaded resources, and times the
evaluation over the configured warmup and measurement iterations, returning one
sample per measured iteration plus the output row count. The timed region SHALL
wrap only the evaluation; warmup iterations SHALL be discarded.

#### Scenario: Warmup discarded, one sample per measurement

- **WHEN** the runner times a view with `warmup: 1` and `measurement: 3`
- **THEN** it returns exactly three samples and the output row count of the result

### Requirement: Row-count correctness guard

For each case, the runner SHALL compare the output row count against the result
assertion for that case and size read from the CHECKFILE
(`benchmark-checkfile-format`) — NOT from any inline `expectCount` in the
benchmark file. When the assertion is present and matches it SHALL report `ok`;
when present and not matching it SHALL report `count_mismatch`; when absent it
SHALL report `ok`. This guard is WORK-VERIFICATION (a fast-but-wrong result must
not post a good time), not specification conformance. For a case whose reference
is resolved in `where`/`forEach` position and is labelled as
count-variance-permitted, the runner SHALL NOT auto-flag a divergence as
`count_mismatch`. The emitted report SHALL conform to
`benchmark-report.schema.json`.

#### Scenario: Matching count is ok

- **WHEN** a case's output row count equals its checkfile assertion for the size
- **THEN** the report marks the case `ok`

#### Scenario: Mismatching count is flagged

- **WHEN** a case's output row count differs from a present checkfile assertion
- **THEN** the report marks the case `count_mismatch`

#### Scenario: Variance-permitted case is not auto-flagged

- **WHEN** a case labelled count-variance-permitted (a reference resolved in
  `where`/`forEach` position) produces a count differing from the assertion
- **THEN** the runner does NOT auto-flag it as `count_mismatch`, honouring the
  restricted invariance claim

### Requirement: Bless mode with analytic cross-check

The runner SHALL provide a `--record` (bless) mode that WRITES THE CHECKFILE —
recording per-size resource counts, per-file sha256 checksums, and the result
assertions (observed output row counts per case per size) — rather than editing
an inline `expectCount` in the benchmark file. Blessing a size SHALL NOT disturb
other sizes' recorded values. A blessed assertion SHALL be analytically
cross-checked before it is committed: for a single-resource flatten view the
count is derivable (no `forEach`/`where` ⇒ the input resource count; `forEach`
over a collection ⇒ the total collection-entry count; `where` ⇒ the filtered
count).

#### Scenario: Bless writes the checkfile assertion for the size

- **WHEN** `--record` is run for size `s`
- **THEN** the checkfile's assertion for that size is set to the observed output
  rows for each case, leaving other sizes' assertions untouched, and the
  benchmark file's cases are not edited

#### Scenario: Bless records counts and checksums

- **WHEN** `--record` is run
- **THEN** the checkfile records the per-size resource counts and per-file sha256
  checksums alongside the result assertions

#### Scenario: Blessed count matches the analytic derivation

- **WHEN** a `forEach: component` Observation view is blessed
- **THEN** the blessed count equals the total number of `component` entries across
  the materialized Observations

### Requirement: Language-neutral runner contract

Execution and timing code SHALL live in an implementation (the `sof-js` reference
runner), never inside the `benchmark/` artifact. Any implementation SHALL be able
to act as a runner by: obtaining the artifact, materializing the data (locating it
by dataset `name`/`version`, deriving no hash), running each case `view` over its
materialized resource type with its own timing harness, comparing the output row
count to the checkfile's result assertion for the case and size, and emitting a
conforming report. The runner SHALL read expected counts (and optionally
checksums) from the checkfile, not from any inline `expectCount`.

#### Scenario: Artifact contains no runner code

- **WHEN** the `benchmark/` directory is inspected
- **THEN** it contains declarative files (including the checkfile), schemas, and
  the materialization tool — but no benchmark runner or timing code

#### Scenario: Any-language runner uses identity and the checkfile

- **WHEN** a non-JS implementation acts as a runner
- **THEN** it locates data by dataset `name`/`version` (no hash derivation) and
  reads its expected counts from the checkfile, needing no JS-specific
  canonicaliser

### Requirement: Runner locates data by explicit identity

The runner SHALL locate a case's materialized NDJSON at
`data/<name>/<version>/<size>/` using the dataset's explicit `name` and
`version`, and SHALL NEVER re-derive a content hash to find it. There is no
recipe canonicalization contract for a runner to reproduce; identity is the
`name`/`version` string pair. The runner MAY additionally verify the materialized
data against the checkfile's per-file sha256 checksums (a strict, OPTIONAL check)
to detect data that has drifted from the locked bytes.

#### Scenario: Runner reads the materialized directory by identity

- **WHEN** a dataset named `synthea-clinical` at `version` `1` is materialized and
  then run at size `m`
- **THEN** the runner resolves `data/synthea-clinical/1/m/` directly from the
  dataset's `name`/`version`, deriving no hash

#### Scenario: Strict mode verifies checksums

- **WHEN** the runner is run in its optional strict mode
- **THEN** it recomputes each materialized file's sha256 and compares it to the
  checkfile, surfacing any drift from the locked bytes

### Requirement: Per-case failure isolation (record-and-continue)

The runner SHALL treat each case's outcome as INDEPENDENT: a case that fails —
whether the failure is a generation error, an execution error, a count mismatch, a
timeout, or a malformed input/output — is recorded with its status and the run
PROCEEDS to the remaining cases. A failing case MUST NOT abort the whole run and
MUST NOT void other cases' already-recorded results. A PARTIAL or interrupted run
SHALL still yield a valid report: a report containing only the cases completed so
far, each with its status, is schema-valid against `benchmark-report.schema.json`
and meaningful. The per-case status recorded here SHALL be one of the values in the
`benchmark-report-format` status taxonomy (`ok`, `count_mismatch`,
`generation_error`, `execution_error`, `timeout`, `malformed`), applied per that
taxonomy's best-effort rules (`execution_error` is the always-conformant default;
`timeout`/`malformed` are OPTIONAL refinements). HOW a runner makes partial results
durable (for example an append-per-cell native log) is an IMPLEMENTATION technique
that this contract does NOT mandate; the contract requires only that whatever set of
cases ran is each recorded INDEPENDENTLY and the emitted report validates.
PROVIDING a way to run a SUBSET of cases — a `--case`/filter flag or a `caseFilter`
input — is OPTIONAL runner functionality (a reference-runner convenience), NOT an
implementer obligation: a conformant runner MAY always run the full suite with no
filter. The contract governs only that whatever set of cases DID run is recorded
per-case-independently and yields a valid report; it does NOT require any mechanism
for selecting which cases run.

#### Scenario: A failing case does not abort the run

- **WHEN** one case in a suite fails (for example an execution error) while the
  others succeed
- **THEN** the failing case is recorded with its failure status, the run continues,
  and the succeeding cases are recorded with their own statuses — the failure does
  not void or omit them

#### Scenario: Partial run yields a valid report

- **WHEN** a run is interrupted after completing only some of its cases
- **THEN** the emitted report contains only the completed cases, each with its
  status, and validates against `benchmark-report.schema.json`

#### Scenario: Each case's outcome is independent

- **WHEN** several cases in a run fail for different reasons (a count mismatch, a
  timeout, a malformed output)
- **THEN** each is recorded with its own status and none of them changes the
  recorded status of any other case

#### Scenario: Subset filtering is optional convenience, not an obligation

- **WHEN** a runner provides NO way to run a subset of cases and always runs the
  full suite
- **THEN** it is conformant, because providing a `--case`/filter flag or
  `caseFilter` is OPTIONAL reference-runner convenience; the contract requires only
  that whatever set of cases ran is each recorded independently and the report
  validates

