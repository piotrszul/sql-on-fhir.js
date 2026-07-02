## Context

The benchmark report format is settled (Wave 1 `benchmark-contract-v2`, the
#22-era statistics change, and Wave 2 `benchmark-bootstrap-and-failure-isolation`).
The native report (`benchmark-report.schema.json`) is the source of truth: per
`(benchmark, size)` it records every case with a `status`, `outputRows`, raw
`samplesMs`, and a `stats: {mean, stddev, min, max, median}` (with
`additionalProperties: false` — no `ci95`, no `p95`). `samplesMs` is REQUIRED
precisely so any consumer, including a JMH export, can recompute whatever
percentiles or confidence interval it needs from the raw data.

The reference harness at `dev/sof-benchmark` (a separate Python implementation) is
the concrete second implementation this contract is measured against. Its
`results-reporting` capability already defines exactly this projection —
`write_jmh_exports` / `_jmh_entry` / `_percentiles` / `_score_error` in
`src/sofbench/results.py`. This change PORTS that projection into a
language-neutral capability spec for this project, adapting only where our native
report's field names differ from the harness's native log.

The one structural difference to bridge: the harness computes the JMH entry
DIRECTLY from a `CellResult` (which carries raw `measurement_samples_ms`), whereas
here the projection reads the finished native REPORT (which carries `samplesMs`
and a precomputed `stats`). The mapping is otherwise identical.

## Goals / Non-Goals

**Goals**

- Specify a JMH-compatible JSON export, consumable by JMH Visualizer, as a lossy
  projection of the native report — the native report stays authoritative.
- Export only `ok`, row-count-verified cells; failures stay in the native report.
- Split one file per `(benchmark, size, implementation)` triple so runs overlay
  rather than overwrite in the Visualizer.
- Pin the `score`/`scoreError`/`scorePercentiles`/`rawData`/`secondaryMetrics.rows`
  mapping, and pin HOW `scoreError` and percentiles are recomputed from
  `samplesMs`, mirroring the reference harness exactly.

**Non-Goals**

- Implementation code and tests — this is the authoring phase; they are enumerated
  in `tasks.md` as implementation-phase, test-first steps.
- Any change to the native report format / `benchmark-report.schema.json`.
- Defining a schema for the JMH format ourselves — it is JMH Visualizer's existing
  input contract, not ours.
- The export's trigger plumbing beyond naming a proposed shape (Gate A confirms).

## Decisions

### D1. A NEW capability `benchmark-jmh-format`, not a delta on `benchmark-report-format`

The JMH export is a DISTINCT OUTPUT ARTIFACT with its own lifecycle: a different
file, a different (external, JMH Visualizer) contract, produced only for verified
cells, and a LOSSY derivative of the native report. Folding it into
`benchmark-report-format` would conflate "the source-of-truth report contract"
with "a downstream viewer projection", and would wrongly imply the export shares
the native report's schema and completeness guarantees. Mirroring the reference
harness — which keeps `results-reporting` as one capability spanning native log +
JMH export — is also an option, but here the native report format is ALREADY its
own settled capability (`benchmark-report-format`), so the cleanest split is: the
report keeps its capability, and the projection ONTO JMH gets its own. The export
depends on the report (it reads it) but adds nothing to the report's requirements,
which is exactly the "added capability, existing spec untouched" shape. Hence a
new `benchmark-jmh-format` capability, and NO MODIFIED requirements.

### D2. The export is a lossy projection; the native report is the source of truth

The export carries STRICTLY LESS than the native report: no failing cells, no
`phaseSamplesMs`, no `environment`, no `stats.stddev`/`min`/`max` as such (they are
folded into recomputed JMH fields). It INVENTS nothing not derivable from the
report. This makes the export independently regenerable from any archived report
and keeps the report the single authoritative record. Producing the export is
OPTIONAL; a conforming run need not emit it, but WHEN emitted it follows this
format.

### D3. Verified cells only (`status: ok` with usable samples)

Only cases with `status: ok` are exported, mirroring the harness's `verified`
predicate (`status == ok and rows is not None and len(samples) > 0`). A cell that
is `ok` but somehow carries no `samplesMs` is not exportable (nothing to plot).
Every non-`ok` cell — `count_mismatch`, `generation_error`, `execution_error`,
`timeout`, `malformed` — is excluded and lives only in the native report. A chart
must show only verified numbers; a `count_mismatch` (a fast-but-WRONG result) in
particular must never masquerade as a valid data point. If no cell in a triple is
exportable, NO file is written for that triple.

### D4. `primaryMetric` mapping, and HOW scoreError/percentiles are recomputed

Each exported case → one JMH benchmark entry. The mapping ports `_jmh_entry`:

| JMH field | value | source |
|-----------|-------|--------|
| `benchmark` | `<benchmark.name>.<case.id>` | our identity (D6) |
| `mode` | `"ss"` | both scenarios are SingleShotTime |
| `params` | `{ size, implementation, … }` | so the Visualizer can axis (D6) |
| `primaryMetric.score` | `stats.mean` | native report |
| `primaryMetric.scoreError` | 95% CI half-width, RECOMPUTED from `samplesMs` | D4a |
| `primaryMetric.scoreConfidence` | `[score − err, score + err]` | derived |
| `primaryMetric.scorePercentiles` | RECOMPUTED from `samplesMs` | D4b |
| `primaryMetric.scoreUnit` | `"ms/op"` | fixed |
| `primaryMetric.rawData` | `[[ …samplesMs… ]]` | native report (nested, D4c) |
| `secondaryMetrics.rows` | `{ score: outputRows, scoreUnit: "rows" }` | D5 |

`score` reads the report's precomputed `stats.mean` (the harness computes
`fmean(samples)`; for a conforming report `stats.mean` IS that mean, so reading it
is equivalent and avoids recomputing what the report already pins). `scoreError`
and `scorePercentiles`, which the report deliberately does NOT carry, are
recomputed from the REQUIRED raw `samplesMs`.

