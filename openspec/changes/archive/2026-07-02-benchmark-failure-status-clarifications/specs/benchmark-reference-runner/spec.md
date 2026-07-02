## MODIFIED Requirements

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
