## MODIFIED Requirements

### Requirement: Declarative recipes (WHAT vs HOW)

A dataset SHALL be described by a declarative recipe — a `kind`, a pinned
generator `version`, and `params` — and SHALL NOT embed a shell command or
function call. Environment-specific facts required to execute a recipe (a custom
Synthea jar path, a custom `java` binary) MAY live in tool-side configuration
outside the artifact, in a file that is not committed
(`tools/executors.config.json`); that configuration is an OPTIONAL OVERRIDE, NOT a
prerequisite. When it is absent, the materializer obtains the pinned generator
automatically (see the "Automatic pinned-generator acquisition" requirement); when
it is present, its jar path and/or `java` binary override the automatic
acquisition.

#### Scenario: Recipe carries no executable

- **WHEN** a benchmark file's `dataset` recipe is inspected
- **THEN** it contains only declarative fields (`kind`, `version`, `params`,
  `resources`, `sizes`, `defaultSize`, `name`) and no shell/JS call

#### Scenario: Environment config is an optional override

- **WHEN** the materialization tool runs with no `tools/executors.config.json`
- **THEN** materialization still proceeds by acquiring the pinned generator
  automatically; and when a `tools/executors.config.json` IS present, its custom
  jar path and/or `java` binary override that automatic acquisition

## ADDED Requirements

### Requirement: Automatic pinned-generator acquisition

The materializer SHALL be able to obtain the pinned generator AUTOMATICALLY,
without a hand-written configuration file. For the `synthea` kind it SHALL resolve
the recipe's pinned `dataset.syntheaVersion` to a published-release download URL
and an expected SHA-256 checksum via a COMMITTED pinned map in the tooling (keyed
by `syntheaVersion`), fetch the jar into a gitignored local cache directory (for
example `benchmark/.cache/synthea/`) if it is not already cached, and VERIFY the
fetched bytes against the pinned SHA-256 before using them. A checksum mismatch
SHALL fail materialization loudly rather than proceed with unverified bytes. A
subsequent materialization SHALL reuse the cached, verified jar and SHALL NOT
re-download it. Both the download URL and its SHA-256 SHALL be pinned in the
committed map (not discovered at runtime), so that pinning a new generator version
is an explicit, reviewed edit. This generator-jar checksum is distinct from and
complementary to the checkfile's per-file NDJSON sha256, and byte-reproducibility
of the materialized NDJSON is unaffected (it still depends only on
`recipe + generator version` under `TZ=UTC` plus line-canonicalization).

#### Scenario: Missing config triggers auto-fetch

- **WHEN** the materializer runs with no `tools/executors.config.json` and the
  pinned jar is not yet cached
- **THEN** it fetches the `dataset.syntheaVersion` jar from the pinned
  published-release URL, verifies it against the pinned SHA-256, caches it locally,
  and uses it

#### Scenario: Checksum mismatch fails loudly

- **WHEN** a fetched jar's SHA-256 does not match the pinned checksum for its
  `syntheaVersion`
- **THEN** materialization fails with an error and does not proceed with the
  unverified bytes

#### Scenario: Cached jar is reused

- **WHEN** the materializer runs a second time with the pinned jar already present
  in the cache
- **THEN** it reuses the cached jar and does not re-download it

#### Scenario: Config overrides auto-fetch

- **WHEN** a `tools/executors.config.json` supplies a jar path
- **THEN** the materializer uses that jar and does not auto-fetch

### Requirement: Generator runs in an isolated working directory

The materializer SHALL run the generator in an ISOLATED working directory so that
the generator's incidental artifacts (for the `synthea` kind, its `db.sqlite` and
its `public/export/<epoch>/` tree) do NOT land in the repo tree. The final
materialized NDJSON SHALL still be written to the identity-keyed layout
(`data/<name>/<version>/<size>/`) unchanged; only the generator's transient working
directory moves out of the repo root. The isolated directory MAY be a
per-materialization temporary directory that is cleaned up afterwards, OR a fixed
gitignored scratch directory — either satisfies this requirement.

#### Scenario: Generation artifacts do not land in the repo tree

- **WHEN** the `synthea` executor materializes a dataset
- **THEN** no `db.sqlite` and no `public/export/` tree is written into the repo
  tree, because the generator ran in an isolated working directory

#### Scenario: Materialized output still lands in the identity-keyed layout

- **WHEN** the generator runs in its isolated working directory
- **THEN** the produced per-resource NDJSON is still written to
  `data/<name>/<version>/<size>/`, unchanged from the identity-keyed layout
  requirement
