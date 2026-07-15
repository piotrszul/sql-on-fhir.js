# benchmark-reference-runner Specification

## Purpose

Defines the reference benchmark-runner provided by `sof-js`: how it times a
single-view reverse-ETL over materialized data, guards output row counts against
blessed expectations, supports a bless (`--record`) mode, and stays in agreement
with the materializer on recipe identity. It also fixes the language-neutral
contract any implementation must satisfy to act as a runner.
## Requirements
### Requirement: Reference runner times a single-view reverse-ETL

The reference runner SHALL be realized as the shared reference harness driving
the `sof-js` hook: the hook loads a case's materialized NDJSON and evaluates its
`view`, and the HARNESS times the work over the configured warmup and
measurement iterations, returning one sample per measured iteration plus the
output row count. The timed region SHALL cover the evaluation AND the
extraction of the flat result to the written CSV (`execute` + `extract`, per
the report format's measurement model — not evaluation alone); warmup
iterations SHALL be discarded. Timing code SHALL live in the harness, not in
the hook.

#### Scenario: Warmup discarded, one sample per measurement

- **WHEN** the harness times a view with `warmup: 1` and `measurement: 3`
- **THEN** it returns exactly three samples and the output row count of the
  result

#### Scenario: The timed region includes the extract

- **WHEN** a sample is measured
- **THEN** its timed region covers evaluating the view and fully writing the
  CSV result, not the evaluation alone

### Requirement: Row-count correctness guard

For each case, the runner SHALL compare the output row count against the result
assertion for that case and size read from the CHECKFILE
(`benchmark-checkfile-format`) — NOT from any inline `expectCount` in the
benchmark file. Under the harness route the compared count SHALL be the
harness's own count of the rows in the WRITTEN CSV, independent of the engine
under test; a hook-reported count is an optional cross-check. When the
assertion is present and matches it SHALL report `ok` (with the report's
`verified` flag set); when present and not matching it SHALL report
`count_mismatch`; when absent it SHALL report `ok` recorded as UNVERIFIED (the
`verified` flag absent or false). This guard is WORK-VERIFICATION (a
fast-but-wrong result must not post a good time), not specification
conformance. For a case whose reference is resolved in `where`/`forEach`
position and is labelled as count-variance-permitted, the runner SHALL NOT
auto-flag a divergence as `count_mismatch`. The emitted report SHALL conform to
`benchmark-report.schema.json`.

#### Scenario: Matching count is ok and verified

- **WHEN** a case's CSV-derived output row count equals its checkfile assertion
  for the size
- **THEN** the report marks the case `ok` with `verified: true`

#### Scenario: Mismatching count is flagged

- **WHEN** a case's CSV-derived output row count differs from a present
  checkfile assertion
- **THEN** the report marks the case `count_mismatch`

#### Scenario: Absent assertion is ok but unverified

- **WHEN** no checkfile assertion exists for a case and size
- **THEN** the report marks the case `ok` without `verified: true`, so an
  unverified pass is distinguishable from a verified one

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
other sizes' recorded values, and blessing a subset of cases SHALL NOT disturb
unselected cases' assertions.

A blessed assertion SHALL be analytically cross-checked before it is committed by
a row-cardinality derivation over the view's select tree that is independent of
the observed `evaluate()` row-composition: sibling `select[]` cross-join
(product of child cardinalities); `unionAll[]` (sum of branch cardinalities);
`forEach` / `forEachOrNull` (sum over collection elements, an empty
`forEachOrNull` collection contributing one all-null row); and view-level
`where[]` (only resources passing every clause are counted). The derivation
SHALL require only `forEach` collection lengths and `where` predicate results,
never column-value extraction. If the derivation and the observed count disagree,
bless SHALL fail without writing the checkfile.

Bless SHALL process the dataset one resource at a time (streaming the NDJSON),
accumulating both the observed output count and the analytic derivation per
resource, so that bless memory is bounded by a single resource and its output
rows rather than by the dataset. Per-file sha256 checksums and line counts SHALL
likewise be computed by streaming.

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

#### Scenario: Nested forEach and unionAll are cross-checked

- **WHEN** a view with nested `forEach` levels and/or a `unionAll` is blessed
- **THEN** the blessed count equals the cross-join/sum cardinality derived over
  the select tree, and a divergence from the observed `evaluate()` count fails
  the bless without writing the checkfile

#### Scenario: Bless memory is bounded at the largest tier

- **WHEN** `--record` is run at the `xl` (100k) tier
- **THEN** the run completes without loading the whole dataset or the whole
  result set into memory, streaming resource-by-resource

### Requirement: Bless selects a subset of cases

The bless runner SHALL accept `--only <ids>` and `--exclude <ids>`
(comma-separated case ids) selecting the cases to bless. `--exclude` SHALL take
precedence over `--only` on a conflict. An id that matches no case SHALL be a
loud error rather than a silent empty bless. Cases not selected SHALL retain
their existing checkfile assertions unchanged.

#### Scenario: Bless only the named cases

- **WHEN** `--record --only condition-flat` is run
- **THEN** only `condition-flat`'s assertion for that size is (re)written and all
  other cases' assertions are preserved byte-for-byte

#### Scenario: Unknown case id fails loudly

- **WHEN** `--only no-such-case` names a case that does not exist
- **THEN** bless fails with an error naming the unknown id and writes nothing

### Requirement: Language-neutral runner contract

An implementation SHALL be able to have its performance measured by EITHER of
two conformant routes. The HOOK ROUTE (recommended): provide a hook — a
manifest plus worker process per `benchmark-hook-format` — and let the shared
reference harness own the measurement loop, timing, verification, and report
emission. The RUNNER ROUTE (escape hatch, for deployment shapes that cannot fit
a harness-supervised worker): obtain the artifact, materialize the data
(locating it by dataset `name`/`version`, deriving no hash), run each case
`view` over its materialized resource type with its own timing harness, compare
the output row count to the checkfile's result assertion for the case and size,
and emit a conforming report. Both routes emit the same
`benchmark-report.schema.json` report, so downstream consumers are indifferent
to the route. ENGINE-SPECIFIC execution code SHALL never live inside the
`benchmark/` artifact; the artifact MAY ship the ENGINE-NEUTRAL reference
harness as a replaceable convenience tool (like the reference materializer),
and the normative contract requires no runner code from any implementation. A
runner on either route SHALL read expected counts (and optionally checksums)
from the checkfile, not from any inline `expectCount`.

#### Scenario: Artifact ships no engine-specific execution code

- **WHEN** the `benchmark/` directory is inspected
- **THEN** it contains declarative files (including the checkfile), schemas,
  and engine-neutral reference tools (the materializer and the harness) — but
  no engine-specific execution or timing code for any implementation

#### Scenario: Hook route requires no runner code from the implementation

- **WHEN** an implementation provides only a hook (manifest + worker) per
  `benchmark-hook-format`
- **THEN** the reference harness measures it end-to-end and emits a conforming
  report, with the implementation writing no loop, timing, statistics, or
  report code

#### Scenario: Hand-rolled runner remains conformant

- **WHEN** a non-JS implementation that cannot fit the worker model acts as its
  own runner — locating data by dataset `name`/`version` (no hash derivation),
  reading expected counts from the checkfile, timing with its own harness
- **THEN** it is conformant, and its emitted report validates against the same
  `benchmark-report.schema.json`

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

