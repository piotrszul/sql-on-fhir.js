## Why

Wave 1 (`benchmark-contract-v2`) hardened the benchmark *contract* — dataset
identity, byte reproducibility, the checkfile, structured implementation
identity, a defined measurement/statistics model, and a correctly-scoped
correctness guard. Wave 2 hardens the benchmark *operational lifecycle* around
that contract: how a run survives a failing case, and how an implementer gets
the generator onto their machine in the first place. It closes two accepted
benchmark-hardening issues (#8 / finding G9, and #10 / finding F9) in one
coherent change. Because the project is pre-production (no external consumers of
these formats yet), the report-format enum is extended cleanly with no
back-compat shim or version signalling — the break is called out here.

The problems this change fixes:

- **The status taxonomy names outcomes but not their SCOPE (#8, G9).** The report
  defines `ok`/`count_mismatch`/`generation_error`/`execution_error`, but nothing
  in the runner or report contract says what a single case's failure MEANS for the
  rest of the run. An implementer reading the current specs could reasonably build
  a runner that aborts the whole run — or voids every other case's result — on the
  first failure, and still claim conformance. A benchmark that measures a suite of
  cases must record each case's outcome INDEPENDENTLY and keep going, and a partial
  or interrupted run must still yield a valid, meaningful report. The taxonomy also
  lacks two outcomes the reference harness (`dev/sof-benchmark`
  `results-reporting`) already distinguishes — a case that exceeded a time budget,
  and a case whose inputs/outputs were structurally invalid — which today have to
  be mislabelled as `execution_error` or `generation_error`.

- **Materialization bootstrap is a manual prerequisite (#10, F9).** Today the
  materializer cannot run at all until a human has downloaded the Synthea jar and
  hand-written `tools/executors.config.json` pointing at it. The generator version
  is already pinned in the recipe (`dataset.syntheaVersion`, currently `3.2.0`), so
  the tool has everything it needs to fetch that exact jar itself — but it does
  not. Every new implementer re-does the manual jar hunt, and there is no checksum
  gate ensuring they got the right bytes.

- **The Synthea executor litters the repo tree (#10, folded in).** On every run the
  executor shells out to Synthea in the process working directory (the repo root),
  where Synthea scatters a `db.sqlite` and a `public/export/<epoch>/` tree. Wave 1
  merely gitignored these leftovers (#17); they still get written into the working
  copy on every materialization/re-bless. The materializer should run the generator
  in an ISOLATED working directory so these artifacts never land in the repo tree.

## What Changes

This is ONE change spanning three existing specs and the Synthea tooling. No new
capability is introduced.

### A. Per-case failure isolation — record-and-continue (#8) — reference-runner

Mandate RECORD-AND-CONTINUE as an explicit runner contract. The runner SHALL treat
each case's outcome as INDEPENDENT: a case that fails (generation, execution,
count mismatch, timeout, malformed input/output, etc.) is recorded with its status
and the run PROCEEDS to the remaining cases. A failing case MUST NOT abort the
whole run or void other cases' already-recorded results. A PARTIAL or interrupted
run SHALL still yield a valid report: a report containing only the cases completed
so far, each with its status, is schema-valid and meaningful.

### B. Extend the status taxonomy with `timeout` and `malformed` (#8) — report format + report schema

Extend the per-case `status` enum (a public-contract change to
`benchmark-report.schema.json`) from
`{ok, count_mismatch, generation_error, execution_error}` to
`{ok, count_mismatch, generation_error, execution_error, timeout, malformed}`,
adopted from the reference harness `dev/sof-benchmark` `results-reporting`:

- `timeout` — the case exceeded a time budget (wall-clock generation/execution
  budget) and was abandoned; distinct from `execution_error` (the engine ran and
  errored).
- `malformed` — the case's inputs or outputs were structurally invalid (e.g. a
  materialized resource that is not parseable, or a result that cannot be
  materialized to the sink); distinct from `generation_error` (generation itself
  failed to produce data).

Add an OPTIONAL free-text `message` on a per-case result — a short human-readable
explanation of a non-`ok` outcome (most useful for `generation_error`,
`execution_error`, `timeout`, and `malformed`). It is advisory context, never a
machine-parsed field.

### C. Auto-fetch the pinned Synthea jar (#10) — dataset-materialization + tooling

The materializer SHALL be able to obtain the pinned generator AUTOMATICALLY: fetch
the pinned-version Synthea jar (the version is `dataset.syntheaVersion`, currently
`3.2.0`) from its published GitHub release, verify it against a pinned SHA-256
checksum, and cache it locally in a gitignored cache directory (proposed
`benchmark/.cache/synthea/`). The pinned `version → { url, sha256 }` map lives in
the tooling (a small committed pinned map keyed by `syntheaVersion`).
`tools/executors.config.json` becomes an OPTIONAL OVERRIDE (a custom jar path
and/or `java` binary), NOT a prerequisite: with no config, the materializer
auto-fetches; with a config, the config wins.

### D. Isolate the generator's working directory (#10, folded in) — dataset-materialization

The materializer SHALL run the generator in an ISOLATED/scratch working directory
so the generator's incidental artifacts (Synthea's `db.sqlite`, its
`public/export/<epoch>/` tree) do not land in the repo tree. The materialized
NDJSON is still written to the identity-keyed layout
(`data/<name>/<version>/<size>/`) as before; only the generator's transient
working directory moves out of the repo root.

## Capabilities

### Modified Capabilities

- `benchmark-reference-runner`: mandate record-and-continue per-case failure
  isolation and partial-report validity; the row-count guard and bless mode are
  unchanged in intent but now sit inside an explicitly per-case-isolated run.
- `benchmark-report-format`: extend the per-case `status` enum with `timeout` and
  `malformed` (defining each), add an OPTIONAL per-case `message`, and state that a
  report of only the completed cases is valid and meaningful.
- `benchmark-dataset-materialization`: the materializer auto-fetches the
  pinned Synthea jar (checksum-verified, cached), making
  `tools/executors.config.json` an optional override rather than a prerequisite,
  and runs the generator in an isolated working directory so its incidental
  artifacts stay out of the repo tree.

## Acceptance Criteria

- A run in which one case fails (generation, execution, count mismatch, timeout, or
  malformed) records that case's status and CONTINUES to the remaining cases; the
  other cases' results are recorded and not voided.
- A partial/interrupted run emits a report that contains only the completed cases,
  each with its status, and that report validates against
  `benchmark-report.schema.json`.
- A report with a case `status` of `timeout` or `malformed` validates; a status
  outside the six-member enum is rejected.
- A per-case `message` is OPTIONAL: a case with a `message` validates, and a case
  without one validates.
- With no `tools/executors.config.json`, the materializer auto-fetches the pinned
  `syntheaVersion` jar from its published release, verifies it against the pinned
  SHA-256, and caches it; a checksum mismatch fails materialization.
- With a `tools/executors.config.json` present, its jar path / `java` binary
  override the auto-fetch.
- After a materialization run, no `db.sqlite` or `public/export/` artifact is
  written into the repo tree (the generator ran in an isolated working directory).
- No Synthea re-bless is required: this change touches no data and no
  contract-of-data; the checkfile's counts and per-file sha256 are untouched.
- `bun test`, `bun run validate`, `bun run check-fmt`, and
  `openspec validate benchmark-bootstrap-and-failure-isolation --strict` are all
  green.

## Impact

- `benchmark/benchmark-report.schema.json`: extend the per-case `status` enum to
  `{ok, count_mismatch, generation_error, execution_error, timeout, malformed}`;
  add an OPTIONAL per-case `message` (string) — implementation phase.
- The reference runner: wrap each case's timing/guard in a per-case try so a
  failure is recorded and the loop continues; emit a valid report from whatever
  cases completed — implementation phase.
- `benchmark/tools/executors/synthea.js` (and a small pinned jar map + fetch/cache
  helper): auto-fetch + checksum-verify + cache the pinned jar, treating
  `executors.config.json` as an optional override; run Synthea in an isolated
  working directory — implementation phase.
- `benchmark/.gitignore`: add the jar cache directory (`.cache/`) — implementation
  phase.
- `benchmark/tools/executors.config.sample.json`: annotate it as an OPTIONAL
  override now, not a prerequisite — implementation phase.

Out of scope (cross-referenced, NOT designed here):

- A future materialization "download kind" that fetches a canonical
  pre-materialized DATASET (not just the generator jar) for stronger
  reproducibility — related, deferred.
- The runner/layout decoupling (how a non-JS runner is wired to the on-disk
  layout) — related, deferred.
- An append-per-cell JSONL "native log" for crash-safety (a valid RUNNER
  IMPLEMENTATION technique, discussed in `design.md`) — NOT mandated by this
  contract, which is a single JSON report document.
- The exact new UTC counts / checksums — untouched here; no re-bless.