**D4a — scoreError (95% CI half-width).** Port `_score_error` EXACTLY: for `n`
samples with sample standard deviation `sd` (the unbiased/`n−1` estimator),

```
scoreError = 1.959964 * sd / sqrt(n)     (n ≥ 2)
scoreError = 0                            (n < 2)
```

i.e. a NORMAL-approximation two-sided 95% half-width (`z = 1.959964`), NOT a
Student-t interval. This mirrors the reference harness (`results.py`
`_score_error`) verbatim, including the `n < 2 → 0` guard and the constant
`1.959964`. `scoreConfidence` is `[score − scoreError, score + scoreError]`.

**D4b — scorePercentiles.** Port `_percentiles` EXACTLY: the JMH percentile map is
computed over the SORTED samples at the fixed set `{0.0, 50.0, 90.0, 95.0, 99.0,
99.9, 100.0}` using linear interpolation between ranks:

```
rank = p/100 * (n − 1)
value = s[floor(rank)] + (s[ceil(rank)] − s[floor(rank)]) * (rank − floor(rank))
```

with the `n == 1 → s[0]` guard. Keys are the percentile numbers as strings
(`"0.0"`, `"50.0"`, …), matching the harness and JMH Visualizer's expectations.

**D4c — rawData nesting.** JMH's `rawData` is an array-of-arrays (one inner array
per fork/iteration group). The harness emits `[list(samples)]` — a single inner
array holding all measurement samples. Port that shape: `rawData = [samplesMs]`.

### D5. `secondaryMetrics.rows` carries the output row count

