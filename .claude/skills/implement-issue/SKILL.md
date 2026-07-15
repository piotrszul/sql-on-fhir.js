---
name: implement-issue
description: Use when asked to implement, fix, or work a specific GitHub issue by number in this repo (e.g. "implement issue 42", "let's do issue #17", "pick up issue 90", "continue issue 8"). Drives the issue end-to-end from a bare issue number to a merge-ready PR: branch, explore, OpenSpec artifacts, implementation, verification, PR.
---

# Implement issue

Drives one GitHub issue end to end, from a bare issue number to a merge-ready
PR. Unlike a pre-planned change, nothing exists yet when this starts: the
issue itself is the brief, and exploration is what turns it into an OpenSpec
change. Read the issue in full (body + every comment) before doing anything
else — the number alone is not enough context to branch, let alone implement.

## Procedure — every numbered step is REQUIRED, in this order

1. **Gate.** `gh issue view <number> --json number,title,body,state,url,labels,comments`.
   If `state` is not `OPEN`, stop and ask the user before doing anything (a
   closed issue may already be resolved, or intentionally shelved). Check for
   existing work: `git branch -a | grep "issue/<number>_"` and
   `gh pr list --search "<number>" --state all`. If a branch or PR already
   references this issue, stop and ask whether to resume it instead of
   starting fresh.
2. **Branch.** Derive `<slug>` from the issue title: lowercase, kebab-case,
   strip punctuation, cap at ~40 characters. `git fetch origin && git
   checkout -b issue/<number>_<slug> origin/staging/benchmark`.
3. **Explore.** `/opsx:explore`, grounded in the issue — walk through the
   body and every comment, pull in anything it links to (files, other
   issues, PRs), and resolve what it leaves implicit (repro steps, root
   cause, acceptance criteria) with the user before writing any artifact.
   Nothing is pre-planned here the way it is for other changes: the issue is
   the only brief there is, so this step is where the real scoping happens.
4. **Artifacts.** `openspec new change "issue-<number>-<slug>"` (same slug as
   the branch), then `/opsx:continue issue-<number>-<slug>` until proposal,
   specs/design, and tasks all exist. The proposal's Why section must cite
   the issue (`Closes #<number>` plus its URL) and reflect what exploration
   surfaced — not a restatement of the issue title.
5. **Implement.** `/opsx:apply issue-<number>-<slug>`. Test-first, per this
   repo's constitution (Principle III): the failing test goes in `tests/`
   before the fix that makes it pass.
6. **Verify.** `bun test`, `bun run validate`, `bun run check-fmt` — all
   green. Before attributing a failure to your change, reproduce it on a
   clean `staging/benchmark`.
7. **Refine.** Run the `simplify` skill, then the `code-review` skill, over
   the branch diff; apply the accepted findings; re-run step 6 if code
   changed. The cycle is not PR-ready until both skills have run.
8. **Archive in-PR.** `/opsx:verify issue-<number>-<slug>`, then
   `/opsx:archive issue-<number>-<slug>` — the archive and synced specs ship
   in the same PR, not a follow-up.
9. **PR.** Push, then `gh pr create --base staging/benchmark`. Body must
   include `Closes #<number>`, a summary of the change, and verification
   results (test / validate / fmt all green).
10. **Stop.** Report the PR URL and a one-line summary, then ask the user to
    review and merge. Never merge it yourself. Never start another issue in
    the same session unless explicitly asked to.

## Red flags

- "The issue is small, I can skip exploration" — step 3 is what turns a bare
  number into a real brief; skipping it means guessing at scope.
- "The diff is small, simplify/code-review would be overkill" — run them;
  step 7 is unconditional.
- "I'll archive after the PR merges" — archive ships in the PR (step 8).
- "The issue title is clear enough for the proposal" — the proposal's Why
  must reflect exploration, not just restate the title.
