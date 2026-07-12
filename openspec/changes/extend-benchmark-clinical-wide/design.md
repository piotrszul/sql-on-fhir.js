# Design — extend-benchmark-clinical-wide

## Context

Three independent-looking asks share one machine: a bigger scale tier, a richer
view set, and per-case run selection. They are packaged as one change because
they share the re-materialize / re-bless cycle and touch overlapping tools. The
v1 single-resource scope (every output row derives from exactly one input
resource) is the property that makes the hardest of them — streaming bless —
small.

## Decisions

### D1. New `clinical-wide.json`, not an extension of `clinical-flat.json`

The imported views span four resource types and are semantically "the Pathling
view set," not "clinical flatten." A new file keeps `clinical-flat`'s recipe,
checkfile, and validation history stable (its numbers stay comparable across the
staging-hooks findings), matches the source's own grouping, and — with case
selection (D4) — a larger file stays ergonomic. Follows the existing pattern:
`clinical-flat` already declares multiple recipe `resources` with one
single-resource view per case.

### D2. Streaming bless — keep `evaluate()`, call it per resource

The memory blow-up is not `evaluate()`; it is calling it once over a fully
`readFileSync`-loaded array and materializing the entire result just to read
`.length`. Because the scope is single-resource, bless can stream:

```
total = 0; derived = 0
for each resource r  (parsed one NDJSON line at a time):
    total   += evaluate(view, [r]).length
    derived += cardinality(view, r)
assert total === derived    // per the cross-check (D3)
record total
```

Memory is O(one resource + its rows). No checkfile value changes — the same
counts, computed incrementally. Input `sha256` and line counts are likewise
computed by streaming the file, so no step re-introduces a whole-file load.

### D3. Generalize the analytic cross-check to the full cardinality algebra

The current `deriveExpectedCount` models only a single top-level `forEach` or a
top-level `where`; the imported views have nested `forEach` (×4, ×3) and a
`unionAll`, which it cannot count and would reject. It is replaced by a
recursive row-cardinality function over the select tree:

```
card(select, focus):
  forEach expr        → Σ over elements of expr(focus): card(body, element)
  forEachOrNull expr  → same, but an empty collection contributes 1 (all-null row)
  no forEach          → card(body, focus)
card(body, focus)     → Π card(child, focus) over nested select[]     (cross-join)
                        × Σ card(branch, focus) over unionAll[]        (sum)
view.where[]          → count only resources passing every where clause
```

Counting needs only the *length* of each `forEach` collection (via the same
`path.js` FHIRPath used by `evaluate()`); it never extracts column values,
resolves types, or builds rows — so it is genuinely much simpler than
`evaluate()` and is not a second copy of the engine.

**Why keep the check at all, given it shares `path.js`?** It is independent of
`evaluate()`'s row-composition code — the layer most prone to bugs — even though
it shares the FHIRPath layer. As a reference implementation, sof-js's output is
what gets "blessed," so FHIRPath-layer bugs would be blessed in either way; the
cross-check guards the combinatorics, which is where it earns its keep.

**Self-protecting property (the key risk argument).** Bless asserts
`cardinality(view,r) === evaluate(view,[r]).length` and hard-fails on mismatch.
A bug in the cardinality function can therefore only *block* a bless until it is
fixed — it can never write a wrong count into the checkfile. Worst case is a
loud refusal, never silent corruption. This makes generalizing the derivation
low-risk. Supersedes the prior design decision (D5 in the benchmark subproject
design) that scoped the cross-check to a single-level derivation.

### D4. Case selection reuses the runner's existing `caseFilter`

`runSuite` already accepts and applies a `caseFilter` predicate
(`runner.js`). Only the surface is missing:

- Harness `run` CLI and bless CLI both parse `--only a,b` and `--exclude a,b`
  into one pure predicate `(case) => boolean`.
- `--only` and `--exclude` compose (exclude wins on conflict); unknown ids are
  a loud error, not a silent empty run.
- The predicate is pure and unit-tested without a hook or a dataset.

Bless honors the same flags so "run these two views" does not force blessing all
of them; unselected cases' assertions are preserved (bless is already
size-additive; it becomes case-additive too).

### D5. `xl` = 100k; re-scope the v1 ceiling; stream the hashing

`sizes` is an open map keyed by name with a required `population`, so `xl` needs
**no schema change**. The `Size as parameter with a v1 demographic ceiling`
requirement is re-scoped: the 10k ceiling exists because a *purely*
low-multiplicity (demographic) dataset is row-starved at small populations and
its larger sizes wait on a download kind. `clinical-wide` roots
measurement-critical cases on high-multiplicity clinical resources
(Condition/Observation/Encounter), so 100k yields millions of rows and the
ceiling rationale does not apply. The ceiling stays for purely demographic
datasets; a dataset with at least one high-multiplicity clinical root may exceed
it. README's blanket "capped at 10k" note is corrected accordingly.

Cost noted honestly: Synthea generate-then-prune at 100k is ~10× the `l` tier in
time and disk; xl data is untracked like every other tier.

### D7. Export-filtered generation; reuse deferred

Contrary to the current materialization requirement's premise ("the generator has
no per-resource export filter"), Synthea **does** filter FHIR bulk output:
`FhirR4.reloadIncludeExclude()` reads `exporter.fhir.included_resources` /
`excluded_resources` (only one may be set; empty ⇒ all), verified by
`FHIRR4ExporterTest`. `Patient` and `Encounter` are always exported regardless.

