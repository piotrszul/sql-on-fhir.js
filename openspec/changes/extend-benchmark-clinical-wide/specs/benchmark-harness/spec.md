## ADDED Requirements

### Requirement: Harness run selects a subset of cases

The harness `run` CLI SHALL accept `--only <ids>` and `--exclude <ids>`
(comma-separated case ids) that select which of the benchmark file's cases are
executed, by building a `caseFilter` predicate the runner applies before the
measurement loop. `--exclude` SHALL take precedence over `--only` on a conflict.
An id that matches no case SHALL be a loud error rather than a silent empty run.
The emitted report SHALL contain only the selected cases; unselected cases SHALL
NOT appear and SHALL NOT be prepared or measured.

#### Scenario: Run only the named cases

- **WHEN** `run --only condition-flat,encounter-flat` is invoked on a file with
  more cases
- **THEN** the report's case list contains exactly `condition-flat` and
  `encounter-flat`

#### Scenario: Exclude a case from an otherwise full run

- **WHEN** `run --exclude us-core-blood-pressures` is invoked
- **THEN** every case except `us-core-blood-pressures` is measured and reported

#### Scenario: Unknown case id fails loudly

- **WHEN** `--only no-such-case` names a case that does not exist
- **THEN** the run fails with an error naming the unknown id and measures nothing
