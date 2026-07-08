# Findings — Pathling CLI hook validation

Target: Pathling (aehrc/pathling) `main` @ b9d9d78, engine `9.9.0.dev`
(local dev build; runtime coordinate
`au.csiro.pathling:library-runtime:9.9.0-SNAPSHOT` resolved from `~/.m2`),
Python 3.12 + `pyspark 4.0.3`, Java 21, macOS (Apple Silicon). Hook:
`hook.json` only — no adapter. Suite: `clinical-flat`, scenario `end_to_end`
(the only scenario a CLI hook declares), sizes `s`, `m`.

Driven through Pathling's published CLI:
`pathling view {dataDir} --from ndjson --view {viewFile} --format csv
--departition --overwrite -o {outCsv}`.

Outcomes per the taxonomy in `../README.md`.

## 1. `pathling view` fits the CLI contract directly — **no contract change (zero glue)**

Where the flatquack hook needed a per-engine adapter (`flatquack-hook.js`) to
bridge its directory-glob CLI, Pathling's `pathling view` matches the
`{dataDir}` / `{viewFile}` / `{outCsv}` template with no code at all:

- `{dataDir} --from ndjson` — reads the materialized `<ResourceType>.ndjson`
  directory (`pc.read.ndjson`); `--from ndjson` is explicit so the sibling
  `manifest.json` cannot perturb format auto-detection.
