## 1. Generalized cardinality cross-check (TDD)

- [x] 1.1 Add a unit test for a pure `cardinality(view, resource)` covering: no `forEach`/`where` ⇒ 1 per resource; single `forEach` ⇒ collection length; nested `forEach` ⇒ product across levels; `unionAll` ⇒ sum of branches; sibling `select[]` ⇒ cross-join product; `forEachOrNull` empty ⇒ 1 (all-null row); view-level `where` ⇒ filtered
- [x] 1.2 Add a test asserting, for each imported clinical-wide view over a small fixture, `Σ cardinality(view, r) === evaluate(view, resources).length` (the self-protecting invariant)
- [x] 1.3 Add a test that a deliberately wrong cardinality makes bless THROW (never writes the checkfile) — the self-protecting property
- [x] 1.4 Run the new tests; confirm they fail only on assertions (not import/syntax)

## 2. Generalized cardinality implementation

- [x] 2.1 Implement recursive `cardinality(view, resource)` in `sof-js/src/benchmark-run.js`, replacing `deriveExpectedCount`; count-only, uses `fhirpath_evaluate` only for `forEach` collection lengths and `where` predicates
- [x] 2.2 Run the cardinality tests; confirm green

## 3. Streaming bless (TDD)

- [x] 3.1 Add a test that bless produces the SAME checkfile counts via the streaming path as the current whole-array path (regression against `clinical-flat` fixtures)
- [x] 3.2 Add a test that the NDJSON reader yields resources one at a time (no whole-file `readFileSync` of the parsed array) — e.g. spy/iterator assertion
- [x] 3.3 Run; confirm failing for the right reason

## 4. Streaming bless implementation

- [x] 4.1 Add a streaming NDJSON line reader to `sof-js/src/benchmark.js` (replace/augment `loadResources` for the bless path); keep the batch `loadResources` for the hook if it still needs it
- [x] 4.2 Rewrite `blessCheckfile` to accumulate `total`/`derived` per resource via the stream; assert per-resource, record `total`
- [x] 4.3 Ensure input `sha256` and line counts in `benchmark/tools/checkfile.js` are computed by streaming, not whole-file reads
- [x] 4.4 Run bless on `clinical-flat` at `s`/`m`; confirm identical checkfile bytes to pre-change

## 5. Case selection (TDD)

- [x] 5.1 Add a unit test for the pure filter builder: `--only a,b`, `--exclude c`, both combined (exclude wins), unknown id ⇒ error
- [x] 5.2 Add a harness `run` CLI test asserting only selected cases appear in the report
- [x] 5.3 Add a bless CLI test asserting only selected cases' assertions change and others (and other sizes) are preserved
- [x] 5.4 Run; confirm failing for the right reason

## 6. Case selection implementation

- [x] 6.1 Parse `--only` / `--exclude` in `benchmark/tools/harness/cli.js`; build the predicate; pass `caseFilter` into `runSuite`
- [x] 6.2 Parse the same flags in `sof-js/src/benchmark-run.js`; apply to the case loop before blessing
- [x] 6.3 Run; confirm green

## 7. Export-filtered generation (TDD)

- [x] 7.1 Add a `synthea-executor` test asserting the executor passes `--exporter.fhir.included_resources` derived from the recipe's `resources` (order-insensitive), and that no filter arg is emitted when `resources` is empty/absent
- [x] 7.2 Add a materialize test asserting that with the filter on, a recipe selecting `["Condition"]` still prunes Synthea's force-exported `Patient`/`Encounter`, and that `Condition.ndjson` bytes match an unfiltered run (byte-safety)
- [x] 7.3 Run; confirm failing for the right reason
- [x] 7.4 Wire `recipe.resources` → `--exporter.fhir.included_resources` in `benchmark/tools/executors/synthea.js`; keep `materialize.js` prune as the safety net for force-exported siblings
- [x] 7.5 Run; confirm green. Re-materialize `clinical-flat` at `s` and confirm its checkfile stays byte-identical

