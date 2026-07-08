# Findings — Pathling Server hook validation

Target: Pathling **Server** `ghcr.io/aehrc/pathling:latest` (engine
`Pathling` version `2.0.1+78a3f75`, FHIR `4.0.1`), run as a Docker container on
macOS (Apple Silicon), Java/Spark inside the image. Adapter:
`pathling-server-hook.js` (Bun), translating the five-command HTTP hook protocol
to Pathling's REST API. Suite: `clinical-flat`, sizes `s` and `m`.

This is the deep protocol test — the only one of the three siblings exercising
the full `capabilities` / `prepare` / `run` / `reset` / `shutdown` HTTP protocol
and both lifecycle modes (connect and spawn). Outcomes per the taxonomy in
`../README.md`.

## 1. The HTTP hook protocol maps cleanly onto Pathling's REST API — **no contract change (clean pass)**

The five commands translate one-to-one to published Pathling operations, with a
thin Bun adapter (the HTTP-hook analog of the CLI shims — the role
`sof-js/src/hook.js` plays for the reference):

- `prepare` → `POST {base}/$import` with `saveMode: overwrite`,
  `Prefer: respond-async` (import is mandatory-async), then poll the returned
  `$job` URL to completion. Sources are `file://` URLs under the server's
  `pathling.import.allowableSources` allowlist.
- `run` → `POST {base}/$viewdefinition-run` (synchronous) with the case's
  ViewDefinition as `viewResource` and `Accept: text/csv`; the CSV stream is
  written verbatim to `outCsv`.
- `reset` → best-effort (see finding 2); `shutdown` → stop the owned container
  (spawn) then exit; `capabilities` → the scenarios the deployment can honour.

Both `clinical-flat` cases produce checkfile-exact counts at both sizes in both
modes (`s` 6406/4366, `m` 48908/39479). The declared `column.type`s
(`string`, `code`) and `getResourceKey()` / `.first()` FHIRPath are honoured by
the server exactly as they were by the CLI. No protocol friction; the contract
needed no change to accommodate a real, independent HTTP implementation.

## 2. `reset` honesty for a Spark server — **no contract change (contract validated)**

The headline spec-stress question: *is `reset` honest for a Spark-backed
server, or must the hook omit `end_to_end` in connect mode rather than ship warm
numbers as cold?* Pathling offers **no REST bulk-clear** (no drop/truncate/reset
operation exists — only per-instance `DELETE`, per-type `$import` overwrite, or
discarding the warehouse and restarting), and a long-lived server keeps its
JVM/Spark session and dataset caches warm across samples. So a connect-mode
`end_to_end` "cold" sample **cannot** be honestly cold.

The contract already prescribes exactly the honest answer, and this validation
confirms it is right and implementable:

- *Reset discards prepared state* (`benchmark-hook-format`): "A hook whose
  deployment cannot honour reset semantics SHALL omit from `capabilities` any
  scenario the harness would drive with `reset` for that lifecycle mode."
- *Scenario declaration matches architectural capability*: "`end_to_end`
  requires returning to dataset-cold before each sample — by service restart
  (spawn mode), by an honoured `reset` (connect mode), or by construction" and
  "SHOULD ship one manifest per deployment, distinguished by
  `implementation.variant`."

So the adapter ships **two manifests**: `hook.connect.json` (connect) declares
only `preloaded_repeated`, and `hook.spawn.json` (spawn) declares
`preloaded_repeated` + `end_to_end`, coldness obtained by construction (a fresh,
empty container per sample). The harness enforces this: driving `end_to_end`
against the connect manifest is refused up front —
`hook does not declare scenario "end_to_end" (declares: preloaded_repeated)` —
so no dishonest cold number can ever be emitted. The contract's reset/scenario
requirements needed no change; the Spark-server case is precisely the case they
were written for.

## 3. "A second `prepare` REPLACES the prepared dataset" is implementable — **no contract change (contract validated)**

