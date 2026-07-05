# Design: benchmark-harness

## Context

Today the runner contract (benchmark-reference-runner) obliges every
implementation to build a complete runner: measurement loop, warmup discipline,
status taxonomy, statistics, checkfile verification, report emission, JMH
export. One implementation exists (`sof-js`); three more are pending (Pathling,
sof-mssql, flatquack), all currently maintained by the same author. Every
hand-rolled runner duplicates protocol code, and any divergence between them
silently undermines the comparability the contract pins elsewhere
(byte-identical data, pinned JMH recomputation, defined stats shape). The
reference runner itself already deviates from the contract it demonstrates: it
serializes CSV to an in-memory string where the spec requires a written file,
and its `buildReport` accepts `scenario: end_to_end` while never timing the
load phase.

This change introduces a shared reference harness plus a thin hook contract, as
agreed in the design review of the benchmark subproject (2026-07-03). The hook
transport was revised from stdio line-JSON to local HTTP in the follow-up
transport review (2026-07-05) and folded into this change pre-merge; D1
records both the decision and the rejected first cut.

## Goals / Non-Goals

**Goals:**

- Shrink the per-implementation obligation from "write a runner" to a ~100-line
  hook (worker process).
- Make cross-implementation comparability true by construction: one codebase
  owns timing, statistics, verification, report and JMH emission.
- Support both measurement scenarios (`preloaded_repeated`, `end_to_end`) with
  the scenario semantics enforced by the harness, not by implementer honor.
- Keep the hand-rolled-runner route conformant (report format stays the
  escape-hatch public contract).
- Make the work-verification guard independent of the engine under test (row
  counts derived from the written CSV).

**Non-Goals:**

