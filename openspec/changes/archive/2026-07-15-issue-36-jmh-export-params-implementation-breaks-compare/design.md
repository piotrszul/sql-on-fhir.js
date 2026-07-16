## Context

`benchmark/tools/harness/jmh.js`'s `jmhEntry` produces one JMH entry per
verified case, currently with `params: { size, implementation: implId }`
(`jmh.js:100`). `openspec/changes/archive/2026-07-02-benchmark-jmh-export/design.md`
D8.3 documents adding `implementation` to `params` as a deliberate divergence
from the ported reference harness (`dev/sof-benchmark` `results.py`, which
keeps only `{dataset, resource, size}` in `params`), reasoning "the axis is
explicit in-file... additive, loses nothing."

Issue #36 shows that reasoning was wrong in practice. JMH Visualizer's
two-file compare mode matches entries between two uploaded files by
`benchmark` name plus **full `params` equality**. One export file = one
implementation, so `params.implementation` is constant within a file (no
disambiguation value there — its stated purpose) but necessarily differs
across the two files a user loads together specifically to compare
implementations. Every cross-file compare therefore matches 0 entries. This
was verified both by direct repro (a real `flatquack-internal` two-version
comparison: 0/6 matched) and by manually normalizing `params.implementation`
to an identical placeholder in both files, after which all 6 cases matched
with diffs consistent with the manually-computed numbers.

`flatquack-internal-driver.js`'s own doc comment states that comparing two
identities via side-by-side JMH Visualizer load is "the point" of producing
multiple `.jmh.json` files from one comparison run — i.e. this bug breaks the
primary documented use case for multi-file export.

## Goals / Non-Goals

**Goals:**
- Restore working two-file (and N-file) compare in JMH Visualizer for
  `.jmh.json` exports covering the same `(benchmark, size)` pairs but
  different implementations.
- Keep the implementation axis recoverable from the export, just not via
  `params` — the file name (`<benchmark>-<size>-<impl>.jmh.json`, via
  existing `outputStem`/`implementationId`) already encodes it and is
  unaffected by this change.
- Bring `params` back in line with the reference harness's shape
  (`{size}` only, dropping the deliberate divergence that turned out to be
  a defect).

**Non-Goals:**
- No change to the native `benchmark-report.json` format or schema — this is
  a projection-only change, per the JMH export's existing lossy-projection
  contract.
- No change to file naming, grouping (one file per
  `(benchmark, size, implementation)` triple), or any other JMH field
  (`mode`, `primaryMetric`, `secondaryMetrics.rows`, etc.).
- Not attempting to preserve `params.implementation` for some hypothetical
  future consumer: nothing in this repo reads it, and the issue's own
  investigation found no compare-workflow-compatible use for it.

## Decisions

**Drop `implementation` from `params`; keep `size`.** `params` becomes
`{ size }`. `size` is safe to keep because a compare workflow's two files are
normally the same size (comparing implementations at a fixed data size) —
size only varies when overlaying multiple sizes of the *same* implementation,
which is a within-file, not cross-file, need already served by `size` being
present. Alternative considered: drop `params` entirely and rely solely on
the file name for both axes. Rejected — `size` in `params` costs nothing
(true here, unlike the `implementation` case) since it doesn't vary across
the comparisons this format exists to support, and dropping it would be an
unnecessary widening of the change beyond fixing the reported defect.

**Spec update, not a new version field.** `openspec/specs/benchmark-jmh-format/spec.md`'s
"JMH benchmark name and axes carry our identity" requirement currently says
the implementation axis SHALL be recoverable "as JMH `params` AND encoded in
the file name" (proposed). This is updated to say recoverable from the file
name only. There is no version field anywhere in this repo's benchmark
contracts (`benchmark-report.schema.json`, `tests.schema.json`, this JMH
format) to bump, and JMH itself is an external, unversioned viewer format —
so per this repo's stable-public-contracts principle, the version signal for
this breaking change is the OpenSpec change record itself (proposal + spec
delta + PR), not a new versioning mechanism invented for the occasion.

## Risks / Trade-offs

- **Breaking change to a published contract** (`benchmark-jmh-format`):
  any external tooling that parsed `params.implementation` out of a
  `.jmh.json` export breaks. Mitigated: nothing in this repo does so; the
  file name has always carried the same identity, so a consumer needing the
  axis has an existing alternative. Called out explicitly in the proposal's
  Capabilities section as **BREAKING**.
- **Previously generated exports remain in the old shape.** Any `.jmh.json`
  files already on disk (or archived) keep `params.implementation` until
  regenerated. Not mitigated further — the export is a regenerable
  projection of the native report (design.md of the original
  `benchmark-jmh-export` change), so regenerating is always available.
