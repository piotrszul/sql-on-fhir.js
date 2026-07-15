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
(`dataset.version`, bumped deliberately when the recipe should re-generate).
Generation is **export-filtered**: the recipe's `resources` are passed to
Synthea's `exporter.fhir.included_resources` so only those types are emitted
(not every type, then pruned). Synthea force-exports `Patient`/`Encounter`
regardless, so the prune is retained as a safety net for those siblings. Only
the recipe's `resources` are kept in the final layout.

## Benchmark an implementation (the hook route — recommended)

You do not write a runner. You write a **hook** — for a service-style engine a
small local HTTP service plus a manifest, for a stateless CLI tool just the
manifest — and the shared reference harness (`tools/harness/`) owns the
measurement loop, the wall clock, the row-count verification, the report, and
the JMH export. Comparability is by construction: one codebase computes every
comparability-critical number.

A hook is described by `hook.json` (validated by `benchmark-hook.schema.json`),
declaring **exactly one lifecycle mode**:

```json
{
  "command": ["python3", "hook.py"],
  "implementation": { "engine": { "name": "my-engine", "version": "1.0.0" } }
}
```

- `command` (**spawn mode**): the harness starts your service, passing the port
  to listen on as the `HOOK_PORT` environment variable, polls
  `GET /capabilities` until you are ready (spawn and readiness are untimed),
  and owns termination.
- `endpoint` (**connect mode**, e.g. `"endpoint": "http://127.0.0.1:8095"`):
  your service is operator-managed (started by hand, docker-compose, …); the
  harness only connects — it never sends `shutdown` and never terminates it.
- `cli` (**CLI mode**): no service and no code at all — an argv template the
  harness spawns fresh per run. See "CLI tool? Zero code." below.

In spawn and connect modes, the service answers five command endpoints with
JSON bodies:

1. `GET /capabilities` → `{"ok":true,"scenarios":["preloaded_repeated","end_to_end"]}`
2. `POST /prepare` `{"dataDir":…,"resources":[…]}` — load the NDJSON into your
   engine's best representation → `{"ok":true}`. A second `prepare` REPLACES
   the prepared dataset, it never accumulates.
3. `POST /run` `{"view":…,"outCsv":…}` — evaluate the ViewDefinition and FULLY
   WRITE the flat result to `outCsv` as a **single CSV file with a header row**
   (RFC-4180), then respond `{"ok":true,"outputRows":…,"phasesMs":{…}}` (both
   fields optional/advisory — the harness counts rows from the file, as the
   lines below the header, and owns the clock). This output-format contract is
   the same in every lifecycle mode; an engine whose native writer emits a
   directory of part files must coalesce to one headed file.
4. `POST /reset` — discard the prepared dataset so the next `prepare` re-does
   the full ingest → `{"ok":true}`
5. `POST /shutdown` — release resources and (spawn mode) exit 0

A failing command answers `{"ok":false,"error":"…"}` **with a 2xx status** and
stays alive; the failure is recorded per-case and the run continues. Non-2xx
statuses and unparseable bodies are protocol violations (they also fail only
the in-flight case). stdout/stderr carry no protocol duties — log freely.

A complete Flask hook is about this big:

```python
from flask import Flask, request, jsonify
import os
app = Flask(__name__)
data = {}

@app.get("/capabilities")
def capabilities(): return jsonify(ok=True, scenarios=["preloaded_repeated", "end_to_end"])

@app.post("/prepare")
def prepare():
    body = request.json; data.clear()
    for r in body["resources"]: data[r] = load_ndjson(f"{body['dataDir']}/{r}.ndjson")
    return jsonify(ok=True)

@app.post("/run")
def run():
    body = request.json
    rows = evaluate(body["view"], data[body["view"]["resource"]])
    write_csv(body["outCsv"], rows)          # fully written BEFORE responding
    return jsonify(ok=True, outputRows=len(rows))

@app.post("/reset")
def reset(): data.clear(); return jsonify(ok=True)

@app.post("/shutdown")
def shutdown(): os._exit(0)

app.run(host="127.0.0.1", port=int(os.environ["HOOK_PORT"]))
```

Run it:

