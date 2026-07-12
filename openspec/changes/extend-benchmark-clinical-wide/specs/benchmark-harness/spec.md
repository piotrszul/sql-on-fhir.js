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

### Requirement: Harness run reads resource files by streaming

The harness `run` path SHALL compute the per-resource line counts it reports and
verify the checkfile's per-file sha256 checksums by streaming each resource file
in fixed-size byte chunks, never reading a whole resource file into memory as one
string or buffer. This keeps a measurement run — not only a bless — memory-bounded
at the largest tiers, where a single resource file can exceed the JS engine's
maximum string length (an ~9 GB `xl` file cannot be read as one string at all).
The reference `sof-js` hook SHALL likewise ingest a resource file by reading it in
chunks so that loading never allocates a whole-file string; the parsed in-memory
table the `preloaded_repeated` scenario keeps resident between runs is inherent to
that scenario and is out of scope for this bound (it bounds the LOAD, not the
resident dataset).

#### Scenario: Observing resource counts streams the file

- **WHEN** the harness reports the input row count for a resource at the `xl` tier
- **THEN** the count is obtained by streaming the file in chunks, never by reading
  the whole file into a single string

#### Scenario: Checksum verification streams the file

- **WHEN** the harness verifies a resource file against its locked sha256 before a
  run
- **THEN** the file is hashed by streaming it in chunks, never by buffering the
  whole file in memory

#### Scenario: The reference hook loads by streaming

- **WHEN** the `sof-js` hook prepares a resource from a single large NDJSON file
- **THEN** it reads and parses the file in chunks so loading never allocates a
  whole-file string, even though the parsed table it then holds resident is the
  `preloaded_repeated` scenario's inherent cost
