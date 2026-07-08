# validate-flatquack-hook — design

## Context

The benchmark contract's CLI mode is a three-placeholder argv template
(`{dataDir}`, `{viewFile}`, `{outCsv}`, substituted as substrings within each
element — `benchmark-hook.schema.json`, `tools/harness/cli-connector.js`).
flatquack (aehrc/flatquack, `master-fix` branch @ 8a66e46, v0.2.1) is a
Bun+DuckDB CLI whose input selection is *directory + glob*
(`--view-path <dir> --view-pattern <glob>`), whose output path is a template
variable, and whose per-run behaviour was probed empirically during
exploration:

- `--view-path <file>` crashes (`ENOTDIR`); the harness's `{viewFile}` lives in
  an **accumulating** session temp dir, so globbing that dir would re-run every
  previous view.
- `--view-path / --view-pattern "..{viewFile}"` resolves exactly the one view
  file: Bun's `Glob.scanSync` tolerates a `..` segment, `/..` is `/`, and a
  fully-literal pattern short-circuits (no filesystem walk, ~0.3 s).
- Both benchmark cases (`condition-flat`, `observation-components`) compile
  under `--strict` and produce checkfile-exact row counts at size `s`
  (6406 / 4366) with a custom SQL template + `--param` substitution.
- Two tool defects, filed upstream: intermittent Bun/duckdb segfault at
  process exit **after** a correct run (~1 in 4, exit 133) —
  [aehrc/flatquack#42](https://github.com/aehrc/flatquack/issues/42) — and
  exit 0 on SQL failure —
  [aehrc/flatquack#43](https://github.com/aehrc/flatquack/issues/43).

## Goals / Non-Goals

**Goals:**

- A zero-code CLI-mode `hook.json` (plus one declarative SQL template) under
  `benchmark/staging-hooks/flatquack/` that drives flatquack through the
  unmodified contract.
- A full harness pass on `clinical-flat`, sizes `s` and `m`, `end_to_end`,
  with checkfile-verified counts; report and JMH export inspected.
- Every friction point recorded in `FINDINGS.md` with exactly one taxonomy
  outcome; contract/doc fixes (if any) land here test-first.

**Non-Goals:**

- No flatquack source changes in this repo (tool defects live in
  aehrc/flatquack; the hook works around them).
- No contract growth: the `{viewDir}` placeholder option is deliberately
  deferred (recorded as a FINDINGS note to reconsider at the end of the
  three-cycle exercise).
- No new benchmark cases or dataset changes.

## Decisions

1. **Single-view selection via a thin adapter** (`flatquack-hook.js`).
   Superseded an initial `..{viewFile}` glob idiom (which leaned on
   undocumented Bun-glob behaviour) after review: the adapter copies the one
   `{viewFile}` into a fresh temp dir and runs flatquack's real, documented
   `--view-path <dir> --view-pattern '*.json'`. Same category as
   `sof-js/hook.js` — a per-engine shim, not a contract change — and the shape
   flatquack's hook will keep after migration. The `{viewDir}` contract
   placeholder remains open for the exercise teardown but is unnecessary given
   the adapter.
2. **Shape bridging via a hook-local SQL template**, `flatquack-hook.sql`,
   modeled on flatquack's `templates/csv.sql` but reading
   `'{{fq_input_dir}}/{{fq_vd_resource}}.ndjson'` (the materializer's exact
   layout — no `**` glob) and writing `TO '{{fq_out_csv}}'`; values arrive via
   `--param fq_input_dir={dataDir}` and `--param fq_out_csv={outCsv}`. This is
   declarative data, not execution code, so the "zero-code manifest" claim
   stands.
3. **Machine-local absolute path to flatquack in the checked-in `hook.json`**
   (user decision), with the manifest's `cwd` left defaulted to the hook
   directory so `--template flatquack-hook.sql` resolves relatively. The argv
   template has no env expansion; staging hooks are documented machine-local
   temporary scaffolding (deleted at migration), and FINDINGS.md +
   `staging-hooks/flatquack/README` note the path must be edited per machine.
   Alternative (gitignored local manifest + checked-in example) rejected: the
   reviewed artifact should be the artifact actually run.
4. **`--strict` always**, so unsupported ViewDefinition directives fail loudly
   instead of silently producing wrong rows (mirrors sof-benchmark practice).
5. **Tool defects are worked around, not vendored** (user decision): issues
   #42/#43 are cross-referenced from FINDINGS.md; the harness pass tolerates
   the segfault flake (a failed sample is flatquack's defect surfacing, not a
   contract defect). If upstream fixes land before this change finalizes, the
   pass is re-run against the fixed checkout.
6. **README CLI example fix (doc gap)**: `benchmark/README.md`'s illustrative
   CLI manifest invents a flatquack CLI (`--input/--view/--output`) that the
   real tool does not have. The example is reworded so it cannot be mistaken
   for real flatquack usage.

## Risks / Trade-offs

- [Segfault #42 killed 100% of raw size-`m` samples] → fixed upstream by
  running flatquack's `run` mode under node; `flatquack-hook.js` launches it
  that way and requires a clean exit plus a written CSV. Both sizes now pass
  with zero flakes and trustworthy timing (documented in FINDINGS entry 3).
- [Machine-local tool path makes the checked-in hook non-portable] → reduced
  to a single `env.FLATQUACK_CLI` value in `hook.json`; explicit scaffolding
  contract already declares staging hooks machine-local and temporary; noted
  in the hook README.
- [Exit-0-on-failure #43 could mask a broken run as success] → the harness
  independently counts rows from the produced CSV against the checkfile, so a
  silent failure surfaces as `count_mismatch`/missing-file, not as a false
  pass.

## Open Questions

- Does the segfault rate under harness load allow a complete `s`+`m` pass?
  (Empirical; answered during apply.) **Answered:** both `s` and `m` pass with
  checkfile-exact counts (6406/4366, 48908/39479) and zero flakes, once #42 is
  fixed upstream (flatquack runs under node) and `flatquack-hook.js` launches
  it that way. Timing is trustworthy — see FINDINGS.md entry 3.
- Report `implementation` identity: `engine.name: flatquack`,
  `engine.version: 0.2.1` + `variant` naming the master-fix checkout — exact
  variant string settled during apply. **Answered:** `cli-master-fix`.

## Post-implementation notes

Two findings the design did not anticipate, both fixed in this change (see
FINDINGS.md 1, 7, 8): the harness handed hooks a symlinked `{viewFile}` path
(contract defect — connector now canonicalizes, test-first, with a delta spec
on benchmark-hook-format), and the benchmark case views were not
ShareableViewDefinition-conformant (benchmark-case defect — views gained
`url`/`name`/`status`/`fhirVersion`; checkfile re-blessed byte-identical),
which in turn exposed sof-js rejecting the spec-defined `fhirVersion`
element (fixed test-first via a shared conformance case).
