## ADDED Requirements

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

For each case, the runner SHALL compare the output row count against
`expectCount[size]`: when the expectation is present and matches it SHALL report
`ok`; when present and not matching it SHALL report `count_mismatch`; when absent
it SHALL report `ok`. The emitted report SHALL conform to
`benchmark-report.schema.json`.

#### Scenario: Matching count is ok

- **WHEN** a case's output row count equals its `expectCount[size]`
- **THEN** the report marks the case `ok`

#### Scenario: Mismatching count is flagged

- **WHEN** a case's output row count differs from a present `expectCount[size]`
- **THEN** the report marks the case `count_mismatch`

### Requirement: Bless mode with analytic cross-check

The runner SHALL provide a `--record` (bless) mode that writes observed output row
counts into a benchmark file's `expectCount[size]` without disturbing other sizes.
A blessed value SHALL be analytically cross-checked before it is committed: for a
single-resource flatten view the count is derivable (no `forEach`/`where` ⇒ the
input resource count; `forEach` over a collection ⇒ the total collection-entry
count; `where` ⇒ the filtered count).

#### Scenario: Bless fills the size's expectCount

- **WHEN** `--record` is run for size `s`
- **THEN** the benchmark file's `expectCount.s` is set to the observed output rows
  for each case, leaving other sizes untouched

#### Scenario: Blessed count matches the analytic derivation

- **WHEN** a `forEach: component` Observation view is blessed
- **THEN** the blessed count equals the total number of `component` entries across
  the materialized Observations

### Requirement: Recipe-identity agreement with the materializer

The runner SHALL derive a dataset's recipe identity identically to the
materializer, so it locates the materialized data the materializer wrote. Both
SHALL obtain the recipe by stripping exactly the presentation-only fields
(`name`, `sizes`, `defaultSize`) from the dataset, via a single shared function.

#### Scenario: Runner reads the materialized directory

- **WHEN** a dataset is materialized and then run
- **THEN** the runner resolves the same `data/<name>_<hash>/<size>/` directory the
  materializer wrote

### Requirement: Language-neutral runner contract

Execution and timing code SHALL live in an implementation (the `sof-js` reference
runner), never inside the `benchmark/` artifact. Any implementation SHALL be able
to act as a runner by: obtaining the artifact, materializing the data, running
each case `view` over its materialized resource type with its own timing harness,
comparing the output row count to `expectCount[size]`, and emitting a conforming
report.

#### Scenario: Artifact contains no runner code

- **WHEN** the `benchmark/` directory is inspected
- **THEN** it contains declarative files, schemas, and the materialization tool —
  but no benchmark runner or timing code
