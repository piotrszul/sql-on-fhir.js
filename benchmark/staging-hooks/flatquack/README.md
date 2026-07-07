# flatquack staging hook

CLI-mode benchmark hook for [flatquack](https://github.com/aehrc/flatquack)
(Bun + DuckDB). Zero code: `hook.json` (argv template) plus
`flatquack-hook.sql`, a declarative SQL template that bridges flatquack's
input/output shape to the hook contract (`--param fq_input_dir={dataDir}`,
`--param fq_out_csv={outCsv}`).

**Machine-local path.** Staging hooks are temporary, machine-local
scaffolding (see `../README.md`). The `cli.run` argv references a flatquack
checkout by absolute path — edit that element to point at yours (branch with
current fixes: `staging/master-fix`; run `bun install` in the checkout). The
argv template deliberately has no environment expansion, and the manifest's
`cwd` must stay defaulted to this directory so `--template flatquack-hook.sql`
resolves.

Run the pass from the repo root:

```
bun run bench:harness run --hook benchmark/staging-hooks/flatquack/hook.json \
    benchmark/clinical-flat.json --size s --out report-s.json
```

View selection uses `--view-path / --view-pattern "..{viewFile}"` — the
`..`-prefixed literal pattern is how a directory-globbing CLI addresses the
single view file the harness materializes; see FINDINGS.md for why and for
the deferred `{viewDir}` alternative.
