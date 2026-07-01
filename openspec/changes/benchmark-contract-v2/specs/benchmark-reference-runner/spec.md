## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Recipe-identity agreement with the materializer

**Reason**: The runner no longer derives a recipe content hash to locate data.
Dataset identity is now the explicit `name` + `version` pair (see
`benchmark-dataset-materialization`), so there is no shared canonicaliser to agree
on and the finding-F1/F6 hash-derivation bugs disappear. Replaced by the new
"Runner locates data by explicit identity" requirement below.

## ADDED Requirements

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
