All tasks below are IMPLEMENTATION-PHASE work (this change authored the spec
only). Per Constitution III (test-first, NON-NEGOTIABLE), every behavioral change
is preceded by a failing test that is observed red for the right reason before any
implementation code is written. Sections are ordered so each red step precedes its
green step. This change READS an existing report shape and touches NO data and NO
checkfile — there is NO re-bless.

## 0. Gate A — design sign-off (blocks all below)

- [x] 0.1 Human confirms `benchmark-jmh-format` as a NEW capability (rather than a
  `benchmark-report-format` delta), per `design.md` D1
- [x] 0.2 Human confirms the export trigger: standalone
  `bun run jmh <report.json> <outdir>` transform over a pure projection function
  (proposed) vs a `--jmh <dir>` runner flag — or both over the same function (D7)
- [x] 0.3 Human confirms the JMH benchmark-name string `<benchmark.name>.<case.id>`
  and that `size` + `implementation` are carried in BOTH `params` and the filename
  (D6), and confirms the filename-safe implementation-id derivation string (D6)
- [x] 0.4 Human confirms the CI method: normal-approximation 95% half-width
  `1.959964 * stddev / sqrt(n)` (sample n−1 stddev, `n<2 ⇒ 0`) ported verbatim
  from the reference harness `_score_error`, rather than a Student-t interval (D4a)

## 1. Verified-cells-only projection — TDD

- [x] 1.1 (RED) Write a failing test: given a fixture native report with a MIX of
  statuses (`ok`, `count_mismatch`, `timeout`, `malformed`, `execution_error`,
  `generation_error`), the projection emits a JMH entry for EACH `ok` case with
  usable `samplesMs` and NO entry for any non-`ok` case (assert `count_mismatch` in
  particular is absent)
- [x] 1.2 (RED) Write a failing test: an `ok` case with empty/absent `samplesMs`
  produces no entry; a triple with no exportable case produces NO file
- [x] 1.3 (RED) Confirm 1.1–1.2 fail for the right reason (no projection exists yet)
- [x] 1.4 (GREEN) Implement the pure projection's cell filter (`status == ok` AND
  usable `samplesMs`); confirm 1.1–1.2 pass

## 2. primaryMetric mapping incl. recomputed scoreError/percentiles — TDD

- [x] 2.1 (RED) Write a failing test against a HAND-COMPUTED fixture: for an `ok`
  case with a known `samplesMs` and `stats.mean`, the entry has `mode: "ss"`,
  `primaryMetric.scoreUnit: "ms/op"`, `primaryMetric.score` == `stats.mean`, and
  `primaryMetric.rawData` == `[samplesMs]` (JMH nested shape)
- [x] 2.2 (RED) Write a failing test asserting `primaryMetric.scoreError` equals a
  HAND-COMPUTED `1.959964 * stddev / sqrt(n)` (sample n−1 stddev) for the fixture,
  and equals `0` for a single-sample case
- [x] 2.3 (RED) Write a failing test asserting `primaryMetric.scorePercentiles`
  equals HAND-COMPUTED linear-interpolation percentiles at
  `{0.0, 50.0, 90.0, 95.0, 99.0, 99.9, 100.0}` (string keys) over the fixture
  `samplesMs`, including the `n == 1` guard
- [x] 2.4 (RED) Confirm 2.1–2.3 fail for the right reason (mapping/recompute not
  implemented)
- [x] 2.5 (GREEN) Implement the `primaryMetric` mapping and the pinned
  `scoreError`/`scorePercentiles` recomputation from `samplesMs` (porting
  `_score_error`/`_percentiles` verbatim); confirm 2.1–2.3 pass

## 3. secondaryMetrics.rows + benchmark name + axes — TDD

- [x] 3.1 (RED) Write a failing test: an `ok` case with `outputRows` `r` yields
  `secondaryMetrics.rows.score == r` with a row-count `scoreUnit`
- [x] 3.2 (RED) Write a failing test: the JMH `benchmark` name is
  `<benchmark.name>.<case.id>`, and `size` + a stable filename-safe
  `implementation` id (derived from `engine`/`binding`/`variant`) appear in
  `params`
- [x] 3.3 (RED) Confirm 3.1–3.2 fail for the right reason
- [x] 3.4 (GREEN) Implement `secondaryMetrics.rows`, the benchmark-name composition,
  and the size/implementation params + implementation-id derivation; confirm
  3.1–3.2 pass

## 4. One file per (benchmark, size, implementation) triple — TDD

- [x] 4.1 (RED) Write a failing test: exporting a report covering two benchmarks
  (and, separately, two sizes of one benchmark) against one implementation writes
  DISTINCT files whose names incorporate benchmark, size, and implementation, with
  each segment sanitized; neither overwrites the other
- [x] 4.2 (RED) Confirm 4.1 fails for the right reason (no per-triple file split /
  naming yet)
- [x] 4.3 (GREEN) Implement the per-triple grouping and the sanitized
  `<benchmark>-<size>-<impl>.jmh.json` naming; confirm 4.1 passes

## 5. Trigger plumbing (per Gate A) — TDD

- [x] 5.1 (RED) Write a failing CLI/flag test (per the Gate-A decision): invoking
  the transform on a fixture report writes the expected JMH files to the output dir
  via the same pure projection function; a report with no `ok` cells writes nothing
- [x] 5.2 (RED) Confirm 5.1 fails for the right reason (no CLI/flag wired yet)
- [x] 5.3 (GREEN) Wire the thin CLI (`bun run jmh <report.json> <outdir>`) and/or
  the `--jmh <dir>` runner flag over the pure function; confirm 5.1 passes

## 6. No re-bless required (explicit no-op on data)

- [x] 6.1 The projection READS an existing conforming report and touches NO
  materialized bytes, NO checkfile, and does NOT modify
  `benchmark-report.schema.json`. State this explicitly and confirm the committed
  checkfile and report schema are unchanged by this change.

## 7. Verify green before merge (Constitution V)

- [x] 7.1 `bun test` — all benchmark + projection tests pass
- [x] 7.2 `bun run validate` — all `tests/*.json` valid against `tests.schema.json`
  (unaffected, stays green)
- [x] 7.3 `bun run check-fmt` — clean
- [x] 7.4 `openspec validate benchmark-jmh-export --strict` — valid
