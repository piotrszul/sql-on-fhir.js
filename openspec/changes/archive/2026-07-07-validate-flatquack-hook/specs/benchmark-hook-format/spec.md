# benchmark-hook-format — delta (validate-flatquack-hook)

Contract defect found validating the flatquack staging hook: the harness
handed engines temp paths (`{viewFile}`, and `{outCsv}`'s working directory)
under the platform temp directory *as returned by the OS*, which on macOS
sits behind a symlink (`/var -> /private/var`). An engine that resolves or
glob-walks that path string sees a different (or unreachable) file than the
harness intended. The harness now canonicalizes every engine-facing temp
directory (shared `makeEngineTempDir` helper), so the paths it substitutes
are always physical and symlink-free.

## MODIFIED Requirements

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
intended. The manifest's `cwd` and `env` apply to the
spawned command. The
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
