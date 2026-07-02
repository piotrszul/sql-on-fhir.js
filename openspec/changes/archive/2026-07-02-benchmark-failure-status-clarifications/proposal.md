## Why

Wave 2 (`benchmark-bootstrap-and-failure-isolation`, #21) made per-case failure
isolation an explicit runner contract and extended the report status taxonomy
with `timeout` and `malformed`. Reviewing that wave for the Pathling
implementation (#22), the implementer surfaced clarification requests about how
BINDING the finer statuses are and how much of the runner surface is an
implementer obligation versus a reference-runner convenience. Left as-is, the
current wording reads as if a conformant runner MUST distinguish `timeout` and
`malformed`, MUST honour some authored time budget, and MUST provide a way to run
a subset of cases — none of which the contract intends. This change encodes those
clarifications so the specs match what the contract actually requires. Because the
project is pre-production (no external consumers of these formats yet), the specs
are edited cleanly with no back-compat shim or version signalling, and NO public
schema changes.

The problems this change fixes (all accepted in #22):

- **The status taxonomy reads as if the finer statuses are REQUIRED outcomes
  (#22.1, #22.3).** The report defines six statuses, but nothing states that
  `execution_error` is the always-conformant default for any load/prepare/evaluate
  failure, nor that `timeout`/`malformed` are OPTIONAL refinements a runner MAY
  apply. On a lazy, strongly-typed engine (e.g. Spark) an unparseable input and an
  engine evaluation error are indistinguishable at the catch site, so mandating the
  `malformed` distinction would only be satisfiable by a permissive non-lazy
  parser. Classification must be stated as BEST-EFFORT: a runner MAY report
  `execution_error` for a failure it cannot cheaply prove is `malformed` (or
  `timeout`), and a runner that records every non-`ok` failure as `execution_error`
  (as the reference runner does) is fully conformant.

- **The `timeout` definition implies an authored/contract budget (#22.2).** The
  current wording ("exceeded a time budget on generation or execution") reads as if
  a benchmark-file budget field governs `timeout`. No such field exists in the
  contract, and none is added here. `timeout` is a status a runner MAY apply when it
  abandons a case under its OWN out-of-band wall-clock budget (e.g. to stop a
  runaway); it is keyed off the runner's own budget, not a benchmark-file field.

- **Partial-run filtering reads as an implementer obligation (#22.4).** The
  per-case failure-isolation requirement guarantees partial-report validity, but a
  reader could infer that PROVIDING a way to run a subset of cases (a `--case`/
  filter flag / `caseFilter`) is part of the contract. It is not: it is OPTIONAL
  reference-runner convenience functionality. The contract requires only that
  whatever set of cases ran is each recorded INDEPENDENTLY and the emitted report
  validates.

- **A stale data-layout line in the benchmark README (#22.5).** `benchmark/README.md`
  still documents the pre-v2 content-hash layout
  (`data/<name>_<hash>/<size>/<ResourceType>.ndjson`). Since contract v2 the
  materializer writes the identity-keyed layout `data/<name>/<version>/<size>/`.

## What Changes

This is ONE change spanning two existing specs and one README documentation line.
It is almost entirely SPEC CLARIFICATION: no new capability is introduced, NO
public schema changes, and the reference runner ALREADY behaves the conformant way
(it collapses every non-`ok` failure into `execution_error`, and its case filter is
optional), so NO reference-runner code change is expected.

### A. Status taxonomy is available-not-required; classification is best-effort (#22.1, #22.3) — report format

Modify "Report structure and status taxonomy" to state explicitly that
`execution_error` is the ALWAYS-CONFORMANT DEFAULT for any failure to load,
prepare, or evaluate a case, and that `timeout` and `malformed` are OPTIONAL
refinements a runner MAY apply when it can cheaply distinguish them. Producing the
finer statuses is a quality-of-diagnostics nicety, NOT a contract obligation.
Classification is BEST-EFFORT — a runner MAY report `execution_error` for a failure
it cannot cheaply prove is `malformed` (or `timeout`). Keep the six-member enum and
the existing per-status descriptions, but reframe `malformed`/`timeout` as optional
labels rather than required outcomes.

### B. `timeout` is runner-applied out-of-band; no authored budget (#22.2) — report format

Reword the `timeout` definition to drop any implication of an authored/contract
budget: `timeout` is a status a runner MAY apply when it abandons a case under its
OWN out-of-band wall-clock budget (e.g. to stop a runaway). It is keyed off the
runner's own budget, not a benchmark-file field. NO `timeoutMs`/budget field is
added to the contract.

### C. Subset filtering is optional reference-runner functionality (#22.4) — reference runner

Modify "Per-case failure isolation (record-and-continue)" to clarify that the
contract requires only that whatever set of cases ran is each recorded
INDEPENDENTLY and the emitted report validates (partial-report validity).
PROVIDING a way to run a subset of cases (a `--case`/filter flag / `caseFilter`) is
OPTIONAL runner functionality — a reference-runner convenience — NOT an implementer
obligation. Add a scenario making this explicit.

### D. README data-layout doc fix (#22.5) — documentation

Update the stale `benchmark/README.md` output line from
`data/<name>_<hash>/<size>/<ResourceType>.ndjson` to the identity-keyed
`data/<name>/<version>/<size>/<ResourceType>.ndjson` (plus `manifest.json`). This
is the ONLY file edit this change makes; it is a doc fix, no test.

## Capabilities

### Modified Capabilities

- `benchmark-report-format`: reframe the status taxonomy so `execution_error` is
  the always-conformant default, `timeout`/`malformed` are OPTIONAL best-effort
  refinements, and `timeout` is keyed off the runner's own out-of-band wall-clock
  budget rather than any authored/contract budget field. The six-member enum and
  the schema are unchanged.
- `benchmark-reference-runner`: clarify that partial-run subset filtering (a
  `--case`/filter flag / `caseFilter`) is OPTIONAL reference-runner convenience, not
  an implementer obligation; the contract requires only per-case-independent
  recording and partial-report validity.

## Acceptance Criteria

- The report-format spec states that `execution_error` is the always-conformant
  default for any load/prepare/evaluate failure, and that a runner recording every
  non-`ok` failure as `execution_error` is fully conformant.
- The report-format spec states that `timeout` and `malformed` are OPTIONAL
  best-effort refinements a runner MAY apply, and that a runner MAY report
  `execution_error` for a failure it cannot cheaply prove is `malformed`/`timeout`.
- The `timeout` definition is keyed off the runner's OWN out-of-band wall-clock
  budget, with no implication of an authored/contract budget field, and no such
  field is added.
- The reference-runner spec states that providing a way to run a subset of cases is
  OPTIONAL functionality, not an implementer obligation, and has a scenario saying so.
- `benchmark/README.md` documents the identity-keyed layout
  `data/<name>/<version>/<size>/<ResourceType>.ndjson`.
- No re-bless: this change touches no data and no contract-of-data; the checkfile's
  counts and per-file sha256 are untouched.
- No `benchmark-report.schema.json` change and no reference-runner code change: the
  runner already collapses failures into `execution_error` and its case filter is
  already optional.
- `bun test`, `bun run validate`, `bun run check-fmt`, and
  `openspec validate benchmark-failure-status-clarifications --strict` are all green.

## Impact

- `openspec/specs/benchmark-report-format/spec.md`: reframe the status-taxonomy
  requirement text (best-effort classification, `execution_error` default,
  optional `timeout`/`malformed`, runner-applied out-of-band `timeout`) — this
  change authors the delta.
- `openspec/specs/benchmark-reference-runner/spec.md`: clarify partial-run subset
  filtering as optional convenience and add a scenario — this change authors the delta.
- `benchmark/README.md`: fix the stale data-layout line to the identity-keyed
  layout — implementation phase (the only file edit; a doc fix, no test).
- `benchmark/benchmark-report.schema.json`: UNCHANGED — the six-member enum and the
  per-status descriptions already accommodate best-effort classification; no schema
  edit is planned.
- The reference runner: UNCHANGED — it already collapses every non-`ok` failure into
  `execution_error` and its case filter is already optional; no code change is planned.

Out of scope (cross-referenced, NOT designed here):

- A shared AUTHORED time budget (a `timeoutMs`/budget field) that would give
  comparable timeout semantics across runners — could be added later if that
  comparability is ever wanted; explicitly out of scope now.
- Any new capability, schema field, or runner flag — this change only reframes the
  wording of existing contract text and fixes a README line.
