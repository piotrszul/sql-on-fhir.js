# Tasks — validate-pathling-server-hook

## 1. Adapter + hook scaffolding

- [x] 1.1 Write `benchmark/staging-hooks/pathling-server/pathling-server-hook.js`
      — a Bun HTTP service (structured after `sof-js/src/hook.js`) answering the
      five protocol endpoints, translating `prepare` → `$import`
      (`saveMode: overwrite`, `Prefer: respond-async`, poll `$job`), `run` →
      `$viewdefinition-run` (`Accept: text/csv`, stream to `outCsv`), `reset`,
      `shutdown`, and a deployment-aware `capabilities`.
- [x] 1.2 Spawn-mode lifecycle: the adapter starts its own Pathling container
      (ephemeral warehouse, `--mount` identity bind of the data root,
      allowableSources set), waits for `/fhir/metadata`, and stops it on
      `shutdown`/SIGTERM.
- [x] 1.3 Connect-mode `hook.connect.json` (`endpoint`) + spawn-mode
      `hook.spawn.json` (`command`); both validate against
      `benchmark-hook.schema.json`.
- [x] 1.4 Hook `README.md`: the operator `docker run` (with the `--mount`
      identity bind + allowableSources), machine-local prerequisites, and how to
      run each mode.

## 2. Connect-mode validation pass (first)

- [x] 2.1 Brought up Pathling via Docker; recorded engine version
      `2.0.1+78a3f75` (from the CapabilityStatement) into both `hook.json`s +
      FINDINGS.
- [x] 2.2 `--strict` data verification against the checkfile hashes at `s`/`m`.
- [x] 2.3 `preloaded_repeated`, size `s`: report + JMH written; counts verified
      (6406 / 4366).
- [x] 2.4 `preloaded_repeated`, size `m`: counts verified (48908 / 39479).
- [x] 2.5 `end_to_end` reset honesty in connect mode: the warm Spark server
      cannot honestly reset-to-cold, so connect declares only
      `preloaded_repeated`; the harness refuses `end_to_end` against it. Exactly
      the contract's reset/scenario requirements (FINDINGS 2).
- [x] 2.6 Reports validated against `benchmark-report.schema.json` (identity
      verbatim, `variant: server`); JMH exports well-formed.

## 3. Spawn-mode decision + pass

- [x] 3.1 Ran spawn-mode `end_to_end` (fresh Pathling per sample): it is the
      only honest source of cold `end_to_end` and exercises the
      expensive-startup readiness probe (FINDINGS 5/6). Worth the wall-clock.
- [x] 3.2 `end_to_end` at `s` and `m`, counts verified (6406/4366, 48908/39479);
      spawn readiness budget (~5.5 s boot ≪ 30 s) was adequate; no leaked
      containers.

## 4. Findings

- [x] 4.1 `benchmark/staging-hooks/pathling-server/FINDINGS.md`: pass record +
      timing, `reset`/`end_to_end` honesty outcome, `prepare`-REPLACES via
      overwrite, `preloaded_repeated` warmth, readiness observation, container
      plumbing notes, every point with exactly one taxonomy outcome.
- [x] 4.2 **No contract change was forced** — every spec-stress point was
      answered by the contract as it already stands (reset-discard +
      scenario-declaration-matches-capability + two-manifests-by-variant +
      run-output CSV). Recorded explicitly; no delta spec, no test-first
      required (this change adds only staging scaffolding, no contract/harness
      behaviour). See `specs/README.md`.

## 5. Verification

- [x] 5.1 `bun test` — benchmark suites fully green; the only failures are the
      pre-existing `sof-js/tests/server/*` `beforeAll()` Bun incompatibility
      (248 pass / 4 fail / 3 errors), unrelated to this change (which adds zero
      sof-js lines — the diff is only `benchmark/staging-hooks/` + `openspec/`).
- [x] 5.2 `bun run validate` green.
- [x] 5.3 `bun run check-fmt` green.

## 6. Refine (simplify + code-review)

- [x] 6.1 `simplify` skill (4 angles): dropped the local `countCsvRows`/advisory
      `outputRows` (harness counts authoritatively), removed a dead import, DRY'd
      the error-body helper, shared `fetchMetadata`, unified teardown. Reverted a
      proposed `Bun.write` stream — it spins on Pathling's chunked CSV response.
- [x] 6.2 `code-review` skill (correctness + protocol + conventions): applied 4
      fixes — register signal handlers before the container boot (leak-on-signal),
      `pathToFileURL` for `file://` sources (space-safe), a deadline on the
      `$import` poll loop, and a loud warning on an unreachable connect backend.
      Re-ran connect+spawn `s` clean after the fixes; conventions: no violations.
