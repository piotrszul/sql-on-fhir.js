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

Design and workflow (ordering rule, exit criteria, migration plan):
`../../docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`.
The per-target work is tracked as OpenSpec changes:
`validate-flatquack-hook`, `validate-pathling-cli-hook`,
`validate-pathling-server-hook` (in that implementation order).
