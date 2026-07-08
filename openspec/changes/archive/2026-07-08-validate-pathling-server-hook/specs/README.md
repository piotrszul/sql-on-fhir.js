# Delta specs — validate-pathling-server-hook

**No capability deltas.** Validating the Pathling **Server** hook — the deep
test of the full five-command HTTP protocol across both connect and spawn
lifecycle modes — was a clean pass that forced **no contract change of any
kind**.

Every spec-stress point the design raised was answered by the contract as it
already stands:

- **`reset` honesty for a Spark server** — the warm, long-lived server cannot
  reset-to-cold, so connect mode declares only `preloaded_repeated` and cold
  `end_to_end` is obtained via spawn (fresh container per sample). This is
  exactly what `benchmark-hook-format` already requires (*Reset discards
  prepared state*: omit from `capabilities` any scenario a deployment cannot
  honour; *Scenario declaration matches architectural capability*: two
  manifests per deployment, distinguished by `implementation.variant`).
- **"A second `prepare` REPLACES the dataset"** — implementable via `$import`
  `saveMode: overwrite`; satisfies the existing *Repeated prepare replaces the
  dataset* scenario.
- **`preloaded_repeated` warmth for a caching server** — warm per-query cost is
  the point of the scenario, correctly separated from cold `end_to_end` by the
  scenario/variant contract.
- **Expensive startup vs. the timed region** — container boot is untimed
  spawn/readiness; cold ETL is timed. The readiness budget was adequate.
- **Run-output CSV** — `$viewdefinition-run`'s single headed CSV satisfies the
  *Result CSV output format* requirement the Pathling CLI cycle added, with no
  per-hook effort — confirming that delta was deployment-neutral.

Because this change adds only temporary staging scaffolding (the adapter, two
`hook.json`s, README, FINDINGS) and no contract/harness/schema behaviour, no
test-first was required and no delta spec is carried. See
`benchmark/staging-hooks/pathling-server/FINDINGS.md` for the full record. This
is the deep protocol test passing clean — a candidate "quiet round" for the
exercise's exit criteria, which the teardown change owns.
