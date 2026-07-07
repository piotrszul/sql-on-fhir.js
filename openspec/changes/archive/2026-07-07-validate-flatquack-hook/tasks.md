# Tasks — validate-flatquack-hook

## 1. Hook scaffolding

- [x] 1.1 Create `benchmark/staging-hooks/flatquack/flatquack-hook.sql` — the
      declarative SQL template (modeled on flatquack's `templates/csv.sql`)
      reading `'{{fq_input_dir}}/{{fq_vd_resource}}.ndjson'` and writing
      `TO '{{fq_out_csv}}'`
- [x] 1.2 Create `benchmark/staging-hooks/flatquack/hook.json` — CLI-mode
      manifest: `bun run <abs path>/src/cli.js --mode run --strict`, the
      `..{viewFile}` view selection, `--param` bridging for `{dataDir}` /
      `{outCsv}`, and `implementation` identity (engine flatquack 0.2.1,
      variant naming the master-fix checkout)
- [x] 1.3 Validate `hook.json` against `benchmark-hook.schema.json` and smoke
      it with `bench:harness exec` (`capabilities`, then one `run`)
- [x] 1.4 Note the machine-local absolute path (edit-per-machine) in the hook
      directory's README stub or FINDINGS.md preamble

## 2. Harness validation pass

- [x] 2.1 Verify materialized data at `data/synthea-clinical/1/{s,m}` matches
      the checkfile hashes (re-materialize only if missing/stale)
- [x] 2.2 Full harness run, size `s`, `end_to_end`, report written; checkfile
      row counts verified for both cases
- [ ] 2.3 Full harness run, size `m`, `end_to_end`, report written; checkfile
      row counts verified for both cases — **BLOCKED** by
      [aehrc/flatquack#42](https://github.com/aehrc/flatquack/issues/42)
      (every size-`m` sample SIGTRAPs at teardown). Re-run after the upstream
      fix; see FINDINGS.md entry 3 and the pass record.
- [x] 2.4 Inspect the emitted report against
      `benchmark-report.schema.json` (identity fields copied verbatim,
      failure statuses sensible given flatquack#42 flakes)
- [x] 2.5 Produce and inspect the JMH export (`--jmh`) for consumability

## 3. Findings

- [x] 3.1 Write `benchmark/staging-hooks/flatquack/FINDINGS.md`: every
      friction point with exactly one taxonomy outcome — at minimum the
      `..{viewFile}` idiom (with the deferred `{viewDir}` reconsideration
      note), tool defects aehrc/flatquack#42 and #43 (cross-referenced,
      worked around here), the machine-local path note, and a clean-pass
      record for whatever passes cleanly
- [x] 3.2 Fix the doc gap in `benchmark/README.md` (fictitious flatquack CLI
      example) so the illustrative manifest cannot be mistaken for real
      flatquack usage
- [x] 3.3 If any finding forces a contract/harness/benchmark-case fix:
      failing test first in `benchmark/tests/`, then the fix, plus a delta
      spec beside `specs/README.md` (or re-blessed checkfiles for case fixes)

## 4. Verification

- [x] 4.1 `bun test` green (repo root — sof-js + benchmark suites)
- [x] 4.2 `bun run validate` green
- [x] 4.3 `bun run check-fmt` green (staged-hook JSON/SQL formatted per
      benchmark prettier config)