- `--view {viewFile}` — the harness-written ViewDefinition file.
- `--departition --format csv -o {outCsv}` — Spark's native CSV writer emits a
  directory of part files; `--departition` (Pathling's default) coalesces them
  into a single file at exactly the `-o` path, written with a header row
  (`option("header","true")`) — precisely the single-headed-CSV the harness's
  `countCsvRows` expects.
- `--overwrite` — `end_to_end` reuses one `{outCsv}` path across a case's
  samples, so each fresh invocation must replace the previous file.

This is the CLI-hook analog of `sof-js/hook.json` being a pure manifest: the
engine's own CLI is contract-shaped, so the hook carries no bridging code and
is exactly what Pathling's hook will keep after migration.

## 2. The run-output CSV contract was underspecified — **doc gap** (fixed here)

Finding 1 works only because `pathling view` offers `--departition` and writes
a header. The contract (`benchmark-hook-format`) said a `run` must "FULLY WRITE
the flat result as a CSV file at `outCsv`" and that the harness "counts its
rows", but never stated the two properties the harness actually depends on:

- the result is a **single file**, not a directory of part files
  (`countCsvRows` does `readFileSync(outCsv)`), and
- the CSV carries a **header row** (`countCsvRows` counts data lines *below*
  the header, so a headerless file is silently undercounted by one).

A Spark/Hadoop-style engine that writes a directory of headerless part files
would fail verification for a non-obvious reason. The behaviour was already
correct and tested (`tools/harness/csv-count.js`, `tests/harness-csv.test.js`),
so this is a wording gap, not a behaviour defect. Fixed here:

- delta spec adds the explicit **"Result CSV output format"** requirement to
  `benchmark-hook-format`
  (`openspec/changes/validate-pathling-cli-hook/specs/benchmark-hook-format/spec.md`),
- `benchmark/README.md`'s CLI section gains the single-file + header-row note
  (with the `--departition` idiom called out for Spark-style writers), and
- a regression test in `tests/harness-csv.test.js` ("a headerless CSV is
  undercounted") pins *why* the header is a contract requirement.

No harness behaviour changes. This directly de-risks the forthcoming
Pathling **server** cycle, whose Spark-backed adapter must departition.

## 3. Timed region includes JVM+Spark startup — **no contract change (decision validated)**

The design's headline stress point. `end_to_end` times one fresh `pathling
view` invocation per sample, so the region includes the full JVM boot + Spark
session creation + Ivy classpath assembly on top of the (tiny) view
evaluation. Boot dominates: ~6 s per sample at `s`, ~7–8.5 s at `m`, while the
data itself is a small increment on top of that fixed floor. This is the
honest cost of a one-off CLI run, not warm per-query cost — the harness's
warmup/sample statistics stay meaningful (report the **median**), and
`implementation.variant: cli` marks these numbers as a different deployment
from a warm server (`preloaded_repeated`), which will amortize the boot floor
away. The deliberate "timed region includes process startup" decision holds.

## 4. Predicted `column.type` / ShareableViewDefinition case defect did NOT materialize — **no benchmark-case defect**

The design anticipated the "second-runner signal" — a strongly-typed engine
rejecting the benchmark case views or diverging on typed columns. It did not
occur:

- Both `clinical-flat` views declare `column.type` (`string`, `code`) and use
  `getResourceKey()` and `.first()` FHIRPath; Pathling honours all of them and
  produces checkfile-exact row counts.
- The ShareableViewDefinition metadata (`url` / `name` / `status` /
  `fhirVersion`) the profile mandates was already added by the flatquack cycle,
  so the typed engine had no missing-metadata objection to raise.

The forward flow of contract fixes (flatquack's metadata fix reaching this
cycle's base branch) is exactly why the ordering rule exists.

## 5. Not a self-contained binary — **environment observation (no contract change)**

Unlike flatquack (a Bun+DuckDB binary), the Pathling CLI hook needs a
Python venv + `pyspark 4.0` + Java, and Spark resolves the Pathling + Delta
jars via Ivy on first launch (network; then cached in `~/.ivy2`). This is
inherent to a JVM/Spark engine and is not a contract concern — the CLI-mode
contract already acknowledges interpreter/JVM boot. Recorded so the machine-
local prerequisites (see this directory's README) are explicit; the single
machine-specific value in `hook.json` is the absolute path to the venv
`pathling`.

## Pass record

Pure `hook.json`, `--strict` (data verified against the checkfile sha256 locks
first); row counts are the harness's own, counted from the written CSV against
the checkfile.

The change's scope is sizes `s` and `m`; `l` (10k population, 463 MB / 968 MB
NDJSON) was run additionally to confirm the pass holds at scale.

| size | result |
| ---- | ------ |
| `s`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 6406 / 4366 (checkfile-exact), 5 samples each; report valid against `benchmark-report.schema.json`, JMH export well-formed (identity in `params`, timing as the primary metric). |
| `m`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 48908 / 39479 (checkfile-exact), 5 samples each; report + JMH valid. |
| `l`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 459611 / 390615 (checkfile-exact), 5 samples each; report + JMH valid. |

No tool defect, no benchmark-case defect, and no behavioural contract change
was forced. The only contract-doc change is the finding-2 clarification of the
(already-tested) output-CSV format; the teardown change owns whether the
exercise's "quiet round" exit criterion is met given that clarification.

### Timing (Apple M3 Pro, Java 21, Spark 4.0.3, `end_to_end`, 5 samples/case)

`end_to_end` times one fresh CLI invocation per sample, so the region
**includes JVM + Spark process startup**. Report the **median**.

| size | case | rows | median | mean | min–max |
| ---- | ---- | ---- | ------ | ---- | ------- |
| `s`  | condition-flat | 6406 | 5959 ms | 6037 ms | 5851–6243 |
| `s`  | observation-components | 4366 | 6696 ms | 6659 ms | 6538–6735 |
| `m`  | condition-flat | 48908 | 7136 ms | 7225 ms | 6738–7901 |
| `m`  | observation-components | 39479 | 8535 ms | 8353 ms | 7665–9048 |
| `l`  | condition-flat | 459611 | 7666 ms | 7896 ms | 7406–8827 |
| `l`  | observation-components | 390615 | 9930 ms | 10027 ms | 9583–10748 |

**Boot floor, with the data cost a small increment on top.** Every sample pays
~6 s of fixed JVM+Spark startup; condition-flat grows 5959→7136→7666 ms and
observation-components (a `forEach` unnest over `component`) 6696→8535→9930 ms
as the data grows `s`→`m`→`l`. Even at `l` (463 MB / 968 MB NDJSON) the boot
floor dominates a plain projection — condition-flat reaches only ~7.7 s, so
reading and projecting 463 MB costs under ~2 s on top of boot; the `forEach`
unnest over the 968 MB Observation file is the one genuinely data-bound case
(~4 s above the floor). These CLI numbers are not comparable to a warm/server
(`preloaded_repeated`) deployment, which amortizes the startup floor away —
that is what `implementation.variant: cli` records.
