## Context

Synthea's simulation window is bounded by two dates on the CLI:

- `-r` (reference date, `YYYYMMDD`) — Synthea's "reference time", the clock the
  generator treats as *now* for reference purposes. The recipe already pins this
  as `params.referenceTime = 20240101`, passed through by `synthea.js`.
- `-e` (end date, `YYYYMMDD`) — the date at which simulation stops. **Synthea
  defaults this to the machine's local wall-clock date.** `synthea.js` does not
  pass it, so it silently tracks the clock — the root cause of the drift.

`params.yearsOfHistory` (Synthea's `exporter.years_of_history`, currently `1`)
controls how much of each patient's simulated history is *exported*, measured
back from the export point. It is a separate lever from the simulation window.

The single decision this proposal must fix for the human gate is: **what value
does the pinned end-date param take, and how does it relate to the existing
`referenceTime` and `yearsOfHistory` params.** Any fixed value makes counts
reproducible; the choice only determines *which* fixed counts we bless.

## Goals / Non-Goals

**Goals**

- Make the Synthea end date an explicit, pinned recipe input, never the wall
  clock.
- Choose a concrete param name and default value, with a rationale, so the
  human gate can approve the resulting one-time count movement.
- Keep the choice self-consistent with `referenceTime` and `yearsOfHistory`.

**Non-Goals**

- Performing the re-bless (that is an implementation step, run once after this
  is approved and `synthea.js` is changed).
- Fixing timezone-sensitive timestamp *fields* in the emitted resources — a
  fixed `-e` fixes counts and day-granularity reproducibility, not per-second
  timestamps; a downloadable pinned dataset (#10) is the eventual fix for that.

## Decisions

### Decision 1 — Param name: `endTime`

The new param is named **`endTime`**, a `YYYYMMDD` integer, mirroring the
existing `referenceTime` (Synthea `-r`). This keeps the two simulation-window
bounds named as a matched pair (`referenceTime` → `-r`, `endTime` → `-e`) and
reads naturally in the recipe. `synthea.js` passes it verbatim as `-e`.

Rejected alternatives: `endDate` (inconsistent with the sibling
`referenceTime`, which already uses the `…Time` suffix for a `YYYYMMDD`
value); `simulationEnd` (verbose, and does not echo the existing param).

### Decision 2 — Default value: `endTime = 20250101`

Set `endTime = 20250101` — exactly **one year after** `referenceTime`
(`20240101`), matching `yearsOfHistory = 1`.

Rationale:

- **Self-consistent window.** With `referenceTime = 20240101`,
  `endTime = 20250101` makes the pinned simulation window exactly the one year
  of history the recipe already asks to export (`yearsOfHistory = 1`). The
  three date params now tell one coherent story — reference epoch, one year
  forward, export one year of history — instead of `referenceTime` being fixed
  while the end silently floats to "today".
- **Clean, human-legible anchor.** `20250101` is a round calendar boundary,
  easy to reason about and to re-derive if the recipe ever changes
  `referenceTime` or `yearsOfHistory` (the invariant to remember is
  `endTime ≈ referenceTime + yearsOfHistory`).
- **Fully decoupled from the wall clock.** Any fixed value achieves this; a
  value tied to `referenceTime` additionally survives future edits to the
  reference epoch by an obvious rule.

Why not pin to today's accidental value `20260630` (the current blessed
counts)? Because that value is itself the artifact of the bug — a specific
machine's clock on a specific day. Preserving it would bless the accident and
leave the window disconnected from `referenceTime`/`yearsOfHistory`. Since a
one-time re-bless is unavoidable the moment we pin *any* fixed date, we take the
opportunity to pin a value that is principled rather than incidental.

### Decision 3 — Move the hardcoded export toggles into `params`

The output-affecting toggles hardcoded in `synthea.js` move into the recipe
`params` so the recipe fully determines the dataset and the content hash covers
them:

- `hospitalExport` → `--exporter.hospital.fhir.export` (was hardcoded `false`)
- `practitionerExport` → `--exporter.practitioner.fhir.export` (was `false`)
- `bulkData` → `--exporter.fhir.bulk_data` (was `true`)
- `yearsOfHistory` → `--exporter.years_of_history` (already a param; keep)

`--exporter.fhir.export=true` (the master FHIR-export switch) is *not* moved —
it is a mode selector for the executor rather than a dataset dial, and turning
it off would produce no data at all; it stays as an executor invariant.
`--generate.thread_count=1` is likewise an executor-level determinism setting,
not a dataset dial, so it is set by the executor and not exposed as a recipe
param.

Param names and their default (current-behaviour-preserving) values:

| param                | Synthea flag                          | default |
|----------------------|---------------------------------------|---------|
| `endTime`            | `-e`                                  | 20250101 (NEW) |
| `yearsOfHistory`     | `--exporter.years_of_history`         | 1 (unchanged) |
| `hospitalExport`     | `--exporter.hospital.fhir.export`     | false |
| `practitionerExport` | `--exporter.practitioner.fhir.export` | false |
| `bulkData`           | `--exporter.fhir.bulk_data`           | true |

The moved toggles keep their current values, so *they alone* do not change the
data; only `endTime` moving from wall-clock to `20250101` changes the counts.

## Expected re-bless impact

Pinning `endTime = 20250101` will change the blessed `expectCount` values away
from today's accidental `m` counts (Condition 50090 / Observation 106613, which
correspond to the wall-clock `20260630`). The new counts are whatever
`20250101` deterministically yields and must be measured once during
implementation by running Synthea 3.2.0 with the pinned recipe and re-blessing
via the reference runner's bless path. Size `s` is expected to be unaffected
(it was end-date-insensitive), but this is verified, not assumed. **No count
value is asserted in this proposal;** the re-bless produces the authoritative
numbers, and the `expectCount` scenarios then hold by construction.

## Risks / Trade-offs

- [The exact new `m` counts are unknown until Synthea is run] → Acceptable: the
  determinism claim is the contract; the specific numbers are an output of the
  one-time re-bless, not something to hand-pick. The re-bless is gated on this
  proposal's approval.
- [Choosing `20250101` over the current `20260630` moves the blessed numbers] →
  Intended. Any fixed date forces a one-time re-bless; a principled date is
  worth the same one-time cost as an incidental one.
- [Content hash of every existing materialized dir changes] → The `data/`
  directories are derived, regenerated on demand, and not authoritative;
  stale dirs under the old hash are simply re-materialized under the new hash.

## Open Questions

- **Confirm `endTime = 20250101` (the human gate's decision).** The alternative
  worth naming is pinning to `20260630` to preserve the current blessed counts
  and avoid re-blessing; this proposal recommends against it (it blesses the
  bug's accident and disconnects the window from `referenceTime`), but the value
  is the one thing the human must sign off before implementation and re-bless.
