# Delta specs — validate-pathling-cli-hook

One capability delta: `benchmark-hook-format/spec.md`.

Validating the Pathling CLI staging hook was a **clean, near-zero-glue pass** —
`pathling view` fits the `{dataDir}` / `{viewFile}` / `{outCsv}` template
directly (no adapter, unlike flatquack), and both `clinical-flat` cases verify
with checkfile-exact counts at sizes `s` and `m`. The one finding that touches
the contract is a **doc gap**: the run-output contract never stated that the
CSV at `outCsv` must be a single file carrying a header row, even though the
harness has always depended on both (and tests them in
`benchmark/tests/harness-csv.test.js`). The delta makes that requirement
explicit — it codifies already-tested behaviour, so no harness behaviour
changes and no test-first was required beyond the header-contract regression
test added alongside.

The remaining findings force no contract change and carry no delta: the
predicted `column.type` / ShareableViewDefinition case defect did not
materialize (Pathling accepted the typed views with exact counts), and the
"timed region includes process startup" decision held (JVM+Spark boot
dominates each `end_to_end` sample, which is the honest cost of a one-off CLI
run and is recorded by `implementation.variant: cli`). See
`benchmark/staging-hooks/pathling-cli/FINDINGS.md`.
