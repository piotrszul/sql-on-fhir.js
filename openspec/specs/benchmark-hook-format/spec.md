# benchmark-hook-format Specification

## Purpose

Defines the hook contract by which an implementation exposes itself to the
shared reference harness: a declarative `hook.json` manifest (validated by the
`benchmark-hook.schema.json` public contract) that declares a lifecycle mode
(spawn, connect, or CLI — an argv template with no service) and the static
implementation identity, plus a small
JSON-over-local-HTTP worker protocol (`capabilities`, `prepare`, `run`,
`reset`, `shutdown`) with failure signalling that keeps the worker usable and
advisory-only phase timings — so an implementation is measured without writing
any loop, timing, or report code.
## Requirements
### Requirement: Hook manifest declares the lifecycle mode and static implementation identity

A hook SHALL be described by a declarative manifest (`hook.json`), validated by
the `benchmark-hook.schema.json` public contract. The manifest SHALL declare
EXACTLY ONE lifecycle mode: `command` (an argv array whose first element is the
executable — the harness spawns and terminates the hook service, "spawn mode"),
`endpoint` (a localhost base URL of an operator-managed hook service the
harness only connects to, "connect mode"), or `cli` (an argv template the
harness spawns fresh per `run`, "CLI mode" — see the CLI hook mode
requirement). The manifest SHALL also declare an `implementation` block
carrying the STATIC identity of the implementation under test in the report
format's structured shape: `engine` (`{ name, version }`, REQUIRED), `binding`
(`{ name, version }`, OPTIONAL), and `variant` (string, OPTIONAL). The
manifest MAY declare `cwd` and `env`, applying to the spawned process in
spawn and CLI modes. The harness SHALL copy the manifest's `implementation`
into the emitted report VERBATIM — the identity is authored once, statically,
and a hook carries no runtime code for it. The schema SHALL reject a manifest
that declares more than one of `command`, `endpoint` and `cli`, or none of
them, or that omits `implementation.engine`, and SHALL reject unknown
top-level properties. This evolution is ADDITIVE: every manifest valid before
the `cli` branch existed remains valid with identical semantics.

#### Scenario: Spawn-mode manifest is accepted

- **WHEN** a `hook.json` declaring a `command` argv array and an
  `implementation` with an `engine` (`name`, `version`) is validated against
  `benchmark-hook.schema.json`
- **THEN** validation passes

#### Scenario: Connect-mode manifest is accepted

- **WHEN** a `hook.json` declaring an `endpoint` base URL and an
  `implementation.engine` is validated
- **THEN** validation passes

#### Scenario: More than one or no lifecycle mode is rejected

- **WHEN** a manifest declares any two of `command`, `endpoint` and `cli`, or
  none of them
- **THEN** schema validation fails

#### Scenario: Manifest identity reaches the report verbatim

- **WHEN** the harness runs a hook whose manifest declares an `engine`, a
  `binding`, and a `variant`
- **THEN** the emitted report's `implementation` equals the manifest's
  `implementation` verbatim

### Requirement: Worker protocol is JSON over local HTTP

A hook SHALL be an HTTP service on a localhost port exposing the protocol's
commands as endpoints with JSON request and response bodies. In spawn mode the
harness starts the hook from the manifest's `command`, passing the port to
listen on as the `HOOK_PORT` environment variable, and polls
`GET /capabilities` until a valid response arrives within its readiness budget
(spawn and readiness are untimed); in connect mode the harness uses the
manifest's `endpoint` as the base URL. The harness SHALL issue at most one
protocol request at a time to a hook (no pipelining). A handled failure SHALL
be signalled in the response body (`{"ok":false,"error":...}`) with a 2xx
status; transport-level failures — connection refused or reset, a non-2xx
status, an unparseable response body — SHALL be treated by the harness as
protocol violations for the in-flight command (the case fails; the run
continues), never silently ignored. The hook's stdout and stderr carry no
protocol duties; in spawn mode the harness MAY capture them as diagnostics.

#### Scenario: Spawn mode listens on the assigned port

- **WHEN** the harness spawns a hook with `HOOK_PORT=41234`
- **THEN** the hook serves the protocol endpoints on `127.0.0.1:41234`, and
  the harness proceeds once `GET /capabilities` answers validly within the
  readiness budget

