## Context

This change is Wave 2 of the benchmark hardening effort. Wave 1
(`benchmark-contract-v2`) hardened the benchmark *contract* — dataset identity by
explicit `name`/`version`, byte-reproducible NDJSON under `TZ=UTC`, the committed
checkfile that owns generated counts/checksums/assertions, structured
implementation identity, a defined measurement/statistics model mapping to JMH
SingleShotTime, and a work-verification row-count guard. Wave 2 leaves that
contract in place and hardens the *operational lifecycle* around it: what a single
case's failure means for the whole run, and how an implementer gets the pinned
generator onto their machine.

The three capabilities touched and one public schema:

| Capability                          | Schema                          | Change |
|-------------------------------------|---------------------------------|--------|
| `benchmark-reference-runner`        | (reads report/checkfile)        | MODIFIED |
| `benchmark-report-format`           | `benchmark-report.schema.json`  | MODIFIED |
| `benchmark-dataset-materialization` | (tooling: jar fetch/cache)      | MODIFIED |

The reference harness at `dev/sof-benchmark` (a separate Python implementation) is
the concrete second implementation this contract is measured against; the
`timeout`/`malformed` statuses and the record-and-continue posture are both
adopted from its `results-reporting`.

## Goals / Non-Goals

**Goals**

- Make per-case failure isolation an explicit runner contract: record each case's
  outcome and continue; a partial run still yields a valid report.
- Extend the report status taxonomy with `timeout` and `malformed` and add an
  optional per-case `message`.
- Let the materializer auto-fetch the pinned Synthea jar (checksum-verified,
  cached), so `executors.config.json` is an optional override, not a prerequisite.
- Run the generator in an isolated working directory so its incidental artifacts
  stay out of the repo tree.

**Non-Goals**

- Implementation code, tests, and schema edits — this is the authoring phase. They
  are enumerated in `tasks.md` as implementation-phase steps.
- Any re-bless / data change. This change touches no materialized bytes and no
  contract-of-data; the checkfile's counts and per-file sha256 are untouched.
- A future "download kind" that fetches a canonical pre-materialized DATASET
  (stronger reproducibility than fetching just the generator jar) — related,
  deferred, cross-referenced only.
- The runner/layout decoupling — related, deferred, cross-referenced only.

## Decisions

### D-A. Record-and-continue is the runner contract; the native log is not (#8)

The CONTRACT this change encodes has exactly three parts:

1. **Per-case isolation** — each case's outcome is independent; a case that fails
   is recorded with its status and the run continues to the remaining cases; a
   failing case never aborts the run or voids other cases' recorded results.
2. **Partial-report validity** — a report containing only the cases completed so
   far, each with its status, is schema-valid and meaningful.
3. **The status set** — the six-member enum below.

Deliberately OUT OF SCOPE of the contract: HOW a runner achieves crash-safety. The
reference harness `dev/sof-benchmark` appends one JSONL record per (case, size)
cell to a "native log" as it goes, so a hard crash mid-run still leaves every
completed cell durably on disk. That append-per-cell native log is a perfectly
valid RUNNER IMPLEMENTATION TECHNIQUE, but this contract does NOT mandate it: our
report is a single JSON document (`benchmark-report.schema.json`), and the contract
only requires that whatever cases completed are recorded and validate. An
implementation MAY buffer in memory and write once, or stream a native log and
project it into the JSON report at the end — either satisfies the contract. We
mention the native log here only so implementers know the crash-safety technique
exists and is allowed; it is not a spec-level SHALL.

### D-B. `timeout` and `malformed` join the status taxonomy (#8)

The enum becomes `{ok, count_mismatch, generation_error, execution_error,
timeout, malformed}`. The two additions carve out outcomes that today have to be
mislabelled:

| status | meaning | distinct from |
|--------|---------|---------------|
| `timeout` | the case exceeded a time budget (a wall-clock budget on generation or execution) and was abandoned | `execution_error` — there the engine actually ran and raised |
| `malformed` | the case's inputs or outputs were structurally invalid — a materialized resource that will not parse, or a result that cannot be materialized to the sink | `generation_error` — there generation itself failed to produce data at all |

Pre-production ⇒ this is a clean additive enum extension with no back-compat alias.
A report emitted by a Wave 1 runner (only the four original statuses) still
validates against the extended enum, since the four originals remain members; the
break is only that a consumer's exhaustive switch must now handle six cases.

### D-C. Optional per-case `message` (#8)

Add an OPTIONAL free-text `message` (string) to a per-case result. It is a short
human-readable explanation of a non-`ok` outcome, most useful for
`generation_error`, `execution_error`, `timeout`, and `malformed` (e.g. the
exception text, or "exceeded 300s budget"). It is advisory context for a human
reading a report, never a machine-parsed field, so it carries no structure beyond
"string" and is never REQUIRED — an `ok` case omits it. Keeping it optional and
free-text avoids over-specifying an error model the contract does not need.

