# Benchmark contract validation via staging hooks — design

Date: 2026-07-07
Status: approved
Relates to: `docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`

## Goal

Validate the benchmark contract (hook manifest + protocol, harness, schemas,
report/JMH formats, materialization) against three real, independent
implementations — **flatquack**, **Pathling CLI**, and **Pathling Server** —
and fold every friction point back into the contract before external
implementers adopt it. The three targets deliberately cover the whole
lifecycle-mode matrix: two CLI-mode manifests (one non-JVM, one JVM) and one
full five-command HTTP hook exercised in both connect and spawn modes.

## Where the glue lives

The end-state model is unchanged: hooks live in each implementation's repo,
and no engine-specific execution code ships here. During validation the
contract is the unstable side, so the glue is developed **in this repository**
as explicitly temporary scaffolding, so that a contract change and the hook
adjustments it forces land atomically in one reviewed commit.

```
benchmark/staging-hooks/
  README.md                  # the scaffolding contract (see below)
  flatquack/hook.json        + FINDINGS.md
  pathling-cli/hook.json     + FINDINGS.md
  pathling-server/hook.json  + adapter source + FINDINGS.md
```

The scaffolding contract, stated in `staging-hooks/README.md`:

- Everything engine-specific lives only under `benchmark/staging-hooks/`.
- The directory is temporary. It is deleted in the migration step (below)
  before `staging/benchmark` promotes to `main`.
- Findings are recorded per target (one `FINDINGS.md` per subdirectory) to
  keep parallel branches conflict-free.

## Workflow

Each target is an independent OpenSpec change, implemented in a **separate
session/context** on its own feature branch, and merged into
`staging/benchmark` via a reviewed PR:

1. `validate-flatquack-hook`
2. `validate-pathling-cli-hook`
3. `validate-pathling-server-hook`

This bootstrap change creates the three change directories with
proposal-level basics, this design doc, and the `staging-hooks/` scaffolding
README, so any fresh session can pick up a change with
`/opsx:continue <change>` (or `/opsx:explore <change>`) and nothing else.

**Ordering rule.** Exploration of any change is free at any time.
*Implementation* of change N+1 branches off `staging/benchmark` only after
change N's PR has merged, so contract fixes flow forward and each later hook
is validated against the amended contract.

**Contract changes stay inside the cycle.** A finding that forces a
schema/harness/doc change is implemented in that same change — test-first per
the constitution, with a delta spec against the affected capability — so the
reviewer sees the friction and the fix together.

## Per-target design (in order)

### 1. flatquack — first contact, zero glue

A pure CLI-mode manifest modeled on
`benchmark/tests/fixtures/hooks/fake-cli.hook.json`. Uniquely stresses:
argv-template expressiveness (`{dataDir}`, `{viewFile}`, `{outCsv}`),
consumability of the materialized NDJSON by an external non-JVM engine,
checkfile verification against a non-reference engine, and report identity
fields. If flatquack's CLI cannot be expressed in the template, that is
itself a finding: either the template contract grows or flatquack gains a
small CLI affordance in its own repo — decided per finding.

### 2. Pathling CLI — JVM in the timed region

A second CLI-mode manifest. Uniquely stresses: the deliberate "timed region
includes process startup" decision (do the harness's warmup/sample statistics
stay meaningful with multi-second JVM boot?), `implementation.variant` as the
disambiguator against the server deployment of the same engine, and — as the
first strongly-typed engine — the predicted `column.type` /
ShareableViewDefinition mismatches in the benchmark cases (the
"second-runner signal" the benchmark README anticipates).

### 3. Pathling Server — the protocol test

A small adapter service written in Bun/JS (matching repo tooling; structured
after `sof-js/src/hook.js`) translating the five hook commands to Pathling's
REST API: import NDJSON on `prepare`, execute the ViewDefinition and write
CSV on `run`, discard the dataset on `reset`. Exercised in **connect mode
first** (Pathling operator-managed), then **spawn mode** (the adapter owns
the Pathling lifecycle), which makes `end_to_end`'s restart-per-sample
semantics real. Known spec-stress points to probe deliberately: is `reset`
honest for a Spark-backed server; is "a second `prepare` REPLACES"
implementable; do `preloaded_repeated` numbers mean what the README claims
for a caching server.

## Validation protocol and findings taxonomy

The same pass for every target: validate `hook.json` against
`benchmark-hook.schema.json` → run the harness on `clinical-flat` at size `s`
then `m`, in every scenario the hook declares → confirm checkfile row counts
→ inspect the report and JMH export for consumability. Every friction point
becomes a `FINDINGS.md` entry tagged with exactly one outcome:

- **contract defect** — schema/harness behaviour is wrong; fixed here,
  test-first.
- **contract gap** — a capability the contract is missing; added here,
  test-first, delta spec included.
- **doc gap** — README/spec wording insufficient; fixed here.
- **benchmark-case defect** — a case fails on a conforming engine (e.g.
  `column.type` mismatches); case fixed, checkfile re-blessed.
- **tool defect** — the implementation under test is wrong; fixed in the
  tool's repo, cross-referenced from the finding.

## Exit criteria and migration

The exercise is complete when all three hooks finish a full pass — every
declared scenario, sizes `s` and `m`, counts verified — **without requiring
any contract change** (one quiet round). Then a final teardown change:

1. move each hook to its implementation's repo;
2. distill the three `FINDINGS.md` files into the benchmark README/spec where
   durable;
3. delete `benchmark/staging-hooks/` entirely, restoring the "no
   engine-specific execution code ships here" invariant, with
   `sof-js/hook.json` remaining the only in-repo hook example.