#### Scenario: Engine failure travels in the body, not the status code

- **WHEN** a `run` fails inside the engine
- **THEN** the hook answers with a 2xx status and `{"ok":false,"error":...}`,
  and the harness records the case per the failure taxonomy

#### Scenario: A transport-level failure fails the case, not the run

- **WHEN** a protocol request is answered with a non-2xx status or an
  unparseable body
- **THEN** the harness treats the in-flight command as failed for that case
  and proceeds with the run

### Requirement: Command vocabulary and capabilities handshake

The protocol SHALL define five commands, exposed as HTTP endpoints on the
hook's base URL. `GET /capabilities` SHALL be answered with the scenarios the
hook supports (`{"ok":true,"scenarios":[...]}`, members drawn from the report
format's scenario enum); the harness SHALL NOT drive a hook through a scenario
it did not declare. `POST /prepare` (body `{"dataDir":...,"resources":[...]}`)
SHALL cause the hook to load the materialized NDJSON for the named resource
types from `dataDir` into the implementation's most suitable representation,
answering `{"ok":true}` when the data is ready; a `prepare` following an
earlier one SHALL REPLACE the previously prepared dataset, not extend it.
`POST /run` (body `{"view":...,"outCsv":...}`) SHALL cause the hook to
evaluate the ViewDefinition over the prepared data and FULLY WRITE the flat
result as a CSV file at `outCsv` BEFORE responding — the response
(`{"ok":true,"outputRows":...,"phasesMs":...}`) signals that the written file
is complete, because the harness times the round-trip and counts rows from
that file. `POST /reset` SHALL cause the hook to discard any prepared dataset
(see the reset requirement). `POST /shutdown` SHALL cause the hook service to
release resources (including any service it privately manages) and, in spawn
mode, exit 0. Unknown fields in any request body SHALL be ignored by the hook,
so the vocabulary can evolve additively; a request to an endpoint the hook
does not implement SHALL be answered with `{"ok":false,"error":...}` rather
than by terminating the service.

#### Scenario: Capabilities gate the scenarios driven

- **WHEN** a hook's `capabilities` response declares only
  `["preloaded_repeated"]`
- **THEN** the harness does not drive that hook through `end_to_end`

#### Scenario: run responds only after the CSV is fully written

- **WHEN** the harness sends `POST /run` with an `outCsv` path
- **THEN** the hook's `{"ok":true,...}` response is sent only after the CSV
  file at that path is complete, so the harness's round-trip time covers the
  full materialization and the file is countable on response

#### Scenario: Repeated prepare replaces the dataset

- **WHEN** a hook that has already prepared a dataset receives another
  `POST /prepare`
- **THEN** the previously prepared dataset is replaced, so a long-lived
  connect-mode service does not accumulate data across harness runs

#### Scenario: Unknown command is an error response, not an exit

- **WHEN** a hook receives a request for an endpoint it does not implement
- **THEN** it answers `{"ok":false,"error":...}` and remains alive for
  subsequent requests

### Requirement: Reset discards prepared state

`POST /reset` SHALL cause the hook to discard any prepared dataset such that a
subsequent `prepare` performs the full ingest work again, as if for the first
time; the hook SHOULD additionally clear engine-managed caches of the
discarded data where its deployment permits. `reset` is UNTIMED — the harness
never includes it in a timed region. A hook whose deployment cannot honour
reset semantics SHALL omit from `capabilities` any scenario the harness would
drive with `reset` for that lifecycle mode.

#### Scenario: Prepare after reset re-does ingest work

- **WHEN** the harness sends `reset` and then `prepare` for the same dataset
- **THEN** the `prepare` performs the full ingest work again, not a no-op
  against retained state

### Requirement: Failure signalling keeps the worker usable

A command that fails SHALL be answered with `{"ok":false,"error":<string>}` —
a short human-readable explanation the harness records as the case's advisory
`message` — and the hook service SHALL remain alive and usable for subsequent
commands, so one failing case cannot void the rest of the run from inside the
hook. Only `shutdown` (or a fatal crash) ends the hook service. The hook's
`outputRows` in a successful `run` response is an OPTIONAL cross-check: the
harness's own count from the written CSV is authoritative.

#### Scenario: A failed run leaves the worker alive

- **WHEN** a `run` command fails inside the engine and the hook answers
  `{"ok":false,"error":"..."}`
- **THEN** the hook service stays alive, and a subsequent `run` for the next
  case is handled normally

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

### Requirement: CLI hook mode

A CLI hook SHALL be declared by a manifest whose `cli` object carries a `run`
argv template — a complete hook for a stateless command-line implementation,
with no service and no implementation-side code. The template's first element
is the executable; the placeholders `{dataDir}` (the materialized dataset
directory), `{viewFile}` (a harness-written temp file containing the case's
ViewDefinition JSON), and `{outCsv}` (the CSV output path) are substituted as
substrings within each element, and the argv is spawned directly, never via a
shell. The temp paths the harness hands the engine — `{viewFile}` and the
directory holding `{outCsv}` — SHALL be canonical (symlink-free), so engines
that resolve or glob-walk a path string observe the same file the harness
intended. The manifest's `cwd` and `env` apply to the spawned command. The
harness SHALL reject, loudly and before any case runs, a template containing
an unknown `{...}` placeholder or omitting `{outCsv}`. For each `run` the
harness spawns ONE fresh engine process from the template and treats the
command as complete only when that process exits: exit 0 signals success
(the CSV at `{outCsv}` must then be fully written, and the harness counts
its rows as usual); a non-zero exit is an engine failure whose advisory
`error` carries the exit status and a stderr tail. A CLI hook is therefore
dataset-cold on every invocation by construction.

#### Scenario: CLI manifest is accepted

- **WHEN** a `hook.json` declaring a `cli.run` argv template using
  `{dataDir}`, `{viewFile}` and `{outCsv}`, plus an `implementation.engine`,
  is validated against `benchmark-hook.schema.json`
- **THEN** validation passes

#### Scenario: Placeholders are substituted within elements

- **WHEN** a template element is `--input={dataDir}`
- **THEN** the spawned argv element is `--input=<the dataset directory>`,
  with no shell involved

#### Scenario: viewFile is a canonical path

- **WHEN** the platform temp directory sits behind a symlink (e.g. macOS's
  `/var -> /private/var`) and a CLI hook's `run` is invoked
- **THEN** the `{viewFile}` substituted into the argv equals its own
  filesystem realpath

#### Scenario: Unknown placeholder is refused before any case

- **WHEN** a `cli.run` template contains `{viewfile}` (an unknown token)
- **THEN** connector setup fails loudly and no engine process is spawned

#### Scenario: Non-zero exit is an engine failure with diagnostics

- **WHEN** the spawned engine process exits with status 3 after writing to
  stderr
- **THEN** the command is treated as `{"ok":false}` with an `error` carrying
  the exit status and a stderr tail, and the next `run` spawns a fresh
  process normally

### Requirement: Scenario declaration matches architectural capability

A hook SHALL declare a scenario only when its architecture can honour that
scenario's semantics, per two verb-level questions. `preloaded_repeated`
requires prepared state that survives across `run` round-trips — an
architecture that cannot hold such state (notably any per-invocation CLI
tool) MUST NOT declare it. `end_to_end` requires returning to dataset-cold
before each sample — by service restart (spawn mode), by an honoured `reset`
(connect mode), or by construction (a fresh process per invocation). For a
CLI hook the harness SHALL synthesize the capabilities handshake from the
manifest — there is no service to ask — as exactly
`{"ok":true,"scenarios":["end_to_end"]}`; this is fixed, not configurable.
An implementation that can serve both scenarios through different
deployments SHOULD ship one manifest per deployment, distinguished by
`implementation.variant`, rather than overloading one hook.

#### Scenario: A stateless CLI tool declares end_to_end only

- **WHEN** the harness loads a `cli` manifest
- **THEN** the synthesized capabilities declare exactly
  `["end_to_end"]`, and driving `preloaded_repeated` against that hook is
  refused as a run-level (not per-case) failure

#### Scenario: One engine, two deployments, two manifests

- **WHEN** an engine is benchmarkable both as a one-shot CLI and as a
  preloaded server
- **THEN** it ships two manifests (e.g. `variant: "cli"` and
  `variant: "server"`), each declaring only the scenarios its deployment
  honours, and reports carry the variant so results are never conflated
