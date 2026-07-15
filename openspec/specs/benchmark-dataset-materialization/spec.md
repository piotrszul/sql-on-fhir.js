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
function call. Environment-specific facts required to execute a recipe (a custom
Synthea jar path, a custom `java` binary) MAY live in tool-side configuration
outside the artifact, in a file that is not committed
(`tools/executors.config.json`); that configuration is an OPTIONAL OVERRIDE, NOT a
prerequisite. When it is absent, the materializer obtains the pinned generator
automatically (see the "Automatic pinned-generator acquisition" requirement); when
it is present, its jar path and/or `java` binary override the automatic
acquisition.

#### Scenario: Recipe carries no executable

- **WHEN** a benchmark file's `dataset` recipe is inspected
- **THEN** it contains only declarative fields (`kind`, `version`, `params`,
  `resources`, `sizes`, `defaultSize`, `name`) and no shell/JS call

#### Scenario: Environment config is an optional override

- **WHEN** the materialization tool runs with no `tools/executors.config.json`
- **THEN** materialization still proceeds by acquiring the pinned generator
  automatically; and when a `tools/executors.config.json` IS present, its custom
  jar path and/or `java` binary override that automatic acquisition

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

### Requirement: Automatic pinned-generator acquisition

The materializer SHALL be able to obtain the pinned generator AUTOMATICALLY,
without a hand-written configuration file. For the `synthea` kind it SHALL resolve
the recipe's pinned `dataset.syntheaVersion` to a published-release download URL
and an expected SHA-256 checksum via a COMMITTED pinned map in the tooling (keyed
by `syntheaVersion`), fetch the jar into a gitignored local cache directory (for
example `benchmark/.cache/synthea/`) if it is not already cached, and VERIFY the
fetched bytes against the pinned SHA-256 before using them. A checksum mismatch
SHALL fail materialization loudly rather than proceed with unverified bytes. A
subsequent materialization SHALL reuse the cached, verified jar and SHALL NOT
re-download it. Both the download URL and its SHA-256 SHALL be pinned in the
committed map (not discovered at runtime), so that pinning a new generator version
is an explicit, reviewed edit. This generator-jar checksum is distinct from and
complementary to the checkfile's per-file NDJSON sha256, and byte-reproducibility
of the materialized NDJSON is unaffected (it still depends only on
`recipe + generator version` under `TZ=UTC` plus line-canonicalization).

#### Scenario: Missing config triggers auto-fetch

- **WHEN** the materializer runs with no `tools/executors.config.json` and the
  pinned jar is not yet cached
- **THEN** it fetches the `dataset.syntheaVersion` jar from the pinned
  published-release URL, verifies it against the pinned SHA-256, caches it locally,
  and uses it

#### Scenario: Checksum mismatch fails loudly

- **WHEN** a fetched jar's SHA-256 does not match the pinned checksum for its
  `syntheaVersion`
- **THEN** materialization fails with an error and does not proceed with the
  unverified bytes

#### Scenario: Cached jar is reused

- **WHEN** the materializer runs a second time with the pinned jar already present
  in the cache
- **THEN** it reuses the cached jar and does not re-download it

#### Scenario: Config overrides auto-fetch

- **WHEN** a `tools/executors.config.json` supplies a jar path
- **THEN** the materializer uses that jar and does not auto-fetch

### Requirement: Generator runs in an isolated working directory

The materializer SHALL run the generator in an ISOLATED working directory so that
the generator's incidental artifacts (for the `synthea` kind, its `db.sqlite` and
its `public/export/<epoch>/` tree) do NOT land in the repo tree. The final
materialized NDJSON SHALL still be written to the identity-keyed layout
(`data/<name>/<version>/<size>/`) unchanged; only the generator's transient working
directory moves out of the repo root. The isolated directory MAY be a
per-materialization temporary directory that is cleaned up afterwards, OR a fixed
gitignored scratch directory — either satisfies this requirement.

#### Scenario: Generation artifacts do not land in the repo tree

- **WHEN** the `synthea` executor materializes a dataset
- **THEN** no `db.sqlite` and no `public/export/` tree is written into the repo
  tree, because the generator ran in an isolated working directory

#### Scenario: Materialized output still lands in the identity-keyed layout

- **WHEN** the generator runs in its isolated working directory
- **THEN** the produced per-resource NDJSON is still written to
  `data/<name>/<version>/<size>/`, unchanged from the identity-keyed layout
  requirement

