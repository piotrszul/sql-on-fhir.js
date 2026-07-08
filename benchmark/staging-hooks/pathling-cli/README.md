# Pathling CLI staging hook

CLI-mode benchmark hook for [Pathling](https://github.com/aehrc/pathling)
(JVM + Apache Spark), driven through its published `pathling` command-line
interface. The whole hook is a manifest — no adapter code:

- `hook.json` — CLI-mode manifest. Runs
  `pathling view {dataDir} --from ndjson --view {viewFile} --format csv
  --departition --overwrite -o {outCsv}`. `--departition` coalesces Spark's
  part-file directory into the single headed CSV the harness counts;
  `--overwrite` lets `end_to_end` reuse one `{outCsv}` across a case's samples.

Unlike the flatquack hook, `pathling view` fits the `{dataDir}` / `{viewFile}`
/ `{outCsv}` contract directly, so there is no per-engine adapter.

**Machine-local path & prerequisites.** Staging hooks are temporary,
machine-local scaffolding (see `../README.md`). This hook is heavier than a
self-contained binary — it needs a JVM/Spark toolchain:

- **Python 3.9–3.12** with the `pathling` package and `pyspark 4.0` installed
  in a venv. The single machine-specific value is `cli.run[0]` in `hook.json`:
  the absolute path to that venv's `pathling` executable. Edit that one line to
  point at yours.
- **Java** (21 used here) on the PATH — Spark's driver JVM.
- **First-run network**: on the first `pathling view`, Spark resolves the
  Pathling library-runtime and Delta jars via Ivy
  (`au.csiro.pathling:library-runtime`, `io.delta:delta-spark_2.13`) and caches
  them under `~/.ivy2`. The dev build (`9.9.0-SNAPSHOT`) resolves
  library-runtime from the local `~/.m2`; a published release resolves it from
  Maven Central.

Run the pass from the repo root (CLI hooks declare only `end_to_end`):

```
bun run bench:harness run --hook benchmark/staging-hooks/pathling-cli/hook.json \
    benchmark/clinical-flat.json --size s --scenario end_to_end --strict \
    --out report-s.json
```