Port the harness's secondary metric: a `rows` entry whose `score` is the case's
`outputRows` (a count, so `scoreError: 0`, `scoreConfidence: [n, n]`,
`scoreUnit: "rows"`). This lets the Visualizer show the produced row count
alongside the timing without conflating it with the timed score. NOTE the field
name: our native report calls it `outputRows`; the harness's `CellResult` calls it
`rows`. The JMH metric key stays `rows` (the harness's public JMH name); its value
is our `outputRows`.

### D6. JMH `benchmark` name and how size/impl are encoded

The harness names each entry `sofbench.<benchmark>.<case_id>` and carries
`params: {dataset, resource, size}`, with the IMPLEMENTATION encoded in the
FILENAME (via `output_stem`), not in `params`. Here:

- **PROPOSED benchmark name:** `<benchmark.name>.<case.id>` (dropping the harness's
  `sofbench.` prefix, which is that harness's package namespace and not ours). Our
  `benchmark.name` is the authored suite `name` (the stable machine id), and
  `case.id` is the stable case id — both already the identity keys the native
  report uses.
- **PROPOSED params:** carry `size` AND `implementation` (a compact id derived from
  `implementation.engine`/`binding`/`variant`, e.g. `<engine.name>-<engine.version>`
  with binding/variant appended when present) as JMH `params`, IN ADDITION to
  encoding size and implementation in the filename. The harness relies on the
  filename alone for the implementation axis; adding `implementation` to `params`
  makes the axis explicit inside the file too, which the Visualizer can group on.
  This is a deliberate, minor divergence (D8) that loses nothing — Gate A confirms
  whether size/impl live in `params`, the filename, or both.

The implementation axis is fed by the structured `implementation`
(`engine`/`binding`/`variant`) that the report already carries (issue #7). The
projection derives a stable, filename-safe implementation id from that structure;
the EXACT derivation string is a Gate-A open question (D-Open).

### D7. Export location / trigger — a pure projection function + thin CLI

PROPOSED: a PURE PROJECTION FUNCTION that takes a parsed native
`benchmark-report.json` (plus an output directory) and returns/writes the JMH
files, with NO measurement or engine dependency. It is exposed via a small CLI
transform — `bun run jmh <report.json> <outdir>` — OR equivalently a `--jmh <dir>`
flag on the reference runner that calls the same function after writing the native
report. The projection reads the FINISHED report, never the live run, which keeps
the native report the source of truth and makes the projection independently
testable against a fixture report (no engine, no data, no network). LEAN: ship the
pure function as the contract-bearing unit and expose it via the standalone
`bun run jmh <report.json> <outdir>` transform (a runner `--jmh` flag is an
optional convenience over the same function). Gate A confirms flag vs standalone.

### D8. Deliberate divergences from `dev/sof-benchmark` `results.py`

The projection ports the harness faithfully; the intentional differences are:

1. **Reads the native REPORT, not a `CellResult` list.** The harness computes JMH
   entries from in-memory cell results as the run finishes; here the projection
   reads the settled `benchmark-report.json`. `score` therefore reads the report's
   `stats.mean` rather than recomputing `fmean(samples)` (equivalent for a
   conforming report). `scoreError`/percentiles are STILL recomputed from
   `samplesMs`, identically.
2. **Benchmark-name prefix dropped.** `<benchmark.name>.<case.id>` instead of
   `sofbench.<benchmark>.<case_id>` — `sofbench` is the harness's package
   namespace, not ours.
3. **`implementation` added to `params`.** The harness carries only
   `{dataset, resource, size}` in `params` and leans on the filename for the
   implementation axis; we ALSO surface `implementation` (and `size`) in `params`
   so the axis is explicit in-file. Additive, loses nothing.
4. **`rows` value sourced from `outputRows`.** Field-name bridge only (D5); the JMH
   metric key `rows` and its meaning are identical to the harness.

Everything else — `mode: ss`, `ms/op`, the `1.959964` normal 95% half-width, the
`{0,50,90,95,99,99.9,100}` linear-interpolation percentiles with string keys, the
`[[…]]` `rawData` nesting, the `<benchmark>-<size>-<impl>.jmh.json` filename with
per-segment sanitization, verified-cells-only, and one-file-per-triple — is ported
verbatim.

## Risks / Trade-offs

- **Two formats can drift.** The export is a projection, so a report-format change
  could silently break it. Mitigated by keeping the export a PURE function of the
  report (regenerable from any archived report) and testing it against a fixture
  report; the report stays the single source of truth.
- **Normal vs Student-t CI.** For small `n` (the RECOMMENDED minimum is 7 samples),
  a normal `z = 1.959964` half-width slightly UNDER-states the interval versus
  Student-t. We accept this deliberately to match the reference harness EXACTLY
  (comparability across the two implementations' exports outweighs the small-`n`
  precision gain); noted so a future change can revisit if both implementations
  move together.
- **JMH format is an external, unversioned contract.** JMH Visualizer's input shape
  is defined by that tool, not by us; a viewer change could require an export
  update. Mitigated by porting a shape the reference harness already exercises
  against the live Visualizer.

## Open Questions (Gate A)

- **New capability vs delta.** Confirm `benchmark-jmh-format` as a NEW capability
  (D1, proposed) rather than a `benchmark-report-format` delta.
- **Export trigger.** Standalone `bun run jmh <report.json> <outdir>` transform
  (proposed) vs a `--jmh <dir>` flag on the reference runner — or both over the
  same pure function (D7).
- **Benchmark-name string + size/impl encoding.** `<benchmark.name>.<case.id>`
  with `size` + `implementation` in BOTH `params` and the filename (proposed, D6)
  vs the harness's filename-only implementation axis.
- **Implementation-id derivation.** The exact filename-safe string derived from
  `implementation.engine`/`binding`/`variant` (proposed
  `<engine.name>-<engine.version>[-<binding…>][-<variant>]`, D6).
- **CI method.** Confirm the normal-approximation 95% half-width
  (`1.959964 * sd / sqrt(n)`, sample stddev, `n<2 ⇒ 0`) ported verbatim from the
  harness `_score_error` (D4a), rather than a Student-t interval.