### D-D. Auto-fetch the pinned Synthea jar; config is an optional override (#10)

The recipe already pins `dataset.syntheaVersion` (currently `3.2.0`), so the
materializer has the exact version it needs. The materializer SHALL be able to
obtain that jar itself:

1. **Resolve** the pinned `syntheaVersion` to a download URL and an expected
   SHA-256 via a small COMMITTED pinned map in the tooling, keyed by version:

   ```
   synthea:
     "3.2.0":
       url:    "https://github.com/synthetichealth/synthea/releases/download/v3.2.0/synthea-with-dependencies.jar"
       sha256: "<pinned 64-hex checksum, recorded when the jar is first pinned>"
   ```

   The map is the pinning mechanism: adding a new `syntheaVersion` means adding one
   entry with its checksum. The exact URL host/path is confirmed at implementation
   time against the published release; the design commitment is that the URL and
   checksum are BOTH pinned in this committed map, not discovered at runtime.

2. **Fetch** the jar (only if not already cached) into a gitignored cache directory
   — proposed `benchmark/.cache/synthea/`, named by version (e.g.
   `synthea-with-dependencies-3.2.0.jar`).

3. **Verify** the downloaded bytes against the pinned SHA-256 BEFORE use; a
   mismatch fails materialization loudly (never silently proceeds with unverified
   bytes). A cache hit is re-verified (or trusted only if its name encodes the
   verified version — implementation detail).

4. **Cache** — a second materialization reuses the cached, verified jar and does
   not re-download.

`tools/executors.config.json` becomes an OPTIONAL OVERRIDE: if present it supplies
a custom jar path and/or a `java` binary and WINS over the auto-fetch (so a
developer can point at a locally-built jar or a non-default `java`). If ABSENT,
the materializer auto-fetches. This inverts the Wave 1 posture where the config was
a hard prerequisite — the `benchmark-dataset-materialization` requirement that
"environment config lives in a gitignored `tools/executors.config.json`" is
relaxed from *required* to *optional override*, and the auto-fetch fills the gap.

Interaction with the existing contract: byte-reproducibility of the MATERIALIZED
NDJSON is unaffected — it depends on `recipe + generator version` plus `TZ=UTC` and
the line-canonicalization, all unchanged. The checksum here guards the GENERATOR
JAR's identity, a different (and complementary) checksum from the checkfile's
per-file NDJSON sha256.

### D-E. Isolated generator working directory (#10, folded in)

Synthea writes a `db.sqlite` and a `public/export/<epoch>/` tree into its process
working directory, which is the repo root today; Wave 1 (#17) only gitignored the
leftovers. The materializer SHALL run the generator in an ISOLATED/scratch working
directory so those artifacts never land in the repo tree.

Two acceptable mechanisms (implementation choice, either satisfies the contract):

- **Per-materialization temp dir**: create a fresh temp directory (e.g. under the
  OS temp root or under `benchmark/.cache/`), run Synthea with that as its CWD /
  `--exporter.baseDirectory`, lift the produced NDJSON into the identity-keyed
  layout, then clean the temp dir up. PROPOSED default — nothing persists.
- **Fixed gitignored scratch dir** (e.g. `benchmark/.cache/scratch/`): reused
  across runs, never committed. Simpler, but leaves bytes around between runs.

Either way the FINAL materialized NDJSON still lands at
`data/<name>/<version>/<size>/` exactly as the `benchmark-dataset-materialization`
layout requires — only the generator's transient CWD moves out of the repo root.
The `db.sqlite`/`public/` gitignore entries added in #17 become belt-and-braces
rather than the primary defence.

## Risks / Trade-offs

- **A pinned URL can rot.** GitHub release assets can be renamed or removed. The
  pinned map records the URL we pinned against; if it 404s, materialization fails
  loudly and the map is updated (with a re-verified checksum) — better than
  silently fetching a different artifact. The future "download kind" (out of scope)
  would mitigate this further by hosting a canonical dataset.
- **Network dependence in the bootstrap path.** Auto-fetch introduces a network
  hop the manual-config path did not have. Mitigated by: the cache (fetch once);
  the config override (air-gapped developers point at a local jar); and unit tests
  that MOCK the fetch (they never hit GitHub).
- **Enum extension is a public-contract change (Constitution IV).** Called out in
  `proposal.md`; pre-production, no consumers, additive (the four originals stay),
  so no version signal is warranted beyond the explicit call-out.

## Open Questions (Gate A)

- Exact `timeout`/`malformed` wording, and confirming the optional `message` is
  worth adding (proposed: yes).
- The cache location `benchmark/.cache/synthea/` and recording the pinned checksum
  as a committed `syntheaVersion → { url, sha256 }` map in the tooling.
- The isolated-CWD mechanism: per-materialization temp dir (proposed) vs a fixed
  gitignored scratch dir.
