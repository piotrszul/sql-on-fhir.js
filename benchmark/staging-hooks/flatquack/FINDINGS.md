# Findings — flatquack CLI hook validation

Target: flatquack (aehrc/flatquack) `staging/master-fix` @ 8a66e46 (v0.2.1),
Bun 1.3.1, DuckDB binding ^1.4.1, macOS (Apple Silicon). Hook:
`hook.json` + `flatquack-hook.js` (thin adapter) + `flatquack-hook.sql` in
this directory (machine-local flatquack path in `env.FLATQUACK_CLI` — see
README.md). Suite: `clinical-flat`, scenario `end_to_end` (the only scenario
a CLI hook declares), sizes `s`, `m`, `l`.

Outcomes per the taxonomy in `../README.md`.

## 1. Harness handed hooks a symlinked `{viewFile}` path — **contract defect**

On macOS the connector's work directory (under `os.tmpdir()`) sits behind the
`/var -> /private/var` symlink. Any engine that canonicalizes or glob-walks
the `{viewFile}` *string* (rather than opening it directly) observes a
different — or, for Bun's non-symlink-following glob, unreachable — file, and
flatquack's glob matched nothing while still exiting 0. Fixed here,
test-first: a shared `tools/harness/tempdir.js` (`makeEngineTempDir`)
canonicalizes every engine-facing temp directory, used by both the CLI
connector (holding `{viewFile}`) and the runner (holding `{outCsv}`) so the
guarantee holds for all lifecycle modes and both substituted paths, not just
the one path that first exposed it. The regression test forces a symlinked
`TMPDIR` (`tests/harness-cli-connector.test.js`), and the CLI-hook-mode
requirement gains the canonical-path guarantee (delta spec
`openspec/changes/validate-flatquack-hook/specs/benchmark-hook-format/spec.md`).

## 2. Single-view selection is inexpressible for a directory-globbing CLI — **no contract change (thin adapter)**

The template offers `{viewFile}` (one file, in a work dir that accumulates
`view-N.json` files across a session), but flatquack selects input as
*directory + glob* (`--view-path` on a file dies with `ENOTDIR`; globbing the
work dir would re-run every accumulated view). No placeholder for "the
directory containing exactly this view" exists.

Resolution: a thin per-engine adapter, `flatquack-hook.js`, copies the one
`{viewFile}` into a fresh temp dir and runs flatquack against it with its
real, documented CLI (`--view-path <dir> --view-pattern '*.json'`). This is
the same category as `sof-js/hook.js` bridging the HTTP contract — an
adapter, not a contract change — and it is exactly what flatquack's hook will
carry when it migrates to its own repo. It also drops an earlier workaround
that leaned on undocumented Bun-glob behaviour (`--view-path / --view-pattern
"..{viewFile}"`, relying on `Glob.scanSync` tolerating a `..` segment).
Independent corroboration that the friction is real, and the adapter the
right shape: the `sof-benchmark` harness isolates each view in a private temp
dir for the same reason.

**Contract question, still open for the exercise teardown:** whether to add a
`{viewDir}` placeholder (a fresh per-run directory) so a directory-globbing
tool needs *no* adapter at all. Not needed for flatquack given the adapter,
but worth deciding once all three targets are in.

**Adapter carries finding 1's own lesson:** the copy target
(`realpathSync(mkdtempSync(...))` in `flatquack-hook.js`) is canonicalized for
exactly the reason finding 1 canonicalizes `{viewFile}` — `tmpdir()` is a
`/var -> /private/var` symlink on macOS and flatquack glob-walks
`--view-path`. Under node's symlink-following glob an uncanonicalized dir
happens to work, but we don't lean on that. **Coverage gap:** unlike the
harness `{viewFile}` fix (which has a symlinked-`TMPDIR` regression test in
`tests/harness-cli-connector.test.js`), the adapter's canonicalization is
untested — the adapter lives outside the contract and a test would need a
flatquack install on the PATH. The guarantee is currently held by inspection,
not by a test; close this if/when the flatquack hook migrates to its own repo
with the tool available.

## 3. Intermittent Bun/duckdb segfault at process exit — **tool defect, FIXED upstream** ([aehrc/flatquack#42](https://github.com/aehrc/flatquack/issues/42))

flatquack crashed *after* the CSV was fully and correctly written (Bun panic
in teardown; exit 133 = SIGTRAP — the legacy `duckdb` native addon that Bun
cannot finalize cleanly). Rate scaled with data size: at size `s` roughly 1
in 4–10 invocations; at size `m` it killed *every* raw harness sample.

**Fixed upstream** (flatquack `master-fix`): the `run`/`explore` modes now
launch under **node** instead of Bun, which finalizes the addon cleanly. The
adapter (`flatquack-hook.js`) runs `node <cli> --mode run …`; 6/6 manual and
4/4 harness size-`m` runs exit 0 with no crash. flatquack's exit code is
therefore trustworthy again, so the adapter honours it (success requires exit
0 **and** a written CSV), and — crucially — the harness-timed region no longer
carries panic overhead, so **timing is now trustworthy**.

## 4. Exit 0 on SQL execution failure — **tool defect** ([aehrc/flatquack#43](https://github.com/aehrc/flatquack/issues/43))

`--mode run` logs DuckDB errors with `console.warn`, prints
`Completed in N ms`, and exits 0 with no CSV written — indistinguishable
from success by exit status, violating the CLI-mode contract ("exit 0 with
the CSV fully written means success"). Still open upstream (the #42 fix did
not touch it). Two layers catch it here: the harness counts rows from the
produced file against the checkfile (a missing file never verifies), and
`flatquack-hook.js` requires a written CSV in addition to a clean exit —
deleting any prior CSV first — so flatquack's dishonest exit 0 becomes an
honest non-zero when no output was produced.