- Hooks for Pathling / sof-mssql / flatquack (follow-on work; they are the
  empirical test of the contract's thinness).
- Workload or size expansion.
- A cold-cache variant for server-backed engines in `preloaded_repeated`.
- Changing the pinned JMH `scoreError` estimator (a later one-place decision
  once the harness is the only computer of it).
- Remote/distributed execution; the harness drives a local child process.

## Decisions

### D1. Transport: local HTTP service, spawned or connected (not stdio, not per-phase shell commands)

The hook is a small HTTP service on a localhost port, speaking the protocol as
JSON request/response bodies: `GET /capabilities`, `POST /prepare`,
`POST /run`, `POST /reset`, `POST /shutdown`. The manifest declares exactly
one lifecycle mode: `command` (spawn mode — the harness starts the service
with an OS-allocated port passed as `HOOK_PORT`, polls `GET /capabilities`
until ready within a budget, and owns termination) or `endpoint` (connect
mode — an operator-managed service, e.g. started via docker-compose; the
harness only connects and never terminates it).

- *Why not stdio line-JSON* (this change's first cut): stdio is respectable
  practice for supervised workers (LSP, DAP, MCP all use it), but three
  observations from prototyping reversed the call. Implementer ergonomics —
  every hook author knows their stack's HTTP micro-framework (Flask, Javalin,
  `Bun.serve`), while stdio protocol loops are niche and carry a
  runtime-specific flush footgun; and a STATEFUL stdio session (`prepare`,
  then repeated `run`) cannot be hand-driven the way `curl` drives an HTTP
  session, which matters most while the prototype gathers implementer
  feedback. Deployment shape — the server-backed engines next in line
  (Pathling, sof-mssql) already run as services; a supervised-child-only
  contract wraps them awkwardly and excludes REST-only engines. Robustness —
  the process-supervision surface concentrated the prototype's fragility
  (spawn failure, shutdown hang, pipe errors); HTTP delegates framing, error
  signalling and connection lifecycle to mature stacks.
- *Why not hardened stdio with JSON-RPC 2.0 framing* (riding vscode-jsonrpc /
  LSP4J / pygls): stronger than a hand-rolled line protocol, but those
  libraries are LSP-ecosystem niche — familiarity stays with HTTP — and the
  stateful-session debuggability gap remains.
- *Why not dual transport* (`stdio | http` per manifest): re-imports the
  divergence risk the shared harness exists to eliminate — two transports to
  keep semantically identical, doubled tests and docs, for a fleet of four.
- *Why not per-phase shell commands* (ClickBench-style `prepare.sh`/`run.sh`):
  works only when prepared state lives externally (a database); for embedded
  engines state cannot outlive a process, so the scripts would privately
  daemonize and reinvent a transport ad hoc.
- Engine failures stay in the response body (2xx + `{"ok":false,"error"}`),
  keeping the status-taxonomy mapping transport-independent; transport-level
  failures (connection refused/reset, non-2xx, malformed body) are the
  protocol-violation/crash class. stdout/stderr carry no protocol duties (in
  spawn mode the harness may capture them as diagnostics).
- A hook that fronts a heavier service (a JVM, a database server) either
  starts and stops it behind the protocol boundary (spawn mode) or IS that
  service's sidecar/endpoint (connect mode).
- Hand-debuggability: a stateful session is drivable by hand
  (`curl :$PORT/prepare`, then repeated `curl :$PORT/run`), and the harness
  keeps a single-command debug mode.

### D2. Timing ownership: the harness wall-clocks; hook-reported phases are advisory

The normative sample is the harness's wall-clock around each `run` round-trip
(HTTP request written → response fully received, after the CSV file is fully
written).
No implementation carries clock code. A hook MAY report per-phase splits
(`load`/`execute`/`extract`) in its response; the harness records them as the
report's existing optional `phaseSamplesMs` — diagnostics for intra-engine
tuning, never the comparable number. IPC round-trip overhead is negligible
against multi-second view executions and is paid equally by every
implementation.

### D3. Scenario semantics enforced by lifecycle control

- `preloaded_repeated` (both modes): setup (untimed) → `prepare` (untimed) →
  warmup `run`s (discarded) → measured `run`s (each timed) → `shutdown` (spawn
  mode only). A repeated `prepare` REPLACES the prepared dataset, so a
  long-lived connect-mode service does not accumulate data across harness
  runs.
- `end_to_end`, spawn mode: spawn + readiness (untimed — VM boot is not ETL
  cost) → timed region covering `prepare` + `run` → service RESTART between
  samples, so every sample is dataset-cold by construction: the harness never
  sent the dataset to that process before the timed sample.
- `end_to_end`, connect mode: an UNTIMED `reset` precedes each timed
  `prepare` + `run` region. Coldness is TRUSTED to the hook's `reset`
  (discard the prepared dataset so `prepare` re-does full ingest work); the
  service process — and with it runtime warmth such as JIT and engine caches —
  persists across samples, which the spec states openly. Finer cold semantics
  (cache-class disclosure, honesty heuristics, warm-engine variants) are
  deferred until implementer feedback.

### D4. Governance: hooks live implementation-side

Each implementation's repo hosts its `hook.json` + hook service; the harness
takes a manifest path (`--hook <path>`). The manifest also fixes the lifecycle
mode (`command` | `endpoint`), so deployment shape is declared, not inferred. This repo ships only the sof-js hook as the
worked example. Consequences: the hook contract must stand alone as a fully
documented public contract, and the manifest is the natural home for the
report's `implementation` identity (`engine`/`binding`/`variant` declared
statically; the harness copies it verbatim — one less thing a hook can get
wrong at runtime). Rejected: an in-repo hook registry (this repo would own
glue for engines it does not control) and a pointer registry (adds a
fetch/trust story with no current need).

### D5. Bless stays in sof-js

Minting checkfile assertions remains a reference-implementation privilege. The
analytic cross-check (`deriveExpectedCount`) needs a FHIRPath evaluator; moving
bless into the harness would make the artifact depend on an implementation,
inverting the layering the whole design defends. The harness only VERIFIES
against an existing checkfile.

### D6. Row counts derived from the written CSV

The harness counts output rows from the CSV file the hook wrote, so the
work-verification guard no longer trusts the engine under test. The hook's own
`outputRows` becomes an optional cross-check; a disagreement is surfaced in the
case's advisory `message` (the harness count is authoritative).

