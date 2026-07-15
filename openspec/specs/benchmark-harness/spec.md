# benchmark-harness Specification

## Purpose

Defines the shared reference harness — the engine-neutral tool that owns the
benchmark measurement loop and the normative wall-clock timing of hook `run`
round-trips, enforces the two measurement scenarios (`preloaded_repeated` and
`end_to_end`) through process control of the hook's lifecycle, drives hooks
through the connector SPI (HTTP spawn/connect and CLI connectors), maps worker
failures onto the report status taxonomy with per-case isolation, verifies
output row counts from the written CSV independently of the engine under test,
and emits the native benchmark report plus its JMH export projection.
## Requirements
### Requirement: Harness owns the measurement loop and the normative timing

The reference harness SHALL own the measurement loop and the clock: for each
measured sample it wall-clock times one `run` command round-trip (HTTP request
written → response fully received, which by the hook contract arrives only
after the CSV is fully written). These
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

The harness SHALL implement both measurement scenarios with their timed
regions enforced by how it manages the hook's lifecycle, per the report
format's load-boundary distinction. For `preloaded_repeated` (HTTP hooks,
both lifecycle modes): setup (untimed) → `prepare` (untimed) → warmup `run`s
(discarded) → measured `run`s (each timed) → `shutdown` (spawn mode only).
For `end_to_end` in SPAWN mode: spawn + readiness (untimed — process/VM
startup of the hook SERVICE is not ETL cost) → a timed region covering the
`prepare` + `run` round-trips (phases `load` + `execute` + `extract`) → a
SERVICE RESTART between samples, so that every sample is dataset-cold BY
CONSTRUCTION: the harness never sent the dataset to that process before the
timed sample. For `end_to_end` in CONNECT mode: an UNTIMED `reset` precedes
each timed `prepare` + `run` region; dataset-coldness rests on the hook
honouring the reset contract (trusted — the service's process, and therefore
its runtime warmth, persists across samples). For `end_to_end` with a CLI
hook: each measured sample's timed region covers the `prepare` (a connector
no-op) and `run` round-trips, where `run` spawns a FRESH engine process from
the manifest's argv template and answers only after it exits — every sample
is dataset-cold by construction, and the engine process's own startup lands
INSIDE the timed region deliberately: it is the real cost of a one-off CLI
invocation (the untimed-startup rule above applies to hook SERVICES, not to
the engine command itself). The harness SHALL emit a report whose
`measurement.scenario`, `phases`, `sink` (`csv`), and warmup/iteration
counts describe what it actually did, and SHALL NOT emit a scenario it did
not drive.

#### Scenario: preloaded_repeated excludes load from every sample

- **WHEN** the harness runs a case under `preloaded_repeated`
- **THEN** `prepare` happens once outside every timed region, each sample times
  only a `run` round-trip, and the report declares
  `phases: ["execute", "extract"]`

#### Scenario: Spawn-mode end_to_end samples are dataset-cold via restart

- **WHEN** the harness collects three `end_to_end` samples for a spawn-mode
  hook
- **THEN** it spawns a fresh hook service per sample (spawn and readiness
  untimed), times `prepare` + `run` together per sample, and the report
  declares `phases: ["load", "execute", "extract"]`

#### Scenario: Connect-mode end_to_end samples reset before each timed region

- **WHEN** the harness collects `end_to_end` samples against a connect-mode
  hook
- **THEN** it sends an untimed `reset` before each sample's timed
  `prepare` + `run` region, and never restarts the operator-managed service

#### Scenario: CLI end_to_end samples time one fresh engine process each

- **WHEN** the harness collects `end_to_end` samples for a CLI hook
- **THEN** each sample's timed region covers the spawn-to-exit lifetime of
  one fresh engine process (including its startup), and the report declares
  `phases: ["load", "execute", "extract"]`

#### Scenario: The report never claims an unenforced scenario

- **WHEN** the harness produces a report
- **THEN** the report's `measurement.scenario` and `phases` describe the timed
  region the harness actually enforced, not a caller-supplied label

### Requirement: Worker lifecycle failures map onto the status taxonomy

