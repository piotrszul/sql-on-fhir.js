## ADDED Requirements

### Requirement: Reproducible Synthea materialization

The `synthea` executor SHALL invoke Synthea deterministically so that
`recipe + generator version` produces identical per-resource row counts across
environments and across wall-clock time, at day granularity. To that end the
executor SHALL pass the pinned simulation end date from the recipe as Synthea's
`-e` flag (from `params.endTime`), alongside the existing `-r`
(`params.referenceTime`), `-s` (`params.seed`), and `-cs`
(`params.clinicianSeed`). The executor SHALL NOT rely on Synthea's wall-clock
default for the end date. The executor SHALL pass `--generate.thread_count=1`
so the export *order* is deterministic. The output-affecting export toggles
SHALL be sourced from the recipe `params`
(`--exporter.years_of_history=<params.yearsOfHistory>`,
`--exporter.hospital.fhir.export=<params.hospitalExport>`,
`--exporter.practitioner.fhir.export=<params.practitionerExport>`,
`--exporter.fhir.bulk_data=<params.bulkData>`) rather than hardcoded in the
executor.

#### Scenario: End date is pinned from the recipe

- **WHEN** the `synthea` executor materializes a recipe
- **THEN** it invokes Synthea with `-e <params.endTime>` and never allows the
  end date to default to the machine's local date

#### Scenario: Same recipe and version reproduce counts across time

- **WHEN** the same `synthea` recipe (same version) is materialized on two
  different wall-clock dates or in two different timezones
- **THEN** the per-resource row counts recorded in each `manifest.json` are
  identical

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
