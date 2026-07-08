# validate-pathling-cli-hook — design

## Context

The benchmark contract's CLI mode is a three-placeholder argv template
(`{dataDir}`, `{viewFile}`, `{outCsv}`, substituted as substrings within each
element — `benchmark-hook.schema.json`, `tools/harness/cli-connector.js`).
Pathling (aehrc/pathling `main` @ b9d9d78, engine `9.9.0.dev`) ships a genuine
published CLI in its Python package (`pathling view`, entry point
`pathling.cli.main:cli`). It reads a directory of `<ResourceType>.ndjson`,
runs a ViewDefinition, and writes tabular output; probed empirically during
exploration:

- `pathling view {dataDir} --from ndjson --view {viewFile} --format csv
  --departition --overwrite -o {outCsv}` fits the template DIRECTLY — no
  adapter is needed (unlike flatquack's directory-glob shim).
- `--departition` (default true) coalesces Spark's directory of part files
  into a single CSV file at the exact `-o` path; the CSV is written
  `option("header","true")`, so it carries the header row the harness's
  `countCsvRows` expects.
- `--overwrite` is required: `end_to_end` reuses one `outCsv` path across a
  case's samples, so each fresh invocation must replace the previous file.
- Both `clinical-flat` cases (`condition-flat` Condition, `observation-components`
  Observation `forEach component`) produce checkfile-exact counts at `s`
  (6406 / 4366) and `m` (48908 / 39479). The declared `column.type`s
  (`string`, `code`) and `getResourceKey()` / `.first()` FHIRPath are honoured
  by the strongly-typed engine.
- The engine is NOT a self-contained binary: it needs a Python venv +
  `pyspark 4.0` + Java, and Spark resolves `au.csiro.pathling:library-runtime`
  (from `~/.m2` for the dev build) and Delta (from Maven Central) via Ivy on
  first launch. Not a contract concern, but a machine-local prerequisite.

## Goals / Non-Goals

**Goals:**

- A zero-code CLI-mode `hook.json` under `benchmark/staging-hooks/pathling-cli/`
  invoking the published `pathling view` CLI through the unmodified contract.
- A full harness pass on `clinical-flat`, sizes `s` and `m`, `end_to_end`,
  with checkfile-verified counts; report and JMH export inspected.
- Every friction point recorded in `FINDINGS.md` with exactly one taxonomy
  outcome; contract/doc fixes (if any) land here.

**Non-Goals:**

- No Pathling source changes (no tool defects were found).
- No new benchmark cases or dataset changes.
- No use of Pathling's own `sof-benchmark` runner (that is Pathling's full
  harness, analogous to sof-js's reference runner — not a CLI hook).

## Decisions

1. **Near-zero-glue manifest, no adapter.** `pathling view` already matches the
   template, so the hook is a pure `hook.json` (contrast flatquack, which
   needed `flatquack-hook.js` to bridge its directory-glob CLI). `--departition`
   + the CSV header are exactly what the harness's single-file, header-counted
   output contract needs.
2. **Machine-local absolute path to the venv `pathling`** in the checked-in
   `hook.json` (argv has no env expansion; user decision, mirrors flatquack's
   machine-local knob). Staging hooks are documented machine-local temporary
   scaffolding; the hook README notes the path must be edited per machine and
   lists the venv/Java/first-run-network prerequisites.
3. **Local dev build (`9.9.0.dev`), not the published PyPI wheel** (user
   decision). The dev build's runtime coordinate
   `au.csiro.pathling:library-runtime:9.9.0-SNAPSHOT` resolves from the local
   `~/.m2`; the published `pathling view` CLI is otherwise identical. Recorded
   in FINDINGS with the exact version so the pass is reproducible.
4. **`--from ndjson` explicit** rather than relying on auto-detection, so the
   `manifest.json` sitting beside the NDJSON in `{dataDir}` cannot perturb
   format detection.
5. **Doc-gap fix for the output-CSV contract (see FINDINGS entry).** The
   contract never stated that `outCsv` must be a single file with a header row,
   though the harness always required it. Fixed here: a delta spec adds the
   explicit "Result CSV output format" requirement to `benchmark-hook-format`,
   the `benchmark/README.md` CLI section gains the single-file+header note, and
   a regression test in `harness-csv.test.js` pins why the header is required.
   No harness behaviour changes (the behaviour was already tested).

## Risks / Trade-offs

- [Every `end_to_end` sample pays full JVM+Spark cold boot] → this is the
  deliberate "timed region includes process startup" decision, and it is the
  honest cost of a one-off CLI run; `implementation.variant: cli` marks these
  numbers as a different deployment from a warm server. Report the median.
  Boot dominates (~6 s at `s`, ~7–8.5 s at `m`); the data cost is a small
  increment on top. Not a defect — a validation of the decision.
- [Machine-local venv path makes the checked-in hook non-portable] → single
  documented value; staging hooks are explicitly machine-local and temporary
  (deleted at migration).
- [Heavier prerequisites than flatquack (Python+Spark+Java+jars, first-run
  network)] → inherent to a JVM/Spark engine; recorded as an observation, not
  a contract issue.

## Open Questions

- Do both sizes pass with checkfile-exact counts on the strongly-typed engine?
  **Answered during apply:** yes — `s` 6406/4366 and `m` 48908/39479, both
  cases `ok`/`verified`, reports valid against `benchmark-report.schema.json`,
  JMH exports well-formed. `l` (10k population) was run additionally and also
  passes clean (459611/390615, checkfile-exact).
- Does the predicted `column.type` / ShareableViewDefinition mismatch bite?
  **Answered:** no — flatquack's cycle already added the Shareable metadata,
  and Pathling honours the declared `string`/`code` types; no case defect.
- Report identity: `engine.name: Pathling`, `variant` distinguishing the CLI
  deployment. **Answered:** `variant: cli` (vs the forthcoming `server`
  deployment), `binding: pathling-python`.
