---
name: validation-cycle
description: Use when starting or resuming one of the benchmark-contract validation changes (validate-flatquack-hook, validate-pathling-cli-hook, validate-pathling-server-hook) in a fresh session, or when asked to "do"/"implement"/"continue" one of them.
---

# Benchmark validation cycle

Drives one benchmark-contract validation change end to end. The change's
proposal (`openspec/changes/<change>/proposal.md`) is the brief; the umbrella
design (`docs/superpowers/specs/2026-07-07-benchmark-validation-staging-hooks-design.md`)
and the findings taxonomy (`benchmark/staging-hooks/README.md`) are normative —
read all three before acting. Implementation order:
`validate-flatquack-hook` → `validate-pathling-cli-hook` →
`validate-pathling-server-hook`.

## Procedure — every numbered step is REQUIRED, in this order

1. **Gate.** The predecessor change's PR must already be merged into
   `staging/benchmark` (`gh pr list --state all`). Not merged → stop and ask
   the user. Only step 3 (exploration) is exempt from this gate.
2. **Branch.** `git fetch origin && git checkout -b feat/<change> origin/staging/benchmark`.
3. **Explore.** `/opsx:explore <change>` — resolve the unknowns (tool CLI
   shape, API endpoints, reset semantics) before authoring artifacts.
4. **Artifacts.** `/opsx:continue <change>` until design, specs, and tasks
   exist. Do not skip the design artifact; if a slot is genuinely trivial,
   the artifact says so explicitly ("no capability deltas planned").
5. **Implement.** `/opsx:apply <change>`. Every friction point becomes a
   `benchmark/staging-hooks/<target>/FINDINGS.md` entry with exactly one
   taxonomy outcome. Contract fixes: failing test first in `benchmark/tests/`,
   then the fix, plus a delta spec. Benchmark-case fixes: re-bless checkfiles
   (`bun run bench:bless`). A clean pass is recorded too.
6. **Verify.** `bun test`, `bun run validate`, `bun run check-fmt` — all
   green. Before attributing a failure to your change, reproduce it on the
   clean base branch.
7. **Refine.** Run the `simplify` skill, then the `code-review` skill, over
   the branch diff; apply the accepted findings; re-run step 6 if code
   changed. The cycle is not PR-ready until both skills have run.
8. **Archive in-PR.** `/opsx:verify <change>`, then `/opsx:archive <change>` —
   the archive and synced specs ship in the same PR (repo precedent: PR #27).
9. **PR.** Push, then `gh pr create --base staging/benchmark`. Body: the
   hook, harness results (sizes `s`/`m`, verified counts), findings outcomes,
   and any contract changes with their delta specs.
10. **Stop.** Report the PR URL and findings summary, then ask the user to
    review and merge. Never merge it yourself. Never start the next change in
    the same session.

## Red flags

- "The diff is small, simplify/code-review would be overkill" — run them; step 7 is unconditional.
- "I'll archive after the PR merges" — archive ships in the PR (step 8).
- "The predecessor PR is basically approved" — approved is not merged; the gate is merge.
