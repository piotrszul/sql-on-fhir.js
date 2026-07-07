# Findings — flatquack CLI hook validation

Target: flatquack (aehrc/flatquack) `staging/master-fix` @ 8a66e46 (v0.2.1),
Bun 1.3.1, DuckDB binding ^1.4.1, macOS (Apple Silicon). Hook:
`hook.json` + `flatquack-hook.sql` in this directory (machine-local absolute
path to the flatquack checkout — see README.md). Suite: `clinical-flat`,
scenario `end_to_end` (the only scenario a CLI hook declares), sizes `s`, `m`.

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

## 2. Single-view selection is inexpressible for a directory-globbing CLI — **contract gap** (deferred by decision)

The template offers `{viewFile}` (one file, in a work dir that accumulates
`view-N.json` files across a session), but flatquack selects input as
*directory + glob* (`--view-path` on a file dies with `ENOTDIR`; globbing the
work dir would re-run every accumulated view). No placeholder for "the
directory containing exactly this view" exists. Resolution chosen: express it
inside the current contract with the `..{viewFile}` idiom —
`--view-path / --view-pattern "..{viewFile}"` — which resolves the one view
file as a fully-literal pattern (no filesystem walk, ~0.3 s). The idiom leans
on undocumented behaviour (Bun's `Glob.scanSync` tolerating a `..` segment;
root being its own parent), so it is a workaround, not a pattern to canonize.
**Deferred decision, to reconsider at the end of the three-cycle exercise:**
add a `{viewDir}` placeholder backed by a fresh per-run directory (any
directory-shaped tool then works unmodified), versus a flatquack single-file
affordance. Independent corroboration that the friction is real: the
`sof-benchmark` harness had to isolate each view in a private temp dir for
the same reason.

## 3. Intermittent Bun/duckdb segfault at process exit — **tool defect** ([aehrc/flatquack#42](https://github.com/aehrc/flatquack/issues/42))

flatquack crashes *after* the CSV is fully and correctly written (Bun panic
in teardown; exit 133 = SIGTRAP). Rate scales with data size: at size `s`
roughly 1 in 4–10 invocations (a full 10-spawn pass needed 3 attempts); at
size `m` it killed every harness sample (3/3), so **the size-`m` pass is
blocked pending the upstream fix**. The harness's failure isolation behaved
exactly as specified — per-case `execution_error` ("engine process was
killed by SIGTRAP"), run continues, report still schema-valid. Worked around
here by re-running; to be re-validated once the fix lands.

## 4. Exit 0 on SQL execution failure — **tool defect** ([aehrc/flatquack#43](https://github.com/aehrc/flatquack/issues/43))

`--mode run` logs DuckDB errors with `console.warn`, prints
`Completed in N ms`, and exits 0 with no CSV written — indistinguishable
from success by exit status, violating the CLI-mode contract ("exit 0 with
the CSV fully written means success"). Contract-side mitigation already in
place: the harness counts rows from the produced file against the checkfile,
so this surfaces as a missing-output failure rather than a false pass.

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

| size | result |
| ---- | ------ |
| `s`  | **verified clean pass** — both cases `ok`, `verified: true`, rows 6406 / 4366 (checkfile-exact), 5 samples each, report valid against `benchmark-report.schema.json`, JMH export well-formed (identity in `params`, rows as secondary metric). Achieved on attempt 3; attempts 1–2 lost a case each to finding 3. |
| `m`  | **blocked** by finding 3 (every sample SIGTRAPs at ~49k/100k resources). Manual single runs produce checkfile-exact 48908 rows for `condition-flat` when they survive. To re-run after aehrc/flatquack#42 is fixed. |
