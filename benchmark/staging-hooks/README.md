# Staging hooks — temporary validation scaffolding

This directory holds engine-specific benchmark hooks for **validating the
benchmark contract** against real implementations. It is a deliberate,
temporary exception to the rule that no engine-specific execution code ships
in this repository.

The scaffolding contract:

- **Temporary.** Once all three hooks complete a full pass without forcing a
  contract change, each hook migrates to its implementation's repository and
  this directory is **deleted** — before `staging/benchmark` promotes to
  `main`. `sof-js/hook.json` remains the only in-repo hook example.
- **Scoped.** Everything engine-specific lives only under this directory.
- **One subdirectory per target**, each with its `hook.json` (validated by
  `../benchmark-hook.schema.json`), any adapter source, and a `FINDINGS.md`
  logging every friction point encountered while validating that target.

Findings taxonomy — every `FINDINGS.md` entry carries exactly one outcome:

| outcome               | meaning                                     | fixed where              |
| --------------------- | ------------------------------------------- | ------------------------ |
| contract defect       | schema/harness behaviour is wrong           | here, test-first         |
| contract gap          | the contract lacks a needed capability      | here, test-first + spec  |
| doc gap               | README/spec wording insufficient            | here                     |
| benchmark-case defect | a case fails on a conforming engine         | here, checkfile re-blessed |
| tool defect           | the implementation under test is wrong      | tool's repo, cross-linked |
| no contract change    | validated with no public-contract change (a clean pass, or a staging-hook-local fix) | staging hook only, or nothing |
| tool/environment constraint | the tool or environment limits validation | none; the comparison is adapted around it |

An outcome MAY carry a parenthetical qualifying the sub-reason (e.g. `no
contract change (thin adapter)`, `tool/environment constraint (comparison
adapted)`); the leading label is the taxonomy outcome.

The per-target subdirectories:

- `flatquack/`, `pathling-cli/`, `pathling-server/` — the three contract
  validation targets (CLI and HTTP hooks measured against the official
  scenarios), one per OpenSpec change below.
- `flatquack-internal/` — a different exercise (change `add-measurement-plans`):
  a **custom measurement plan** (fork-per-trial, in-engine `table` sink,
  untimed engine-reported `count`) driven through the harness module entry point
  `runPlanSuite`, validating the internal-tuning reuse story. It emits an
  `internal:<name>` record that is deliberately non-conforming (fail-closed) —
  NOT an official-scenario report. Same migration exit criterion as the others:
  it moves to flatquack's repo and this subdirectory is deleted before
  `staging/benchmark` promotes to `main`.

Design and workflow (ordering rule, exit criteria, migration plan):
`../../docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`.
The per-target work is tracked as OpenSpec changes:
`validate-flatquack-hook`, `validate-pathling-cli-hook`,
`validate-pathling-server-hook`, then `add-measurement-plans` (in that
implementation order), each driven by the `validation-cycle` skill
(`/validation-cycle <change>` in a fresh session; see
`.claude/skills/validation-cycle/SKILL.md`).
