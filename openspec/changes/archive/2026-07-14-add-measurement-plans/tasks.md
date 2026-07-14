# Tasks: add-measurement-plans

## 1. Preflight

- [x] 1.1 Verify `worker.js` (HTTP spawn/connect) forwards unknown commands
      generically to the hook (design D4 assumption); record the outcome in
      FINDINGS.md and adjust D4/tasks if it does not
- [x] 1.2 Confirm the full verification pipeline is green on the clean branch
      base (`bun test`, `bun run validate`, `bun run check-fmt`) so later
      failures are attributable

## 2. Plan executor (behavior-preserving refactor)

- [x] 2.1 Add executor unit tests encoding the design's decomposition table —
      one test per official binding row (fork level, setup, timed region,
      verification, warmup) — failing first against a stub executor
- [x] 2.2 Add failing tests for plan validation: malformed plan rejected as a
      loud setup failure; `post-loop-count` combined with a non-materializing
      timed region rejected before any case runs
- [x] 2.3 Implement the `MeasurementPlan` record, its validation, and the
      generic single-shot executor in `benchmark/tools/harness/`
- [x] 2.4 Re-express `preloaded_repeated` and `end_to_end`
      (spawn/connect/CLI) as scenario bindings resolved inside `runSuite`;
      delete the per-scenario closures
- [x] 2.5 Confirm the pre-existing harness test suite passes UNMODIFIED (any
      edit to an existing test is a red flag; investigate before proceeding)

## 3. Plan-only capabilities

- [x] 3.1 Test-first: fork-per-trial lifecycle (fresh worker per case, reused
      across that case's warmup + measurement samples, shut down at case end)
- [x] 3.2 Test-first: post-loop `count` verb — untimed, once per case after
      the sample loop; engine-reported rows feed the work-verification guard;
      provenance recorded
- [x] 3.3 Test-first: post-loop `extract` verb — untimed; harness counts the
      written CSV itself; no extraction time in any sample
- [x] 3.4 Test-first: official bindings never issue `count`/`extract` (assert
      command traces for both scenarios)
- [x] 3.5 Add the module entry point for custom plans (design D3); test that
      the public harness CLI accepts only official scenario names and has no
      plan flag

## 4. Internal record (honesty guard, profile form)

- [x] 4.1 Test-first: a custom-plan run emits `<stem>.internal-report.json`
      with `measurement.scenario: "internal:<name>"`, truthful
      phases/sink/warmup, and the plan record embedded verbatim as
      `measurement.plan`
- [x] 4.2 Test-first: the internal record FAILS validation against the
      published `benchmark-report.schema.json` (fail-closed), and no code
      path emits an official scenario name from a raw plan
- [x] 4.3 Add a staging-local JSON schema for the internal record shape (not
      a public contract) and validate emitted records against it in tests
- [x] 4.4 Test-first: JMH files project from an internal record via the
      existing `projectJmh` unchanged
- [x] 4.5 Record hook-reported `phasesMs` from custom-plan runs as advisory
      `phaseSamplesMs` (the `.timer` cross-check; design open question
      resolved: include)

## 5. Staging benchmark (flatquack-internal)

- [x] 5.1 Scaffold `benchmark/staging-hooks/flatquack-internal/` per the
      staging-hooks README rules: `hook.json` (spawn mode; `implementation`
      identity with `internal-` variant prefix), `README.md`, empty
      `FINDINGS.md`
- [x] 5.2 Implement the DuckDB-session hook (bun): `prepare` records dataDir;
      `run` executes `CREATE OR REPLACE TEMP TABLE _sink AS <body>` on a
      persistent `duckdb-<version>` child with sentinel-based completion
      (event-driven); `count` answers `SELECT count(*) FROM _sink`; `extract`
      runs `COPY _sink TO '<outCsv>' (HEADER)`; `reset`/`shutdown` manage the
      child; `SET preserve_insertion_order = false` on session start
- [x] 5.3 Implement memoized flatquack SQL generation in the hook (compile on
      first `run` per case, keyed by view; worktree and DuckDB binary paths
      from hook `env`)
- [x] 5.4 Unit-test the hook's pure parts without a DuckDB binary (sentinel
      parsing, SQL assembly, memoization, env resolution)
- [x] 5.5 Implement the staging driver: constructs the internal plan
      (fork-per-trial, table sink, `post-loop-count`, warmup), calls the
      module entry point, refuses a manifest whose variant lacks the
      `internal-` prefix, writes internal record + JMH files

## 6. Validation runs and findings

- [x] 6.1 Materialize the target benchmark's datasets at sizes `s` and `m`
      (`bun run data`)
- [x] 6.2 Run the driver for at least two implementation identities (two
      DuckDB CLI versions and/or two flatquack refs); all cases verified
      against checkfile counts via `count`
- [x] 6.3 Spot-check `extract` vs `count` agreement on at least one case
      (same rows from both verbs)
- [x] 6.4 Confirm the advisory `.timer` cross-check: `samplesMs` minus
      hook-reported execute `phasesMs` is a small, roughly constant overhead
- [x] 6.5 Load the JMH exports of both identities into JMH Visualizer and
      confirm the overlay compares them side by side with self-describing
      impl-ids
- [x] 6.6 Record every friction point in FINDINGS.md with exactly one
      taxonomy outcome (clean passes recorded too); implement any forced
      contract/harness/doc fix test-first with a delta spec

## 7. Docs

- [x] 7.1 Document the plan vocabulary, the module entry point, and the
      internal-record honesty rules in `benchmark/README.md` (internal-reuse
      section — distinct from the conforming hook/runner routes; no public
      contract changes)
- [x] 7.2 Update `benchmark/staging-hooks/README.md` with the new
      subdirectory and its migration exit criterion

## 8. Verify and refine (validation-cycle steps 6–7)

- [x] 8.1 Full pipeline green: `bun test`, `bun run validate`,
      `bun run check-fmt`
- [x] 8.2 Run the `simplify` skill over the branch diff; apply accepted
      findings; re-verify
- [x] 8.3 Run the `code-review` skill over the branch diff; apply accepted
      findings; re-verify
