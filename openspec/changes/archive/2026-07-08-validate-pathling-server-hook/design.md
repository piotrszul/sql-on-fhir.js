# validate-pathling-server-hook — design

## Context

This is the third and last of the sibling validation changes, and the only one
that exercises the full five-command HTTP hook protocol
(`capabilities` / `prepare` / `run` / `reset` / `shutdown`) rather than the
stateless CLI template. The reference example of the protocol is
`sof-js/src/hook.js`; the harness driver is
`benchmark/tools/harness/worker.js` (transport, lifecycle modes) and
`runner.js` (scenario loops). Two lifecycle modes matter here:

- **connect mode** (`hook.json` has `endpoint`): the harness only ever connects
  to an operator-managed service — never spawns it, never sends signals, and,
  for `end_to_end`, TRUSTS an untimed `reset` between timed regions
  (`runner.js` `runCaseEndToEnd`, connect branch).
- **spawn mode** (`hook.json` has `command`): the harness starts the service
  with an OS-allocated `HOOK_PORT`, polls `GET /capabilities` until `ok:true`
  within a readiness budget (default 30 s, `worker.js` `spawnHook`), and owns
  termination. For `end_to_end`, spawn mode restarts a FRESH service per sample
  (spawn + readiness untimed), so every sample is cold by construction.

The target engine is **Pathling Server** (`ghcr.io/aehrc/pathling:latest`), a
Spark-backed FHIR server. Its ViewDefinition-execution and bulk-import APIs
already exist over REST; a small Bun/JS adapter translates the hook protocol to
them. The REST facts that shape the adapter, established during exploration
(cited against the Pathling repo at `/Users/szu004/dev/pathling`):

- **Import is `POST {base}/$import`, ASYNCHRONOUS and mandatory-async**: the
  request MUST carry `Prefer: respond-async`, returns `202` with a
  `Content-Location` pointing at a `$job` status URL, which is polled (`202`
  while running, `200` with a `Parameters` result when done). Sources are
  `file://` URLs, gated by `pathling.import.allowableSources` (a URL-prefix
  allowlist). `saveMode: overwrite` deletes all existing resources of that type
  and replaces them with the file — a per-type self-cleaning ingest.
  (`server/.../bulkimport/ImportProvider.java`, `ImportMode.java`,
  `ImportOperationIT.java`.)
- **ViewDefinition execution is `POST {base}/$viewdefinition-run`,
  SYNCHRONOUS**: a `Parameters` body carrying `viewResource` (the
  ViewDefinition), with CSV requested via `Accept: text/csv` or a `_format`
  parameter and a header row by default (`header=true`). The result streams
  back as one CSV document — the adapter writes it verbatim to `outCsv`, which
  is naturally the single headed file the run-output contract requires
  (the `benchmark-hook-format` "Result CSV output format" requirement added by
  the CLI cycle). (`server/.../view/ViewDefinitionRunProvider.java`.)
- **There is NO bulk clear / drop / truncate over REST.** The only reset levers
  are (a) `saveMode: overwrite` on import (per-type), and (b) discarding the
  warehouse and restarting the process (whole-store). This is the crux of the
  design's honesty question for `reset`.
- Storage is persisted as Delta tables under `pathling.storage.warehouseUrl`;
  `cacheDatasets` defaults true, so datasets are cached in memory across
  requests. Data — and warmed caches/JVM/Spark session — survive across
  samples in a long-lived (connect-mode) server.
- Local bring-up is Docker only: no `java -jar` path (the source jar is a thin,
  non-executable module jar), so the supported route is
  `docker run -p 8080:8080 ghcr.io/aehrc/pathling:latest`.

## Goals / Non-Goals

**Goals:**

- A small Bun/JS adapter (`pathling-server-hook.js`, structured after
  `sof-js/src/hook.js`) under `benchmark/staging-hooks/pathling-server/`, plus
  its `hook.json`, translating the five hook commands to Pathling's REST API.
