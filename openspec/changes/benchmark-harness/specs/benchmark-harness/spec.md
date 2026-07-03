# benchmark-harness Specification (delta)

## ADDED Requirements

### Requirement: Harness owns the measurement loop and the normative timing

The reference harness SHALL own the measurement loop and the clock: for each
measured sample it wall-clock times one `run` command round-trip (command
written to the worker's stdin → response line read from stdout, which by the
hook contract arrives only after the CSV is fully written). These
harness-timed round-trips ARE the report's `samplesMs`; no implementation
carries timing code, and hook-reported `phasesMs` are recorded only as the
advisory `phaseSamplesMs`. Warmup iterations SHALL be discarded. The harness
SHALL take its recommended warmup/measurement counts from the benchmark file's
`iterations` and SHALL record the counts actually used in the report's
`measurement` block.

#### Scenario: samplesMs are harness wall-clock round-trips

- **WHEN** the harness measures a case with `measurement: 5`
- **THEN** the case's `samplesMs` are exactly five harness-measured `run`
  round-trip times, and any hook-reported `phasesMs` appear only as
  `phaseSamplesMs`

#### Scenario: Warmup runs are discarded

- **WHEN** the harness runs a case with `warmup: 2` and `measurement: 5`
- **THEN** it issues seven `run` commands and reports five samples

### Requirement: Scenario semantics are enforced by process control

The harness SHALL implement both measurement scenarios with their timed regions
enforced by how it manages the worker, per the report format's load-boundary
distinction. For `preloaded_repeated`: spawn (untimed) → `prepare` (untimed) →
warmup `run`s (discarded) → measured `run`s (each timed) → `shutdown`. For
`end_to_end`: spawn (untimed — process/VM startup is not ETL cost) → a timed
region covering the `prepare` + `run` round-trips (phases
`load` + `execute` + `extract`) → and a WORKER RESTART between samples, so that
every `end_to_end` sample is dataset-cold BY CONSTRUCTION: the harness never
sent the dataset to that worker process before the timed sample. The harness
SHALL emit a report whose `measurement.scenario`, `phases`, `sink` (`csv`), and
warmup/iteration counts describe what it actually did, and SHALL NOT emit a
scenario it did not enforce.

#### Scenario: preloaded_repeated excludes load from every sample

- **WHEN** the harness runs a case under `preloaded_repeated`
- **THEN** `prepare` happens once outside every timed region, each sample times
  only a `run` round-trip, and the report declares
  `phases: ["execute", "extract"]`

#### Scenario: end_to_end samples are dataset-cold via worker restart

- **WHEN** the harness collects three `end_to_end` samples for a case
- **THEN** it spawns a fresh worker per sample (spawn untimed), times
  `prepare` + `run` together per sample, and the report declares
  `phases: ["load", "execute", "extract"]`

#### Scenario: The report never claims an unenforced scenario

- **WHEN** the harness produces a report
- **THEN** the report's `measurement.scenario` and `phases` describe the timed
  region the harness actually enforced, not a caller-supplied label

### Requirement: Worker lifecycle failures map onto the status taxonomy

The harness SHALL own the worker's lifetime — spawn from the hook manifest,
`shutdown` on completion, SIGTERM on abandonment — and SHALL map lifecycle
failures onto the report status taxonomy per its best-effort rules: a worker
that crashes while a case is in flight yields `execution_error` for that case;
a worker that exceeds the harness's OWN out-of-band inactivity budget is
killed and the in-flight case is recorded as `timeout`; an `{"ok":false}`
response yields `execution_error` with the hook's `error` recorded as the
advisory `message`. After killing or losing a worker the harness SHALL respawn
it (and re-`prepare` where the scenario requires) to continue with the
remaining cases, preserving the reference-runner contract's per-case failure
isolation: a failing case never aborts the run nor voids other cases' recorded
results, and a partial run still emits a valid report.

#### Scenario: Worker crash mid-case is recorded and the run continues

- **WHEN** the worker process dies while a case's `run` is in flight
- **THEN** that case is recorded as `execution_error`, the harness respawns the
  worker, and the remaining cases are attempted and recorded independently

#### Scenario: Unresponsive worker maps to timeout

- **WHEN** a `run` produces no response line within the harness's inactivity
  budget
- **THEN** the harness kills the worker, records the case as `timeout`, and
  continues with the remaining cases in a fresh worker

### Requirement: Verification counts rows from the written CSV

For each successful `run` the harness SHALL derive the case's output row count
by counting the rows of the CSV file the hook wrote, and SHALL apply the
work-verification guard against the checkfile assertion for that case and size
using THAT count — so verification is independent of the engine under test. The
guard follows the reference-runner contract: present + match ⇒ `ok`; present +
mismatch (and not count-variance-permitted) ⇒ `count_mismatch`; absent ⇒ `ok`
(recorded as unverified via the report's `verified` flag). A hook-reported
`outputRows` disagreeing with the harness count is surfaced in the advisory
`message`.

#### Scenario: The harness count feeds the guard

- **WHEN** a hook writes a CSV with 48908 rows and the checkfile assertion for
  the case and size is 48908
- **THEN** the case is `ok` with `verified: true`, regardless of what
  `outputRows` the hook reported

#### Scenario: CSV-derived mismatch is flagged

- **WHEN** the harness's CSV count differs from a present assertion on a case
  that is not count-variance-permitted
- **THEN** the case is recorded as `count_mismatch`

### Requirement: Harness emits the native report and the JMH export

The harness SHALL emit the native report conforming to
`benchmark-report.schema.json` — sourcing `implementation` verbatim from the
hook manifest, benchmark and dataset identity from the authored suite, and
per-case results keyed by the stable case `id` — and SHALL be able to emit the
JMH export as a projection of that report per `benchmark-jmh-format`. The
harness VERIFIES against an existing checkfile only; bless mode (writing the
checkfile, with the analytic cross-check) remains the sof-js reference
implementation's concern per the reference-runner contract.

#### Scenario: One harness run yields report and optional JMH files

- **WHEN** the harness completes a run with a JMH output directory configured
- **THEN** it writes a conforming native report and the per
  `(benchmark, size, implementation)` JMH export files projected from that
  report

#### Scenario: The harness does not bless

- **WHEN** the harness runs against a suite with no checkfile present
- **THEN** it does not create one — cases are reported `ok` but unverified —
  and blessing remains a sof-js `--record` operation
