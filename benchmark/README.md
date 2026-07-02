# SQL on FHIR Benchmark

Implementation-agnostic performance benchmark for SQL on FHIR view runners — the
performance analog of the conformance suite in `../tests`. A benchmark file pairs
a declarative Synthea **dataset recipe** with ViewDefinition **cases** and
per-size **expected row counts**. The data is generated locally; it is not
checked in.

## Layout

- `*.json` — inline benchmark files (`benchmark.schema.json`).
- `benchmark.schema.json` / `benchmark-report.schema.json` — public contracts.
- `tools/` — the reference materialization tool (no runner/timing code).
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

Output: `data/<name>_<hash>/<size>/<ResourceType>.ndjson` + `manifest.json`.
`<size>` selects the population; `<hash>` is the recipe content hash (identical
recipes dedupe). Only the recipe's `resources` are kept; siblings are pruned.

## Run a benchmark (the runner contract)

A runner, in any language:
1. obtain this `benchmark/` directory at a pinned tag;
2. materialize the data (above, or reimplement from the recipe);
3. for each `*.json`, run each `case.view` over the materialized NDJSON for the
   chosen size with your own timing harness;
4. compare output row count to `expectCount[size]` (`ok` / `count_mismatch`);
5. emit `benchmark-report.json` per `benchmark-report.schema.json`.

Recommended measurement: time **execute + extract** (evaluate + a full
materialization of the result — a table or CSV, never a lazy count). Record what
you timed in the report's `measurement` block.

`sof-js` is the reference runner: `bun run bench:run -- <file> --size <s> [--record]`
(`--record` blesses `expectCount`).

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
