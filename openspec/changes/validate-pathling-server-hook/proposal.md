## Why

The five-command HTTP hook protocol (`capabilities` / `prepare` / `run` /
`reset` / `shutdown`) and its lifecycle-mode and scenario semantics have never
been exercised by a service that is not the reference implementation. Pathling
Server — a Spark-backed FHIR server whose ViewDefinition-execution API already
exists — is the deep protocol test, and the place where the contract's hardest
claims (honest `reset`, `prepare`-replaces, what `preloaded_repeated` means
for a caching server) are put under real pressure.

Last of three sibling validation changes (after `validate-flatquack-hook` and
`validate-pathling-cli-hook`). Design, findings taxonomy, ordering rule, and
migration plan:
`docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`.

## What Changes

- Add `benchmark/staging-hooks/pathling-server/` — a small adapter service in
  Bun/JS (structured after `sof-js/src/hook.js`) translating hook commands to
  Pathling's REST API: import NDJSON on `prepare`, execute the ViewDefinition
  and fully write CSV on `run`, discard the dataset on `reset` — plus its
  `hook.json`, with `implementation.variant` distinguishing this deployment
  from the CLI one.
- Exercise **connect mode first** (Pathling operator-managed), then **spawn
  mode** (the adapter owns the Pathling lifecycle, making `end_to_end`'s
  restart-per-sample semantics real). Run both scenarios the hook declares on
  `clinical-flat` at sizes `s` and `m`; verify checkfile counts; inspect
  report and JMH export.
- Record findings in `benchmark/staging-hooks/pathling-server/FINDINGS.md`
  using the taxonomy in `benchmark/staging-hooks/README.md`; contract/doc/case
  fixes land in this change, test-first.

Validation focus unique to this target:

- Is `reset` honest for a Spark-backed server, or must the hook omit
  `end_to_end` in connect mode rather than ship warm numbers as cold?
- Is "a second `prepare` REPLACES the prepared dataset" implementable?
- Do `preloaded_repeated` numbers mean what the README claims when server
  caches persist across samples?
- Untimed spawn/readiness vs. timed regions when service startup is expensive.

## Capabilities

### New Capabilities

<!-- None planned: this change validates existing capabilities. -->

### Modified Capabilities

<!-- None planned upfront. This target is the likeliest of the three to force
     delta specs against benchmark-hook-format and benchmark-harness (scenario
     and lifecycle semantics); if a full pass needs no contract change, record
     that outcome in FINDINGS.md. -->

## Impact

- `benchmark/staging-hooks/pathling-server/` — temporary scaffolding (deleted
  at migration, per the design doc).
- Possibly `benchmark/` schemas, `benchmark/tools/harness/`,
  `benchmark/tests/`, benchmark README (scenario semantics wording), or case
  files + re-blessed checkfiles.
- Possibly Pathling's repo (tool defects or small API affordances;
  cross-referenced from FINDINGS.md).

Workflow: implemented in a fresh session on a feature branch off
`staging/benchmark`, only after `validate-pathling-cli-hook` merges; PR
reviewed before merge. This change concludes with the exit-criteria check
that triggers the separate migration/teardown step in the design doc.
