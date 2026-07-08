# Delta specs — validate-flatquack-hook

No capability deltas planned. This change validates existing capabilities
(benchmark-hook-format, benchmark-harness, benchmark-dataset-materialization,
benchmark-report-format, benchmark-suite-format) against a real external
engine; the planned outputs are staging scaffolding
(`benchmark/staging-hooks/flatquack/`) and findings, not contract changes.

Exploration resolved the one anticipated contract question — single-view
selection for a directory-globbing tool — *within* the existing contract (the
`..{viewFile}` idiom; see `../design.md` decision 1), and the encountered tool
defects are fixed upstream (aehrc/flatquack#42, #43), so no delta emerged
upfront. The deferred `{viewDir}` option is recorded in FINDINGS.md for
reconsideration at the end of the three-cycle exercise.

If implementation surfaces a finding whose outcome is **contract defect** or
**contract gap**, the fix lands in this change test-first WITH a delta spec
added beside this file (`<capability>/spec.md`), per the findings taxonomy in
`benchmark/staging-hooks/README.md`. A doc-gap fix (e.g. the README's
illustrative CLI example) needs no delta spec.
