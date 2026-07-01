# benchmark-suite-format Specification

## Purpose

Defines the benchmark file format — a public contract (`benchmark.schema.json`)
plus cross-field invariants — that pairs one declarative dataset recipe with one
or more ViewDefinition cases. It is the performance analog of a `tests/*.json`
file and is language-neutral.
## Requirements
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

### Requirement: Single resource is a measurement-setup property

The benchmark SHALL treat "single resource / no joins" as a property of the
measurement setup — one ViewDefinition timed over one materialized resource type —
and SHALL NOT restrict view syntax to enforce it. A case `view` MAY therefore use
any FHIRPath, including `getResourceKey()` and `getReferenceKey()`. The only
validated view invariant SHALL be that each case's `view.resource` is a member of
its `dataset.resources`.

#### Scenario: Reference functions are allowed

- **WHEN** a case view uses `getResourceKey()` and `getReferenceKey(subject)`
- **THEN** the invariant validator reports no error for the use of those functions

#### Scenario: Case resource outside the dataset is rejected

- **WHEN** a case's `view.resource` is not listed in its `dataset.resources`
- **THEN** the invariant validator returns an error naming that case and resource

### Requirement: Fixed FHIR version for v1

A benchmark file's `fhirVersion` SHALL be `4.0.1` in v1 (the version Synthea
emits). The schema SHALL constrain `fhirVersion` to this value.

#### Scenario: Non-4.0.1 version is rejected

- **WHEN** a benchmark file declares a `fhirVersion` other than `4.0.1`
- **THEN** schema validation fails

### Requirement: Synthea recipe pins every output-affecting input

A `synthea`-kind dataset recipe SHALL declare, in its `params`, every input
that affects the generated data, so that the language-neutral artifact — and its
content hash — describe the dataset completely rather than deferring inputs to
executor-hardcoded defaults or to the machine wall clock. In addition to the
existing `seed`, `clinicianSeed`, and `referenceTime`, the `params` SHALL
include a pinned simulation end date `endTime` (`YYYYMMDD`), and SHALL carry the
export toggles that shape the output — `yearsOfHistory`, `hospitalExport`,
`practitionerExport`, and `bulkData`. The invariant validator SHALL report an
error naming any of these output-affecting params (`endTime`, `yearsOfHistory`,
`hospitalExport`, `practitionerExport`, `bulkData`) that a `synthea` recipe
omits. Because the boolean toggles are meaningful when `false`, the validator
treats only an absent (null/undefined) value as an omission, not an explicit
`false`.

#### Scenario: Recipe declares an explicit end date

- **WHEN** a `synthea` recipe's `params` are inspected
- **THEN** they include an `endTime` (`YYYYMMDD`) that pins Synthea's simulation
  end date rather than relying on the wall-clock default

#### Scenario: Missing endTime is rejected

- **WHEN** a `synthea` recipe's `params` omit `endTime`
- **THEN** the invariant validator returns an error naming the recipe and the
  missing `endTime`

#### Scenario: Any missing output-affecting param is rejected

- **WHEN** a `synthea` recipe's `params` omit any output-affecting input —
  `endTime`, `yearsOfHistory`, `hospitalExport`, `practitionerExport`, or
  `bulkData`
- **THEN** the invariant validator returns an error naming the missing param,
  so an unspecified input can never be interpolated into the executor as
  `undefined` (and silently read as false / wall-clock)
- **AND** an explicit `false` for a boolean toggle is accepted as a declared
  value, not treated as omitted

#### Scenario: Export toggles live in the recipe

- **WHEN** a `synthea` recipe is inspected
- **THEN** the output-affecting export toggles (`yearsOfHistory`,
  `hospitalExport`, `practitionerExport`, `bulkData`) are present in `params`
  and are not left to executor-hardcoded values

#### Scenario: Content hash covers the pinned inputs

- **WHEN** two `synthea` recipes differ only in `endTime` (or in any moved
  export toggle)
- **THEN** their content hashes — and therefore their materialized directories —
  differ, and reordering the `params` keys does not change the hash

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

