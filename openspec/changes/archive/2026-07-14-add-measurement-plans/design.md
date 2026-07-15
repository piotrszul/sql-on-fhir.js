# Design: add-measurement-plans

## Context

`benchmark/tools/harness/runner.js` implements the measurement loop as one
hand-written closure per (scenario × lifecycle mode): `runCasePreloaded`, and
`runCaseEndToEnd` with spawn/connect branches (CLI mode reuses the spawn
branch via the CLI connector's synthesized capabilities). Each closure bundles
axes that in JMH are independent: worker fork level, untimed setup, what the
clock wraps, warmup policy, and when verification happens. The internal
flatquack/DuckDB tuning cell (proposal: retire `dev/sof-benchmark`) needs the
combination none of the closures reach — fork-per-case, warmups discarded,
load inside the timed region, in-engine `table` sink, verification via a
post-loop untimed extraction.

Decomposition of every choreography the harness must express (the plan
vocabulary is derived from — and closed over — these rows):

| binding                | fork level | trial setup     | invocation setup | timed region   | extraction        | warmup |
| ---------------------- | ---------- | --------------- | ---------------- | -------------- | ----------------- | ------ |
| preloaded_repeated     | suite      | lazy prepare    | —                | run            | in-run (CSV)      | W      |
| end_to_end (spawn/CLI) | invocation | —               | —                | prepare + run  | in-run (CSV)      | 0      |
| end_to_end (connect)   | suite      | —               | reset            | prepare + run  | in-run (CSV)      | 0      |
| internal warm cell     | trial      | prepare (no-op) | —                | run (table)    | post-loop count   | W      |

Verification is *already* post-loop in `finishEntry` (the last written CSV is
counted once); what varies is only whether the CSV is produced inside each
timed `run` or by a separate untimed command after the loop.

Relevant precedents: the connector SPI (transports behind one interface —
this change is the same move for choreography) and the staging-hooks
validation workflow (findings taxonomy, migration exit criterion).

## Goals / Non-Goals

**Goals:**

- One generic single-shot executor over a declarative `MeasurementPlan`;
  official scenarios become named bindings; zero observable change to them.
- The internal cell expressible as a plan: fork-per-trial, `table` sink,
  post-loop untimed verification (`count`, with `extract` available), warmup
  on a load-including timed region.
- Honesty guard in profile form: official scenario stamps derivable only from
  bindings; raw plans emit a lossless, self-describing, deliberately
  non-conforming record plus JMH.
- Staging flatquack DuckDB-session benchmark validating all of the above,
  with findings feeding harness fixes test-first.

**Non-Goals:**

- No public contract changes: schemas, hook protocol docs, official scenario
  semantics, `bench:harness` CLI flags all stay as-is (findings may force
  additive exceptions, each with a delta spec).
- No JMH modes beyond single-shot; no plugin/callback plan system; no
  throughput/sampling semantics.
- Not the base-vs-profile formalization of `benchmark-report-format`, not an
  official `table`-sink scenario, not the `extract` verb's graduation into
  `benchmark-hook-format` — all deferred to a findings-informed follow-up.
- No compile-step status taxonomy (`GENERATION_ERROR`), no new dataset kinds,
  no manifest parameterization.

## Decisions

### D1. Plans are closed data, not callbacks

`MeasurementPlan` is a plain record interpreted by the executor:

```js
{
  forkLevel: 'suite' | 'trial' | 'invocation',
  trialSetup: 'prepare-lazy' | 'none',        // untimed, per case
  invocationSetup: 'reset' | 'none',          // untimed, before each sample
  timedRegion: ['run'] | ['prepare', 'run'],  // one wall-clocked round-trip seq
  verification: 'in-run-csv'                  // run writes the CSV; harness counts it
              | 'post-loop-count'             // untimed count(*) verb; engine-reported
              | 'post-loop-extract',          // untimed CSV verb; harness counts it
  warmup: 'iterations' | 'zero',              // use spec/CLI warmup, or force 0
}
```

Every field is a closed enum whose values are exactly the behaviors the four
known rows need — the executor implements each keyed behavior (e.g.
`prepare-lazy` keeps the per-resource `prepared` set and its failure
isolation). No functions in plans: data plans are trivially loggable (they
*are* the record's plan descriptor, D5), diffable in tests, and cannot smuggle
choreography past the honesty guard. Rejected alternative: lifecycle
callbacks (JMH `@Setup`-style) — maximally flexible, but turns every custom
plan into unauditable code and makes "what was measured" unrecordable.

### D2. Scenario bindings own the official names

A binding = `{ scenario, mode } → plan` lookup for the four official rows.
`runSuite` keeps its public signature and resolves `(scenario, manifest mode)`
to a plan internally; the report assembler takes the *binding* (which carries
the scenario name and the schema-pinned `phases`/`sink`/`warmup` stamping
rules) — never a raw plan. The executor itself never sees scenario names.
Existing tests must pass unmodified; that is the acceptance criterion for the
refactor being behavior-preserving.

### D3. Internal runs enter through a separate module entry point, not the CLI

The staging driver imports a new harness export (e.g.
`runPlanSuite({ plan, internalScenarioId, ... })`) directly; the public
`bench:harness run` CLI gains no `--plan` flag. Rationale: the CLI is
documented public surface for hook authors — a plan flag there would be an
attractive nuisance during the very phase meant to test whether plans should
ever be public. The driver lives in the staging directory and dies with it at
migration.

### D4. Post-loop verification verbs are staging-scoped hook commands

Two untimed post-loop commands, selected by the plan's `verification` field:

- `{ cmd: 'count' }` → `{ ok, rows }` — the engine counts the materialized
  sink (`SELECT count(*) FROM _sink`). **Default for the internal cell.**
  Engine-reported, but sound *for this plan shape*: the official contract's
  CSV does double duty (anti-laziness proof + harness-owned count), and a
  `table` sink already forces full materialization inside the timed region,
  so only the provenance nicety is relaxed — acceptable in a non-conforming
  record (D5 stamps the provenance), a non-threat for self-controlled tuning,
  and exact parity with the retired rig's sentinel `count(*)`. It also avoids
  an untimed multi-GB `COPY` per case at `l`/`xl`.
- `{ cmd: 'extract', outCsv }` — the hook fully writes the CSV (same
  output-format contract as `run`) before responding; the harness counts the
  file. Kept available (not mandatory) because the CSV is the diffable
  artifact when two variants disagree on more than cardinality, and it is the
  hook's debugging affordance.

The HTTP connector forwards commands generically, so no connector change is
expected for spawn/connect hooks; the CLI connector answers both with its
existing unknown-command error (correct: a per-invocation process cannot hold
a result). Official bindings never send either verb, so no existing hook can
encounter them. Rejected alternative: a `run` variant flag
(`{ cmd:'run', sink:'table' }`) — overloads the one verb whose semantics the
public contract pins hardest, and makes "untimed" a body flag instead of a
structural property of when the command is sent.

### D5. The internal record is report-shaped, truthful, and non-conforming

Custom-plan runs emit `<stem>.internal-report.json`: the exact report
structure with `measurement.scenario` set to a namespaced non-official id
(`internal:<name>`, e.g. `internal:warm-table-sink`), truthful
`phases`/`sink`/`warmup`, and an added `measurement.plan` block carrying the
plan record verbatim — including the `verification` value, so the count's
provenance (engine-reported `count` vs harness-counted `extract` CSV) is
recorded in the data it qualifies. The published report schema's closed scenario enum makes
this record fail validation everywhere the contract is enforced (fail-closed,
zero contract changes) while keeping every byte lossless. A staging-local JSON
schema (not a public contract) validates the internal shape in tests. The JMH
export reuses `projectJmh` unchanged; self-description rides on
`implementation.variant` (D6).

### D6. Implementation identity for internal runs is self-describing

The staging hook's manifest sets `implementation` so the composed impl-id
reads unambiguously in JMH overlays, e.g. engine `duckdb`/`1.5.3`, binding
`flatquack`/`<git-ref>`, variant `internal-warm-table-sink[-<backend>]`. This
is operator hygiene (JMH labels carry no conformance claim), but the driver
enforces it: it refuses a manifest whose variant lacks the `internal-` prefix.

### D7. Staging benchmark shape

`benchmark/staging-hooks/flatquack-internal/`: a spawn-mode HTTP hook (bun)
that per case holds one `duckdb-<version>` CLI child; `prepare` records the
data dir; first `run` compiles the ViewDefinition via the flatquack worktree
(memoized — generation cost lands in a discarded warmup sample), then every
`run` executes `CREATE OR REPLACE TEMP TABLE _sink AS <body>` with completion
detected by an echoed sentinel line (event-driven, no polling); `count`
answers `SELECT count(*) FROM _sink`; `extract` runs
`COPY _sink TO '<outCsv>' (HEADER)` (implemented for debugging/diffing even
though the default plan uses `count`). `SET preserve_insertion_order = false`
matches the retired rig. The driver runs an existing benchmark (sizes `s`/`m`)
for at least two implementation identities (two DuckDB CLI versions and/or two
flatquack refs) and verifies checkfile counts via the post-loop extraction.
DuckDB binaries and flatquack worktrees are operator-provided local paths
(hook `env`), like the existing staging flatquack hook's `FLATQUACK_CLI`.

## Risks / Trade-offs

- [Refactor regresses official scenarios] → existing contract tests stay
  green *unmodified* (any test edit is a red flag in review); the
  decomposition table is encoded as executor unit tests per binding.
- [Plan vocabulary creeps toward a framework] → closed enums only; a new
  behavior requires a new enum value plus a design-level row justifying it;
  callbacks are rejected by construction (D1).
- [Internal records leak into official tooling] → non-official scenario id
  fails the published schema everywhere (fail-closed); distinct filename
  (`.internal-report.json`); driver-enforced `internal-` variant prefix (D6).
- [JMH overlays visually mislead] → residual and accepted: JMH labels carry
  no conformance claim; mitigation is the self-describing impl-id (D6).
- [`extract` semantics drift from `run`'s output contract] → the staging hook
  reuses the same CSV assertions in tests; if findings show `extract` is
  general, graduation happens in the follow-up contract change, test-first.
- [`post-loop-count` gets reused where it is not sound] → its soundness
  argument depends on a materializing (`table`) sink in the timed region; the
  executor rejects a plan combining `post-loop-count` with an `in-run-csv`-
  style region, and any graduation of `count` into the public contract must
  carry the anti-laziness analysis explicitly.
- [Sentinel-based session parsing is brittle across DuckDB versions] →
  isolated inside the staging hook (not harness code); a parsing failure is a
  per-case `execution_error`, and version quirks land in FINDINGS.md — this
  is exactly the friction the staging exercise exists to surface.

## Migration Plan

1. This change: refactor + plan extensions + staging benchmark, PR to
   `staging/benchmark` with in-PR archive (validation-cycle procedure).
2. After the harness adjustments settle: hook + driver migrate to flatquack's
   repository; `benchmark/staging-hooks/flatquack-internal/` is deleted;
   `dev/sof-benchmark` retires (its README gains a pointer, in its own repo).
3. Possible follow-up contract change (separate proposal): base-vs-profile
   split in `benchmark-report-format`, official `table`-sink scenario,
   `extract` graduation — informed by FINDINGS.md.

Rollback: the refactor is internal to `benchmark/tools/harness/`; reverting
the PR restores the closure-based runner with no schema or data migration.

## Open Questions

- Internal scenario id naming: fix `internal:` as the reserved namespace now,
  or leave any non-enum string non-conforming by definition? (Leaning: fix the
  prefix — it gives the follow-up profile change an obvious reserved space.)
- Should the executor record per-sample `phasesMs` from the internal hook's
  DuckDB `.timer` as the advisory cross-check (proposal's noise argument), or
  is that deferred polish? (Leaning: include — it is the cheap evidence that
  the harness clock ≈ engine time once extraction is untimed.)
- Does `worker.js` forward unknown commands generically in spawn/connect mode
  (expected: yes)? If not, the connector change is slightly larger than D4
  assumes — verify before tasks are finalized.
