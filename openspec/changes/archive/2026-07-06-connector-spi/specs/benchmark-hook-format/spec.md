# benchmark-hook-format — delta for connector-spi

## ADDED Requirements

### Requirement: CLI hook mode

A CLI hook SHALL be declared by a manifest whose `cli` object carries a `run`
argv template — a complete hook for a stateless command-line implementation,
with no service and no implementation-side code. The template's first element
is the executable; the placeholders `{dataDir}` (the materialized dataset
directory), `{viewFile}` (a harness-written temp file containing the case's
ViewDefinition JSON), and `{outCsv}` (the CSV output path) are substituted as
substrings within each element, and the argv is spawned directly, never via a
shell. The manifest's `cwd` and `env` apply to the spawned command. The
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

## MODIFIED Requirements

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
