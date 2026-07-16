## 1. Test-first: capture the failing expectation

- [x] 1.1 Update `benchmark/tests/jmh.test.js`'s
      `'benchmark name is <benchmark.name>.<case.id>; size and implementation are params'`
      test to assert `params` is exactly `{ size }` (no `implementation` key),
      and observe it fail against the current implementation.

## 2. Implementation

- [x] 2.1 In `benchmark/tools/harness/jmh.js`'s `jmhEntry`, change
      `params: { size, implementation: implId }` to `params: { size }`.
- [x] 2.2 Confirm `implId`/`implementationId` is still used for the file name
      (`outputStem`) so the implementation axis stays recoverable from the
      file name, unchanged.

## 3. Verify

- [x] 3.1 `bun test` — full suite green, including the updated `jmh.test.js`.
      (4 pre-existing failures/3 errors in `sof-js/tests/server/*` are
      unrelated — reproduced identically on a clean `staging/benchmark`.)
- [x] 3.2 `bun run validate` — schema validation passes (no test-case JSON
      touched, so this should be a no-op check).
- [x] 3.3 `bun run check-fmt` — formatting check passes.

## 4. Refine

- [x] 4.1 Run the `simplify` skill over the diff and apply accepted findings.
      (All 4 angles — reuse, simplification, efficiency, altitude — found
      nothing to change.)
- [x] 4.2 Run the `code-review` skill over the diff and apply accepted
      findings. (Fixed a stale doc comment on `implementationId`; the
      main-spec-not-yet-synced observation is expected, resolved by the
      archive step in section 5.)
- [x] 4.3 Re-run section 3 verification if any code changed during refine.

## 5. Close out

- [x] 5.1 `/opsx:verify` this change against its artifacts. (No CRITICAL or
      WARNING issues; ready for archive.)
- [x] 5.2 `/opsx:archive` this change, syncing `benchmark-jmh-format`'s
      updated spec into `openspec/specs/`, in the same PR.
