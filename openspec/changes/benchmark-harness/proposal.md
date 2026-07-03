## Why

The current runner contract asks every implementation to hand-roll a complete
benchmark runner — measurement loop, warmup discipline, status taxonomy,
statistics, checkfile verification, report emission, JMH export. That is a THICK
obligation, duplicated per engine (sof-js today; Pathling, sof-mssql and
flatquack pending), and any drift between those hand-rolled harnesses silently
undermines the cross-implementation comparability the contract works so hard to
pin (the byte-identical data, the pinned JMH recomputation methods, the defined
stats shape). The evidence that the obligation is too heavy is already in-tree:
the reference runner itself deviates from its own contract (it serializes CSV to
an in-memory string where the spec demands a written file, and its report API can
claim an `end_to_end` timed region it never times).

A shared reference harness inverts the contract: ONE codebase owns the
measurement loops and the protocol, and an implementation provides only a thin
HOOK — a worker process that loads data, runs a view, and writes CSV. This makes
comparability true BY CONSTRUCTION rather than by spec prose, shrinks the
per-implementation obligation from "write a runner" to ~100 lines of glue, and
serves both driving use cases at once: cross-engine comparison (harness-timed,
uniform) and intra-engine version tuning (one place emits the JMH export).

## What Changes

- **NEW hook contract (public contract).** An implementation is benchmarked
  through a harness-supervised WORKER PROCESS speaking line-delimited JSON over
  stdio: `capabilities` → `prepare` → `run` ×N → `shutdown`. stdout belongs to
  the protocol; engine logs go to stderr. A hook is described by a small
  manifest (`hook.json`) declaring the spawn command and the STATIC
  implementation identity (`engine`, optional `binding`, optional `variant`)
  that the harness copies into the report. Hooks live IMPLEMENTATION-SIDE (each
  engine's repo owns its hook); this repo ships only the `sof-js` hook as the
  reference example, so the hook contract must stand alone as a fully documented
  public contract.
- **NEW shared reference harness** under `benchmark/tools/harness/` (a reference
  tool, replaceable like the materializer). The harness owns: worker lifecycle
  (spawn/kill; a crashed worker maps to `execution_error`, an unresponsive one
  to `timeout` under the harness's own budget), wall-clock timing of each `run`
  round-trip (the NORMATIVE measurement — no clock code in any implementation),
  both measurement scenarios (`preloaded_repeated`: `prepare` untimed, `run`
  timed; `end_to_end`: `prepare`+`run` timed with a WORKER RESTART between
  samples so each sample is dataset-cold by construction, spawn excluded from
  timing), output row counting FROM THE WRITTEN CSV (the work-verification guard
  no longer trusts the engine under test; the hook's own `outputRows` is an
  optional cross-check), checkfile assertion verification, statistics, native
  report emission, and the JMH export.
- **Advisory phase splits.** A hook MAY report per-phase timings
  (`load`/`execute`/`extract`) in its `run` response; the harness records them
  as the report's existing optional `phaseSamplesMs` — diagnostics for
  intra-engine tuning, never the comparable number.
- **The sof-js runner is re-wrapped as the first hook.** The harness absorbs the
  loop, statuses, stats, report and JMH emission from `sof-js/src/benchmark-run.js`.
  Bless mode (`--record` + the analytic cross-check) STAYS in sof-js: minting
  checkfile assertions remains a reference-implementation privilege, keeping the
  artifact → implementation dependency direction clean (the harness only
  verifies).
- **The hand-rolled-runner path survives as the escape hatch.** The report
  format remains a public contract; an implementation that cannot fit the worker
  model (e.g. a REST-only service) still hand-rolls a runner and emits the same
  report format, so downstream consumers (JMH export, future aggregation) are
  indifferent to the route.
- **BREAKING (pre-production waiver, called out openly): the artifact's "no
  runner code" promise is amended.** The `benchmark-reference-runner` spec's
  "artifact contains no runner or timing code" becomes: the NORMATIVE contract
  requires no runner code from implementations; a reference harness ships in the
  artifact as replaceable convenience, and the hook interface is the new THIN
  normative contract.
- **Report format hardening folded in (two additive schema changes).** (1) The
  closed `stats` shape is OPENED: the five fields (`mean`, `stddev`, `min`,
  `max`, `median`) stay REQUIRED but extra fields are permitted, per
  Constitution IV's preference for additive evolution — forcing recomputation
  from `samplesMs` is achieved by keeping `samplesMs` required, not by banning
  keys. (2) A per-case `verified` flag distinguishes verified-`ok` (a checkfile
  assertion was present and matched) from unverified-`ok` (no assertion
  consulted), closing the "assertion absent ⇒ silently ok" hole in the
  work-verification guard.

Out of scope (deliberately): hooks for Pathling / sof-mssql / flatquack (they
follow the accepted contract and are its empirical test); workload and size
expansion; a cold-cache variant for server-backed engines in
`preloaded_repeated` (the warm-cache semantics are stated, a cold variant is a
future `variant` discriminator); changing the pinned `scoreError` estimator
(once the harness is the only thing computing it, that is a later one-place
decision).

## Capabilities

### New Capabilities

- `benchmark-hook-format`: the hook public contract — the `hook.json` manifest
  (spawn command, static implementation identity) and the worker stdio protocol
  (line-delimited JSON commands `capabilities`/`prepare`/`run`/`shutdown`,
  response shapes, error signalling, stdout/stderr discipline, buffering rules).
- `benchmark-harness`: the reference harness — worker lifecycle and failure
  mapping onto the status taxonomy, harness-owned wall-clock timing, the two
  scenarios' timed-region and restart semantics, CSV-derived row counting,
  checkfile verification, report and JMH emission.

### Modified Capabilities

- `benchmark-reference-runner`: the "artifact contains no runner code" promise
  is amended to admit the reference harness as replaceable convenience; the
  runner contract is restated as two conformant routes (hook + harness, or
  hand-rolled runner emitting the report format); bless remains a sof-js
  concern.
- `benchmark-report-format`: the `stats` shape becomes open-for-extension (five
  required fields, extras permitted); a per-case `verified` flag distinguishes
  verified from unverified `ok`.

## Impact

- `benchmark/tools/harness/` (NEW): the reference harness implementation.
- `benchmark/benchmark-hook.schema.json` (NEW public contract): the hook
  manifest schema; the wire protocol is specified prose+examples in the
  capability spec.
- `benchmark/benchmark-report.schema.json`: `stats.additionalProperties` opened;
  optional per-case `verified` added.
- `sof-js/src/benchmark-run.js`: slimmed to bless mode (`--record` + analytic
  cross-check); loop/report/JMH code moves to the harness.
- `sof-js` (NEW): the reference hook (worker entry point + `hook.json`).
- `sof-js/src/jmh.js` / `jmh-cli.js`: relocated/re-exported under the harness
  (the projection stays a pure function of the native report).
- `benchmark/README.md`: the runner contract section gains the hook route as
  the recommended path; the hand-rolled route remains documented.
- Root/package scripts: a `bench:harness` entry point.
- Constitution IV note: the reference-runner spec amendment is a called-out
  break under the pre-production waiver (no external consumers of the runner
  contract yet); the report-schema changes are additive.
