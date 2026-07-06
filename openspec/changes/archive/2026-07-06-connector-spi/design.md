# Design — connector SPI and the CLI connector

## Context

The harness's scenario loops (`benchmark/tools/harness/runner.js`) never speak
HTTP. They drive the client object returned by `startWorker(manifest)`:
`{ mode, capabilities, implementation, alive, send(cmd, {timeoutMs}),
shutdown(), kill(), waitExit() }`. Everything transport-specific lives behind
that object in `worker.js`. That seam is the connector SPI in all but name —
this change names it, gives it a second stock implementation (CLI), and makes
connector selection a manifest concern.

The motivating implementations are flatquack and Pathling CLI: stateless
one-shot tools for which the mandated HTTP service is an ~80-line copy-paste
shim. The HTTP protocol stays untouched as the only language-neutral interop
contract; the SPI is a harness-internal extension seam, not a second public
protocol.

## Goals / Non-Goals

**Goals:**

- Formalize the connector SPI as the existing worker-client interface, with
  connector selection driven by the manifest's lifecycle discriminator.
- Ship a zero-code CLI connector: a hook manifest with an argv template is a
  complete hook for a stateless CLI implementation.
- Keep the refactor behaviour-preserving for HTTP hooks: every existing
  worker/runner/cli test passes unchanged.
- Write down the scenario-declaration decision table (which scenarios an
  architecture should declare, and why).

**Non-Goals:**

- Custom module connectors (manifest → implementer-supplied JS file):
  deferred until a concrete architecture forces their shape. The manifest
  discriminator leaves room for a `module` branch.
- Any change to the HTTP protocol, the report format, or the benchmark file
  format.
- `preloaded_repeated` support for CLI hooks (structurally impossible without
  state across processes — see D3).
- Windows shell semantics; argv arrays are spawned directly, never via a
  shell, on all platforms.

## Decisions

### D1. The SPI is the existing worker-client interface, `send(cmd)` included

The connector interface is exactly what `startWorker` already returns; the
factory becomes `startConnector(manifest, opts)` and picks the connector from
the manifest discriminator (`endpoint` → HTTP connect, `command` → HTTP
spawn, `cli` → CLI). `runner.js` changes only its import.

*Alternative rejected: typed per-verb methods* (`connector.prepare(...)`,
`connector.run(...)`). Prettier, but it churns `runner.js` for zero
behavioural gain and hard-codes the verb vocabulary into the SPI surface; the
generic `send(cmd)` lets the vocabulary evolve additively (the hook-format
spec already requires unknown-field tolerance) with changes confined to the
call sites that use a new verb.

### D2. CLI manifests declare an argv template; the connector owns temp files

New manifest branch:

```json
{
  "cli": {
    "run": ["flatquack", "--input", "{dataDir}", "--view", "{viewFile}", "--output", "{outCsv}"]
  },
  "implementation": { "engine": { "name": "flatquack", "version": "0.3.0" } }
}
```

- `cli.run` is an argv template. Placeholders `{dataDir}`, `{viewFile}`,
  `{outCsv}` are substituted as substrings within each element (so
  `--input={dataDir}` works); the array is spawned directly, no shell.
- The harness writes the case's ViewDefinition JSON to a temp file and
  substitutes its path for `{viewFile}` — CLI tools take files, not inline
  JSON, and this keeps the manifest free of any per-case content.
- `cwd` and `env` keep their existing manifest semantics and apply to the
  spawned command.
- A template that uses an unknown placeholder, or omits `{outCsv}`, fails
  connector setup loudly (`SetupError`) before any case runs — a typo must
  not surface as N identical per-case failures.

*Alternative rejected: one template per verb* (`prepare`/`run`/`reset`
templates). A stateless tool has nothing meaningful to run for
`prepare`/`reset`, and per-verb templates would invite implementers to fake
statefulness through the filesystem. One `run` template keeps the contract
honest: the command IS the whole load→execute→extract pipeline. The nested
`cli` object leaves room for future slots (e.g. a version probe) without
top-level sprawl.

### D3. CLI connector verb semantics: synthesized handshake, one process per run

There is no service to ask, so the connector answers the verbs itself:

- `capabilities` → synthesized `{"ok":true,"scenarios":["end_to_end"]}`.
  Fixed, not configurable: a per-invocation process cannot hold prepared
  state across `run` round-trips, so `preloaded_repeated` is structurally
  dishonest for this connector. An implementation that CAN preload (a
  server, an embedded engine) should expose that mode through an HTTP hook
  manifest instead — that is the decision table's point.