```
bun run bench:harness run --hook path/to/hook.json <file> --size <s> \
    [--scenario preloaded_repeated|end_to_end] [--strict] [--jmh <dir>] [--out <report.json>] \
    [--only <ids>] [--exclude <ids>]
bun run bench:harness exec --hook path/to/hook.json '{"cmd":"capabilities"}'   # debug one command
```

`--only condition-flat,encounter-flat` runs just those cases; `--exclude
us-core-blood-pressures` runs every case but that one. `--exclude` wins over
`--only` on a conflict, and an id matching no case fails loudly. The same two
flags work on `bench:bless`.

Because the hook is a stateful HTTP session, you can also drive it by hand
while developing (spawn it yourself with a `HOOK_PORT`):

```
HOOK_PORT=8095 python3 hook.py &
curl :8095/capabilities
curl :8095/prepare -d '{"dataDir":"data/demographics/1/s","resources":["Patient"]}'
curl :8095/run -d '{"view":{...},"outCsv":"/tmp/out.csv"}'
curl -X POST :8095/shutdown
```

Scenario semantics per lifecycle mode: `preloaded_repeated` keeps one hook
(prepare untimed, each `run` round-trip timed, warmups discarded).
`end_to_end` times `prepare` + `run` together; in spawn mode the harness
restarts the service per sample so every sample is dataset-cold by
construction, while in connect mode it TRUSTS your untimed `reset` before each
timed region (the service — and its runtime warmth — persists across samples).
Note `preloaded_repeated` means warm: for a server-backed engine the server's
cache state persists across samples — that is what "preloaded" measures, not
cold-query cost.

### CLI tool? Zero code.

If your implementation is a stateless command-line tool (one invocation =
load + execute + extract), the entire hook is a manifest:

```json
{
  "cli": {
    "run": ["my-engine", "--data", "{dataDir}", "--view", "{viewFile}", "--out={outCsv}"]
  },
  "implementation": { "engine": { "name": "my-engine", "version": "0.3.0" } }
}
```

(The argv shown is illustrative — spell the template in whatever flags your
tool actually takes.)

