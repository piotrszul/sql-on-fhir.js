## ADDED Requirements

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

### Requirement: Content-hashed on-disk layout and provenance manifest

Materialized data SHALL be written under
`data/<name>_<hash>/<size>/<ResourceType>.ndjson`, one resource per line, with a
sibling `manifest.json` recording the recipe identity, population, per-file row
counts, and a timestamp. `<hash>` SHALL be a content hash of the recipe that is
independent of JSON key order, so identical recipes resolve to the same directory
and distinct sizes coexist without clobbering.

#### Scenario: Recipe hash is key-order independent

- **WHEN** the same recipe is hashed with its keys in two different orders
- **THEN** the resulting `<hash>` (and directory) is identical

#### Scenario: Manifest records per-file row counts

- **WHEN** a dataset is materialized
- **THEN** `manifest.json` lists each kept resource type and its NDJSON row count

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
