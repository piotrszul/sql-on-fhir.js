## ADDED Requirements

### Requirement: Inline benchmark file structure

A benchmark file SHALL be a single declarative JSON document that pairs one
dataset recipe with one or more ViewDefinition cases. It SHALL declare a `title`,
a `fhirVersion`, a `dataset` (with `name`, `kind`, `version`, `resources`,
`sizes`, and `defaultSize`), and a non-empty `cases` array; each case SHALL carry
a `view` (a ViewDefinition with a `resource`) and MAY carry a per-size
`expectCount` map. It MAY declare a `group` and recommended `iterations`. The
format SHALL be validated by the `benchmark.schema.json` public contract, which
SHALL reject unknown top-level properties.

#### Scenario: Well-formed file is accepted

- **WHEN** a benchmark file declaring title, fhirVersion, a dataset, and at least
  one case is validated against `benchmark.schema.json`
- **THEN** validation passes

#### Scenario: Missing required field is rejected

- **WHEN** a benchmark file omits a required field such as `fhirVersion`
- **THEN** schema validation fails

#### Scenario: Unknown top-level property is rejected

- **WHEN** a benchmark file carries a property the schema does not define
- **THEN** schema validation fails

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

### Requirement: Size, expectCount, defaultSize, and group consistency

`expectCount` keys SHALL each be a declared size of the dataset, `defaultSize`
SHALL be a declared size, and all benchmark files sharing a `group` SHALL declare
the same set of size-tier names. The invariant validator SHALL report an error
when any of these does not hold.

#### Scenario: expectCount references an undeclared size

- **WHEN** a case `expectCount` contains a key that is not a declared dataset size
- **THEN** the validator returns an error naming that size

#### Scenario: defaultSize is not a declared size

- **WHEN** a dataset's `defaultSize` is not among its declared sizes
- **THEN** the validator returns an error for `defaultSize`

#### Scenario: Group members disagree on size tiers

- **WHEN** two files share a `group` but declare different size-tier name sets
- **THEN** the validator returns an error naming the group

### Requirement: Fixed FHIR version for v1

A benchmark file's `fhirVersion` SHALL be `4.0.1` in v1 (the version Synthea
emits). The schema SHALL constrain `fhirVersion` to this value.

#### Scenario: Non-4.0.1 version is rejected

- **WHEN** a benchmark file declares a `fhirVersion` other than `4.0.1`
- **THEN** schema validation fails
