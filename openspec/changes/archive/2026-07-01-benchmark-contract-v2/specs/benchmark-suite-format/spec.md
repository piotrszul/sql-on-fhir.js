## RENAMED Requirements

- FROM: `### Requirement: Size, expectCount, defaultSize, and group consistency`
- TO: `### Requirement: Size, defaultSize, and group consistency`

## MODIFIED Requirements

### Requirement: Inline benchmark file structure

A benchmark file SHALL be a single declarative JSON document that carries only
AUTHORED INTENT — it pairs one dataset recipe with one or more ViewDefinition
cases and carries no generated facts. It SHALL declare a `title`, a
`fhirVersion`, a `dataset` (with `name`, `kind`, `version`, `resources`,
`sizes`, and `defaultSize`), and a non-empty `cases` array; each case SHALL carry
a stable `id` (short, unique within the file, and stable across edits) and a
`view` (a ViewDefinition with a `resource`). The case `title` is a free-text
human label that MAY change freely; the `id` is the stable key that the
checkfile's assertions and the report's per-case results reference, so it MUST
NOT change casually. The dataset `version` is an
explicit, human-maintained identity tag that expresses INTENT to change the data:
an author bumps it deliberately when the recipe should re-generate. A case SHALL
NOT carry a per-size `expectCount` map — the expected output row counts are
generated facts and live in the checkfile (`benchmark-checkfile-format`), not in
the benchmark file. A benchmark file MAY declare a `group` and recommended
`iterations`. The format SHALL be validated by the `benchmark.schema.json` public
contract, which SHALL reject unknown top-level properties (including a stray
`expectCount`).

#### Scenario: Well-formed file is accepted

- **WHEN** a benchmark file declaring title, fhirVersion, a dataset (with an
  explicit `version`), and at least one case is validated against
  `benchmark.schema.json`
- **THEN** validation passes

#### Scenario: Missing required field is rejected

- **WHEN** a benchmark file omits a required field such as `fhirVersion`
- **THEN** schema validation fails

#### Scenario: Inline expectCount is rejected

- **WHEN** a case in a benchmark file carries an `expectCount` map
- **THEN** schema validation fails, because expected output row counts are
  generated facts that belong in the checkfile, not authored intent

#### Scenario: Unknown top-level property is rejected

- **WHEN** a benchmark file carries a property the schema does not define
- **THEN** schema validation fails

#### Scenario: Case declares a stable id

- **WHEN** a benchmark file's cases are inspected
- **THEN** each case declares an `id` unique within the file and distinct from its
  free-text `title`, and that `id` is the key the checkfile assertions and report
  results reference

### Requirement: Size, defaultSize, and group consistency

`defaultSize` SHALL be a declared size of the dataset, and all benchmark files
sharing a `group` SHALL declare the same set of size-tier names. The invariant
validator SHALL report an error when either does not hold. (The former
`expectCount`-key-versus-size check has moved to the checkfile, whose assertions
are validated against the declared sizes there.)

#### Scenario: defaultSize is not a declared size

- **WHEN** a dataset's `defaultSize` is not among its declared sizes
- **THEN** the validator returns an error for `defaultSize`

#### Scenario: Group members disagree on size tiers

- **WHEN** two files share a `group` but declare different size-tier name sets
- **THEN** the validator returns an error naming the group

## ADDED Requirements

### Requirement: Row-count guard is work-verification, not conformance

The benchmark's row-count expectations SHALL be understood as a benchmark-owned
WORK-VERIFICATION guard, NOT as a specification-conformance check — the
assertions are held in the checkfile and verified by the runner. Because the
benchmark measures speed, it needs this guard so that a fast-but-WRONG result
cannot post a good time. Specification conformance is the separate concern of the
`tests/` suite, which is non-exhaustive and answers a different question. The
benchmark artifact SHALL NOT present its row-count guard as evidence of
conformance.

#### Scenario: Guard verifies work, not conformance

- **WHEN** a case's output row count matches its checkfile assertion
- **THEN** the guard confirms the engine did the expected amount of work at that
  size — it does NOT certify the engine as spec-conformant, which is `tests/`

### Requirement: Row-count invariance is claimed only for projection-position references

The row-count-invariance claim SHALL be made only for references resolved in
PROJECTION (column) position: only there is it expected that two conformant
engines produce the same output row count. For a reference resolved inside a
`where` filter or a `forEach`, the
empty-vs-null-vs-error behaviour is engine-specific and MAY legitimately change
the row count; two conformant engines MAY therefore differ, and such a case MUST
NOT be treated as a defect nor auto-flagged as a count mismatch. Such cases SHALL
be labelled/guarded so the runner does not enforce a shared count on them. The
cross-engine DEMONSTRATION of this divergence is out of scope for this
capability; a content-level correctness assertion is a future, stricter guard and
is likewise out of scope.

#### Scenario: Projection-position reference is invariant

- **WHEN** a case resolves a reference in a column path (projection position)
- **THEN** its output row count is expected to be invariant across conformant
  engines, and a mismatch is a real signal

#### Scenario: Filter/forEach-position reference is not auto-flagged

- **WHEN** a case resolves a reference inside a `where` or `forEach`, and two
  conformant engines produce different row counts due to
  empty-vs-null-vs-error handling
- **THEN** the divergence MUST NOT be auto-flagged as a count mismatch, because
  the row-count-invariance claim does not extend to that position