The harness SHALL own the hook's lifecycle per the manifest's mode — in spawn
mode: start from `command`, probe readiness via `capabilities` within a
budget, `shutdown` on completion, terminate on abandonment; in connect mode:
connect to `endpoint`; `shutdown` is NOT sent and the service is never
terminated by the harness; for a CLI hook: no long-lived process exists, and
the connector spawns one engine process per `run`, in its own process group.
Failures SHALL map onto the report status taxonomy per its best-effort
rules: a transport-level failure while a case is in flight (connection
refused or reset, non-2xx status, unparseable body, or — spawn mode — the
hook process dying; for a CLI hook — the engine process failing to spawn)
yields `execution_error` for that case; a command exceeding the harness's
OWN out-of-band inactivity budget yields `timeout` for the in-flight case
(spawn mode kills the hook process; a CLI connector kills the in-flight
engine process group); an `{"ok":false}` response — for a CLI hook, a
non-zero engine exit, with a stderr tail as the `error` — yields
`execution_error` with the hook's `error` recorded as the advisory
`message`. After losing a hook the harness SHALL restore a usable one to
continue with the remaining cases — respawn in spawn mode, reconnect (with
`reset` + re-`prepare` where the scenario requires) in connect mode; a CLI
connector is usable again by construction, since the next `run` spawns
fresh — preserving the reference-runner contract's per-case failure
isolation: a failing case never aborts the run nor voids other cases'
recorded results, and a partial run still emits a valid report. All stock
connectors SHALL keep the engine in a separate OS process, so a hook crash
or hang can never take the harness down with it. A spawn-mode hook that
never becomes ready within the readiness budget, a connect-mode endpoint
that refuses the initial connection, or a CLI manifest whose template fails
placeholder validation SHALL fail the run's setup loudly rather than
recording per-case noise.

#### Scenario: Worker crash mid-case is recorded and the run continues

- **WHEN** a spawn-mode hook process dies while a case's `run` is in flight
- **THEN** that case is recorded as `execution_error`, the harness respawns
  the hook, and the remaining cases are attempted and recorded independently

#### Scenario: Unresponsive worker maps to timeout

- **WHEN** a `run` produces no response within the harness's inactivity budget
- **THEN** the harness records the case as `timeout`, kills the hook process
  in spawn mode, and continues with the remaining cases against a restored
  hook

#### Scenario: Hung CLI engine process maps to timeout

- **WHEN** a CLI hook's engine process produces no exit within the harness's
  inactivity budget
- **THEN** the harness kills that process group, records the case as
  `timeout`, and the remaining cases run normally with fresh processes

#### Scenario: Non-zero CLI exit is an engine failure, not a crash

- **WHEN** a CLI hook's engine process exits non-zero for one case
- **THEN** that case is recorded as `execution_error` with a stderr tail in
  its advisory `message`, and the remaining cases are attempted normally

#### Scenario: Readiness failure aborts setup loudly

- **WHEN** a spawn-mode hook never answers `capabilities` validly within the
  readiness budget
- **THEN** the harness reports a setup failure for the run rather than
  recording every case as a per-case failure

#### Scenario: Invalid CLI template aborts setup loudly

- **WHEN** a CLI manifest's `run` template contains an unknown placeholder or
  omits `{outCsv}`
- **THEN** the harness reports a setup failure for the run before attempting
  any case

### Requirement: Harness run selects a subset of cases

The harness `run` CLI SHALL accept `--only <ids>` and `--exclude <ids>`
(comma-separated case ids) that select which of the benchmark file's cases are
executed, by building a `caseFilter` predicate the runner applies before the
measurement loop. `--exclude` SHALL take precedence over `--only` on a conflict.
An id that matches no case SHALL be a loud error rather than a silent empty run.
The emitted report SHALL contain only the selected cases; unselected cases SHALL
NOT appear and SHALL NOT be prepared or measured.

#### Scenario: Run only the named cases

- **WHEN** `run --only condition-flat,encounter-flat` is invoked on a file with
  more cases
- **THEN** the report's case list contains exactly `condition-flat` and
  `encounter-flat`

#### Scenario: Exclude a case from an otherwise full run

- **WHEN** `run --exclude us-core-blood-pressures` is invoked
- **THEN** every case except `us-core-blood-pressures` is measured and reported

#### Scenario: Unknown case id fails loudly

- **WHEN** `--only no-such-case` names a case that does not exist
- **THEN** the run fails with an error naming the unknown id and measures nothing

### Requirement: Harness run streams its file reads and writes

The harness `run` path SHALL stream every whole-file interaction on both the input
and output sides in fixed-size chunks, never holding a whole resource file or a
whole output CSV in memory as one string or buffer. This keeps a measurement run —
not only a bless — memory-bounded at the largest tiers, where a single file can
exceed the JS engine's maximum string length (an ~9 GB `xl` resource file cannot
be read as one string at all, and a wide result's CSV can hit the same ceiling
even when the row objects fit).

