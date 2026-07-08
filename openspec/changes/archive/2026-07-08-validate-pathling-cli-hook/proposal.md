## Why

After first contact via `validate-flatquack-hook`, the CLI lifecycle mode
needs validation against a JVM engine, where the deliberate contract decision
that a CLI hook's timed region **includes process startup** actually bites.
Pathling CLI is also the first strongly-typed engine to run the benchmark
cases, which is expected to surface the "second-runner signal" the benchmark
README anticipates.

Second of three sibling validation changes (after `validate-flatquack-hook`,
before `validate-pathling-server-hook`). Design, findings taxonomy, ordering
rule, and migration plan:
`docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`.

## What Changes

- Add `benchmark/staging-hooks/pathling-cli/hook.json` — a CLI-mode manifest
  invoking Pathling's CLI with the `{dataDir}` / `{viewFile}` / `{outCsv}`
  template, with `implementation.variant` distinguishing this deployment from
  the server deployment of the same engine.
- Run the reference harness on `clinical-flat` at sizes `s` and `m`
  (`end_to_end`), verify checkfile row counts, and inspect the report and JMH
  export.
- Record findings in `benchmark/staging-hooks/pathling-cli/FINDINGS.md` using
  the taxonomy in `benchmark/staging-hooks/README.md`; contract/doc/case fixes
  land in this change, test-first.

Validation focus unique to this target:

- Do the harness's warmup/sample statistics stay meaningful when every timed
  sample carries multi-second JVM boot?
- `implementation.variant` as the deployment disambiguator in the report.
- `column.type` / ShareableViewDefinition conformance of the benchmark cases
  on a strongly-typed engine (expected **benchmark-case defects**, fixed with
  re-blessed checkfiles).

## Capabilities

### New Capabilities

<!-- None planned: this change validates existing capabilities. -->

### Modified Capabilities

<!-- None planned upfront. Findings may add delta specs to
     benchmark-hook-format, benchmark-harness, benchmark-suite-format or
     benchmark-report-format; if a full pass needs no contract change, record
     that outcome in FINDINGS.md. -->

## Impact

- `benchmark/staging-hooks/pathling-cli/` — temporary scaffolding (deleted at
  migration, per the design doc).
- Likely benchmark case files + re-blessed checkfiles (`column.type` fixes).
- Possibly `benchmark/` schemas, `benchmark/tools/harness/`,
  `benchmark/tests/` if findings force contract fixes.
- Possibly Pathling's repo (tool defects; cross-referenced from FINDINGS.md).

Workflow: implemented in a fresh session on a feature branch off
`staging/benchmark`, only after `validate-flatquack-hook` merges; PR reviewed
before merge.
