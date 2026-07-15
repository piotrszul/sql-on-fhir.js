## MODIFIED Requirements

### Requirement: Generate-then-prune keeps only selected resources

The materializer SHALL constrain generation to the recipe's `resources` by
passing them to the generator's per-resource export filter (Synthea's
`exporter.fhir.included_resources`), and SHALL still prune any remaining siblings
before writing the final layout. The prune step is retained as a safety net
because the generator force-exports some resource types regardless of the filter
(Synthea always includes `Patient` and `Encounter`); such force-exported siblings
are pruned when they are not listed in `resources`. Pruning or filtering a
sibling SHALL NOT alter the bytes of a kept resource's file.

#### Scenario: Generation is constrained to the recipe resources

- **WHEN** a recipe selects `["Condition", "Observation"]`
- **THEN** the generator is invoked with an export filter limiting output to those
  resource types (plus any the generator force-includes), rather than generating
  every resource type and discarding most

#### Scenario: Force-exported siblings are pruned

- **WHEN** the generator force-exports `Patient`/`Encounter` although the recipe
  selects only `["Condition"]`
- **THEN** the force-exported siblings are pruned, the manifest has no entry for
  them, and `Condition.ndjson`'s bytes are unchanged from an unfiltered run

### Requirement: Size as parameter with a v1 demographic ceiling

A size SHALL select the population for each dataset (tier labels shared across a
group, concrete population per dataset). The 10,000-patient v1 ceiling SHALL
apply only to purely low-multiplicity (demographic-root) datasets, which are
row-starved at small populations and whose larger sizes are deferred until a
download kind exists. A dataset that roots at least one measurement-critical
case on a high-multiplicity clinical resource (e.g. `Condition`, `Observation`,
`Encounter`) MAY declare sizes above the ceiling, including an `xl` tier of
100,000 patients. The applicable ceiling and any tier that exceeds it SHALL be
documented in the benchmark README.

#### Scenario: Size selects the population

- **WHEN** a dataset is materialized at size `m`
- **THEN** the executor is invoked with the population declared for tier `m`

#### Scenario: A clinical dataset declares an xl tier above the demographic ceiling

- **WHEN** a dataset with a high-multiplicity clinical root declares `xl` = 100,000
- **THEN** the tier is accepted and materialized, and the README documents it as
  an intentional exception to the demographic 10k ceiling

### Requirement: Reproducible Synthea materialization

The `synthea` executor SHALL invoke Synthea deterministically so that, combined
with the materializer's NDJSON line-canonicalization,
`recipe + generator version` produces BYTE-IDENTICAL per-resource NDJSON across
environments and across wall-clock time, not merely identical row counts.
Byte-identity across environments is delivered by two mechanisms together:
`TZ=UTC` (so emitted timestamps render identically regardless of host timezone)
PLUS the materializer's deterministic, locale-independent NDJSON line
canonicalization (so the persisted line order is stable regardless of Synthea's
bulk-export iteration order). To that end the executor SHALL pass the pinned
simulation end date from the recipe as Synthea's `-e` flag (from
`params.endTime`), alongside the existing `-r` (`params.referenceTime`), `-s`
(`params.seed`), and `-cs` (`params.clinicianSeed`), and SHALL run Synthea with
`TZ=UTC` in its process environment so that emitted `dateTime`/`instant` fields
do not encode a local timezone offset. The executor SHALL NOT rely on Synthea's
wall-clock default for the end date and SHALL NOT rely on the host timezone for
timestamp rendering. The executor SHALL NOT pass a generation thread-count flag
to control export order: `--generate.thread_count` is not a recognized Synthea
property (silently ignored), and even a genuine single-threaded generator pool
does not stabilize Synthea's multi-threaded bulk-export line order, so the
materializer's line-canonicalization is the sole mechanism that makes the
persisted bytes reproducible. That canonicalization SHALL be memory-bounded (an
external merge sort that never loads a whole resource file into memory), so the
largest tiers (e.g. `xl`) canonicalize without exhausting memory. The
output-affecting export toggles SHALL be sourced from the recipe `params`
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

#### Scenario: No generation thread flag is passed

- **WHEN** the `synthea` executor builds its argument list
- **THEN** no `--generate.thread_count` or `--generate.thread_pool_size` flag is
  emitted, because neither makes bulk-export line order deterministic; order is
  stabilized by the materializer's canonicalization instead

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

#### Scenario: Persisted NDJSON is order-stable via memory-bounded canonicalization

- **WHEN** the `synthea` executor invokes Synthea and its bulk export emits
  resources in an unstable line order across runs
- **THEN** the materializer's line-canonicalization sorts those lines
  deterministically via a memory-bounded external merge sort, so the persisted
  NDJSON — and its per-file sha256 — is byte-identical across runs even for the
  largest tiers
