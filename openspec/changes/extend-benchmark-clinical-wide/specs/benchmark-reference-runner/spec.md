## MODIFIED Requirements

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

## ADDED Requirements

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
