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

### Requirement: Harness run streams its file reads and writes

The harness `run` path SHALL stream every whole-file interaction on both the input
and output sides in fixed-size chunks, never holding a whole resource file or a
whole output CSV in memory as one string or buffer. This keeps a measurement run —
not only a bless — memory-bounded at the largest tiers, where a single file can
exceed the JS engine's maximum string length (an ~9 GB `xl` resource file cannot
be read as one string at all, and a wide result's CSV can hit the same ceiling
even when the row objects fit).

On the INPUT side: the harness SHALL compute the per-resource line counts it
reports and verify the checkfile's per-file sha256 checksums by streaming each
resource file in chunks, and the reference `sof-js` hook SHALL ingest a resource
file by reading it in chunks so loading never allocates a whole-file string. On
the OUTPUT side: the harness SHALL count the output CSV's data rows by streaming
it in chunks (carrying RFC-4180 quote state across chunk boundaries), and the
reference hook SHALL write the output CSV by streaming its rows to disk rather than
building the whole CSV as one string. The parsed in-memory dataset the
`preloaded_repeated` scenario keeps resident, and the result-row array the
non-streaming `evaluate()` returns, are inherent to the engine and out of scope for
this bound — it bounds the LOAD, the COUNT and the WRITE, not the resident tables.

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

#### Scenario: Counting output rows streams the CSV

- **WHEN** the harness counts the data rows of a run's output CSV to verify it
- **THEN** the count is obtained by streaming the CSV in chunks with RFC-4180 quote
  state carried across boundaries, never by reading the whole CSV into one string

#### Scenario: The reference hook writes the output CSV by streaming

- **WHEN** the `sof-js` hook writes the result CSV for a run
- **THEN** it streams the rows to disk through a bounded buffer, byte-identically to
  the whole-string serializer, so a wide result's CSV is never held as one
  whole-file string
