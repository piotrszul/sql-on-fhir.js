## Why

The benchmark's central assumption is that `recipe + generator version`
reproduces the same dataset on every machine, at any time. That assumption is
the bedrock of both the content-hashed `data/<name>_<hash>/` layout and the
blessed `expectCount` values. It is currently false.

`tools/executors/synthea.js` pins Synthea's seed (`-s`), clinician seed
(`-cs`), and reference date (`-r`), but **omits `-e` (the simulation end
date)**. Synthea defaults `-e` to the machine's local wall-clock date, so the
committed ("blessed") datasets are an accident of the clock at bless time, not
a property of the recipe. Two implementers running the identical recipe on
different days — or in different timezones — get different data and different
row counts, yet the recipe hash is unchanged, so the drift is silent.

This has been fully root-caused (issue #4). The committed size-`m` manifest was
generated `2026-06-29T23:14Z`; on the AEST (+10:00) bless machine that local
date was already `2026-06-30`, so the unset `-e` defaulted to `20260630`.
Regenerating with `-e 20260630` reproduces the blessed data byte-for-byte
(Condition = 50090, Observation = 106613, seed 589, same jar). Neighbouring end
dates give different counts (`20260628` → 50054, `20260629` → 50037,
`20260701` → 50095), confirming `-e` is the sole drift cause within one Synthea
version. Size `s` (population 100) happened to be end-date-insensitive, which is
why the drift only surfaced at `m`.

Related, per Synthea's own "Recreating a Dataset" guidance, reproducing a
dataset requires pinning `-s`, `-cs`, `-r`, **and `-e`**, plus a fixed
`exporter.years_of_history` and Synthea version. Several output-affecting
Synthea toggles are currently **hardcoded in `synthea.js`** rather than declared
in the recipe (`--exporter.hospital.fhir.export=false`,
`--exporter.practitioner.fhir.export=false`, `--exporter.fhir.bulk_data=true`,
`--exporter.years_of_history`). Because they are not in the recipe, the recipe
does not fully describe the dataset, and the content hash does not cover them.

## What Changes

- **Pin the simulation end date.** Add a declarative `endTime` field to the
  Synthea recipe `params`, and have `synthea.js` pass it as Synthea's `-e`
  flag alongside the existing `-r`. The wall-clock default SHALL never be
  relied upon. (Design decision on the concrete value: see `design.md`.)
- **Pin export order.** Pass `--generate.thread_count=1` so the export *order*
  is deterministic. (Counts are already deterministic given `-e`; only order
  depends on thread count. This matters for any future content/order
  comparison.)
- **Move hardcoded export toggles into the recipe.** The output-affecting
  toggles currently hardcoded in `synthea.js`
  (`--exporter.hospital.fhir.export`, `--exporter.practitioner.fhir.export`,
  `--exporter.fhir.bulk_data`, `--exporter.years_of_history`) become recipe
  `params`, so that `recipe + version` fully determines the dataset and the
  content hash covers every output-affecting input.
- **Re-bless once.** After `endTime` is pinned to its chosen fixed value, the
  blessed `expectCount` values are regenerated once against that pinned date.
  Pinning `-e` to a fixed value deterministically changes the counts away from
  today's accidental 50090/106613 to whatever the pinned date yields. **This
  proposal does not perform the re-bless; it is a downstream implementation
  step, called out here so the human gate can approve the count movement.**

This is a change to the **benchmark suite-format contract** (the recipe
`params` gain new fields) and to the **dataset-materialization behaviour**
(the executor pins `-e`, `--generate.thread_count=1`, and reads the moved
toggles from the recipe). The project is pre-production, so no versioning or
back-compat signalling is required for the contract change; but because
`benchmark.schema.json` and the recipe format are public contracts (Principle
IV), the additive change is documented here explicitly.

## Capabilities

### Modified Capabilities

- `benchmark-suite-format`: the Synthea recipe `params` are extended with the
  output-affecting inputs that fully determine the dataset — `endTime` and the
  moved export toggles — so the language-neutral artifact, and its content
  hash, describe the dataset completely rather than deferring inputs to the
  executor's hardcoded defaults or the wall clock.
- `benchmark-dataset-materialization`: the `synthea` executor SHALL pass a
  pinned `-e` (from `params.endTime`), pass `--generate.thread_count=1`, and
  source the export toggles from the recipe `params`, so that `recipe +
  version` is reproducible across environments and time at day granularity.

### New Capabilities

<!-- None. -->

## Acceptance Criteria

- Materializing the Synthea recipe on two different wall-clock dates (or in two
  different timezones), with the same recipe and Synthea version, produces
  identical per-resource row counts.
- The `synthea` executor invokes Synthea with `-e <params.endTime>`,
  `--generate.thread_count=1`, and the export toggles taken from the recipe
  `params` (no output-affecting Synthea flag is hardcoded in `synthea.js`).
- A benchmark file whose Synthea recipe `params` omits `endTime` is rejected by
  the invariant validator (an explicit end date is mandatory for the `synthea`
  kind).
- The recipe content hash changes when `endTime` (or any moved toggle) changes,
  and is unchanged by reordering the `params` keys.
- After the one-time re-bless, each case's `expectCount[size]` equals the row
  count produced by materializing against the pinned `endTime`, and the
  reference runner reports PASS for every case at every declared size.
- The existing suite-format and materialization scenarios continue to hold;
  `bun test`, `bun run validate`, and `bun run check-fmt` are green.

## Impact

- `benchmark/clinical-flat.json`: recipe `params` gain `endTime` and the moved
  export toggles; `expectCount` values are re-blessed (implementation phase).
- `benchmark/tools/executors/synthea.js`: pass `-e`, `--generate.thread_count=1`,
  read moved toggles from `params`; stop hardcoding the toggles.
- `benchmark/benchmark.schema.json`: document/allow the new `params` fields (the
  schema is permissive on `params` today; confirm no `additionalProperties:
  false` rejection).
- The benchmark invariant validator: enforce that a `synthea` recipe declares
  `endTime`.
- `benchmark/data/synthea-clinical_<hash>/`: the content hash changes because
  `params` change; existing materialized directories become stale and are
  regenerated under a new hash (no migration — they are gitignored derived
  data / re-generated on demand).
- A new benchmark test asserting reproducible counts / correct executor
  invocation (implementation phase; test-first, see `tasks.md`).

Out of scope: a downloadable pinned dataset (#10), which additionally fixes
timezone-sensitive timestamp *fields* (not just counts); the `expectCount`
equality-vs-tolerance boundary (#12); and content/order comparison (#13). This
change restores count reproducibility, which those issues build on.