The harness substitutes `{dataDir}` (the materialized dataset directory),
`{viewFile}` (a temp file it writes with the case's ViewDefinition JSON) and
`{outCsv}` (where to write the CSV) — as substrings within elements, so
`--out={outCsv}` works — and spawns the argv directly, never via a shell.
`{outCsv}` follows the same output-format contract as any `/run` (a single
headed CSV file — see above); a Spark/Hadoop-style writer that emits a
directory of part files must coalesce to one file, e.g. Pathling's
`pathling view --departition`.
Exit 0 with the CSV fully written means success; a non-zero exit fails that
case with your stderr tail as the diagnostic. Each timed sample spawns one
fresh process, so a CLI hook serves `end_to_end` only — run it with
`--scenario end_to_end`, since the harness's default is `preloaded_repeated`,
which a CLI hook never declares. Its timed region
deliberately INCLUDES your process startup (interpreter/JVM boot): that is
the real cost of a one-off CLI invocation. Numbers from a CLI hook and a
server hook of the same engine are therefore different deployments — ship
one manifest per deployment, told apart by `implementation.variant`.

### Which scenarios should my hook declare?

Two verb-level questions decide it:

| your architecture can…                          | declare                |
| ----------------------------------------------- | ---------------------- |
| hold prepared state across `run` round-trips    | `preloaded_repeated`   |
| return to dataset-cold cheaply (restart, honest `reset`, or fresh process) | `end_to_end` |

A stateless CLI tool answers no to the first (the harness fixes its declared
scenarios to `end_to_end` for you); a server that cannot truly discard state
on `reset` answers no to the second in connect mode and should omit
`end_to_end` there rather than ship warm numbers as cold.

Hooks live in your implementation's repo; `sof-js/hook.json` + `sof-js/src/hook.js`
in this repository are the worked example of an HTTP hook, and
`benchmark/tests/fixtures/hooks/fake-cli.hook.json` of a CLI one.

## Hand-rolled runner (the escape hatch)

An implementation whose deployment shape fits neither lifecycle mode may still
act as its own runner, in any language:
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

## Internal reuse: measurement plans (NOT a public route)

The harness drives every run through one generic single-shot executor over a
declarative **measurement plan** — a closed data record (no callbacks) over fork
level (`suite` | `trial` | `invocation`), untimed trial setup, untimed
invocation setup, timed region, sink (`csv` | `table`), verification
(`in-run-csv` | `post-loop-count` | `post-loop-extract`), and warmup policy. The
two official scenarios are simply named plan **bindings**:
`preloaded_repeated` and `end_to_end` resolve to fixed plans, and their
observable semantics are unchanged. This section is **internal harness
architecture, not a public contract**: the plan vocabulary carries no
comparability meaning, and nothing here changes the schemas, the hook protocol,
or the CLI.

The reuse case is intra-stack performance tuning (e.g. comparing engine
configurations or build refs), where the public scenario vocabulary must not
move. Two guarantees keep such runs honest:

- **The public CLI drives only official scenarios.** `bench:harness run`
  accepts `preloaded_repeated` / `end_to_end` and nothing else; there is no
  `--plan` flag. A custom plan is reachable only through the harness module
  entry point `runPlanSuite({ plan, scenarioId, phases, … })`.
- **A custom-plan run is fail-closed by construction.** It emits a lossless,
  report-shaped `<stem>.internal-report.json` whose `measurement.scenario` is a
  namespaced non-official id (`internal:<name>`), whose `measurement` truthfully
  declares the phases/sink/warmup actually driven, and which embeds the plan
  verbatim as `measurement.plan` (so the row-count's provenance —
  engine-reported `count` vs harness-counted `extract` — is recorded in the data
  it qualifies). The published `benchmark-report.schema.json`'s closed
  `scenario` enum makes this record fail validation everywhere the contract is
  enforced, so it can never be mistaken for a conforming, comparable report.
  Official scenario names are derivable only from bindings; no code path stamps
  one onto a raw plan. The JMH export still projects (labels carry no
  conformance claim), and the executor rejects an unsound plan
  (`post-loop-count` without a materializing `table` sink) as a loud setup
  failure before any case runs.

The worked example is the temporary staging benchmark under
`staging-hooks/flatquack-internal/` (a flatquack DuckDB-session hook + driver);
it migrates out with the rest of `staging-hooks/`. Whether any of this graduates
into the public contract is a deliberately deferred, findings-informed decision.

## Bless (reference implementation only)

`bun run bench:bless -- <file> --size <s> [--only <ids>] [--exclude <ids>]`
evaluates each case with the sof-js reference engine, analytically cross-checks
the counts, and writes the committed checkfile. Blessing is not part of the
runner contract. It streams the dataset one resource at a time (summing the
observed count and the analytic derivation per resource), so bless memory is
bounded by a single resource and its output rows rather than by the dataset —
this is what makes the `xl` (100k) tier blessable. The analytic cross-check is a
count-only row-cardinality derivation over the select tree (nested
`forEach`/`forEachOrNull`, `unionAll`, sibling-`select` cross-join, view-level
`where`); a disagreement with the observed count only ever *blocks* a bless, it
can never write a wrong count. `--only`/`--exclude` bless a subset; unselected
cases keep their existing assertions.

## v1 scope

Synthea-generated single-resource benchmarks (one view over one materialized
resource type), FHIR R4 (4.0.1). Views may use any FHIRPath including reference
functions; single-resource is a measurement-setup property. Case views should
conform to the
[ShareableViewDefinition](https://build.fhir.org/ig/HL7/sql-on-fhir/StructureDefinition-ShareableViewDefinition.html)
profile — every column carries a `type`, and that `type` must match the FHIR type
the path returns — so cases run unchanged on strongly-typed engines. The `sof-js`
reference runner ignores `column.type`, so this is not enforced here; a
second-runner mismatch (e.g. Pathling) is the signal. Purely low-multiplicity
(demographic-root) datasets are capped at 10k patients — they are row-starved at
small populations and their larger sizes wait on a download kind. A dataset that
roots at least one measurement-critical case on a high-multiplicity clinical
resource (`Condition`, `Observation`, `Encounter`) may exceed that ceiling: for
example `clinical-wide` declares an `xl` tier of 100k patients, which yields
millions of rows. `xl` is opt-in per run (`--size xl`) and heavier to generate
(~10× the `l` tier in time and disk). Referenced datasets, QR/download kinds,
referentially-consistent multi-resource datasets, and result checksums are
future extensions. See `../docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`.