- `prepare` → records `dataDir` (and answers `{"ok":true}` immediately, ~0 ms).
- `run` → substitutes the template, spawns a fresh child process, waits for
  exit, then answers: exit 0 → `{"ok":true}`; non-zero exit → `{"ok":false,
  "error": "<exit status>: <stderr tail>"}` (an engine failure — the
  connector stays usable; the next `run` spawns fresh).
- `reset` → `{"ok":true}` no-op: cold by construction.
- `shutdown`/`kill` → no-ops between cases; during an in-flight `run`, `kill`
  signals the child's process group (SIGTERM → SIGKILL escalation, same
  policy as the HTTP spawn connector).

The runner's `end_to_end` spawn-mode loop then works unchanged: "start
worker" is instant (synthesized capabilities), the timed region covers the
`prepare` (no-op) + `run` (the actual command) round-trips, and every sample
is dataset-cold because every sample is a fresh process.

### D4. CLI timed region includes engine-process startup — deliberately

For HTTP spawn hooks, service spawn + readiness are untimed ("VM boot is not
ETL cost"). For a CLI hook the child process IS the engine invocation: its
startup (interpreter boot, JVM start) lands inside the timed region, because
that is the real, user-visible cost of a one-off CLI transformation — there
is no way to run flatquack without paying flatquack's startup. This is a
known, documented asymmetry, not an accident: `pathling-cli` e2e numbers
include JVM boot and `pathling-server` e2e numbers do not, and the report's
`implementation.variant` is what keeps that comparison honest. The harness
spec text states this explicitly so nobody "discovers" it.

### D5. Failure taxonomy per connector, all stock connectors fully isolated

The existing error classes carry over; the CLI connector maps onto them:

| event | class | case status |
| --- | --- | --- |
| child exceeds inactivity budget | `WorkerTimeout` (child group killed) | `timeout` |
| child cannot be spawned (missing binary) | `WorkerCrash` | `execution_error` |
| non-zero exit | engine failure (`ok:false` path) | `execution_error` + stderr tail as `message` |
| invalid template placeholders | `SetupError` | run-level setup failure |

Both stock connectors keep the hook in a separate OS process, so the
crash/timeout isolation story of the failure taxonomy is preserved untouched.
The weaker-isolation caveat belongs to the deferred module-connector route
and is written down only when that route is.

### D6. `worker.js` becomes the connector layer without moving public seams

`startWorker` is renamed `startConnector` and grows the `cli` branch; the
HTTP spawn/connect implementations are byte-for-byte behaviour-preserving
(the existing `harness-worker.test.js` suite passes unchanged as the
regression guard). The CLI connector lives in its own module
(`cli-connector.js`) sharing the process-group kill/escalation helpers.
No file moves beyond that; the refactor must be reviewable as "extract +
extend", not "rewrite".

## Risks / Trade-offs

- **[CLI e2e numbers embed process startup]** → documented as normative in
  the harness spec (D4); `variant` labelling distinguishes deployments;
  anyone needing startup-free numbers runs the same engine behind an HTTP
  hook.
- **[Synthesized capabilities assert identity/scenarios from a file, not
  running code]** → accepted for scenarios (structural, per D3); identity
  was ALREADY manifest-asserted for HTTP hooks (the spec requires verbatim
  copy), so nothing weakens.
- **[Template substring substitution could collide with literal braces in
  arguments]** → placeholders are only the three known tokens; a literal
  `{dataDir}` in an argument to the tool is implausible, and an unknown
  `{...}` token is rejected at setup, so typos fail loudly rather than pass
  through silently.
- **[A CLI tool that writes the CSV lazily could return before the file is
  complete]** → impossible by construction: the connector answers `run` only
  after the child EXITS, and the harness counts rows from the file after the
  response, same as for HTTP hooks.
- **[oneOf growth is a schema change to a public contract]** → additive
  (Constitution IV): every previously valid manifest remains valid with
  identical semantics; only new documents can use the new branch.

## Migration Plan

Additive throughout; no migration. Existing HTTP hook manifests and services
are untouched. Rollback = not using `cli` manifests. The `startWorker` →
`startConnector` rename is internal to `benchmark/tools/harness/` (one
importer).

## Open Questions

- None blocking. The deferred module-connector shape (and its isolation
  caveats) is intentionally left to a future change with a concrete driver
  (e.g. Databricks-hosted Pathling).
