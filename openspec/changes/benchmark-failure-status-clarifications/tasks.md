All tasks below are IMPLEMENTATION-PHASE work (this change authored the specs
only). This change is almost entirely SPEC CLARIFICATION plus a single README
documentation fix. The reference runner ALREADY behaves the conformant way — it
collapses every non-`ok` failure into `execution_error`, and its case filter is
already optional — so NO reference-runner code change is expected. There is NO
`benchmark-report.schema.json` change: the six-member enum and the per-status
descriptions already accommodate best-effort classification. The ONLY file edit is
the README data-layout line. There is NO behaviour change, so there is no
test-first (Constitution III) obligation here; the sole edit is documentation, and
the existing tests must remain green because nothing they exercise changed.

## 0. Gate A — design sign-off (blocks all below)

- [ ] 0.1 Human confirms the #22 clarifications as in `design.md`: (D-A)
  `execution_error` is the always-conformant default and `timeout`/`malformed` are
  OPTIONAL best-effort refinements; (D-B) `timeout` is keyed off the runner's own
  out-of-band budget with no authored budget field added; (D-C) subset filtering is
  optional reference-runner convenience; (D-E) the README data-layout fix
- [ ] 0.2 Human confirms NO schema change, NO reference-runner code change, and NO
  re-bless are in scope (spec + README only)

## 1. README data-layout doc fix (the only file edit; #22.5, D-E)

- [ ] 1.1 In `benchmark/README.md`, update the stale output line from
  `data/<name>_<hash>/<size>/<ResourceType>.ndjson` + `manifest.json` to
  `data/<name>/<version>/<size>/<ResourceType>.ndjson` + `manifest.json`, matching
  the identity-keyed layout the materializer has written since contract v2. This is
  a documentation fix with no behaviour and no test.

## 2. Confirm no behaviour changed (no code, no schema)

- [ ] 2.1 Confirm `benchmark/benchmark-report.schema.json` is UNCHANGED by this
  change — the six-member status enum and per-status descriptions already
  accommodate best-effort classification; no schema edit is made.
- [ ] 2.2 Confirm the reference runner is UNCHANGED — it already records every
  non-`ok` failure as `execution_error` and its case filter is already optional; no
  runner code edit is made.
- [ ] 2.3 Confirm the existing benchmark/runner tests remain green (nothing they
  exercise changed): the same statuses validate, the same runner behaviour holds.

## 3. No re-bless required (explicit no-op on data)

- [ ] 3.1 This change touches NO materialized bytes and NO contract-of-data: the
  checkfile's per-size `resourceCounts`, per-file `sha256`, and result `assertions`
  are UNTOUCHED, and NO Synthea re-bless is performed. Confirm the committed
  checkfile is unchanged by this change.

## 4. Verify green before merge (Constitution V)

- [ ] 4.1 `bun test` — benchmark + runner tests pass (any pre-existing unrelated
  failures noted, not introduced by this change).
- [ ] 4.2 `bun run validate` — all `tests/*.json` valid against `tests.schema.json`
  (unaffected, stays green).
- [ ] 4.3 `bun run check-fmt` — clean.
- [ ] 4.4 `openspec validate benchmark-failure-status-clarifications --strict` —
  valid.