On the INPUT side: the harness SHALL compute the per-resource line counts it
reports and verify the checkfile's per-file sha256 checksums by streaming each
resource file in chunks, and the reference `sof-js` hook SHALL ingest a resource
file by reading it in chunks so loading never allocates a whole-file string. On
the OUTPUT side: the harness SHALL count the output CSV's data rows by streaming
it in chunks (carrying RFC-4180 quote state across chunk boundaries), and the
reference hook SHALL write the output CSV by streaming its rows to disk rather than
building the whole CSV as one string. The parsed in-memory dataset the
`preloaded_repeated` scenario keeps resident, and the result-row array the
non-streaming `evaluate()` returns, are inherent to the engine and out of scope for
this bound — it bounds the LOAD, the COUNT and the WRITE, not the resident tables.

#### Scenario: Observing resource counts streams the file

- **WHEN** the harness reports the input row count for a resource at the `xl` tier
- **THEN** the count is obtained by streaming the file in chunks, never by reading
  the whole file into a single string

#### Scenario: Checksum verification streams the file

- **WHEN** the harness verifies a resource file against its locked sha256 before a
  run
- **THEN** the file is hashed by streaming it in chunks, never by buffering the
  whole file in memory

#### Scenario: The reference hook loads by streaming

- **WHEN** the `sof-js` hook prepares a resource from a single large NDJSON file
- **THEN** it reads and parses the file in chunks so loading never allocates a
  whole-file string, even though the parsed table it then holds resident is the
  `preloaded_repeated` scenario's inherent cost

#### Scenario: Counting output rows streams the CSV

- **WHEN** the harness counts the data rows of a run's output CSV to verify it
- **THEN** the count is obtained by streaming the CSV in chunks with RFC-4180 quote
  state carried across boundaries, never by reading the whole CSV into one string

#### Scenario: The reference hook writes the output CSV by streaming

- **WHEN** the `sof-js` hook writes the result CSV for a run
- **THEN** it streams the rows to disk through a bounded buffer, byte-identically to
  the whole-string serializer, so a wide result's CSV is never held as one
  whole-file string

### Requirement: Verification counts rows from the written CSV

The harness SHALL, for each successful case whose plan produces a result CSV
— every official scenario binding (the timed `run` writes it) and any custom
plan with `post-loop-extract` (the untimed `extract` writes it) —
derive the case's output row count by counting the rows of the CSV file the
hook wrote, and SHALL apply the work-verification guard against the checkfile
assertion for that case and size using THAT count — so verification is
independent of the engine under test. A custom plan whose timed region
materializes the result in-engine MAY instead verify via the untimed `count`
verb per the post-loop-verification requirement; such a count is
engine-reported, and the emitted record SHALL identify that provenance. The
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

### Requirement: Harness drives hooks through the connector SPI

The harness SHALL drive every scenario through the connector SPI — the
harness-internal interface `{ mode, capabilities, implementation, alive,
send(command), shutdown(), kill() }` — and SHALL select the connector from
the manifest's lifecycle discriminator: `endpoint` → HTTP connect connector,
`command` → HTTP spawn connector, `cli` → CLI connector. Scenario logic
SHALL remain in the harness's measurement loops; a connector only translates
protocol commands to its transport. The two HTTP connectors SHALL preserve
the pre-SPI worker behaviour exactly. The SPI is a harness extension seam,
not a public contract: the language-neutral contract for out-of-process
hooks remains the HTTP protocol, and implementer-supplied connector modules
are out of scope for this change.

#### Scenario: Connector selection follows the manifest

- **WHEN** the harness is given manifests declaring `endpoint`, `command`,
  and `cli` respectively
- **THEN** it drives the same scenario loops through the HTTP connect, HTTP
  spawn, and CLI connectors respectively, with no scenario logic in any
  connector

#### Scenario: HTTP hooks are unaffected by the SPI refactor

- **WHEN** an existing spawn- or connect-mode HTTP hook runs under the
  refactored harness
- **THEN** its lifecycle, timing, failure mapping, and report output are
  unchanged from the pre-SPI harness

### Requirement: Harness executes choreography through measurement plans