The executor already receives `recipe.resources` (unused). It will pass them as
`--exporter.fhir.included_resources` so generation emits only the needed types
instead of every type. This is an **export** filter, not a simulation filter —
Synthea still models each patient's full history; the win is avoiding the
convert/serialize/write/prune of unwanted resources (large ones like `Claim` /
`ExplanationOfBenefit`), biggest at `xl`. It is **byte-safe for kept resources**:
a resource file's content is independent of what else is exported, and lines are
canonicalised (sorted) per file — so `clinical-flat`'s Cond/Obs sha256 are
unchanged. Prune is retained as a safety net for the force-exported
`Patient`/`Encounter`.

**Reuse is explicitly deferred.** Because `Patient`/`Encounter` are always
exported, `clinical-flat`'s generation already produces `clinical-wide`'s full
set, so the two runs are dedupable (a shared dataset, or a raw-generation cache
keyed on syntheaVersion+params+population+included-set). That optimization is a
**separate change**; here `clinical-wide` has its own dataset identity and
generates independently, and `clinical-flat` is untouched.

### D6. Views imported verbatim; re-blessed against this recipe

The six views are copied from `sof-benchmark/benchmarks/pathling/views`
(the `.inlined` variant of `UsCoreBloodPressures`; `QuestionnaireResponseFlat`
excluded). The source's `expected` counts are Pathling's numbers for a
*different* Synthea version/seed/params and do not transfer — clinical-wide is
blessed against its own recipe. Independent cross-validation still arrives when
the staging Pathling/flatquack hooks run `clinical-wide` and agree with the
blessed counts (a genuinely second-engine oracle), consistent with the
benchmark's "a second-runner mismatch is the signal" stance.

### D8. Canonicalisation is a memory-bounded external merge sort (supersedes the in-memory sort)

Discovered while enabling `xl` (§9). The persisted bytes must be stable so the
checkfile's per-file `sha256` is reproducible, and that requires an ordinal
line sort because **Synthea's bulk-export line order is non-deterministic** —
verified empirically (two identical-input runs differ raw, agree sorted) and
against v3.2.0 source (export runs inline on the multi-threaded generator pool,
writing each patient's lines to a shared `PrintWriter` as it finishes). Two
correctives to earlier assumptions:

- `--generate.thread_count=1` (previously passed "for deterministic export
  order") is **not a real Synthea property** — silently ignored, generation
  always ran multi-threaded. Removed.
- Even a *genuine* single-threaded pool (`-c` file with
  `generate.thread_pool_size=1`, the only way that flag takes effect) does yield
  deterministic order, but costs ~20× generation wall-time at `xl` (~7 h vs
  ~21 min) — rejected.

So canonicalisation stays, but the original whole-file `readFileSync` + in-memory
`.sort` **OOMs at `xl`** (the ~9 GB Encounter/Observation files exceed JSC's max
string length — this is the OOM, independent of RAM). It is replaced by a
streaming external merge sort (`benchmark/tools/external-sort.js`): bounded sorted
runs + a heap k-way merge, using the **same ordinal comparator**, so output is
**byte-identical** — verified by `clinical-flat` `s`/`m` re-materializing to the
exact committed checksums (no re-bless) and by an `LC_ALL=C sort` idempotency
cross-check. This is what makes `xl` materializable; with D2's streaming bless,
the whole `xl` pipeline is memory-bounded (materialize and bless both ~300 MB
peak on a 22 GB dataset). Note `LC_ALL=C sort -S` was also viable (bounded,
byte-identical) but a pure-JS merge sort avoids a system-binary dependency and
guarantees the comparator match by construction rather than by BMP-order luck.

### D9. The harness RUN path streams its file reads too (not only bless)

D2 bounded **bless**, but a measurement **run** still had three whole-file reads
that would trip the same JSC max-string-length ceiling at `xl`: the harness's own
`observeResourceCounts` (via `countLines`) and `verifyChecksums` (via `sha256Of`),
plus the reference `sof-js` hook's `loadResources`. All three now read the file in
fixed-size byte chunks:

- `countLines` and `hashAndCountLines` share one private `scanFileBytes` chunk
  loop (byte-level newline count, so multibyte-safe by construction).
- `sha256Of` streams chunks into the hash instead of hashing one whole-file buffer.
- the hook's `loadResources` stays **synchronous** (so the hook's request handler
  is untouched) but reads via a `StringDecoder` chunk loop, so a UTF-8 character
  split across a chunk boundary is reassembled and no whole-file string is ever
  allocated.

These are **output-preserving** memory refactors — identical counts, hashes and
parsed arrays — so, like D8's sort, there is no behavioural red to observe; the
new chunked paths are locked by tiny-`chunkBytes` boundary tests (a newline and a
multibyte char forced mid-chunk) and by the `xl`-tier byte-identity that already
holds. The one honest boundary: `preloaded_repeated` requires the hook to hold the
whole parsed dataset resident between runs, so this bounds the **load**, not the
resident table — that residency is the scenario's inherent cost, documented rather
than pretended away.

## Risks / trade-offs

- **Cardinality edge cases** (`forEachOrNull` empty-row, `unionAll` interplay
  with sibling columns) are subtle. Mitigated by D3's self-protecting property
  and by TDD: each imported view's known-good `evaluate()` output is the test.
- **xl generation cost** is real; `xl` is opt-in per run and not required for
  the suite to be green at `s`/`m`/`l`.
- **Constitution IV**: dropping the old single-level cross-check in favor of the
  general one is a deliberate, documented supersede (this design), not silent.

## Non-goals

- Result-value checksums, referenced/multi-resource-join datasets, and QR
  datasets remain deferred v1 extensions.
- No change to the report, checkfile, hook, or suite JSON *formats*.
