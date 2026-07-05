# benchmark-reference-runner Specification (delta)

## MODIFIED Requirements

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
