---
name: run-benchmark
description: Run the SQL on FHIR performance benchmark against one or more staging hooks under benchmark/staging-hooks/ (flatquack, flatquack-internal, pathling-cli, pathling-server), routing each hook through the right driver and collecting reports/JMH files into one .local/ run directory. Use when the user wants to run, benchmark, or measure a staging hook, compare engines or tuning variants, or asks to run performance numbers for this repo's benchmark subproject.
---

# Run benchmark

Wraps `benchmark/tools/harness/cli.js` (the public route, official scenarios)
and any co-located custom-plan driver (the internal route — currently
`staging-hooks/flatquack-internal/flatquack-internal-driver.js`) behind one
script, so mixed hook selections don't need manual command construction. The
routing rule: a hook whose `implementation.variant` starts with `internal-`
runs through its directory's `<dir>-driver.js`; every other hook runs through
the harness CLI, once per declared scenario.

## Collect parameters

Ask only for what the user hasn't already given.

- **Hook(s)** — REQUIRED, no default, multiple allowed. A path under
  `benchmark/staging-hooks/`, or a bare directory name (`flatquack`) — but
  only when that directory has exactly one `hook*.json`. `flatquack-internal`
  has several tuning variants (`hook.json`, `hook.threads1.json`,
  `hook.duckdb141.json`, `hook.duckdb152.json`); always name the file
  explicitly there, never guess which one.
- **Benchmark** — default `clinical-wide` (`benchmark/clinical-wide.json`).
  Bare name or explicit path both work. Single-valued per run.
- **Size** — default `m`. Single-valued per run.
- **Scenario(s)** — default both `preloaded_repeated` and `end_to_end` for
  standard hooks; a scenario a hook doesn't declare is skipped, not an error.
  Multiple allowed. Ignored for internal hooks (they always run their fixed
  custom plan) — say so if the user passed one alongside only internal hooks.

## Run

```
bun run .claude/skills/run-benchmark/scripts/run-benchmark.js \
  --benchmark <name-or-path> --size <s> \
  --hook <path> [--hook <path> ...] \
  [--scenario <name> ...] \
  [--out <dir>] [--data <root>] [--strict] [--only <ids>] [--exclude <ids>]
```

`--strict`/`--only`/`--exclude` are optional passthrough to the harness CLI
and apply only to standard hooks (the internal driver has no equivalent
flags); the script warns rather than silently dropping them when internal
hooks are also selected.

Omit `--out` for the default
`.local/benchmark-runs/<timestamp>-<benchmark>-<size>/` — every report and
JMH file from the invocation lands in that one directory. The script prints
a per-hook/scenario summary (ok / skipped / failed) and exits non-zero if
anything failed.

## After running

Report the output directory and the printed summary verbatim — don't
re-derive pass/skip/fail counts by hand. If something failed, read the
printed stderr tail before proposing a fix; don't guess.