## 5. README's illustrative CLI manifest invented a flatquack CLI — **doc gap**

`benchmark/README.md`'s CLI-mode example showed
`["flatquack", "--input", …, "--view", …, "--output", …]` — flags the real
tool does not have (its real invocation needs a template file, `--param`
bridging, and the finding-2 idiom). Fixed here: the example engine is now the
neutral `my-engine` with an explicit "illustrative — use your tool's real
flags" note.

## 6. Nothing said CLI hooks must run with `--scenario end_to_end` — **doc gap**

The harness's default scenario is `preloaded_repeated`, which a CLI hook
never declares, so a first `bench:harness run` against a CLI hook is refused
(loudly and correctly, but the "CLI tool? Zero code." section never said so).
Fixed here: the README's CLI section now states the required flag.

## 7. Benchmark case views were not ShareableViewDefinition-conformant — **benchmark-case defect**

`benchmark/README.md` claims case views conform to the
ShareableViewDefinition profile, but both `clinical-flat` views lacked the
profile-mandatory `url`, `name`, `status` and `fhirVersion`. flatquack
tolerated this (our template bypasses its `name`-derived output naming — the
stock `@csv` template would have emitted `undefined.csv`), but a validating
engine may refuse such views outright. Fixed here: both views now carry the
four elements; the re-blessed checkfile is byte-identical (metadata does not
affect rows).

## 8. sof-js rejected the spec-defined `fhirVersion` element — **tool defect** (sof-js — fixed here, its home repo)

Surfaced by fixing 7: the reference engine's ViewDefinition schema
(`sof-js/src/validate.js`) omitted `ViewDefinition.fhirVersion`, so it threw
`must NOT have additional properties` on views the Shareable profile
*requires* — a spec-fidelity defect in the reference implementation. Fixed
test-first: new shared conformance case "shareable metadata elements are
accepted" in `tests/validate.json` (fails on the old schema, passes now);
`fhirVersion` added to the schema.

## Pass record

Both via `flatquack-hook.js` (flatquack under node, per finding 3; row counts
are the harness's own, counted from the written CSV against the checkfile).

| size | result |
| ---- | ------ |
| `s`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 6406 / 4366 (checkfile-exact), 5 samples each; report valid against `benchmark-report.schema.json`, JMH export well-formed (identity in `params`, rows as secondary metric). |
| `m`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 48908 / 39479 (checkfile-exact), zero flakes across 4 repeat runs. |
| `l`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 459611 / 390615 (checkfile-exact), zero flakes across 3 repeat runs. The largest scale (442 MB / 923 MB NDJSON) is the strongest test of the #42 node fix — no crashes. |

With the #42 fix (finding 3), no sample crashes and timing carries no panic
overhead — so the numbers are meaningful, not just the row counts. Both sizes
pass on the first attempt with no retries. This closes the exercise's
size `s`/`m`/`l` exit criterion for this target with **no contract change
forced** by findings 2–4 (finding 1 remains the one contract defect fixed
here).

### Timing (Apple M3 Pro, node v25, `end_to_end`, 5 samples/case)

`end_to_end` times one fresh CLI invocation per sample, so the region
**includes node + DuckDB process startup** — the real cost of a one-off CLI
run, not warm per-query cost. Report the **median**.

| size | case | rows | median | mean | min–max |
| ---- | ---- | ---- | ------ | ---- | ------- |
| `s`  | condition-flat | 6406 | 291 ms | 312 ms | 279–397 |
| `s`  | observation-components | 4366 | 293 ms | 294 ms | 288–302 |
| `m`  | condition-flat | 48908 | 303 ms | 303 ms | 293–309 |
| `m`  | observation-components | 39479 | 373 ms | 371 ms | 358–378 |
| `l`  | condition-flat | 459611 | 363 ms | 410 ms | 358–607 |
| `l`  | observation-components | 390615 | 1135 ms | 1133 ms | 1101–1165 |

**Startup floor, then the data cost emerges at `l`.** condition-flat is nearly
flat `s`→`m` (291→303 ms) and only reaches 363 ms at `l` (459k rows from a
442 MB file) — a simple projection stays close to the fixed ~290 ms floor
(node boot, loading the 54 MB `duckdb.node` addon, parsing the 511 KB FHIR R4
schema, FHIRPath→SQL compile). observation-components, a `forEach` unnest over
`component`, is where scale shows: 293→373→**1135 ms** as the Observation
NDJSON grows to 923 MB — genuinely data-bound at `l`. These CLI numbers are
not comparable to a warm/server (`preloaded_repeated`) deployment, which
amortizes the startup floor away; that is what `implementation.variant`
(`cli-master-fix`) records.

The cold-start first-sample outlier recurs predictably at `l` too
(condition-flat 607 ms first sample vs 358–363 ms after) — same page-cache
first-touch effect described below, now over the larger data file.

**On the one outlier** (`s`/condition-flat max 397 ms, pulling its mean above
its median): a cold-start first-touch I/O cost paid only by the *first*
flatquack process of a session — chiefly loading the 54 MB `duckdb.node`
addon and the schema from cold page cache. It is **not** JIT warm-up (every
`end_to_end` sample is a fresh process, so nothing warms across samples), and
it does not reproduce once those files are page-cached: on warm re-runs the
first sample is instead the *fastest* (~255 ms). Use the median; the mean is
skewed by this one cold read.
