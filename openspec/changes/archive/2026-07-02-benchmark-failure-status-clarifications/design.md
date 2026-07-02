## Context

This is a small follow-up to Wave 2 (`benchmark-bootstrap-and-failure-isolation`,
#21), which introduced per-case failure isolation and the `timeout`/`malformed`
statuses. Reviewing that wave for the Pathling implementation, the implementer
raised clarification requests (#22) about how binding the finer statuses are, what
governs `timeout`, and how much of the runner surface is an implementer obligation.
All five points are accepted. This change encodes the clarifications into the two
affected specs and fixes one stale README line. It changes no schema and no runner
code — the contract's INTENT is unchanged; the wording is being made match it.

The reference harness at `dev/sof-benchmark` (a separate Python implementation) and
the `sof-js` reference runner both already behave the conformant way: they collapse
every non-`ok` failure into `execution_error`, and their case filter is optional.
Pathling runs on Spark, a lazy strongly-typed engine, which is why the
best-effort framing matters: at the catch site, an unparseable input and an engine
evaluation error are indistinguishable, so mandating the `malformed` distinction
would only be satisfiable by a permissive non-lazy parser.

## Goals / Non-Goals

**Goals**

- State that `execution_error` is the always-conformant default for any
  load/prepare/evaluate failure, and that `timeout`/`malformed` are OPTIONAL
  best-effort refinements a runner MAY apply.
- Reword `timeout` so it is keyed off the runner's OWN out-of-band wall-clock
  budget, with no implication of an authored/contract budget field.
- Clarify that partial-run subset filtering is OPTIONAL reference-runner
  convenience, not an implementer obligation.
- Fix the stale README data-layout line to the identity-keyed layout.

**Non-Goals**

- Implementation code and tests — this is the authoring phase. The only file edit
  (the README line) is enumerated in `tasks.md` as an implementation-phase step.
- Any `benchmark-report.schema.json` change — the six-member enum and per-status
  descriptions already accommodate best-effort classification.
- Any reference-runner code change — it already collapses failures into
  `execution_error` and its case filter is already optional.
- Any re-bless / data change — no materialized bytes and no contract-of-data are
  touched.
- Adding a shared AUTHORED time budget field — cross-referenced only, deferred.

## Decisions

### D-A. `execution_error` is the always-conformant default; classification is best-effort (#22.1, #22.3)

The status taxonomy is AVAILABLE-not-REQUIRED. `execution_error` is the default
label for ANY failure to load, prepare, or evaluate a case, and a runner that
records every non-`ok` failure as `execution_error` (as the `sof-js` reference
runner does) is fully conformant. `timeout` and `malformed` are OPTIONAL
refinements a runner MAY apply WHEN it can cheaply distinguish them; producing the
finer statuses is a quality-of-diagnostics nicety, not a contract obligation.
Classification is therefore BEST-EFFORT — a runner MAY report `execution_error` for
a failure it cannot cheaply prove is `malformed` (or `timeout`).

Rationale: on a lazy, strongly-typed engine (e.g. Spark) an unparseable input and
an engine evaluation error surface at the same catch site with no cheap way to tell
them apart. Mandating the `malformed`/`execution_error` distinction would only be
satisfiable by writing a permissive non-lazy parser purely to classify failures —
a cost the contract has no reason to impose. The six-member enum and the existing
per-status descriptions stay; only the framing of `malformed`/`timeout` changes from
"required outcome" to "optional label a runner MAY apply".

### D-B. `timeout` is runner-applied out-of-band; no authored budget (#22.2)

The current `timeout` wording ("exceeded a time budget on generation or execution")
reads as if a benchmark-file budget field governs it. There is NO such field in the
contract, and none is added here. `timeout` is a status a runner MAY apply when it
abandons a case under its OWN out-of-band wall-clock budget — e.g. a runner-level
timeout to stop a runaway case. The reworded definition drops any implication of an
authored/contract budget and keys `timeout` off the runner's own budget.

Deferred (out of scope now): a shared AUTHORED budget (a `timeoutMs`/budget field
in the benchmark or measurement contract) COULD be added later IF comparable
timeout semantics across runners are ever wanted — so that "timed out" means the
same wall-clock threshold everywhere. That is a contract addition with its own
schema and cross-runner-comparability implications; it is explicitly NOT part of
this change, which only removes the false implication that such a budget already
exists.

### D-C. Subset filtering is optional reference-runner convenience (#22.4)

The per-case failure-isolation requirement already guarantees partial-report
validity: whatever set of cases ran is each recorded INDEPENDENTLY and the emitted
report validates. This change adds that PROVIDING a way to run a subset of cases (a
`--case`/filter flag / `caseFilter`) is OPTIONAL runner functionality — a
reference-runner convenience — NOT an implementer obligation. A conformant runner
that always runs the full suite, with no filter, satisfies the contract. A new
scenario states this explicitly.

### D-D. No schema, no runner code, no re-bless

The clarifications are pure wording. `benchmark-report.schema.json` keeps its
six-member enum and its per-status descriptions unchanged. The `sof-js` reference
runner keeps its current behaviour (collapse non-`ok` failures into
`execution_error`; case filter optional). No materialized bytes or checkfile values
change. The only file edit in the implementation phase is the README data-layout
line (D-E).

### D-E. README data-layout doc fix (#22.5)

`benchmark/README.md` still documents the pre-v2 content-hash layout
(`data/<name>_<hash>/<size>/<ResourceType>.ndjson`). Since contract v2 the
materializer writes the identity-keyed layout. Update the line to
`data/<name>/<version>/<size>/<ResourceType>.ndjson` (plus `manifest.json`). This
is a documentation fix with no behaviour and no test.

## Risks / Trade-offs

- **Reframing without a schema change could look like a no-op.** It is not: the
  contract's OBLIGATIONS shrink (finer statuses become optional), which is exactly
  the point — a Spark-backed runner can be conformant without a classifier. The
  schema already permits every status the reworded text describes, so no schema move
  is warranted.
- **Deferring the authored budget** means `timeout` remains non-comparable across
  runners (each uses its own threshold). Accepted: comparability is a separate,
  larger contract decision, and today no runner relies on a shared budget.

## Migration / Rollout

No migration. Pre-production, no external consumers of these formats yet; the
edits are clarifications to spec prose plus one README line. No versioning shim.
