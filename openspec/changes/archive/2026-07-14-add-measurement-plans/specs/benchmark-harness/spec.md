# benchmark-harness — delta for add-measurement-plans

## ADDED Requirements

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

## MODIFIED Requirements

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
