# flatquack DuckDB-session internal benchmark (staging)

Staging scaffolding for the `add-measurement-plans` change: a **custom
measurement plan** exercised against a real engine, validating that the
harness's plan-driven core and its honesty guard support internal performance
tuning (the retirement of `dev/sof-benchmark`) without moving any public
comparability semantics. Like the rest of `staging-hooks/`, everything here is
temporary and migrates to flatquack's repository before `staging/benchmark`
promotes to `main`.

## What it measures

The internal **warm-table-sink** plan — the combination no official scenario
reaches:

| axis            | value                                                          |
| --------------- | -------------------------------------------------------------- |
| fork level      | `trial` (a fresh, warmed duckdb session per case)              |
| trial setup     | `prepare-lazy` (records the data dir; load rides inside `run`) |
| timed region    | `run` → `CREATE OR REPLACE TEMP TABLE _sink AS (<compiled SQL>)` |
| sink            | `table` (materialize in-engine; no CSV in the timed region)    |
| warmup          | `iterations` (warmups discarded)                               |
| verification    | `post-loop-count` (untimed engine-reported `count(*)`)         |

Load + execute are inside the clock; CSV serialization is excluded. This is the
cell `dev/sof-benchmark` measured (flatquack versions × DuckDB versions on a
warm engine, result-CSV serialization outside the timed region).

## Pieces

- `hook.json`, `hook.threads1.json` — spawn-mode HTTP manifests, one per
  implementation identity. Both use the same flatquack ref and duckdb here (the
  only combination available locally — see FINDINGS.md); they differ by a real
  engine tuning knob, `DUCKDB_PRAGMAS` (`SET threads=1` on the second), which is
  exactly the kind of A/B this internal benchmark exists for. **Machine-local
  paths** live in `env` (like the CLI hook's `FLATQUACK_CLI`): `DUCKDB_BIN` (a
  duckdb CLI binary) and `FLATQUACK_CLI` (flatquack `src/cli.js`). Edit them for
  your machine. The `implementation.variant` MUST start with `internal-` — the
  driver refuses anything else (honesty guard, design D6).
- `flatquack-internal-hook.js` — the hook: holds one persistent duckdb child,
  compiles the ViewDefinition via flatquack `--mode preview` (memoized,
  untimed), materializes `_sink` per timed sample, and answers the staging
  `count`/`extract` verbs.
- `duck-session.js` — the persistent DuckDB CLI session (sentinel-based,
  event-driven completion).
- `hook-lib.js` — pure helpers (SQL assembly, count parsing, env, memo key),
  unit-tested in `tests/staging-flatquack-internal.test.js`.
- `flatquack-macros.sql`, `flatquack-table.sql` — flatquack templates: the
  macro block (defined once, untimed) and the body-only SELECT (wrapped in
  `CREATE TABLE`).
- `flatquack-internal-driver.js` — constructs the plan, drives it through the
  harness module entry point `runPlanSuite` (NOT the public CLI), and writes an
  internal record + JMH projection per identity.
- `internal-report.schema.json` — the staging-local schema for the internal
  record (NOT a public contract; validates the `internal:<name>` scenario and
  the embedded `measurement.plan`).

## Run

```
bun run flatquack-internal-driver.js \
  --hook hook.json --hook hook.cte-fix.json \
  ../../clinical-flat.json --size s --out <dir>
```

writes `<benchmark>-<size>-<impl>.internal-report.json` and
`<...>.jmh.json` per identity into `<dir>`. Load the two `.jmh.json` files into
[JMH Visualizer](https://jmh.morethan.io/) for a side-by-side overlay; the
self-describing impl-ids (`…-internal-warm-table-sink[-<ref>]`) keep the
identities distinct and carry no conformance claim.

Findings from validating this cell are in `FINDINGS.md`.
