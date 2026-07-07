## Why

The benchmark contract (hook manifest + protocol, harness, schemas,
materialization) has so far been exercised only by the reference `sof-js` hook
and synthetic test fixtures. Before external implementers adopt it, it needs
first contact with a real, independent engine. flatquack — a stateless,
non-JVM CLI tool — is the cheapest possible first target: the entire hook is a
zero-code CLI-mode manifest.

This is the first of three sibling validation changes (flatquack →
`validate-pathling-cli-hook` → `validate-pathling-server-hook`). Design,
findings taxonomy, ordering rule, and migration plan:
`docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`.

## What Changes

- Add `benchmark/staging-hooks/flatquack/hook.json` — a CLI-mode manifest
  (modeled on `benchmark/tests/fixtures/hooks/fake-cli.hook.json`) invoking
  flatquack with the `{dataDir}` / `{viewFile}` / `{outCsv}` template.
- Run the reference harness on `clinical-flat` at sizes `s` and `m`
  (`end_to_end`; the harness fixes CLI hooks to that scenario), verify
  checkfile row counts, and inspect the emitted report and JMH export.
- Record every friction point in
  `benchmark/staging-hooks/flatquack/FINDINGS.md` using the taxonomy in
  `benchmark/staging-hooks/README.md`.
- Any contract/harness/doc/benchmark-case fix a finding forces is implemented
  **in this change**, test-first, with a delta spec against the affected
  capability.

Validation focus unique to this target: argv-template expressiveness,
consumability of the materialized NDJSON by an external non-JVM engine,
checkfile verification against a non-reference engine, and report identity
fields. If flatquack's CLI cannot be expressed in the template, the finding
decides whether the template contract grows or flatquack gains a small CLI
affordance in its own repo.

## Capabilities

### New Capabilities

<!-- None planned: this change validates existing capabilities. -->

### Modified Capabilities

<!-- None planned upfront. Findings may add delta specs to
     benchmark-hook-format, benchmark-harness, benchmark-dataset-materialization,
     benchmark-report-format or benchmark-suite-format; if a full pass needs no
     contract change, record that outcome in FINDINGS.md. -->

## Impact

- `benchmark/staging-hooks/flatquack/` — temporary scaffolding (deleted at
  migration, per the design doc).
- Possibly `benchmark/` schemas, `benchmark/tools/harness/`,
  `benchmark/tests/`, or benchmark case files + re-blessed checkfiles, if
  findings force contract or case fixes.
- Possibly flatquack's own repo (tool defects; cross-referenced from
  FINDINGS.md, out of scope here).

Workflow: implemented in a fresh session on a feature branch off
`staging/benchmark`; PR reviewed before merge. The two sibling changes start
implementation only after this one merges.