The harness SHALL drive every run through a single generic single-shot
executor parameterized by a declarative measurement plan — a closed data
record over fork level (`suite` | `trial` | `invocation`), untimed trial
setup, untimed invocation setup, timed region, verification
(`in-run-csv` | `post-loop-count` | `post-loop-extract`), and warmup policy.
The official scenarios SHALL be defined as named scenario bindings resolving
to plans whose observable semantics — process control, timed regions, warmup,
failure mapping, and reporting — are exactly those of the scenario-semantics
requirement; scenario logic SHALL NOT exist outside the binding lookup and
the plan-keyed executor behaviours. Plans SHALL be data only (no callbacks or
functions), and the executor SHALL reject, as a loud setup failure before any
case runs, a plan that is malformed or that combines `post-loop-count`
verification with a timed region that does not materialize the result
in-engine. Plans are a harness extension seam, not a public contract: the
public harness CLI SHALL accept only the official scenario names, and a
custom plan SHALL be reachable only through a harness module entry point.

#### Scenario: Official scenarios run as plan bindings unchanged

- **WHEN** an existing hook runs `preloaded_repeated` or `end_to_end` (any
  lifecycle mode) under the plan-driven harness
- **THEN** its lifecycle, timing, failure mapping, and report output are
  unchanged from the pre-plan harness

#### Scenario: Unsound count verification is rejected

- **WHEN** a caller supplies a plan combining `post-loop-count` verification
  with a timed region that does not materialize the result in-engine
- **THEN** the executor fails the run's setup loudly before any case runs,
  rather than recording engine-reported counts whose anti-laziness premise
  does not hold

#### Scenario: The public CLI drives only official scenarios

- **WHEN** the harness CLI is invoked with a scenario argument
- **THEN** only `preloaded_repeated` and `end_to_end` are accepted, and no
  CLI flag supplies a custom plan

### Requirement: Post-loop verification verbs for materializing plans

The harness SHALL support two untimed post-loop verification commands,
selected by the plan's verification value and issued once per case after the
sample loop, outside every timed region: `count` — the hook answers
`{ "ok": true, "rows": <n> }` by counting the materialized result in-engine —
and `extract` (`{ "cmd": "extract", "outCsv": … }`) — the hook fully writes
the result CSV (the same output-format contract as `run`) before responding,
and the harness derives the row count by counting that file itself. The
resulting count SHALL feed the work-verification guard exactly as a
CSV-derived count does, and the emitted record SHALL identify the count's
provenance (engine-reported for `count`; harness-counted for `extract`).
Official scenario bindings SHALL NOT issue either verb, so hooks written for
the official scenarios can never encounter them.

#### Scenario: count feeds the guard with provenance recorded

- **WHEN** a custom plan with `post-loop-count` completes its sample loop and
  the hook answers `rows` equal to the checkfile assertion for the case and
  size
- **THEN** the case is `ok` with `verified: true`, and the emitted record
  identifies the count as engine-reported

#### Scenario: extract produces a harness-counted CSV outside the clock

- **WHEN** a custom plan with `post-loop-extract` completes its sample loop
- **THEN** the harness issues one `extract` after the final sample, counts
  the written CSV itself, and no extraction time contributes to any sample

#### Scenario: Official hooks never see the verbs

- **WHEN** a run uses an official scenario binding
- **THEN** no `count` or `extract` command is sent at any point in the run

### Requirement: Custom-plan runs emit self-describing non-conforming records

A run driven by a custom plan SHALL emit a lossless report-shaped record
whose `measurement.scenario` is a namespaced non-official identifier
(`internal:<name>`), whose measurement block truthfully declares the phases,
sink, and warmup/iteration counts actually driven, and which embeds the plan
record verbatim as `measurement.plan`; the record SHALL be written under a
filename distinct from the native report's (`<stem>.internal-report.json`).
Official scenario names SHALL be derivable only from scenario bindings:
report assembly SHALL take a binding, and no harness code path SHALL stamp an
official scenario onto a custom-plan run. The JMH export MAY be projected
from an internal record, since JMH labels carry no conformance claim.

#### Scenario: Internal record fails the published report schema

- **WHEN** a custom-plan run's record is validated against
  `benchmark-report.schema.json`
- **THEN** validation fails on the non-official `measurement.scenario` value,
  so every consumer enforcing the published contract rejects the record

#### Scenario: Official stamp is unobtainable from a raw plan

- **WHEN** a caller drives the executor with a custom plan, even one
  structurally identical to an official binding's plan
- **THEN** the emitted record carries its `internal:<name>` scenario
  identifier, never an official scenario name

#### Scenario: JMH projection is available for internal records

- **WHEN** a custom-plan run completes with a JMH output directory configured
- **THEN** JMH files are projected from the internal record per
  `benchmark-jmh-format`

