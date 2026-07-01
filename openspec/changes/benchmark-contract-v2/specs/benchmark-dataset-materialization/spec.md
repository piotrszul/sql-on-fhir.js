## RENAMED Requirements

- FROM: `### Requirement: Content-hashed on-disk layout and provenance manifest`
- TO: `### Requirement: Identity-keyed on-disk layout and provenance manifest`

## MODIFIED Requirements

### Requirement: Identity-keyed on-disk layout and provenance manifest

Materialized data SHALL be written under
`data/<name>/<version>/<size>/<ResourceType>.ndjson`, one resource per line,
where `<name>` and `<version>` are the dataset's explicit, human-maintained
identity (`dataset.name`, `dataset.version`) — NOT a derived content hash. The
materializer SHALL NOT compute or depend on any content hash of the recipe to
locate or key the data; the identity is the `name`/`version` string pair alone.
A sibling `manifest.json` SHALL record the recipe identity, population, per-file
row counts, and a timestamp. Distinct versions and distinct sizes coexist without
clobbering because they occupy distinct directories.

#### Scenario: Data is keyed by explicit name and version

- **WHEN** a dataset named `synthea-clinical` at `version` `1` is materialized at
  size `m`
- **THEN** its files are written under `data/synthea-clinical/1/m/` and no
  content-hash directory segment is produced

#### Scenario: No content hash is derived

- **WHEN** the materializer resolves where to write a dataset
- **THEN** it uses only the dataset's `name` and `version`, computing no
  recipe content hash and requiring no key-order canonicalization

#### Scenario: Manifest records per-file row counts

- **WHEN** a dataset is materialized
- **THEN** `manifest.json` lists each kept resource type and its NDJSON row count

### Requirement: Reproducible Synthea materialization

The `synthea` executor SHALL invoke Synthea deterministically so that
`recipe + generator version` produces BYTE-IDENTICAL per-resource NDJSON across
environments and across wall-clock time, not merely identical row counts. To that
end the executor SHALL pass the pinned simulation end date from the recipe as
Synthea's `-e` flag (from `params.endTime`), alongside the existing `-r`
(`params.referenceTime`), `-s` (`params.seed`), and `-cs`
(`params.clinicianSeed`), and SHALL run Synthea with `TZ=UTC` in its process
environment so that emitted `dateTime`/`instant` fields do not encode a local
timezone offset. The executor SHALL NOT rely on Synthea's wall-clock default for
the end date and SHALL NOT rely on the host timezone for timestamp rendering. The
executor SHALL pass `--generate.thread_count=1` so the export *order* is
deterministic. The output-affecting export toggles SHALL be sourced from the
recipe `params`
(`--exporter.years_of_history=<params.yearsOfHistory>`,
`--exporter.hospital.fhir.export=<params.hospitalExport>`,
`--exporter.practitioner.fhir.export=<params.practitionerExport>`,
`--exporter.fhir.bulk_data=<params.bulkData>`) rather than hardcoded in the
executor. Byte identity across environments is the precondition that makes the
checkfile's per-file sha256 checksums meaningful.

#### Scenario: End date is pinned from the recipe

- **WHEN** the `synthea` executor materializes a recipe
- **THEN** it invokes Synthea with `-e <params.endTime>` and never allows the
  end date to default to the machine's local date

#### Scenario: Timezone is pinned to UTC

- **WHEN** the `synthea` executor invokes Synthea
- **THEN** it runs with `TZ=UTC` in the process environment, so emitted
  timestamps render in UTC regardless of the host timezone

#### Scenario: Same recipe and version reproduce bytes across time and timezone

- **WHEN** the same `synthea` recipe (same version) is materialized on two
  different wall-clock dates or in two different timezones
- **THEN** the per-resource NDJSON is byte-identical (identical per-file sha256),
  not merely identical in row count

#### Scenario: Export toggles come from the recipe

- **WHEN** the `synthea` executor builds its argument list
- **THEN** `--exporter.years_of_history`, `--exporter.hospital.fhir.export`,
  `--exporter.practitioner.fhir.export`, and `--exporter.fhir.bulk_data` take
  their values from the recipe `params`, and no output-affecting Synthea flag is
  hardcoded in the executor

#### Scenario: Export order is deterministic

- **WHEN** the `synthea` executor invokes Synthea
- **THEN** it passes `--generate.thread_count=1`, so a content/order comparison
  of the materialized NDJSON is stable across runs