`$import` with `saveMode: overwrite` deletes all existing resources of the
imported type and replaces them with the file contents. The adapter uses
overwrite unconditionally, so a repeated `prepare` of the same type replaces its
predecessor with no residue — exactly the *Repeated prepare replaces the
dataset* requirement. This is also why the connect-mode `reset` no-op is honest:
freshness of the queried types is carried by `prepare`'s overwrite, and the
scenario that would demand a true cold reset (`end_to_end`) is simply not
declared in connect mode.

## 4. `preloaded_repeated` means what the README claims for a caching server — **no contract change (contract validated)**

`preloaded_repeated` prepares OUTSIDE the timed region and then times `run`
round-trips; warmth across samples is the *point* of the scenario, not a
distortion. Against the warm server the medians are tiny and query-bound —
tens of ms at `s` (66/76 ms), a few hundred ms at `m` (228/158 ms) — and the
advisory `phaseSamplesMs` confirm it: the `execute` phase is essentially the
whole sample (~66 ms at `s`, ~160–230 ms at `m`) while `extract` (writing the
buffered CSV) is well under 1 ms. These are exactly warm per-query numbers,
distinct from the cold end-to-end cost, and `implementation.variant: server`
marks them as a different deployment from the CLI's per-invocation cold numbers.

## 5. Cold `end_to_end` via spawn: boot is untimed, cold ETL is timed — **no contract change (decision validated)**

In spawn mode the harness restarts a fresh adapter — hence a fresh, empty
Pathling container — per `end_to_end` sample, so coldness is by construction.
The container boot (~5.5 s to a serving FHIR endpoint) lands in the harness's
UNTIMED spawn/readiness region ("VM boot is not ETL cost"); the timed region is
`prepare` (`$import`) + `run` (`$viewdefinition-run`). The samples bear this out:
`s` ~8.3–8.6 s and `m` ~13.3–13.8 s per sample, of which the advisory `execute`
phase (the first, cold Spark query) is ~2.0–3.4 s and the balance is the cold
`$import`. This is the deliberate load-boundary decision working as designed for
a service that owns its own engine lifecycle.

## 6. Spawn readiness budget was adequate — **observation (no contract change)**

The design flagged the harness's spawn readiness budget (default 30 s, and not
exposed on the harness CLI) as possibly too short for a Spark boot. It was not:
Pathling answers `GET /fhir/metadata` in ~5.5 s cold, well inside the budget, and
the adapter opens its own port only after the server is ready, so the harness's
readiness poll lines up with genuine readiness. Recorded as an observation, not
a defect: on a slower host or a heavier engine a >30 s boot would exhaust a
non-configurable budget, but that limit did not bite here and fixing an
unexercised limit would be scope creep. No change forced.

## 7. Container plumbing notes — **environment observations (no contract change)**

- **`--mount`, not `-v …:ro`.** Docker mis-parsed the `-v <src>:<dst>:ro`
  short form for absolute paths, landing the bind at a corrupted destination
  (`…/data` → `…/datao`) so `$import` could not see the files. The adapter and
  the README both use the explicit
  `--mount type=bind,source=…,target=…,readonly` form. Adapter/tooling detail,
  not a benchmark-contract concern.
- **Identity mount + `allowableSources`.** The container mounts the host data
  root at an identical absolute path and sets
  `pathling.import.allowableSources=file://<dataRoot>/`, so the adapter passes
  `file://<dataDir>/<Resource>.ndjson` verbatim with no path-translation
  contract. Machine-local prerequisite (staging hooks are temporary,
  machine-local scaffolding).
- **Buffered CSV write, not `Bun.write(outCsv, res)`.** Streaming the
  `$viewdefinition-run` response body straight to disk with
  `Bun.write(path, response)` spins at 100% CPU indefinitely on Pathling's
  chunked transfer encoding (the view-run operation is a `manualResponse`
  chunked stream). The adapter buffers the body (`res.text()`) and writes it in
  one call, which is correct and fast at these result sizes. Adapter/tooling
  detail, not a benchmark-contract concern.
- **Version scheme differs across deployments.** The server reports engine
  version `2.0.1+78a3f75` where the CLI cycle recorded `9.9.0.dev` for the same
  engine "Pathling". `implementation.variant` (`server` vs `cli`) is exactly the
  disambiguator that keeps the two deployments' reports from being conflated;
  each report carries its own deployment's honest version.