## 8. clinical-wide benchmark file + recipe

- [x] 8.1 Author `benchmark/clinical-wide.json`: its **own** dataset identity (e.g. name `synthea-clinical-wide`, version `1` — NOT shared with `clinical-flat`; reuse is a separate change); Synthea recipe over `Patient`, `Encounter`, `Condition`, `Observation`; sizes `s`=100, `m`=1000, `l`=10000, `xl`=100000; reuse `clinical-flat`'s proven Synthea params/seed/`syntheaVersion`; `defaultSize` = `m`
- [x] 8.2 Import the six views verbatim as cases (exclude QuestionnaireResponse; use `UsCoreBloodPressures.inlined`): `condition-flat`, `encounter-flat`, `patient-addresses`, `patient-and-contact-addresses`, `patient-demographics`, `us-core-blood-pressures`
- [x] 8.3 `bun run validate` — confirm `clinical-wide.json` passes `benchmark.schema.json`
- [x] 8.4 Materialize `s` and `m` (`bun run data clinical-wide.json --size s|m`)
- [x] 8.5 Bless `s` and `m` (`bun run bench:bless -- clinical-wide.json --size s|m`); commit `clinical-wide.check.json`

## 9. xl scale enablement

- [x] 9.1 Materialize `clinical-wide` at `l` and `xl`; bless both via the streaming path; confirm bounded memory (no OOM at `xl`). `l` bless peak RSS 306 MB; `xl` bless peak RSS 320 MB (22 GB dataset, ~20M resources). `xl` materialize required the streaming-sort canonicalisation (§11) — the in-memory sort OOM'd first.
- [x] 9.2 Sanity-run the harness against `sof-js/hook.json` on `clinical-wide` at `s` (`--scenario end_to_end`) to confirm the file runs end-to-end and counts verify — all 6 cases verified

## 10. Docs + verification

- [x] 10.1 Update `benchmark/README.md`: `xl` tier, re-scoped 10k ceiling note, export-filtered generation, `--only`/`--exclude` flags
- [x] 10.2 `bun test` (sof-js + benchmark), `bun run validate`, `bun run check-fmt` — benchmark suite green, validate green, check-fmt green. NOTE: sof-js has 9 pre-existing conformance failures (`fn_boundary`, one `validate` case) + server-test env failures that are present on the baseline with all session work stashed — unrelated to this change, tracked separately.
- [x] 10.3 Confirm `clinical-flat.check.json` is byte-identical to pre-change (no incidental re-bless drift) — `clinical-flat` `s`/`m` re-materialize to the exact committed checksums under the new streaming sort

## 11. Memory-bounded canonicalisation (TDD) — discovered during §9

The original `canonicaliseNdjson` loaded the whole NDJSON file into one JS string
(`readFileSync` + `.split` + in-memory `.sort`), which OOMs at `xl` (Encounter/Observation
~9 GB exceed JSC's max string length). Investigation (verified empirically + against Synthea
v3.2.0 source) established: Synthea's bulk-export LINE ORDER is non-deterministic (multi-threaded
export), `--generate.thread_count=1` is an inert (non-existent) flag, and no generator flag yields
ordered multi-threaded output — so canonicalisation is required but must be memory-bounded.

- [x] 11.1 Add `external-sort.js` tests (TDD): byte-identical to the in-memory ordinal sort (incl. unicode); byte-identical across many external-merge chunks; empty input ⇒ empty output; already-sorted idempotent
- [x] 11.2 Implement `benchmark/tools/external-sort.js`: external merge sort (bounded runs + heap k-way merge), same ordinal comparator, streaming I/O with backpressure
- [x] 11.3 Wire `canonicaliseNdjson` → `sortFileLines`; confirm `clinical-flat` `s`/`m` bytes unchanged (no re-bless) and `xl` materializes without OOM
- [x] 11.4 Remove the inert `--generate.thread_count=1` flag + correct its comment (TDD: executor test asserts no thread flag)
