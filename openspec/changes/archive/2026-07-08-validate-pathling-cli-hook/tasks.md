# Tasks — validate-pathling-cli-hook

## 1. Hook scaffolding

- [x] 1.1 Create `benchmark/staging-hooks/pathling-cli/hook.json` — CLI-mode
      manifest invoking `pathling view {dataDir} --from ndjson --view {viewFile}
      --format csv --departition --overwrite -o {outCsv}`, machine-local
      absolute path to the venv `pathling`, `implementation` identity (engine
      Pathling `9.9.0.dev`, binding pathling-python, variant `cli`)
- [x] 1.2 Validate `hook.json` against `benchmark-hook.schema.json`
- [x] 1.3 Note the machine-local path + prerequisites (Python venv, pyspark 4.0,
      Java, first-run Maven/Ivy jar resolution) in the hook directory's README

## 2. Harness validation pass

- [x] 2.1 Verify materialized data at `data/synthea-clinical/1/{s,m}` matches
      the checkfile hashes (`--strict`)
- [x] 2.2 Full harness run, size `s`, `end_to_end`, report + JMH written;
      checkfile row counts verified for both cases (6406 / 4366)
- [x] 2.3 Full harness run, size `m`, `end_to_end`, report + JMH written;
      checkfile row counts verified for both cases (48908 / 39479)
- [x] 2.4 Inspect both reports against `benchmark-report.schema.json` (identity
      fields copied verbatim; both cases `ok`/`verified`)
- [x] 2.5 Inspect the JMH exports for consumability (identity in `params`,
      timing as the primary metric)

## 3. Findings

- [x] 3.1 Write `benchmark/staging-hooks/pathling-cli/FINDINGS.md`: the
      near-zero-glue clean pass, the output-CSV doc gap, the confirmed
      "timed region includes process startup" observation, the non-materializing
      `column.type` prediction, the machine-local/environment note, and the
      pass record + timing
- [x] 3.2 Doc-gap fix: `benchmark/README.md` CLI section states the single-file
      + header-row output requirement
- [x] 3.3 Doc-gap fix: delta spec adds the "Result CSV output format"
      requirement to `benchmark-hook-format`; regression test in
      `harness-csv.test.js` pins the header requirement (no behaviour change)

## 4. Verification

- [x] 4.1 `bun test` — this change adds one passing test and zero failures.
      The 4 pre-existing `sof-js/tests/server/*` failures (a Bun
      `beforeAll(fn, timeout)` incompatibility) reproduce identically on the
      clean base branch (251 tests, 4 fail / 3 errors) and are unrelated to
      this change; benchmark suites are fully green.
- [x] 4.2 `bun run validate` green
- [x] 4.3 `bun run check-fmt` green