## 8. The run-output CSV contract (added by the CLI cycle) generalizes to the HTTP hook — **no contract change (contract validated)**

`$viewdefinition-run` returns a single CSV document with a header row
(`header=true`), which the adapter writes verbatim to `outCsv` — one regular
file, header line, RFC-4180 body. The *Result CSV output format* requirement the
Pathling **CLI** cycle added to `benchmark-hook-format` (single file, header
row) is satisfied by the **server** path with no per-hook effort, confirming that
delta was the right, deployment-neutral shape.

## Pass record

All runs `--strict` (materialized data verified against the checkfile sha256
locks first); row counts are the harness's own, counted from the written CSV
against the checkfile.

| mode    | scenario           | size | result |
| ------- | ------------------ | ---- | ------ |
| connect | preloaded_repeated | `s`  | **verified clean pass** — both cases `ok`/`verified`, 6406 / 4366 (checkfile-exact), 1 warmup + 5 samples; report valid against `benchmark-report.schema.json`, JMH export well-formed (`variant: server` in `params`). |
| connect | preloaded_repeated | `m`  | **verified clean pass** — 48908 / 39479 (checkfile-exact); report + JMH valid. |
| spawn   | end_to_end         | `s`  | **verified clean pass** — 6406 / 4366 (checkfile-exact), 0 warmup + 5 samples (fresh container per sample); no leaked containers; report + JMH valid. |
| spawn   | end_to_end         | `m`  | **verified clean pass** — 48908 / 39479 (checkfile-exact); report + JMH valid. |

No tool defect, no benchmark-case defect, **and no contract change of any kind
was forced** — every spec-stress point the design raised (reset honesty,
prepare-replaces, `preloaded_repeated` warmth, expensive-startup readiness) was
answered by the contract as it already stands. This is the deep protocol test
passing clean: a strong signal that the benchmark contract's HTTP-hook,
lifecycle-mode, and scenario-honesty requirements are correct and implementable
against a real, independent, Spark-backed server. The teardown change owns
whether this constitutes the exercise's "quiet round" exit criterion.

### Timing (Apple M-series, Docker, 5 samples/case)

`preloaded_repeated` times a warm `run` round-trip (prepare excluded);
`end_to_end` times one cold `$import` + `$viewdefinition-run` per sample
(container boot untimed). Report the **median**.

| mode    | scenario           | size | case                   | rows  | median   | mean     | min–max        |
| ------- | ------------------ | ---- | ---------------------- | ----- | -------- | -------- | -------------- |
| connect | preloaded_repeated | `s`  | condition-flat         | 6406  | 66 ms    | 83 ms    | 57–116 ms      |
| connect | preloaded_repeated | `s`  | observation-components | 4366  | 76 ms    | 90 ms    | 69–140 ms      |
| connect | preloaded_repeated | `m`  | condition-flat         | 48908 | 228 ms   | 263 ms   | 161–359 ms     |
| connect | preloaded_repeated | `m`  | observation-components | 39479 | 158 ms   | 175 ms   | 154–242 ms     |
| spawn   | end_to_end         | `s`  | condition-flat         | 6406  | 8328 ms  | 8332 ms  | 8167–8482 ms   |
| spawn   | end_to_end         | `s`  | observation-components | 4366  | 8618 ms  | 8625 ms  | 8400–8872 ms   |
| spawn   | end_to_end         | `m`  | condition-flat         | 48908 | 13305 ms | 13650 ms | 12655–15101 ms |
| spawn   | end_to_end         | `m`  | observation-components | 39479 | 13754 ms | 13838 ms | 13442–14382 ms |

**Warm vs cold, honestly separated.** The connect/`preloaded_repeated` numbers
are warm per-query cost (tens to hundreds of ms; the server holds prepared
state and caches). The spawn/`end_to_end` numbers are the honest cold cost of a
full ingest + query per sample (seconds), with container boot excluded as
untimed startup. The two are the same engine measured under two different,
correctly-labelled deployments (`variant: server`), never conflated — exactly
what the scenario/variant contract is for.
