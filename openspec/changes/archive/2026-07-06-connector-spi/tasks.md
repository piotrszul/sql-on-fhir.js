# Tasks — connector-spi

Test-first throughout (Constitution III): each group writes its failing tests
before the code that makes them pass. Existing HTTP worker/runner/cli tests
are the behaviour-preservation regression guard and must pass unchanged at
every step.

## 1. Manifest contract: the `cli` branch

- [x] 1.1 Extend `benchmark/tests/hook-schema.test.js` first: a `cli.run`
      manifest with `implementation.engine` validates; any two of
      `command`/`endpoint`/`cli` (and none) are rejected; unknown top-level
      properties still rejected; existing spawn/connect fixtures still pass.
- [x] 1.2 Add the `cli` branch to `benchmark/benchmark-hook.schema.json`:
      `oneOf` gains `{ "required": ["cli"] }`; `cli` is an object with a
      required `run` argv template (`minItems: 1`),
      `additionalProperties: false`; top-level description updated for the
      third mode.
- [x] 1.3 Update `benchmark/tools/harness/manifest.js` docs/validation so a
      `cli` manifest loads with `cwd` resolved against the manifest
      directory, same as spawn mode (test in the existing manifest tests).

## 2. Connector SPI extraction (behaviour-preserving)

- [x] 2.1 Rename `startWorker` → `startConnector` in
      `benchmark/tools/harness/worker.js` and add the three-way manifest
      dispatch (`endpoint` → connect, `command` → spawn, `cli` → CLI); update
      the single importer (`runner.js`). No behavioural change for HTTP
      hooks: `benchmark/tests/harness-worker.test.js` and
      `harness-runner.test.js` pass without edits.
- [x] 2.2 Extract the process-group kill/escalation helpers (`killGroup`,
      SIGTERM → SIGKILL policy) so the CLI connector can share them, keeping
      `worker.js`'s spawn-mode behaviour byte-for-byte identical.

## 3. CLI connector

- [x] 3.1 Write `benchmark/tests/harness-cli-connector.test.js` first, with a
      fixture script under `benchmark/tests/fixtures/hooks/` (e.g.
      `fake-cli.js`: reads the view file and dataDir from argv, writes a
      deterministic CSV to the `{outCsv}` path; flags to exit non-zero, hang,
      and write to stderr) plus a `fake-cli.hook.json` manifest. Cover:
      synthesized capabilities are exactly
      `{ok:true, scenarios:["end_to_end"]}`; template substitution inside
      elements (`--out={outCsv}`); no shell interpretation; `prepare`/`reset`
      answer ok without spawning; `run` answers only after child exit with
      the CSV complete; non-zero exit → `{ok:false}` with exit status +
      stderr tail, connector still usable; missing binary → `WorkerCrash`;
      hang → `WorkerTimeout` with the process group killed; unknown
      placeholder and missing `{outCsv}` → `SetupError` before any spawn.
- [x] 3.2 Implement `benchmark/tools/harness/cli-connector.js` per design D3:
      placeholder validation at startup (SetupError), synthesized
      capabilities, per-`run` temp view file + fresh child in its own
      process group, exit-code → ok/ok:false mapping, timeout kill via the
      shared escalation helpers, no-op `shutdown`/`reset`.

## 4. Runner integration

- [x] 4.1 Extend `benchmark/tests/harness-runner.test.js` first: an
      `end_to_end` suite against the `cli` fixture manifest produces a
      conforming report with `phases: ["load","execute","extract"]`,
      `warmup: 0`, harness-counted `outputRows`, and `implementation` copied
      verbatim; each sample spawned a fresh process (fixture counts
      invocations); `preloaded_repeated` against the same manifest is
      refused as a run-level SuiteError naming the declared scenarios; a
      case whose fixture run exits non-zero is `execution_error` with a
      stderr tail in `message` while sibling cases stay `ok`.
- [x] 4.2 Confirm `runner.js` needs no scenario-loop changes beyond the
      `startConnector` import (design D1/D3); if any leak of connector
      concerns into the loops proves necessary, stop and revisit the design
      instead of patching around it.
- [x] 4.3 Extend `benchmark/tests/harness-cli.test.js`: `bench:harness run`
      with a `cli` manifest end-to-end through the CLI entry point, report
      written and schema-valid.

## 5. Docs and verification

- [x] 5.1 Update `benchmark/README.md` (or the harness section): the three
      manifest modes, the zero-code CLI hook example, the
      scenario-declaration decision table (two verb-level questions), and
      the documented CLI-startup-inside-timed-region asymmetry (design D4).
- [x] 5.2 Full pipeline green: `bun test`, `bun run validate`,
      `bun run check-fmt`; `openspec validate connector-spi --strict`.
