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
agreed in the design review of the benchmark subproject (2026-07-03).

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

### D1. Transport: harness-supervised worker over stdio (not HTTP, not per-phase shell commands)

The hook is a single long-lived child process per implementation, spawned and
killed by the harness, speaking line-delimited JSON on stdin/stdout.

- *Why not HTTP*: HTTP answers "how do I call it" but not lifetime — port
  allocation, readiness probing, orphan cleanup and a supervisor would all have
  to be bolted on, and every hook would have to embed an HTTP server. A
  supervised child gets lifetime for free: the child dies with the harness,
  and a crashed child is directly observable.
- *Why not per-phase shell commands* (ClickBench-style `prepare.sh`/`run.sh`):
  `preloaded_repeated` requires loaded state to survive between timed samples;
  for embedded engines (sof-js, flatquack in-process) state cannot outlive a
  process, so `prepare.sh` would have to start a daemon and stash a pid/port
  file — reinventing service management without a supervisor.
- A hook that fronts a heavier service (a JVM, a database server) starts and
  stops it *behind* the protocol boundary; the harness only ever manages one
  child.
- stdout is reserved for the protocol; engine logs go to stderr. Responses are
  flushed per line (block-buffered runtimes such as Python must flush
  explicitly).
- Hand-debuggability is preserved: the protocol is line-JSON
  (`echo '{"cmd":"run",...}' | ./hook` works), and the harness ships a
  single-command debug mode.

### D2. Timing ownership: the harness wall-clocks; hook-reported phases are advisory

The normative sample is the harness's wall-clock around each `run` round-trip
(command written → response line read, after the CSV file is fully written).
No implementation carries clock code. A hook MAY report per-phase splits
(`load`/`execute`/`extract`) in its response; the harness records them as the
report's existing optional `phaseSamplesMs` — diagnostics for intra-engine
tuning, never the comparable number. IPC round-trip overhead is negligible
against multi-second view executions and is paid equally by every
implementation.

### D3. Scenario semantics enforced by process control

- `preloaded_repeated`: spawn (untimed) → `prepare` (untimed) → warmup `run`s
  (discarded) → measured `run`s (each timed) → `shutdown`.
- `end_to_end`: spawn (untimed — VM boot is not ETL cost) → timed region
  covering `prepare` + `run` → worker RESTART between samples, so every sample
  is dataset-cold by construction. The spec's "MUST NOT be warmed with this
  dataset" stops being honor-system: the harness never sent the dataset to that
  worker before the timed sample.

### D4. Governance: hooks live implementation-side

Each implementation's repo hosts its `hook.json` + worker; the harness takes a
manifest path (`--hook <path>`). This repo ships only the sof-js hook as the
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
- [stdout contamination by chatty engines corrupts the protocol] → The hook
  spec makes stderr-for-logs a normative rule with a scenario; the harness
  fails a case loudly on an unparseable protocol line rather than guessing.
- [The harness becomes a single point of measurement bugs] → Preferable to N
  divergent copies of the same bugs; mitigated by protocol-level tests with
  scripted fake hooks and by the unchanged, still-public report contract.
- [Worker model biases toward embedded/library deployment shapes] → The
  hand-rolled-runner route remains conformant for deployment shapes that
  cannot fit (e.g. REST-only services).
- [Python/JVM hooks with block-buffered stdout hang the protocol] → Explicit
  flush requirement with its own scenario; harness inactivity budget maps to
  `timeout` rather than hanging forever.

## Migration Plan

Pre-production; no external consumers of the runner contract. `bun run
bench:run` is replaced by the harness entry point (`bench:harness run --hook
… --size …`); bless becomes `bench:bless` (sof-js). The report and checkfile
formats are unchanged except for the two additive schema edits (open `stats`,
optional `verified`), so existing reports remain valid. Rollback is dropping
the harness and restoring `benchmark-run.js` — the declarative artifact is
untouched.

## Open Questions

- Should the protocol message shapes be pinned in a JSON Schema per line (in
  addition to prose + examples in the capability spec)? Deferred until a second
  hook exists to test ergonomics.
- `prepare` granularity if a future suite declares many datasets per file
  (today: one dataset per suite, one `prepare` per (dataset, size)).