### D7. Constitution placement and the amended "no runner code" promise

The harness lives at `benchmark/tools/harness/` as a reference tool,
replaceable like the materializer. The `benchmark-reference-runner` spec's
"artifact contains no runner or timing code" is amended openly (Constitution
IV; the pre-production waiver from contract v2 applies — there are still no
external consumers of the runner contract): the NORMATIVE contract requires no
runner code from implementations; the artifact MAY ship a reference harness as
convenience. Engine-specific execution code remains banned from the artifact.

### D8. Report-format hardening folded in

1. The closed `stats` shape opens: `mean`/`stddev`/`min`/`max`/`median` stay
   REQUIRED, extra fields become PERMITTED. Forcing recomputation from
   `samplesMs` is achieved by keeping `samplesMs` required, not by banning
   keys; a closed object makes every future statistic a breaking change,
   against Constitution IV's additive-evolution preference.
2. An optional per-case `verified` flag distinguishes verified-`ok` (an
   assertion was present and matched) from unverified-`ok` (no assertion
   consulted), closing the "assertion absent ⇒ silently ok" hole. Additive;
   reports without it stay valid.

### D9. The sof-js runner slims to bless; the harness absorbs the rest

`sof-js/src/benchmark-run.js` keeps only `--record` (bless + analytic
cross-check). The measurement loop, status mapping, report emission and the JMH
projection move to the harness (the projection stays a pure function of the
native report, per benchmark-jmh-format, and is relocated so one codebase
computes comparability-critical numbers). sof-js gains a hook entry point +
`hook.json`, becoming the first hook and the worked example.

## Risks / Trade-offs

- [The ~100-line-hook claim is untested] → The Pathling hook (follow-on) is the
  explicit empirical test; if it needs substantially more than ~a day / ~100
  lines, the hook contract is renegotiated before the workload expands.
- [Warm-cache bias for server-backed engines in `preloaded_repeated`: a
  database's buffer pool persists across samples, invisible to the harness] →
  Stated openly in the harness spec as what "preloaded" means; a cold-cache
  mode is a future `variant`, not a new scenario.
- [Port conflicts / stale listeners in spawn mode] → OS-allocated free port
  per spawn; the readiness probe validates the `capabilities` body, so
  "something else answered on that port" is distinguishable from "ready".
- [Orphaned children if the harness dies mid-run (spawn mode)] → spawn into a
  process group and terminate the group; accepted residual risk at prototype
  grade.
- [Connect-mode `reset` dishonesty or drift] → trusted by design at prototype
  grade (revisited with implementer feedback); the report still never claims
  a scenario the harness did not drive.
- [The harness becomes a single point of measurement bugs] → Preferable to N
  divergent copies of the same bugs; mitigated by protocol-level tests with
  scripted fake hooks (tiny HTTP servers) and by the unchanged, still-public
  report contract.
- [Embedded hooks must now embed an HTTP listener] → ~10 lines in Bun/Node;
  the sof-js hook is the worked example proving the size claim. Deployment
  shapes that fit neither mode still have the hand-rolled-runner escape
  hatch.

## Migration Plan

Pre-production; no external consumers of the runner contract. `bun run
bench:run` is replaced by the harness entry point (`bench:harness run --hook
… --size …`); bless becomes `bench:bless` (sof-js). The report and checkfile
formats are unchanged except for the two additive schema edits (open `stats`,
optional `verified`), so existing reports remain valid. Rollback is dropping
the harness and restoring `benchmark-run.js` — the declarative artifact is
untouched.

## Open Questions

- Should the protocol message shapes be pinned in a JSON Schema per endpoint
  (in addition to prose + examples in the capability spec)? Deferred until a
  second hook exists to test ergonomics.
- `prepare` granularity if a future suite declares many datasets per file
  (today: one dataset per suite, one `prepare` per (dataset, size)).
- Optional `reset` in spawn mode as a cheaper alternative to restart for
  engines where restart is expensive (restart stays the enforced default).
- Whether the report should disclose the cold mechanism (`restart` vs
  `reset`) per run — deferred with the finer cold semantics.
