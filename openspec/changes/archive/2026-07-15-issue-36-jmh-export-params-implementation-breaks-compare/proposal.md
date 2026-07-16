## Why

Closes #36 (https://github.com/piotrszul/sql-on-fhir.js/issues/36). The JMH
export puts `implementation` into each entry's `params`
(`benchmark/tools/harness/jmh.js:100`). Within one exported file this is
constant, so it adds no disambiguation there — but JMH Visualizer's two-file
compare mode matches entries by `benchmark` name **+ full `params` equality**,
and `params.implementation` necessarily *differs* across any two files you'd
actually load side by side to compare implementations. The result, confirmed
by manual repro: comparing two `.jmh.json` files from a real
`flatquack-internal` DuckDB-version run matched **0** of the 6 shared cases.
This silently defeats the exact side-by-side compare workflow
`flatquack-internal-driver.js`'s own doc comment describes as "the point" of
producing multiple files. The reference harness this project ports
(`dev/sof-benchmark` `results.py`) never put the implementation in `params`
for this reason; our port's deliberate divergence (documented in
`openspec/changes/archive/2026-07-02-benchmark-jmh-export/design.md` D8.3 as
"additive, loses nothing") is the defect.

## What Changes

- `jmhEntry` in `benchmark/tools/harness/jmh.js` **BREAKING**: drop
  `implementation` from each JMH entry's `params`, keeping only `size`. The
  implementation axis remains fully recoverable from the file name (via
  `outputStem`/`implementationId`, unchanged), matching how the reference
  harness expects two comparable runs to share identical `params`.
- Update `openspec/specs/benchmark-jmh-format/spec.md`'s "JMH benchmark name
  and axes carry our identity" requirement so it no longer prescribes
  `params` as a place the implementation axis is carried — only the file name.
- Update `benchmark/tests/jmh.test.js` to assert `params` no longer carries
  `implementation`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `benchmark-jmh-format`: the "JMH benchmark name and axes carry our
  identity" requirement changes — the implementation axis is recoverable from
  the file name only, no longer duplicated into `params`. This narrows the
  emitted JSON shape (a field removal), so it is a breaking change to this
  published contract per the stable-public-contracts principle; this proposal
  and its spec delta are the version signal, since the JMH export format
  (an external, unversioned viewer format) carries no version field to bump.

## Impact

- `benchmark/tools/harness/jmh.js` (`jmhEntry`): removes `implementation`
  from `params`.
- `benchmark/tests/jmh.test.js`: assertions on `params` shape.
- `openspec/specs/benchmark-jmh-format/spec.md`: requirement/scenario text
  for the axes requirement.
- No change to `benchmark-report.schema.json` or the native report — this is
  a projection-only change, consistent with the JMH export's existing
  lossy-projection contract.
- Any previously generated `.jmh.json` files with `params.implementation`
  are unaffected on disk; only future exports change shape. Consumers who
  parsed `params.implementation` out of old exports (none known in this
  repo) would need to switch to reading the file name instead.