- Exercise **connect mode first** (operator-managed Pathling), running the
  honest scenario(s) on `clinical-flat` at sizes `s` and `m` with
  checkfile-verified counts; then decide, per what connect mode reveals,
  whether spawn mode (adapter owns the Pathling lifecycle, making
  `end_to_end`'s restart-per-sample real) is worth the wall-clock, recording
  the reasoning in `FINDINGS.md`.
- Every friction point recorded in `FINDINGS.md` with exactly one taxonomy
  outcome; contract/doc/case fixes land here, test-first.

**Non-Goals:**

- No Pathling source changes unless a genuine tool defect is found (then fixed
  in Pathling's repo and cross-referenced).
- No new benchmark cases or dataset changes; the checkfile counts are the
  fixed oracle (condition-flat `s` 6406 / `m` 48908; observation-components
  `s` 4366 / `m` 39479).
- No use of Pathling's own `sof-benchmark` runner (that is a library/Spark
  in-process harness, not a REST hook).

## Decisions

1. **The adapter is a per-engine shim, not contract code.** Like
   `sof-js/src/hook.js` it is an HTTP service answering the five endpoints with
   JSON bodies (engine failures as `{"ok":false,"error":...}` with a 2xx
   status). It holds a tiny amount of state: the FHIR base URL of the Pathling
   server it talks to, and (spawn mode) a handle to the Pathling container it
   owns. It lives only under `staging-hooks/` and is deleted at migration.

2. **Command → REST mapping.**
   - `capabilities` → declare the scenarios the current DEPLOYMENT can honestly
     serve (see decision 4); no REST call.
   - `prepare` → for each requested resource type, `POST /$import` with
     `saveMode: overwrite` and a `file://` URL for `<dataDir>/<Resource>.ndjson`,
     `Prefer: respond-async`, then poll the `$job` URL to completion. Overwrite
     gives prepare its documented REPLACE semantics for free: a second prepare
     of the same type discards the prior contents. Untimed in
     `preloaded_repeated`; inside the timed region in `end_to_end`.
   - `run` → `POST /$viewdefinition-run` with the case's ViewDefinition as
     `viewResource`, `Accept: text/csv`; stream the response body to `outCsv`
     (single headed file). Report advisory `outputRows` by counting data lines.
   - `reset` → see decision 3.
   - `shutdown` → (spawn mode) stop the owned Pathling container, then exit 0;
     (connect mode) exit 0 without touching the operator's server — but the
     harness never sends `shutdown` in connect mode.

3. **`reset` honesty is the central spec-stress point — resolved empirically in
   apply.** A Spark-backed server has no REST bulk-clear, and a long-lived
   server keeps JVM/Spark/dataset caches warm regardless. So a connect-mode
   `end_to_end` "cold" sample is not truly cold: even if `reset` re-imports with
   overwrite, the second timed region runs against a warm engine. The honest
   options are (a) connect mode declares only `preloaded_repeated` (where
   prepare is explicitly OUTSIDE the timed region and warmth is expected and
   correct), and (b) `end_to_end` coldness is obtained ONLY in spawn mode, where
   a fresh container per sample is cold by construction. The hypothesis carried
   into apply: **connect-mode `end_to_end` cannot be shipped as honest cold
   numbers; the adapter's `capabilities` reflects what each deployment can serve
   honestly.** Whether this is a doc gap (README wording on connect-mode `reset`
   trust for warm engines) or a contract observation is decided by the friction
   apply actually hits.

4. **`capabilities` is deployment-aware.** The adapter distinguishes its
   deployment from the environment: connect mode is signalled by the operator
   setting `PATHLING_BASE` to an already-running Pathling; spawn mode is its
   absence (the adapter owns a fresh container). (Both modes receive `HOOK_PORT`,
   so it cannot distinguish them.) The adapter declares
   `['preloaded_repeated']` when it cannot honestly serve cold `end_to_end`
   (connect against a long-lived server) and `['preloaded_repeated',
   'end_to_end']` when it can (spawn, fresh container per sample). The harness
   already refuses to drive a scenario a hook does not declare
   (`runner.js` `startGated`), so this keeps dishonest numbers off the table by
   construction.

5. **Data reaches Pathling by `file://` with an identity mount.** The harness
   hands the adapter a host absolute `dataDir`; Pathling reads inside a
   container. To avoid a path-translation contract, the container mounts the
   host data directory at the IDENTICAL absolute path
   (`--mount type=bind,source=<dataRoot>,target=<dataRoot>,readonly` — `-v`
   mis-parses absolute paths) and sets
   `pathling.import.allowableSources=file://<dataRoot>/`, so the adapter passes
   `file://<dataDir>/<Resource>.ndjson` verbatim. Spawn mode does this in its
   own `docker run`; connect mode documents the same mount in the hook README.

6. **Warehouse coldness by deployment.** Spawn mode runs Pathling with an
   EPHEMERAL warehouse (no volume), so each fresh container is an empty store —
   reinforcing cold-by-construction. Connect mode's long-lived server keeps its
   warehouse; `prepare`'s overwrite import is what refreshes the queried types.

7. **Identity: `engine.name: Pathling`, `variant: server`.** This distinguishes
   the server deployment from the CLI one (`variant: cli`) of the same engine,
   exactly the disambiguation `implementation.variant` exists for. The concrete
   `engine.version` is read from the running server's CapabilityStatement and
   recorded in `hook.json` and FINDINGS so the pass is reproducible.

## Risks / Trade-offs

- **[Spawn-mode `end_to_end` reboots Spark per sample]** → honest but slow
  (~tens of seconds of Spark boot per sample). Mitigated by running connect
  mode's honest scenario first and treating spawn `end_to_end` as an optional,
  scoped confirmation whose cost is recorded. This is the proposal's
  "untimed spawn/readiness vs. timed regions when startup is expensive" probe.
- **[Spawn readiness budget may be too short for a Spark boot]** → the harness's
  spawn readiness budget defaults to 30 s and is not exposed on the harness CLI
  (`tools/harness/cli.js` has no `--readiness`), while a cold Pathling container
  can take longer to answer `capabilities`. This is a candidate contract
  finding (expose/raise the readiness budget, or document the requirement);
  confirmed or refuted empirically in apply, fixed test-first if real.
- **[Async import polling inside the `end_to_end` timed region]** → the `$job`
  poll cadence adds a small, adapter-side latency to the measured `load` phase.
  Recorded as an observation; the harness owns the wall clock and the poll
  interval is a fixed, documented adapter constant.
- **[Docker-only bring-up on the host]** → heavier than the CLI hooks' local
  binaries; the image pull and Spark heap are machine-local prerequisites,
  documented in the hook README (staging hooks are explicitly machine-local and
  temporary).

## Open Questions (answered during apply)

- Do both `clinical-flat` cases produce checkfile-exact counts against the
  Pathling **server** at `s` and `m` (as they did for the CLI)? Expected yes;
  the same typed views and `getResourceKey()`/`.first()` FHIRPath are honoured
  by the same engine.
- Is connect-mode `end_to_end` `reset` honest, or must the hook omit it? (See
  decision 3/4 — the headline question.)
- Does `saveMode: overwrite` deliver `prepare`-REPLACES cleanly, with no
  residue from a prior prepare?
- Do `preloaded_repeated` numbers mean what the README claims when the server's
  dataset caches persist across samples (warm-by-design, which is the point of
  that scenario)?
- Does the spawn readiness budget accommodate a cold Spark boot, or is that a
  contract gap?
