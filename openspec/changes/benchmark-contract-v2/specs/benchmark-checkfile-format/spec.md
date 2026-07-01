## ADDED Requirements

### Requirement: Build-time checkfile is a committed lock/checksum artifact

The benchmark build SHALL produce, post-generation, a committed checkfile — a
declarative, language-neutral JSON document validated by the
`benchmark-checkfile.schema.json` public contract. The checkfile is the home for
everything *generated* about a benchmark's dataset and expected results, as
distinct from the benchmark file, which carries everything *authored*. It SHALL
record the dataset identity (`name`, `version`), the generator version
(`syntheaVersion`), per-size resource counts, per-size/per-file sha256 checksums,
and the per-case per-size result assertions. The schema SHALL reject unknown
top-level properties.

#### Scenario: Well-formed checkfile is accepted

- **WHEN** a checkfile declaring dataset identity, `syntheaVersion`, per-size
  `resourceCounts`, per-file `sha256` checksums, and `assertions` is validated
  against `benchmark-checkfile.schema.json`
- **THEN** validation passes

#### Scenario: Missing required field is rejected

- **WHEN** a checkfile omits a required field such as the dataset identity or
  `syntheaVersion`
- **THEN** schema validation fails

#### Scenario: Unknown top-level property is rejected

- **WHEN** a checkfile carries a property the schema does not define
- **THEN** schema validation fails

### Requirement: Checkfile records dataset identity and generator version

The checkfile SHALL record the dataset identity it locks — `name` and `version`
— matching the benchmark file's `dataset.name`/`dataset.version`, and the
`syntheaVersion` (the generator version actually used to produce the locked
data). This ties the checkfile unambiguously to one authored dataset revision.

#### Scenario: Identity matches the benchmark file

- **WHEN** a checkfile is produced for a benchmark whose `dataset.name` is
  `synthea-clinical` and `dataset.version` is `1`
- **THEN** the checkfile's dataset `name`/`version` are `synthea-clinical`/`1`

### Requirement: Checkfile records per-size resource counts and per-file checksums

For each declared size the checkfile SHALL record `resourceCounts` (a map from
each kept resource type to its NDJSON row count) and per-file sha256 checksums
(one per materialized `<ResourceType>.ndjson`). The checksums are meaningful only
because the generated NDJSON is byte-identical across environments (the `TZ=UTC`
materialization requirement); they lock the exact data bytes so drift can be
detected.

#### Scenario: Per-size counts and checksums are present

- **WHEN** a checkfile is inspected for size `s`
- **THEN** it lists a `resourceCounts` entry per kept resource type and a sha256
  checksum per materialized NDJSON file at that size

#### Scenario: Checksum detects byte drift

- **WHEN** a materialized NDJSON file differs by even one byte from the bytes the
  checkfile locked
- **THEN** its recomputed sha256 does not match the checkfile's recorded sha256

### Requirement: Checkfile owns the result assertions

The checkfile SHALL carry the result assertions — the expected output row count
for each case at each size — previously held inline in the benchmark file's
`expectCount`. Assertions SHALL be keyed by the case's title (the same key the
report's `results` uses) and then by size. The benchmark file SHALL NOT carry
these assertions; they live only in the checkfile.

#### Scenario: Assertions are keyed by case and size

- **WHEN** a checkfile is inspected
- **THEN** its `assertions` map contains, for each case title, an expected output
  row count per declared size

#### Scenario: Assertions have moved out of the benchmark file

- **WHEN** the benchmark file and its checkfile are compared
- **THEN** the expected output row counts appear only in the checkfile's
  `assertions`, never inline in the benchmark file's cases
