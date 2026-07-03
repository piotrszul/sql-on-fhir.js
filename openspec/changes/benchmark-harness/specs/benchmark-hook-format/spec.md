# benchmark-hook-format Specification (delta)

## ADDED Requirements

### Requirement: Hook manifest declares the spawn command and static implementation identity

A hook SHALL be described by a declarative manifest (`hook.json`), validated by
the `benchmark-hook.schema.json` public contract. The manifest SHALL declare a
`command` (an argv array whose first element is the executable) and an
`implementation` block carrying the STATIC identity of the implementation under
test in the report format's structured shape: `engine` (`{ name, version }`,
REQUIRED), `binding` (`{ name, version }`, OPTIONAL), and `variant` (string,
OPTIONAL). The manifest MAY declare `cwd` and `env` for spawning. The harness
SHALL copy the manifest's `implementation` into the emitted report VERBATIM —
the identity is authored once, statically, and a hook carries no runtime code
for it. The schema SHALL reject a manifest that omits `command` or
`implementation.engine`, and SHALL reject unknown top-level properties.

#### Scenario: Well-formed manifest is accepted

- **WHEN** a `hook.json` declaring a `command` argv array and an
  `implementation` with an `engine` (`name`, `version`) is validated against
  `benchmark-hook.schema.json`
- **THEN** validation passes

#### Scenario: Missing engine is rejected

- **WHEN** a manifest omits `command` or `implementation.engine`
- **THEN** schema validation fails

#### Scenario: Manifest identity reaches the report verbatim

- **WHEN** the harness runs a hook whose manifest declares an `engine`, a
  `binding`, and a `variant`
- **THEN** the emitted report's `implementation` equals the manifest's
  `implementation` verbatim

### Requirement: Worker protocol is line-delimited JSON over stdio

A hook SHALL be a worker process that the harness spawns from the manifest's
`command` and drives over standard streams: the harness writes one JSON command
per line to the worker's stdin, and the worker writes EXACTLY ONE JSON response
line to stdout per command, in command order (no pipelining, no unsolicited
protocol lines). stdout is RESERVED for protocol responses; all logging and
diagnostics SHALL go to stderr. The worker SHALL flush each response line
immediately (a block-buffered runtime must flush explicitly), because the
harness's timing boundary is the arrival of the response line. A stdout line
that is not a valid JSON protocol response SHALL be treated by the harness as a
protocol violation for the in-flight command (the case fails; the run
continues), never silently skipped.

#### Scenario: One response line per command, in order

- **WHEN** the harness sends two commands in sequence
- **THEN** the worker emits exactly one response line for the first, then
  exactly one for the second, with no interleaved or unsolicited stdout lines

#### Scenario: Logs go to stderr, not stdout

- **WHEN** a worker needs to log engine diagnostics while handling a command
- **THEN** it writes them to stderr, and its stdout carries only the JSON
  response line

#### Scenario: Unflushed or non-JSON stdout is a protocol violation

- **WHEN** a worker writes a non-JSON line to stdout (for example a stray log
  line) while a command is in flight
- **THEN** the harness treats the in-flight command as failed for that case and
  proceeds with the run, rather than guessing or hanging

### Requirement: Command vocabulary and capabilities handshake

The protocol SHALL define four commands. `capabilities`
(`{"cmd":"capabilities"}`) SHALL be answered with the scenarios the hook
supports (`{"ok":true,"scenarios":[...]}`, members drawn from the report
format's scenario enum); the harness SHALL NOT drive a hook through a scenario
it did not declare. `prepare`
(`{"cmd":"prepare","dataDir":...,"resources":[...]}`) SHALL cause the worker to
load the materialized NDJSON for the named resource types from `dataDir` into
the implementation's most suitable representation, answering
`{"ok":true}` when the data is ready. `run`
(`{"cmd":"run","view":...,"outCsv":...}`) SHALL cause the worker to evaluate
the ViewDefinition over the prepared data and FULLY WRITE the flat result as a
CSV file at `outCsv` BEFORE responding — the response
(`{"ok":true,"outputRows":...,"phasesMs":...}`) signals that the written file
is complete, because the harness times the round-trip and counts rows from that
file. `shutdown` (`{"cmd":"shutdown"}`) SHALL cause the worker to release
resources (including any service it privately manages) and exit 0. Unknown
fields in any command SHALL be ignored by the worker, so the vocabulary can
evolve additively; a worker receiving an unknown `cmd` SHALL answer
`{"ok":false,"error":...}` rather than exiting.

#### Scenario: Capabilities gate the scenarios driven

- **WHEN** a hook's `capabilities` response declares only
  `["preloaded_repeated"]`
- **THEN** the harness does not drive that hook through `end_to_end`

#### Scenario: run responds only after the CSV is fully written

- **WHEN** the harness sends `run` with an `outCsv` path
- **THEN** the worker's `{"ok":true,...}` response is written only after the
  CSV file at that path is complete, so the harness's round-trip time covers
  the full materialization and the file is countable on response

#### Scenario: Unknown command is an error response, not an exit

- **WHEN** a worker receives a `cmd` it does not implement
- **THEN** it answers `{"ok":false,"error":...}` and remains alive for
  subsequent commands

### Requirement: Failure signalling keeps the worker usable

A command that fails SHALL be answered with `{"ok":false,"error":<string>}` —
a short human-readable explanation the harness records as the case's advisory
`message` — and the worker SHALL remain alive and usable for subsequent
commands, so one failing case cannot void the rest of the run from inside the
hook. Only `shutdown` (or a fatal crash) ends the worker. The hook's
`outputRows` in a successful `run` response is an OPTIONAL cross-check: the
harness's own count from the written CSV is authoritative.

#### Scenario: A failed run leaves the worker alive

- **WHEN** a `run` command fails inside the engine and the worker answers
  `{"ok":false,"error":"..."}`
- **THEN** the worker stays alive, and a subsequent `run` for the next case is
  handled normally

#### Scenario: Hook-reported outputRows is a cross-check, not the count

- **WHEN** a successful `run` response carries an `outputRows` that disagrees
  with the harness's count of the written CSV's rows
- **THEN** the harness's CSV-derived count is used for verification, and the
  disagreement is surfaced in the case's advisory `message`

### Requirement: Advisory phase splits

Hook-supplied phase timings SHALL be treated as ADVISORY diagnostics only. A
hook MAY include a `phasesMs` object in a successful `run` response, keyed by
the report format's phase vocabulary (`load`, `execute`, `extract`), carrying
its own per-phase millisecond timings for that sample. The harness SHALL record
them as the report's optional `phaseSamplesMs` and SHALL NOT use them as (or to
adjust) the normative harness-timed samples.

#### Scenario: phasesMs lands in phaseSamplesMs, never in samplesMs

- **WHEN** a hook's `run` responses carry `phasesMs` splits
- **THEN** the emitted report's case carries them as `phaseSamplesMs`, and the
  case's `samplesMs` remain the harness's own wall-clock round-trip times
