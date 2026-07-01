# benchmark-dataset-materialization Specification

## Purpose

Defines how a declarative dataset recipe in a benchmark file is turned into
materialized, on-disk NDJSON that benchmark runners consume. Materialization is
deterministic, idempotent, and provenance-tracked, and keeps environment-specific
execution details out of the language-neutral artifact.
## Requirements
### Requirement: Declarative recipes (WHAT vs HOW)

A dataset SHALL be described by a declarative recipe — a `kind`, a pinned
generator `version`, and `params` — and SHALL NOT embed a shell command or
function call. Environment-specific facts required to execute a recipe (the
Synthea jar path, the `java` binary) SHALL live only in tool-side configuration
outside the artifact, in a file that is not committed.

#### Scenario: Recipe carries no executable

- **WHEN** a benchmark file's `dataset` recipe is inspected
- **THEN** it contains only declarative fields (`kind`, `version`, `params`,
  `resources`, `sizes`, `defaultSize`, `name`) and no shell/JS call

#### Scenario: Environment config is not part of the artifact

- **WHEN** the materialization tool needs the jar path and `java` binary
- **THEN** it reads them from a gitignored `tools/executors.config.json`, not from
  any benchmark file

### Requirement: Generate-then-prune keeps only selected resources

Because the generator has no per-resource export filter, the materializer SHALL
generate the full population into a staging area and then keep only the resource
types listed in the recipe's `resources`, pruning all siblings before writing the
final layout.

#### Scenario: Siblings are pruned

- **WHEN** a recipe selects `["Condition"]` and the executor produces both
  `Condition.ndjson` and `Observation.ndjson`
- **THEN** only `Condition.ndjson` is kept and the manifest has no `Observation`
  entry

### Requirement: Idempotent materialization

Materialization SHALL skip regeneration when a manifest already exists whose
population matches the requested size and all selected resource files are
present; a `force` option SHALL rebuild regardless.

#### Scenario: Second run skips the executor

- **WHEN** a dataset is materialized twice at the same size without `force`
- **THEN** the executor runs only on the first call

### Requirement: Pluggable executor registry

The materialization tool SHALL select an executor by the recipe's `kind` from a
registry, so new data sources can be added as new kinds. The `synthea` executor
SHALL produce per-resource NDJSON by shelling out to the configured Synthea jar.

#### Scenario: Unknown kind is rejected

- **WHEN** a dataset declares a `kind` with no registered executor
- **THEN** materialization fails with an error naming the kind

### Requirement: Size as parameter with a v1 demographic ceiling

A size SHALL select the population for each dataset (tier labels shared across a
group, concrete population per dataset). In v1, demographic (low-multiplicity
root) datasets SHALL be limited to a documented population ceiling of 10,000
patients; larger demographic sizes are deferred until a download kind exists.

#### Scenario: Size selects the population

- **WHEN** a dataset is materialized at size `m`
- **THEN** the executor is invoked with the population declared for tier `m`

### Requirement: Reproducible Synthea materialization

The `synthea` executor SHALL invoke Synthea deterministically so that, combined
with the materializer's NDJSON line-canonicalization,
`recipe + generator version` produces BYTE-IDENTICAL per-resource NDJSON across
environments and across wall-clock time, not merely identical row counts.
Byte-identity across environments is delivered by two mechanisms together:
`TZ=UTC` (so emitted timestamps render identically regardless of host timezone)
PLUS the materializer's deterministic, locale-independent NDJSON line
canonicalization (so the persisted line order is stable regardless of Synthea's
bulk-export iteration order). To that
end the executor SHALL pass the pinned simulation end date from the recipe as
Synthea's `-e` flag (from `params.endTime`), alongside the existing `-r`
(`params.referenceTime`), `-s` (`params.seed`), and `-cs`
(`params.clinicianSeed`), and SHALL run Synthea with `TZ=UTC` in its process
environment so that emitted `dateTime`/`instant` fields do not encode a local
timezone offset. The executor SHALL NOT rely on Synthea's wall-clock default for
the end date and SHALL NOT rely on the host timezone for timestamp rendering. The
executor SHALL pass `--generate.thread_count=1` to aid generation determinism;
this flag does NOT by itself stabilize Synthea's bulk-export line order, so the
materializer's line-canonicalization is what makes the persisted bytes
reproducible. The output-affecting export toggles SHALL be sourced from the
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

#### Scenario: Persisted NDJSON is order-stable via materializer canonicalization

- **WHEN** the `synthea` executor invokes Synthea and its bulk export emits
  resources in an unstable line order across runs (which `--generate.thread_count=1`
  does not by itself prevent)
- **THEN** the materializer's line-canonicalization sorts those lines
  deterministically, so the persisted NDJSON — and its per-file sha256 — is
  byte-identical across runs

### Requirement: Identity-keyed on-disk layout and provenance manifest

Materialized data SHALL be written under
`data/<name>/<version>/<size>/<ResourceType>.ndjson`, one resource per line,
where `<name>` and `<version>` are the dataset's explicit, human-maintained
identity (`dataset.name`, `dataset.version`) — NOT a derived content hash. The
materializer SHALL NOT compute or depend on any content hash of the recipe to
locate or key the data; the identity is the `name`/`version` string pair alone.
A sibling `manifest.json` SHALL record the recipe identity, population, per-file
row counts, and a timestamp. Distinct versions and distinct sizes coexist without
clobbering because they occupy distinct directories. The materializer SHALL
canonicalize the persisted NDJSON line order with a deterministic,
locale-independent ordinal sort so that persisted bytes reproduce across runs
regardless of the order in which the executor emitted the resources.

#### Scenario: Persisted NDJSON line order is canonicalized

- **WHEN** the materializer writes a resource's NDJSON to disk
- **THEN** it sorts the lines with a deterministic, locale-independent ordinal
  comparator, so two runs that emit the same lines in different orders persist
  byte-identical NDJSON (identical per-file sha256)

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

