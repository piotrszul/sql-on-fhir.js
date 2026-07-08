# Pathling Server staging hook

HTTP-hook (five-command protocol) benchmark hook for
[Pathling](https://github.com/aehrc/pathling) driven as a **FHIR server** over
its REST API — the deep protocol test of the benchmark contract. A small Bun/JS
adapter (`pathling-server-hook.js`, structured after `sof-js/src/hook.js`)
translates the protocol to Pathling's REST operations:

- `prepare` → `POST {base}/$import` (`saveMode: overwrite`, `Prefer:
  respond-async`, poll the `$job` URL). Overwrite gives `prepare` its REPLACE
  semantics: each type is deleted and re-ingested from its NDJSON file.
- `run` → `POST {base}/$viewdefinition-run` (`Accept: text/csv`, header row);
  the CSV response is written verbatim to `outCsv` — one headed file, as the
  run-output contract requires.
- `reset` → best-effort no-op: a Spark-backed server has no REST bulk-clear, so
  freshness of the queried types is carried by `prepare`'s overwrite.
- `shutdown` → (spawn mode) stops the owned container; then exits.

Two deployments, one adapter:

| file               | mode    | scenarios declared                  | who owns Pathling |
| ------------------ | ------- | ----------------------------------- | ----------------- |
| `hook.connect.json`| connect | `preloaded_repeated`                | operator          |
| `hook.spawn.json`  | spawn   | `preloaded_repeated`, `end_to_end`  | the adapter       |

Connect mode declares only `preloaded_repeated`: a long-lived Spark server keeps
its JVM/Spark/dataset caches warm across samples, so an `end_to_end` "cold"
sample would not be honestly cold (see `FINDINGS.md`). Spawn mode gets coldness
by construction — the harness restarts a fresh adapter (hence a fresh, empty
container) per `end_to_end` sample.

## Prerequisites (machine-local, temporary scaffolding — see `../README.md`)

- **Docker** (Desktop or a daemon). The only supported local bring-up for the
  Pathling **server** is its image `ghcr.io/aehrc/pathling:latest`
  (`docker pull` it once; it is large and runs a Spark JVM with a ≥2 GB heap).
- **Bun** for the adapter (repo tooling).
- The benchmark data must be materialized under `benchmark/data` (the adapter
  mounts that directory into the container at an identical absolute path and
  hands Pathling `file://` URLs verbatim).

## Connect mode (run this first)

Start an operator-managed Pathling server with the data root mounted at its own
absolute path and `$import` allowed to read it:

```
DATA_ROOT="$(cd benchmark/data && pwd)"
docker run --rm -d --name pathling-bench -p 8080:8080 \
  --mount "type=bind,source=$DATA_ROOT,target=$DATA_ROOT,readonly" \
  -e "pathling.import.allowableSources=file://$DATA_ROOT/" \
  ghcr.io/aehrc/pathling:latest
# wait for GET http://127.0.0.1:8080/fhir/metadata to answer 200
```

Start the adapter on the port `hook.connect.json` names (9797), pointed at that
server:

```
cd benchmark/staging-hooks/pathling-server
PATHLING_BASE=http://127.0.0.1:8080/fhir HOOK_PORT=9797 bun pathling-server-hook.js
```

Run the pass from the repo root:

```
bun run bench:harness run --hook benchmark/staging-hooks/pathling-server/hook.connect.json \
    benchmark/clinical-flat.json --size s --scenario preloaded_repeated --strict \
    --out report-s.json
```

## Spawn mode

The adapter owns the container lifecycle (starts one with an ephemeral warehouse
on bring-up, stops it on shutdown), so no operator server is needed:

```
bun run bench:harness run --hook benchmark/staging-hooks/pathling-server/hook.spawn.json \
    benchmark/clinical-flat.json --size s --scenario end_to_end --strict \
    --out report-e2e-s.json
```

Adapter env knobs (both defaulted): `PATHLING_IMAGE` (image ref),
`HOOK_DATA_ROOT` (host data root to mount, defaults to this repo's
`benchmark/data`).
