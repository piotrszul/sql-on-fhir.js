# SQL on FHIR Benchmark

Implementation-agnostic performance benchmark for SQL on FHIR view runners — the
performance analog of the conformance suite in `../tests`. A benchmark file pairs
a declarative Synthea **dataset recipe** with ViewDefinition **cases** and
per-size **expected row counts**. The data is generated locally; it is not
checked in.

## Layout

- `*.json` — inline benchmark files (`benchmark.schema.json`).
- `benchmark.schema.json` / `benchmark-report.schema.json` /
  `benchmark-hook.schema.json` — public contracts.
- `tools/` — the reference materialization tool and the reference harness
  (`tools/harness/`), both engine-neutral and replaceable; no engine-specific
  execution code ships here.
- `data/` — materialized NDJSON + manifests (untracked).

## Materialize data

Needs Java on the PATH. The materializer auto-fetches the pinned Synthea jar
(the version in the recipe's `dataset.syntheaVersion`) from its published GitHub
release, checksum-verifies it against a committed pin, and caches it under
`benchmark/.cache/synthea/` (gitignored) — so no manual jar download is required.

1. (OPTIONAL) `cp tools/executors.config.sample.json tools/executors.config.json`
   to override the auto-fetch — point `jar` at a locally-built
   `synthea-with-dependencies-<version>.jar` and/or set a non-default `java`
   binary. With no config, the jar is auto-fetched.
2. `bun run data <file|--group NAME> --size <s|m|...>`

Output: `data/<name>/<version>/<size>/<ResourceType>.ndjson` + `manifest.json`.
`<size>` selects the population; `<version>` is the authored dataset version
(`dataset.version`, bumped deliberately when the recipe should re-generate). Only
the recipe's `resources` are kept; siblings are pruned.

## Benchmark an implementation (the hook route — recommended)

You do not write a runner. You write a **hook** — a worker process plus a small
manifest — and the shared reference harness (`tools/harness/`) owns the
measurement loop, the wall clock, the row-count verification, the report, and
the JMH export. Comparability is by construction: one codebase computes every
comparability-critical number.

A hook is described by `hook.json` (validated by `benchmark-hook.schema.json`):

```json
{
  "command": ["python3", "driver.py"],
  "implementation": { "engine": { "name": "my-engine", "version": "1.0.0" } }
}
```

The worker speaks line-delimited JSON on stdin/stdout:

1. `{"cmd":"capabilities"}` → `{"ok":true,"scenarios":["preloaded_repeated","end_to_end"]}`
2. `{"cmd":"prepare","dataDir":…,"resources":[…]}` — load the NDJSON into your
   engine's best representation → `{"ok":true}`
3. `{"cmd":"run","view":…,"outCsv":…}` — evaluate the ViewDefinition and FULLY
   WRITE the flat result as CSV to `outCsv`, then respond
   `{"ok":true,"outputRows":…,"phasesMs":{…}}` (both fields optional/advisory —
   the harness counts rows from the file and owns the clock)
4. `{"cmd":"shutdown"}` — release resources and exit 0

Rules that will bite you if skipped: **stdout belongs to the protocol** (engine
logs go to stderr) and **each response line must be flushed immediately** —
block-buffered runtimes (Python!) must flush explicitly or the harness will
time out waiting on a response sitting in your buffer. A failing command
answers `{"ok":false,"error":"…"}` and stays alive; the failure is recorded
per-case and the run continues.

Run it:

```
bun run bench:harness -- run --hook path/to/hook.json <file> --size <s> \
    [--scenario preloaded_repeated|end_to_end] [--strict] [--jmh <dir>] [--out <report.json>]
bun run bench:harness -- exec --hook path/to/hook.json '{"cmd":"capabilities"}'   # debug one command
```

Scenario semantics are enforced by process control: `preloaded_repeated` keeps
one worker (prepare untimed, each `run` round-trip timed, warmups discarded);
`end_to_end` restarts the worker per sample so every sample is dataset-cold
(spawn untimed, `prepare` + `run` timed). Note `preloaded_repeated` means
warm: for a server-backed engine the server's cache state persists across
samples — that is what "preloaded" measures, not cold-query cost.

Hooks live in your implementation's repo; `sof-js/hook.json` + `sof-js/src/hook.js`
in this repository are the worked example.

## Hand-rolled runner (the escape hatch)

An implementation that cannot fit a harness-supervised worker (e.g. a REST-only
service) may still act as its own runner, in any language:
1. obtain this `benchmark/` directory at a pinned tag;
2. materialize the data (above, or reimplement from the recipe);
3. for each `*.json`, run each `case.view` over the materialized NDJSON for the
   chosen size with your own timing harness — time **execute + extract**
   (evaluate + a full materialization of the result to a written CSV, never a
   lazy count);
4. compare output row counts to the checkfile's assertions
   (`ok` / `count_mismatch`), recording `verified` accordingly;
5. emit `benchmark-report.json` per `benchmark-report.schema.json`.

Both routes emit the same report format, so downstream consumers are
indifferent to the route.

## Bless (reference implementation only)

`bun run bench:bless -- <file> --size <s>` evaluates each case with the sof-js
reference engine, analytically cross-checks the counts, and writes the
committed checkfile. Blessing is not part of the runner contract.

## v1 scope

Synthea-generated single-resource benchmarks (one view over one materialized
resource type), FHIR R4 (4.0.1). Views may use any FHIRPath including reference
functions; single-resource is a measurement-setup property. Case views should
conform to the
[ShareableViewDefinition](https://build.fhir.org/ig/HL7/sql-on-fhir/StructureDefinition-ShareableViewDefinition.html)
profile — every column carries a `type`, and that `type` must match the FHIR type
the path returns — so cases run unchanged on strongly-typed engines. The `sof-js`
reference runner ignores `column.type`, so this is not enforced here; a
second-runner mismatch (e.g. Pathling) is the signal. Demographic datasets
are capped at 10k patients (generate-then-prune). Referenced datasets, QR/download
kinds, referentially-consistent multi-resource datasets, and result checksums are
future extensions. See `../docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`.
