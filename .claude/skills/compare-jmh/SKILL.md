---
name: compare-jmh
description: Compare two or more JMH benchmark result files (*.jmh.json, e.g. produced by run-benchmark's --out directory) side by side using the JMH Visualizer (jmh.morethan.io), a client-side-only comparison tool. Use when the user wants to compare/diff benchmark runs, view results in JMH Visualizer, or check for performance regressions between hooks or tuning variants.
---

# Compare JMH results

Drives the Playwright browser tools to upload `.jmh.json` files into
https://jmh.morethan.io/ (data stays in-browser — the tool's own banner says
so; nothing is sent to a server) and reads back the rendered diff.

## Collect files

REQUIRED, at least two. Accept either:
- explicit `.jmh.json` paths, or
- a directory (e.g. a `run-benchmark` `--out` dir) — glob `*.jmh.json` inside
  it non-recursively.

More than ~4 files becomes a multi-run comparison rather than a pairwise
diff; the tool handles it, just say so when reporting back.

## Procedure

1. If the `mcp__playwright__browser_*` tools aren't already loaded, fetch
   them: `ToolSearch("select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_file_upload,mcp__playwright__browser_take_screenshot")`.
2. `browser_navigate` to `https://jmh.morethan.io/`.
3. `browser_snapshot` to get the "Choose File" button's ref, then
   `browser_click` it — this opens a file-chooser modal.
4. `browser_file_upload` with the full list of absolute file paths in one
   call (uploads them all at once, producing the comparison view directly;
   no need to add one at a time).
5. `browser_take_screenshot` with `fullPage: true`, **omitting `filename`**.
   The Playwright tool sandbox only allows writing under the repo (its
   default `.playwright-mcp/` or the repo root) — passing an absolute path
   outside the repo (e.g. the session scratchpad) is denied. Let it use its
   default `.playwright-mcp/page-<timestamp>.png`.
6. Read the screenshot and transcribe the actual numbers into the chat
   response as a table (case, scores per file, % delta) — don't just say
   "see the screenshot." Call out the "Declined Benchmarks" / "Improved
   Benchmarks" sections by name if present.
7. The visualizer hides deltas under 5% by default (the "Ignoring deviations
   below N%" slider) — mention this if the user asks about small
   differences, since it means near-noise cases may be omitted from the
   rendered tables even though they were uploaded.
8. `.playwright-mcp/` is excluded via `.git/info/exclude` (a local, uncommitted
   ignore — it will never end up in a commit), but it still accumulates on
   disk across sessions with nothing pruning it. After reading the
   screenshot, delete it (and any snapshot `.yml` files this run produced)
   with Bash `rm` so it doesn't grow unbounded.

## After

Report the comparison table and where the screenshot was saved (before you
delete it). Don't editorialize about whether a regression is "real" unless
asked — just report the numbers.
