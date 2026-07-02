All tasks below are IMPLEMENTATION-PHASE work (this change authored the specs
only). Per Constitution III (test-first, NON-NEGOTIABLE), every behavioral change
is preceded by a failing test that is observed red for the right reason before any
implementation code is written. Sections are ordered so each red step precedes its
green step.

## 0. Gate A — design sign-off (blocks all below)

- [ ] 0.1 Human confirms the `timeout`/`malformed` status definitions and the
  addition of an OPTIONAL per-case `message` (proposed: yes) as in `design.md`
  D-B/D-C
- [ ] 0.2 Human confirms the jar cache location (`benchmark/.cache/synthea/`
  proposed) and recording the pin as a committed `syntheaVersion → { url, sha256 }`
  map in the tooling (D-D)
- [ ] 0.3 Human confirms the isolated-CWD mechanism: per-materialization temp dir
  (proposed) vs a fixed gitignored scratch dir (D-E)

## 1. Report schema — status enum + optional message — TDD

- [x] 1.1 (RED) Write failing schema-validation tests for
  `benchmark-report.schema.json`: a report with a case `status` of `timeout` is
  ACCEPTED; a report with a case `status` of `malformed` is ACCEPTED; a case with a
  free-text `message` is ACCEPTED; a case WITHOUT a `message` is ACCEPTED
  (`message` is optional); a `status` outside the six-member enum is REJECTED
- [x] 1.2 (RED) Confirm 1.1 fails for the right reason (enum is still the four-value
  set; `message` not yet permitted under `additionalProperties: false`)
- [x] 1.3 (GREEN) Extend the per-case `status` enum in
  `benchmark/benchmark-report.schema.json` to
  `{ok, count_mismatch, generation_error, execution_error, timeout, malformed}`
  and add an OPTIONAL `message` (`{ "type": "string" }`) to the per-case properties;
  confirm 1.1 passes

## 2. Runner per-case failure isolation (record-and-continue) — TDD

- [x] 2.1 (RED) Write a failing runner test: in a run where one case fails
  (stub/inject an execution error) and the others succeed, the failing case is
  recorded with its failure status, the run CONTINUES, and the succeeding cases are
  all recorded — the failure does not abort the run or drop the other cases
- [x] 2.2 (RED) Write a failing runner test: a run interrupted after completing only
  some cases emits a report containing only those completed cases, each with a
  status, and that report VALIDATES against `benchmark-report.schema.json`
- [x] 2.3 (RED) Confirm 2.1–2.2 fail for the right reason (a failing case currently
  aborts / voids the run)
- [x] 2.4 (GREEN) Wrap each case's timing/guard in a per-case boundary so a failure
  is captured as a per-case status and the loop proceeds; emit a valid report from
  whatever cases completed; confirm 2.1–2.2 pass

## 3. Synthea jar auto-fetch (checksum + cache) — TDD (mock the network)

- [x] 3.1 (RED) Write failing unit tests that STUB/MOCK the network fetch (do NOT
  hit GitHub): with no `tools/executors.config.json`, resolving the pinned
  `syntheaVersion` produces the pinned URL + SHA-256 from the committed map, the
  (mocked) fetch is invoked, the bytes are checksum-verified, and the jar is cached;
  a mocked fetch whose bytes fail the checksum FAILS materialization loudly; a
  second run with the jar already cached does NOT re-fetch
- [x] 3.2 (RED) Write a failing unit test: when `tools/executors.config.json`
  supplies a jar path, the materializer uses it and does NOT invoke the fetch
- [x] 3.3 (RED) Confirm 3.1–3.2 fail for the right reason (no auto-fetch path yet;
  config is still a prerequisite)
- [x] 3.4 (GREEN) Add the committed `syntheaVersion → { url, sha256 }` pinned map,
  a fetch/verify/cache helper (cache dir `benchmark/.cache/synthea/`), and make
  `tools/executors.config.json` an OPTIONAL override in the synthea executor /
  config loader; add `.cache/` to `benchmark/.gitignore`; annotate
  `tools/executors.config.sample.json` as an optional override; confirm 3.1–3.2
  pass

## 4. Isolated generator working directory — TDD

- [x] 4.1 (RED) Write a failing test (stub/spy the spawn; do NOT run Java) asserting
  the synthea executor runs with an isolated working directory / baseDirectory
  OUTSIDE the repo tree, and that after a materialization run no `db.sqlite` and no
  `public/export/` artifact exists in the repo root
- [x] 4.2 (RED) Confirm 4.1 fails for the right reason (generator still runs in the
  repo root)
- [x] 4.3 (GREEN) Run the generator in an isolated working directory (per D-E:
  per-materialization temp dir OR fixed gitignored scratch dir), lift the produced
  NDJSON into `data/<name>/<version>/<size>/` as before, and clean up; confirm 4.1
  passes

## 5. No re-bless required (explicit no-op on data)

- [x] 5.1 This change touches NO materialized bytes and NO contract-of-data: the
  checkfile's per-size `resourceCounts`, per-file `sha256`, and result `assertions`
  are UNTOUCHED, and NO Synthea re-bless is performed. State this explicitly and
  confirm the committed checkfile is unchanged by this change.

## 6. Verify green before merge (Constitution V)

- [x] 6.1 `bun test` — all benchmark + runner tests pass (pre-existing sof-js
  server + compliance failures are unrelated to this change; a Bun-version
  `beforeAll()` incompatibility in `sof-js/tests/server/*`, unchanged by Wave 2)
- [x] 6.2 `bun run validate` — all `tests/*.json` valid against `tests.schema.json`
  (unaffected, stays green)
- [x] 6.3 `bun run check-fmt` — clean
- [x] 6.4 `openspec validate benchmark-bootstrap-and-failure-isolation --strict` —
  valid
