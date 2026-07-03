## 1. Public contracts (test-first)

- [x] 1.1 Write failing schema-validation tests for the hook manifest contract (accepts command + implementation.engine; rejects missing command/engine and unknown top-level properties), then add `benchmark/benchmark-hook.schema.json` to make them pass
- [x] 1.2 Write failing tests for the report-schema changes — `stats` with an extra field (e.g. `p95`) validates while a missing required field still fails; per-case `verified` boolean accepted; reports without `verified` remain valid — then update `benchmark/benchmark-report.schema.json`
- [x] 1.3 Add sample `hook.json` fixtures (minimal engine-only; full engine+binding+variant) used by schema and harness tests

## 2. Harness core: protocol client and worker lifecycle (test-first, scripted fake hooks)

- [x] 2.1 Build scripted fake-hook fixtures for tests: well-behaved, `{"ok":false}`-responding, crashing mid-command, hanging (no response), stdout-polluting (non-JSON line), and slow-but-valid
- [x] 2.2 Write failing tests, then implement worker lifecycle: spawn from manifest (`command`/`cwd`/`env`), `shutdown` on completion, SIGTERM on abandonment, exit-code observation
- [x] 2.3 Write failing tests, then implement the protocol client: one JSON command per line, exactly one response line per command in order, `capabilities` handshake gating scenarios, unknown-`cmd` error tolerated
- [x] 2.4 Write failing tests, then implement failure mapping: crash-in-flight → `execution_error`; inactivity budget exceeded → kill + `timeout`; `{"ok":false,"error"}` → `execution_error` with advisory `message`; non-JSON stdout line → case fails, run continues
- [x] 2.5 Write failing tests, then implement respawn-and-continue after a killed/lost worker (re-`prepare` where the scenario requires), preserving per-case failure isolation and valid partial reports

## 3. Measurement loops

- [x] 3.1 Write failing tests, then implement the `preloaded_repeated` loop: spawn + `prepare` untimed, warmup `run`s discarded, each measured `run` round-trip wall-clocked as one `samplesMs` entry
- [x] 3.2 Write failing tests, then implement the `end_to_end` loop: fresh worker per sample (spawn untimed), `prepare` + `run` timed together, worker restart between samples
- [x] 3.3 Write failing tests, then implement measurement-block honesty: report `scenario`/`phases`/`sink: csv`/actual warmup+iteration counts describe what the harness enforced; no caller-supplied scenario label can misreport the timed region
- [x] 3.4 Record hook-reported `phasesMs` as advisory `phaseSamplesMs`, never mixed into `samplesMs`

## 4. Verification and reporting

- [x] 4.1 Write failing tests, then implement CSV-derived row counting (count rows of the written file; handle quoted embedded newlines per the CSV writer's dialect)
- [x] 4.2 Write failing tests, then implement the work-verification guard from the harness count: present+match → `ok`+`verified: true`; present+mismatch (not variance-permitted) → `count_mismatch`; absent → `ok` unverified; `countVariancePermitted` not auto-flagged; hook/harness count disagreement surfaced in `message`
- [x] 4.3 Write failing tests, then implement native report emission: `implementation` copied verbatim from the manifest, benchmark/dataset identity from the authored suite, results keyed by suite `name` and case `id`, resource counts recorded
- [x] 4.4 Relocate the JMH projection (`sof-js/src/jmh.js`, `jmh-cli.js`) under `benchmark/tools/harness/`, keeping it a pure function of the native report; move its tests; wire the harness's optional JMH output directory

## 5. sof-js hook and runner slimming

- [x] 5.1 Write failing protocol-level tests driving the sof-js hook through the harness (capabilities → prepare → run → shutdown over the fixture NDJSON), then implement the sof-js worker entry point + `hook.json` (engine identity, CSV written to `outCsv`, optional `outputRows` + `phasesMs`)
- [x] 5.2 Slim `sof-js/src/benchmark-run.js` to bless-only (`--record` + analytic cross-check + checkfile writing); delete the absorbed loop/report/JMH code; keep `deriveExpectedCount` tests
- [x] 5.3 Remove the dead `syntheaVersion ?? dataset.version` fallback in bless (hard-fail on a recipe missing `syntheaVersion`)
- [x] 5.4 Add CLI entry points: `bench:harness` (run: `--hook <manifest> <suite> --size <s> [--scenario] [--strict] [--jmh <dir>]`, plus a single-command debug mode) and `bench:bless` (sof-js); retire `bench:run`
- [x] 5.5 End-to-end smoke test: materialized fixture data → harness + sof-js hook → conforming report with `verified: true` cases → JMH export files

## 6. Docs and pipeline

- [x] 6.1 Rewrite `benchmark/README.md` runner-contract section: hook route (recommended, with the Python-worker sketch) and hand-rolled runner route (escape hatch); document stdout/stderr discipline and the flush rule; state the warm-cache semantics of `preloaded_repeated`
- [x] 6.2 Fold harness tests and hook-schema validation into `bun test` / `bun run validate` / `bun run check-fmt`; full pipeline green
- [x] 6.3 `openspec validate benchmark-harness --strict` green; proposal/design/specs consistent with what was built
