# Findings — flatquack CLI hook validation

Target: flatquack (aehrc/flatquack) `staging/master-fix` @ 8a66e46 (v0.2.1),
Bun 1.3.1, DuckDB binding ^1.4.1, macOS (Apple Silicon). Hook:
`hook.json` + `flatquack-hook.js` (thin adapter) + `flatquack-hook.sql` in
this directory (machine-local flatquack path in `env.FLATQUACK_CLI` — see
README.md). Suite: `clinical-flat`, scenario `end_to_end` (the only scenario
a CLI hook declares), sizes `s`, `m`.

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

## 3. Intermittent Bun/duckdb segfault at process exit — **tool defect** ([aehrc/flatquack#42](https://github.com/aehrc/flatquack/issues/42))

flatquack crashes *after* the CSV is fully and correctly written (Bun panic
in teardown; exit 133 = SIGTRAP). Rate scales with data size: at size `s`
roughly 1 in 4–10 invocations; at size `m` it killed *every* raw harness
sample (the pass could not complete without an adapter).

Worked around by `flatquack-hook.js`, which defines success as "the CSV was
written" and ignores flatquack's exit code — so a crash after a correct write
is a pass, and the harness's independent row count still guards against a
truncated write (→ `count_mismatch`, not a false pass). This unblocks both
sizes (see pass record). **Caveat:** on a crashed sample the harness-timed
region now includes Bun's panic/backtrace printing, so the *timing* from this
hook is not trustworthy flatquack performance until #42 is fixed — the
adapter buys a complete, count-verified pass, not clean numbers. Also filed
upstream; drop the mask and re-time once fixed.

## 4. Exit 0 on SQL execution failure — **tool defect** ([aehrc/flatquack#43](https://github.com/aehrc/flatquack/issues/43))

`--mode run` logs DuckDB errors with `console.warn`, prints
`Completed in N ms`, and exits 0 with no CSV written — indistinguishable
from success by exit status, violating the CLI-mode contract ("exit 0 with
the CSV fully written means success"). Two layers catch it here: the harness
counts rows from the produced file against the checkfile (a missing file
never verifies), and `flatquack-hook.js` — which keys success off the output
CSV's existence — turns flatquack's dishonest exit 0 into an honest non-zero
exit when no CSV was written.

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

Both via `flatquack-hook.js` (segfault masked per finding 3; row counts are
the harness's own, counted from the written CSV against the checkfile).

| size | result |
| ---- | ------ |
| `s`  | **verified pass** — both cases `ok`, `verified: true`, rows 6406 / 4366 (checkfile-exact), 5 samples each; report valid against `benchmark-report.schema.json`, JMH export well-formed (identity in `params`, rows as secondary metric). |
| `m`  | **verified pass** — both cases `ok`, `verified: true`, rows 48908 / 39479 (checkfile-exact), stable across 3 repeat runs. Previously blocked by finding 3; the adapter's output-based success signalling unblocks it. |

**Timing is not trustworthy yet** (finding 3): crashed samples carry Bun's
panic overhead in the timed region. The pass proves the *contract* works
end-to-end at both sizes with verified row counts; publishable flatquack
numbers wait on aehrc/flatquack#42.
