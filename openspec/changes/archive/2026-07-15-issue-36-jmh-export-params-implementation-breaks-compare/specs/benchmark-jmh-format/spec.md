## MODIFIED Requirements

### Requirement: JMH benchmark name and axes carry our identity

The system SHALL compose each JMH entry's `benchmark` NAME from this project's
identity as `<benchmark.name>.<case.id>` — the authored suite `name` (the stable
machine id, from `report.benchmark.name`) joined to the stable case `id`. The
`size` SHALL be recoverable from the entry as a JMH `param` (and is also
encoded in the file name) so the Visualizer can axis on it. The
`implementation` SHALL be recoverable ONLY from the file name, and SHALL NOT
be carried in `params`: because JMH Visualizer's two-file compare mode
matches entries across uploaded files by `benchmark` name plus full `params`
equality, and one exported file always corresponds to exactly one
implementation, putting `implementation` in `params` would make it constant
within any single file while necessarily differing across any two files
compared against each other — defeating that compare workflow entirely. The
implementation axis SHALL be fed by the structured `implementation`
(`engine`, optional `binding`, optional `variant`) the native report carries, from
which a stable, filename-safe implementation identifier is derived and used in
the file name.

#### Scenario: benchmark name joins suite name and case id

- **WHEN** a case `id` `c` from a benchmark whose suite `name` is `b` is exported
- **THEN** the JMH entry's `benchmark` name is `b.c` (the authored suite `name`
  joined to the stable case `id`), not a title or an invented label

#### Scenario: size is recoverable as a params axis

- **WHEN** an entry is exported for size `<size>`
- **THEN** the `size` is recoverable from the entry's `params` (and from the
  file name) so the Visualizer can group and axis on it

#### Scenario: implementation is recoverable from the file name only

- **WHEN** an entry is exported for a structured `implementation`
- **THEN** the implementation identity is recoverable from the file name, and
  the entry's `params` does NOT carry an `implementation` field, so that two
  exported files for the same `(benchmark, size)` pair but different
  implementations still match on `params` and can be compared side by side
  in JMH Visualizer

#### Scenario: Implementation axis derives from structured implementation identity

- **WHEN** the report's `implementation` declares an `engine` and optionally a
  `binding` and a `variant`
- **THEN** the export derives a stable, filename-safe implementation identifier
  from that structured identity to feed the implementation axis via the file
  name
