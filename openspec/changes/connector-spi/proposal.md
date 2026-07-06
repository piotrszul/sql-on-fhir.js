# Connector SPI for the benchmark harness

## Why

The hook contract mandates an HTTP service for every implementation, but for a
stateless CLI tool (flatquack, Pathling CLI) that is pure ceremony: every such
implementation would copy-paste the same ~80-line web-server shim around a
single command invocation — exactly the "too much required from the
implementation" burden the harness exists to remove. Meanwhile the seam that
solves this already exists de facto: `runner.js` never speaks HTTP; it drives
an in-process object (`capabilities` / `send` / `shutdown` / `kill`) returned
by `startWorker`. Formalizing that seam as a connector SPI lets a CLI
implementation plug in with a manifest alone — zero code — while the HTTP
protocol remains unchanged as the sole language-neutral interop contract for
service-style implementations (Python drivers, Pathling server, sof-mssql).

## What Changes

- Formalize the **connector SPI**: the harness-internal JavaScript interface
  that the scenario loops drive — the five verbs (`capabilities`, `prepare`,
  `run`, `reset`) plus lifecycle (`shutdown`/`kill`). Scenario logic stays in
  the harness; a connector only translates verbs to a transport. The existing
  HTTP worker becomes the first connector (`HttpConnector`, spawn and connect
  modes), with behaviour unchanged.
- Add a stock **CLI connector**: manifest-driven command templates
  (placeholders for `dataDir`, the view, `outCsv`), a fresh child process per
  timed call, full crash/timeout isolation via child-process kill. A CLI
  implementation's entire hook is a JSON manifest — no code. Structurally
  stateless, so it declares `end_to_end` only; `preloaded_repeated` requires
  state that survives across `run` calls, which a per-invocation process
  cannot honestly hold.
- Extend the **hook manifest** with an additive discriminator: `command` |
  `endpoint` (existing, unchanged semantics) | `cli` (new — command templates
  for the CLI connector). Existing manifests remain valid as written.
- Document the **scenario-declaration decision table** in the hook-format
  spec: which scenarios an architecture should declare, reduced to two
  verb-level questions — can you hold prepared state across runs?
  (`preloaded_repeated`); can you return to dataset-cold cheaply?
  (`end_to_end`).
- **Out of scope (deferred)**: custom module connectors (a manifest pointing
  at an implementer-supplied JS file). The SPI is shaped so that route can be
  added later, but it is not specified or implemented until a concrete
  architecture (e.g. Databricks-hosted Pathling) forces its shape and its
  weaker crash-isolation story is worth writing down.

No breaking changes: the manifest evolution is additive (`oneOf` gains one
branch), the HTTP protocol is untouched, and the report format is unaffected.

## Capabilities

### New Capabilities

_None — the connector SPI and CLI connector are requirement-level changes to
the two existing harness capabilities, not a new public contract._

### Modified Capabilities

- `benchmark-harness`: the harness SHALL drive scenarios through the connector
  SPI rather than assuming an HTTP worker; connector selection follows the
  manifest discriminator; the failure-taxonomy mapping is restated per
  connector kind (both stock connectors preserve full process isolation).
- `benchmark-hook-format`: the manifest lifecycle-mode requirement gains the
  `cli` branch (command templates, placeholder vocabulary, per-call process
  semantics); the capability handshake for CLI manifests is synthesized by the
  harness from the manifest (no service to ask); the scenario-declaration
  decision table becomes part of the capability-handshake requirement.

## Impact

- **Code**: `benchmark/tools/harness/worker.js` refactors into the connector
  layer (`HttpConnector` preserving current behaviour); new CLI connector
  module; `runner.js` unchanged except connector selection;
  `benchmark/benchmark-hook.schema.json` gains the `cli` manifest branch;
  `manifest.js` validation extended.
- **Tests**: new connector-SPI conformance tests shared by both stock
  connectors; CLI-connector tests against a fixture command; manifest schema
  tests for the new branch; existing HTTP worker/runner tests must pass
  unchanged (regression guard that the refactor is behaviour-preserving).
- **Contracts**: `benchmark-hook.schema.json` evolves additively
  (Constitution IV); the HTTP protocol and report schema are untouched.
- **Downstream**: flatquack and Pathling-CLI hooks become manifest-only,
  which is the empirical test of this change's premise; the sof-js HTTP hook
  continues to work unmodified.
