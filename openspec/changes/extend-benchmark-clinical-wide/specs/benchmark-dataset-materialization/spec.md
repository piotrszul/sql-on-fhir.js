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
