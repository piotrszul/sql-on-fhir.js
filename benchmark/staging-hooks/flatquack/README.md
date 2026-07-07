# flatquack staging hook

CLI-mode benchmark hook for [flatquack](https://github.com/aehrc/flatquack)
(Bun + DuckDB). The pieces:

- `hook.json` — CLI-mode manifest. Runs the adapter and carries the one
  machine-local knob as an env var.
- `flatquack-hook.js` — a thin adapter (the CLI-hook analog of
  `sof-js/hook.js`): isolates the harness's single `{viewFile}` in a fresh
  temp dir so flatquack's directory-glob CLI selects exactly it, then reports
  success by whether the output CSV was written (see FINDINGS.md entries 2–4).
- `flatquack-hook.sql` — declarative SQL template bridging flatquack's
  input/output shape to the harness (`--param fq_input_dir` / `fq_out_csv`).

**Machine-local path.** Staging hooks are temporary, machine-local
scaffolding (see `../README.md`). The single machine-specific value is
`env.FLATQUACK_CLI` in `hook.json` — the absolute path to your flatquack
checkout's `src/cli.js`. Edit that one line to point at yours (branch with
current fixes: `staging/master-fix`; run `bun install` in the checkout).
Everything else is portable: the manifest's `cwd` defaults to this directory,
so the adapter and SQL template resolve relatively.

Run the pass from the repo root (CLI hooks declare only `end_to_end`):

```
bun run bench:harness run --hook benchmark/staging-hooks/flatquack/hook.json \
    benchmark/clinical-flat.json --size s --scenario end_to_end --out report-s.json
```
