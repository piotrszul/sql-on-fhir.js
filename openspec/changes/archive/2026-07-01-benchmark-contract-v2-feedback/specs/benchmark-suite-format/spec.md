## MODIFIED Requirements

### Requirement: Inline benchmark file structure

A benchmark file SHALL be a single declarative JSON document that carries only
AUTHORED INTENT — it pairs one dataset recipe with one or more ViewDefinition
cases and carries no generated facts. It SHALL declare an authored SUITE IDENTITY
— a stable machine `name` and an authored `version` — alongside a `title`, a
`fhirVersion`, a `dataset` (with `name`, `kind`, `version`, `resources`, `sizes`,
and `defaultSize`), and a non-empty `cases` array; each case SHALL carry a stable
`id` (short, unique within the file, and stable across edits) and a `view` (a
ViewDefinition with a `resource`). The suite `name` is the stable machine id of
the suite (distinct from `group`, a flat multi-file label, and from `title`); the
suite `version` is the authored suite revision, human-maintained and bumped
deliberately when the suite changes — mirroring `dataset.name`/`dataset.version`
and the case `id`/`title` split. The `title` is a free-text human label that MAY
change freely; the suite `name` and `version` are the stable identity that
`report.benchmark.{name,version}` SHALL source DIRECTLY from (rather than being
invented from a pinned tag/commit outside the contract). The case `title` is a
free-text human label that MAY change freely; the case `id` is the stable key
that the checkfile's assertions and the report's per-case results reference, so it
MUST NOT change casually. The dataset `version` is an explicit, human-maintained
identity tag that expresses INTENT to change the data: an author bumps it
deliberately when the recipe should re-generate. A case SHALL NOT carry a per-size
`expectCount` map — the expected output row counts are generated facts and live in
the checkfile (`benchmark-checkfile-format`), not in the benchmark file. A
benchmark file MAY declare a `group` and recommended `iterations`. The format
SHALL be validated by the `benchmark.schema.json` public contract, which SHALL
require the suite `name` and `version` and SHALL reject unknown top-level
properties (including a stray `expectCount`).

#### Scenario: Well-formed file is accepted

- **WHEN** a benchmark file declaring a suite `name` and `version`, a title,
  fhirVersion, a dataset (with an explicit `version`), and at least one case is
  validated against `benchmark.schema.json`
- **THEN** validation passes

#### Scenario: Missing required field is rejected

- **WHEN** a benchmark file omits a required field such as `fhirVersion`
- **THEN** schema validation fails

#### Scenario: Missing suite identity is rejected

- **WHEN** a benchmark file omits the suite `name` or the suite `version`
- **THEN** validation fails, because `report.benchmark.{name,version}` must have an
  authoritative source in the authored inputs rather than being invented from a
  pinned tag

#### Scenario: Suite version sources report provenance

- **WHEN** a report is produced from a benchmark file
- **THEN** its `report.benchmark.name`/`report.benchmark.version` are the authored
  suite `name`/`version`, not a value derived from the pinned suite tag/commit

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
