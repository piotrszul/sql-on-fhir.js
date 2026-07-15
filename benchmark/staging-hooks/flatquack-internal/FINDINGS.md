# Findings — flatquack DuckDB-session internal benchmark

Target: the `add-measurement-plans` internal-reuse story — a custom measurement
plan (fork-per-trial, in-engine `table` sink, load inside the timed region,
warmups discarded, untimed engine-reported `count(*)`) driven through the
harness module entry point `runPlanSuite`, against a real engine (flatquack
`master-fix` @ 58f5126 compiling ViewDefinitions to DuckDB SQL; DuckDB CLI
v1.5.2; Bun 1.3.1; macOS/Apple Silicon). Suite: `clinical-flat`, sizes `s` and
`m`, both implementation identities.

Outcomes per the taxonomy in `../README.md`.

## Headline: the contract needed NO change — one quiet round for internal reuse

The whole exercise validated that the plan-driven executor, the honesty guard,
the two staging post-loop verbs (`count`/`extract`), and the internal-record
emission carry an internal-tuning benchmark **without any change to a public
contract** (no schema edit, no hook-protocol change, no official-scenario
addition). Every friction point below was inside the staging hook — my adapter
code — not the harness or its formats. This is the intended exit signal: the
plan vocabulary stays internal harness architecture until a later,
findings-informed contract change decides which parts graduate (proposal
"out of scope"). The harness code written for this change (`plan.js`,
`runner.js` executor, `internal-report.js`) ran against the real engine
UNCHANGED after it was written.

Verification, both identities, both sizes:

| case                   | s (rows) | m (rows) | checkfile | verified |
| ---------------------- | -------- | -------- | --------- | -------- |
| condition-flat         | 6406     | 48908    | ✓ / ✓     | yes      |
| observation-components | 4366     | 39479    | ✓ / ✓     | yes      |

The `count` verb's engine-reported rows matched the sha256-locked checkfile
assertions in every cell; a spot-check confirmed the `extract` verb writes a CSV
whose harness-counted rows equal the `count` verb's number (4366 = 4366). The
`.timer` cross-check held: the harness `samplesMs` mean sits ~0–1 ms above the
hook-reported execute `phasesMs` mean (the HTTP + IPC overhead), roughly
constant across cases — evidence the harness clock ≈ engine time once extraction
is untimed. The two identities separate cleanly in the numbers (single-threaded
`observation-components` at `m`: ~147 ms vs ~95 ms default), and their JMH
exports carry distinct self-describing impl-ids that overlay side by side.

## 1. DuckDB colorizes the `->` deprecation warning onto the sentinel line — **no contract change (staging hook robustness)**

flatquack `master-fix` generates DuckDB's deprecated single-arrow lambda
syntax (`x -> …`). DuckDB 1.5.2 prints a **colorized** deprecation WARNING for
it, and — even when stdout is a pipe, not a TTY — the warning's trailing ANSI
color-reset (`\x1b[00m`) is emitted on the SAME line as the following `.print`
sentinel. The session's naive whole-line match (`line === sentinel`) therefore
never fired, and the persistent session hung on the first `observation-components`
sample (the query with lambdas), surfacing to the harness as a `run` transport
failure once the case's worker was killed.

This is exactly the sentinel brittleness the design flagged as a risk
("Sentinel-based session parsing is brittle across DuckDB versions → a per-case
`execution_error`, version quirks land in FINDINGS.md"). Fixed inside the hook
(`duck-session.js`): strip ANSI SGR codes from every stdout line before matching
the sentinel. No harness or contract change — the session I/O is staging-scoped
scaffolding. A hook migrating to flatquack's repo should keep this guard (or
silence the warning with `SET lambda_syntax='ENABLE_SINGLE_ARROW'`).

## 2. flatquack substitutes its `{{…}}` tokens inside SQL comments too — **no contract change (template hygiene)**

flatquack's template renderer replaces every `{{token}}` occurrence textually,
including ones written inside `--` SQL comments. An early version of the
macros/table templates referenced token names in their explanatory comments;
those references expanded into inlined macro DDL mid-comment, corrupting the
generated SQL (a stray backtick, a commented-out first macro). Resolved by
keeping the template prose free of literal token names. Pure hook-authoring
hygiene; noted so the migrated hook's templates stay clean.

## 3. Macros and the SELECT arrive as one preview blob — **no contract change (hook design)**

flatquack `--mode preview` emits its macro block and the query as one script
(macros are separate `CREATE OR REPLACE MACRO` statements, then the SELECT).
Wrapping the whole blob in `CREATE TABLE _sink AS (…)` is invalid (the macros
are statements, not a subquery), and re-defining macros inside every timed
sample would pollute the measured region. Resolved with two templates: a
macros-only template compiled once at session start (untimed) and a body-only
template (no macro block, no `COPY TO`) wrapped per sample. This keeps the timed
region to just load + execute → in-engine sink. Hook-internal design; no
contract implication.

## 4. Only the `master-fix` flatquack ref produced wrappable SQL locally — **tool/environment constraint (comparison adapted)**

The design suggests comparing two flatquack refs and/or two DuckDB versions.
Locally, only one DuckDB version is installed (1.5.2; `duckdb` and `duckdb_cli`
are the same Cellar build), and among the flatquack worktrees only `master-fix`
generates a SELECT that wraps cleanly in `CREATE TABLE _sink AS (…)`:

- `cte-fix` leaves `{{fq_sql_transform_expression}}` unsubstituted in preview
  output (branch-specific renderer state) → `Parser Error at "{"`.
- `master`, `repeat-v5-fix`, `repeat-list-unrolling` emit a differently-shaped
  body that fails to wrap → `Parser Error at ")"`.

These are per-branch flatquack behaviours, not defects this change fixes; a
migrated hook would validate against flatquack's own release. To still exercise
the harness's two-identity path (distinct records, distinct JMH impl-ids, a
side-by-side overlay), the second identity is a genuine DuckDB **configuration**
A/B on the same ref: `SET threads=1` vs the default, expressed via the hook's
`DUCKDB_PRAGMAS` env and an `internal-warm-table-sink-threads1` variant. That is
squarely the kind of intra-stack tuning this internal benchmark exists to
measure, so it validates the reuse story faithfully; swapping in two real
engine versions once available is a drop-in manifest change.
