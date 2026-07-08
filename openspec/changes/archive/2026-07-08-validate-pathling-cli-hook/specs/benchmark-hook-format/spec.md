# benchmark-hook-format — delta (validate-pathling-cli-hook)

Doc gap found validating the Pathling CLI staging hook: the contract says a
`run` must "FULLY WRITE the flat result as a CSV file at `outCsv`" and that the
harness "counts its rows", but it never states the two properties the harness
actually depends on — that the result is a SINGLE file (not a directory of
Spark/Hadoop part files) and that it carries a HEADER row (the harness counts
data rows as line-count-minus-one). Pathling's `pathling view` satisfies both
only because it offers `--departition` (coalesce to one file) and writes a
header; an engine whose native writer emits a directory of headerless part
files would fail verification for a non-obvious reason (a directory read error,
or a silent off-by-one undercount). The behaviour was already fixed and tested
(`benchmark/tools/harness/csv-count.js`,
`benchmark/tests/harness-csv.test.js`); this delta only makes the requirement
explicit, so no harness behaviour changes.

## ADDED Requirements

### Requirement: Result CSV output format

A `run` — in every lifecycle mode (spawn, connect, or CLI) — SHALL write its
flat result as exactly ONE CSV file at `outCsv`: a regular file, never a
directory of part files. The file SHALL follow RFC-4180 (comma-separated
fields, fields containing a comma, double quote, or newline wrapped in double
quotes, and embedded double quotes escaped by doubling). Its first line SHALL
be a HEADER row naming the result columns; the harness derives the output row
count as the number of data lines BELOW that header, so a zero-row result is
either an empty file or a header-only file. An engine whose native writer emits
a directory of part files (e.g. a Spark or Hadoop writer) MUST coalesce that
output into a single headed file before responding — for example Pathling's
`pathling view --departition`.

#### Scenario: A single headed CSV is counted by its data rows

- **WHEN** a `run` writes a CSV file at `outCsv` whose first line is a header
  and which has N data lines below it
- **THEN** the harness's output row count for that case is N

#### Scenario: A zero-row result is an empty or header-only file

- **WHEN** a view produces no rows
- **THEN** the hook writes either an empty file or a file containing only the
  header line at `outCsv`, and the harness counts zero rows

#### Scenario: A headerless CSV violates the contract

- **WHEN** an engine writes its N result rows to `outCsv` with no header line
- **THEN** the harness counts N-1 rows (an off-by-one undercount), so a header
  row is required for the count to be correct
