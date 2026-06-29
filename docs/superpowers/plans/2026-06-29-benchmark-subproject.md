# Benchmark Subproject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an implementation-agnostic SQL-on-FHIR benchmark subproject — inline benchmark files (view + declarative Synthea dataset recipe + per-size expected row counts), a reference data-materialization tool, schema+invariant validation, and a `sof-js` reference benchmark-runner that produces conforming result reports and blesses the expected counts.

**Architecture:** A new top-level `benchmark/` directory holds declarative JSON artifacts (`benchmark.schema.json`, `benchmark-report.schema.json`, inline `*.json` benchmark files) and a Bun/JS materialization tool under `benchmark/tools/`. The tool resolves a benchmark file (or group) + size → declarative recipe(s) → a **pluggable `kind → executor` registry** that materializes NDJSON into an untracked `data/` directory under a content-hashed layout with a provenance manifest. The reference benchmark-runner lives in `sof-js` (an implementation), consuming the materialized NDJSON via `sof-js`'s existing `evaluate()`. The artifact itself contains no execution/timing code.

**Tech Stack:** Bun (runtime + `bun test`), JavaScript ESM, `ajv` 8 + `ajv-cli` (JSON Schema validation), Synthea 3.2.0 (data generation, shelled out via Java; environment-specific config out of the artifact).

## Global Constraints

- **Runtime:** Bun. Verification pipeline is `bun test`, `bun run validate`, `bun run check-fmt`; no check may be weakened or skipped (Constitution V).
- **Module system:** ESM (`"type": "module"`). Match `sof-js` prettier config: `printWidth: 110, tabWidth: 2, semi: false, singleQuote: true`.
- **Language-neutral artifact (Constitution II):** `benchmark/*.json` and schemas are declarative. No shell/JS calls embedded in a recipe. Environment-specific facts (jar path, `java` binary) live ONLY in tool-side config, never in a benchmark file.
- **Test-first (Constitution III):** every behavioural change gets a failing test first.
- **FHIR version:** v1 fixes `fhirVersion: "4.0.1"` (what Synthea 3.2.0 emits).
- **Single-resource by measurement setup, not by syntax:** views may use any FHIRPath, **including `getResourceKey()` and `getReferenceKey()`**. The "single resource / no joins" property comes from the measurement setup (one ViewDefinition over one materialized resource type, timed as a reverse-ETL), not from restricting view syntax. The only validated view invariant is that each case's `view.resource` ∈ its dataset's `resources`. `bench:validate` does NOT restrict reference functions.
- **On-disk layout contract:** `data/<name>_<hash>/<size>/<ResourceType>.ndjson` (one resource per line) + `data/<name>_<hash>/<size>/manifest.json`. `<hash>` = short content hash of the recipe.
- **Demographic generation ceiling:** Synthea has no per-resource export filter → generate-then-prune. v1 caps demographic (Patient-rooted) dataset populations at 10,000; larger awaits `kind: download`.
- **`data/` is untracked.** Bless `expectCount` only by reviewed change with an analytic cross-check; `expectCount` is implicitly keyed by the recipe's Synthea `version`.

---

### Task 1: Scaffold `benchmark/` subproject + `benchmark.schema.json`

**Files:**
- Create: `benchmark/package.json`
- Create: `benchmark/.gitignore`
- Create: `benchmark/benchmark.schema.json`
- Create: `benchmark/tests/schema.test.js`
- Modify: `package.json` (root — add `bench:*` scripts)

**Interfaces:**
- Produces: the structural JSON Schema `benchmark/benchmark.schema.json` (id `https://sql-on-fhir.org/ig/benchmark`); root scripts `bench:test`, `bench:validate`.

- [ ] **Step 1: Create `benchmark/package.json`**

```json
{
  "name": "sof-benchmark",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "description": "Implementation-agnostic SQL on FHIR benchmark artifact and reference materialization tool",
  "scripts": {
    "test": "bun test",
    "validate": "ajv -s benchmark.schema.json -d \"*.json\" --strict=false && bun run tools/validate-benchmarks.js",
    "data": "bun run tools/cli.js"
  },
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-cli": "^5.0.0"
  },
  "prettier": {
    "printWidth": 110,
    "tabWidth": 2,
    "semi": false,
    "singleQuote": true
  }
}
```

- [ ] **Step 2: Create `benchmark/.gitignore`**

```
data/
tools/executors.config.json
```

- [ ] **Step 3: Create `benchmark/benchmark.schema.json`**

```json
{
  "$id": "https://sql-on-fhir.org/ig/benchmark",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SQL on FHIR benchmark schema",
  "description": "Inline benchmark file: a dataset recipe paired with ViewDefinition cases and per-size expected row counts.",
  "type": "object",
  "required": ["title", "fhirVersion", "dataset", "cases"],
  "properties": {
    "title": { "type": "string" },
    "description": { "type": "string" },
    "group": { "type": "string", "description": "Flat label coordinating multi-file benchmarks." },
    "fhirVersion": { "type": "string", "enum": ["4.0.1"] },
    "iterations": {
      "type": "object",
      "properties": {
        "warmup": { "type": "integer", "minimum": 0 },
        "measurement": { "type": "integer", "minimum": 1 }
      },
      "required": ["warmup", "measurement"],
      "additionalProperties": false
    },
    "dataset": {
      "type": "object",
      "required": ["name", "kind", "version", "resources", "sizes", "defaultSize"],
      "properties": {
        "name": { "type": "string", "description": "Human-readable; part of the on-disk dir key." },
        "kind": { "type": "string", "enum": ["synthea"] },
        "version": { "type": "string", "description": "Pinned generator version." },
        "resources": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "params": { "type": "object" },
        "sizes": {
          "type": "object",
          "minProperties": 1,
          "additionalProperties": {
            "type": "object",
            "required": ["population"],
            "properties": { "population": { "type": "integer", "minimum": 1 } }
          }
        },
        "defaultSize": { "type": "string" }
      },
      "additionalProperties": false
    },
    "cases": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["title", "view"],
        "properties": {
          "title": { "type": "string" },
          "description": { "type": "string" },
          "view": { "type": "object", "required": ["resource"] },
          "expectCount": { "type": "object", "additionalProperties": { "type": "integer", "minimum": 0 } }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 4: Write the failing test `benchmark/tests/schema.test.js`**

```js
import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark.schema.json'

const ajv = new Ajv({ strict: false })
const validate = ajv.compile(schema)

const goodFile = {
  title: 'clinical-flat',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'synthea-clinical',
    kind: 'synthea',
    version: '3.2.0',
    resources: ['Condition'],
    sizes: { s: { population: 100 } },
    defaultSize: 's',
  },
  cases: [{ title: 'condition flat', view: { resource: 'Condition' } }],
}

test('a well-formed benchmark file passes the schema', () => {
  expect(validate(goodFile)).toBe(true)
})

test('a benchmark file missing fhirVersion fails the schema', () => {
  const bad = structuredClone(goodFile)
  delete bad.fhirVersion
  expect(validate(bad)).toBe(false)
})

test('an unknown top-level property fails the schema', () => {
  const bad = { ...goodFile, bogus: 1 }
  expect(validate(bad)).toBe(false)
})
```

- [ ] **Step 5: Install deps and run the test to verify it passes**

Run:
```bash
cd benchmark && bun install && bun test tests/schema.test.js
```
Expected: 3 tests pass. (If `bun install` is offline-blocked, the deps mirror `sof-js`'s already-installed `ajv`/`ajv-cli` versions.)

- [ ] **Step 6: Add root scripts** — modify root `package.json` `scripts` block, adding:

```json
    "bench:test": "cd benchmark && bun test",
    "bench:validate": "cd benchmark && bun run validate"
```

- [ ] **Step 7: Commit**

```bash
git add benchmark/package.json benchmark/.gitignore benchmark/benchmark.schema.json benchmark/tests/schema.test.js package.json
git commit -m "feat(benchmark): scaffold subproject and structural benchmark schema"
```

---

### Task 2: Invariant validator (`tools/validate-benchmarks.js`)

JSON Schema can't express the cross-field invariants. This adds a JS validator the `validate` script already chains after `ajv`.

**Files:**
- Create: `benchmark/tools/validate-benchmarks.js`
- Create: `benchmark/tests/validate-benchmarks.test.js`

**Interfaces:**
- Produces: `export function validateBenchmark(file): string[]` (returns array of error strings; empty = valid). `export function validateGroup(files): string[]` (cross-file group-tier consistency). `export async function main(dir): number` (process exit code; scans `dir`).

- [ ] **Step 1: Write the failing test `benchmark/tests/validate-benchmarks.test.js`**

```js
import { test, expect } from 'bun:test'
import { validateBenchmark, validateGroup } from '../tools/validate-benchmarks.js'

const base = () => ({
  title: 't',
  fhirVersion: '4.0.1',
  dataset: {
    name: 'd', kind: 'synthea', version: '3.2.0',
    resources: ['Condition'],
    sizes: { s: { population: 100 }, m: { population: 1000 } },
    defaultSize: 's',
  },
  cases: [{ title: 'c', view: { resource: 'Condition' }, expectCount: { s: 10, m: 100 } }],
})

test('a valid file yields no errors', () => {
  expect(validateBenchmark(base())).toEqual([])
})

test('case view.resource must be in dataset.resources', () => {
  const f = base()
  f.cases[0].view.resource = 'Patient'
  expect(validateBenchmark(f)).toContain('case "c": view.resource "Patient" not in dataset.resources')
})

test('reference functions are allowed (single-resource is a measurement-setup property)', () => {
  const f = base()
  f.cases[0].view.select = [
    { column: [{ name: 'id', path: 'getResourceKey()' }, { name: 'subj', path: 'getReferenceKey(subject)' }] },
  ]
  expect(validateBenchmark(f)).toEqual([])
})

test('expectCount keys must be declared sizes', () => {
  const f = base()
  f.cases[0].expectCount = { s: 10, XL: 1 }
  expect(validateBenchmark(f).some((e) => e.includes('expectCount size "XL"'))).toBe(true)
})

test('defaultSize must be a declared size', () => {
  const f = base()
  f.dataset.defaultSize = 'nope'
  expect(validateBenchmark(f).some((e) => e.includes('defaultSize'))).toBe(true)
})

test('group members must declare identical size-tier names', () => {
  const a = base(); a.group = 'g'
  const b = base(); b.group = 'g'; b.dataset.sizes = { s: { population: 5 } }
  expect(validateGroup([a, b]).some((e) => e.includes('group "g"'))).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd benchmark && bun test tests/validate-benchmarks.test.js`
Expected: FAIL — `Cannot find module '../tools/validate-benchmarks.js'`.

- [ ] **Step 3: Implement `benchmark/tools/validate-benchmarks.js`**

```js
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function validateBenchmark(file) {
  const errors = []
  const ds = file.dataset || {}
  const sizes = Object.keys(ds.sizes || {})

  if (ds.defaultSize && !sizes.includes(ds.defaultSize))
    errors.push(`defaultSize "${ds.defaultSize}" is not a declared size`)

  for (const c of file.cases || []) {
    const res = c.view?.resource
    if (res && !(ds.resources || []).includes(res))
      errors.push(`case "${c.title}": view.resource "${res}" not in dataset.resources`)
    // NOTE: reference functions (getResourceKey/getReferenceKey) are intentionally
    // NOT restricted — single-resource is a measurement-setup property, not syntax.

    for (const sz of Object.keys(c.expectCount || {})) {
      if (!sizes.includes(sz)) errors.push(`case "${c.title}": expectCount size "${sz}" is not a declared size`)
    }
  }
  return errors
}

export function validateGroup(files) {
  const errors = []
  const groups = {}
  for (const f of files) if (f.group) (groups[f.group] ||= []).push(f)
  for (const [g, members] of Object.entries(groups)) {
    const tierSets = members.map((m) => Object.keys(m.dataset?.sizes || {}).sort().join(','))
    if (new Set(tierSets).size > 1)
      errors.push(`group "${g}": members declare differing size-tier names (${[...new Set(tierSets)].join(' vs ')})`)
  }
  return errors
}

export async function main(dir = '.') {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'package.json')
  const parsed = []
  let failed = 0
  for (const name of files) {
    let doc
    try {
      doc = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      continue // not a benchmark file (e.g. a schema); ajv step covers schema shape
    }
    if (!doc.dataset || !doc.cases) continue
    parsed.push(doc)
    const errs = validateBenchmark(doc)
    if (errs.length) {
      failed++
      console.error(`${name}:`)
      errs.forEach((e) => console.error(`  - ${e}`))
    }
  }
  const groupErrs = validateGroup(parsed)
  groupErrs.forEach((e) => console.error(`  - ${e}`))
  if (groupErrs.length) failed++
  if (failed) return 1
  console.log(`bench:validate — ${parsed.length} benchmark file(s) OK`)
  return 0
}

if (import.meta.main) process.exit(await main(new URL('..', import.meta.url).pathname))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd benchmark && bun test tests/validate-benchmarks.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add benchmark/tools/validate-benchmarks.js benchmark/tests/validate-benchmarks.test.js
git commit -m "feat(benchmark): add cross-field invariant validator"
```

---

### Task 3: `benchmark-report.schema.json` (public contract)

**Files:**
- Create: `benchmark/benchmark-report.schema.json`
- Create: `benchmark/tests/report-schema.test.js`

**Interfaces:**
- Produces: JSON Schema `https://sql-on-fhir.org/ig/benchmark-report` validating runner output (Task 10 emits against it).

- [ ] **Step 1: Create `benchmark/benchmark-report.schema.json`**

```json
{
  "$id": "https://sql-on-fhir.org/ig/benchmark-report",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SQL on FHIR benchmark report schema",
  "type": "object",
  "required": ["implementation", "measurement", "results"],
  "properties": {
    "implementation": {
      "type": "object",
      "required": ["name", "version"],
      "properties": { "name": { "type": "string" }, "version": { "type": "string" } }
    },
    "benchmarkVersion": { "type": "string" },
    "environment": { "type": "object" },
    "measurement": {
      "type": "object",
      "required": ["phases", "sink", "warmup", "iterations"],
      "properties": {
        "phases": { "type": "array", "items": { "enum": ["load", "execute", "extract"] } },
        "sink": { "enum": ["table", "csv", "memory", "other"] },
        "warmup": { "type": "integer", "minimum": 0 },
        "iterations": { "type": "integer", "minimum": 1 }
      }
    },
    "results": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["size", "cases"],
        "properties": {
          "size": { "type": "string" },
          "fhirVersion": { "type": "string" },
          "cases": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["title", "status"],
              "properties": {
                "title": { "type": "string" },
                "status": { "enum": ["ok", "count_mismatch", "generation_error", "execution_error"] },
                "inputRows": { "type": "integer" },
                "outputRows": { "type": "integer" },
                "samplesMs": { "type": "array", "items": { "type": "number" } },
                "stats": { "type": "object" },
                "phaseSamplesMs": { "type": "object" }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test `benchmark/tests/report-schema.test.js`**

```js
import { test, expect } from 'bun:test'
import Ajv from 'ajv'
import schema from '../benchmark-report.schema.json'

const validate = new Ajv({ strict: false }).compile(schema)

const goodReport = {
  implementation: { name: 'sof-js', version: '2.0.0' },
  measurement: { phases: ['execute', 'extract'], sink: 'memory', warmup: 1, iterations: 5 },
  results: {
    'clinical-flat': {
      size: 's',
      cases: [{ title: 'condition flat', status: 'ok', outputRows: 10, samplesMs: [1.2, 1.3] }],
    },
  },
}

test('a well-formed report passes the schema', () => {
  expect(validate(goodReport)).toBe(true)
})

test('an invalid status value fails the schema', () => {
  const bad = structuredClone(goodReport)
  bad.results['clinical-flat'].cases[0].status = 'slow'
  expect(validate(bad)).toBe(false)
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd benchmark && bun test tests/report-schema.test.js`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add benchmark/benchmark-report.schema.json benchmark/tests/report-schema.test.js
git commit -m "feat(benchmark): add benchmark report schema"
```

---

### Task 4: Layout module (`tools/layout.js`)

**Files:**
- Create: `benchmark/tools/layout.js`
- Create: `benchmark/tests/layout.test.js`

**Interfaces:**
- Produces:
  - `export function recipeHash(recipe): string` — 8-char hex of a stable JSON serialization.
  - `export function datasetKey(name, recipe): string` → `` `${name}_${recipeHash(recipe)}` ``.
  - `export function datasetDir(dataRoot, name, recipe, size): string`.
  - `export function resourceFile(dataRoot, name, recipe, size, resourceType): string`.
  - `export function manifestFile(dataRoot, name, recipe, size): string`.

- [ ] **Step 1: Write the failing test `benchmark/tests/layout.test.js`**

```js
import { test, expect } from 'bun:test'
import { recipeHash, datasetKey, datasetDir, resourceFile, manifestFile } from '../tools/layout.js'

const recipe = { kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } }

test('recipeHash is stable regardless of key order', () => {
  const a = recipeHash({ kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } })
  const b = recipeHash({ params: { seed: 589 }, resources: ['Condition'], version: '3.2.0', kind: 'synthea' })
  expect(a).toBe(b)
  expect(a).toMatch(/^[0-9a-f]{8}$/)
})

test('recipeHash changes when content changes', () => {
  expect(recipeHash(recipe)).not.toBe(recipeHash({ ...recipe, params: { seed: 590 } }))
})

test('datasetKey is name_hash', () => {
  expect(datasetKey('synthea-clinical', recipe)).toBe(`synthea-clinical_${recipeHash(recipe)}`)
})

test('paths place size and resource correctly', () => {
  const dir = datasetDir('/data', 'd', recipe, 's')
  expect(dir).toBe(`/data/d_${recipeHash(recipe)}/s`)
  expect(resourceFile('/data', 'd', recipe, 's', 'Condition')).toBe(`${dir}/Condition.ndjson`)
  expect(manifestFile('/data', 'd', recipe, 's')).toBe(`${dir}/manifest.json`)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd benchmark && bun test tests/layout.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `benchmark/tools/layout.js`**

```js
import { createHash } from 'node:crypto'
import { join } from 'node:path'

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

export function recipeHash(recipe) {
  return createHash('sha256').update(stableStringify(recipe)).digest('hex').slice(0, 8)
}

export function datasetKey(name, recipe) {
  return `${name}_${recipeHash(recipe)}`
}

export function datasetDir(dataRoot, name, recipe, size) {
  return join(dataRoot, datasetKey(name, recipe), size)
}

export function resourceFile(dataRoot, name, recipe, size, resourceType) {
  return join(datasetDir(dataRoot, name, recipe, size), `${resourceType}.ndjson`)
}

export function manifestFile(dataRoot, name, recipe, size) {
  return join(datasetDir(dataRoot, name, recipe, size), 'manifest.json')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd benchmark && bun test tests/layout.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add benchmark/tools/layout.js benchmark/tests/layout.test.js
git commit -m "feat(benchmark): add on-disk layout and recipe-hash module"
```

---

### Task 5: Materialization orchestration (`tools/materialize.js`)

Orchestrates generate-then-prune, manifest, idempotent skip, and dedup, against an injected executor (so it's testable without Synthea).

**Files:**
- Create: `benchmark/tools/materialize.js`
- Create: `benchmark/tests/materialize.test.js`

**Interfaces:**
- Consumes: `layout.js` (Task 4).
- Produces: `export async function materialize({ dataset, size, dataRoot, executor, force }): Promise<object>` — returns the manifest. `executor` signature: `async (recipe, population, outDir) => void` (writes `<outDir>/<Type>.ndjson` for the resources it generates). Manifest shape: `{ name, kind, version, size, population, resources: { [Type]: count }, generatedAt }`.

- [ ] **Step 1: Write the failing test `benchmark/tests/materialize.test.js`**

```js
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { materialize } from '../tools/materialize.js'
import { resourceFile, manifestFile } from '../tools/layout.js'

const dataset = {
  name: 'd', kind: 'synthea', version: '3.2.0',
  resources: ['Condition'],
  sizes: { s: { population: 100 } }, defaultSize: 's',
  params: { seed: 589 },
}

// fake executor: writes 3 Conditions and 5 (to-be-pruned) Observations
let calls = 0
const fakeExecutor = async (recipe, population, outDir) => {
  calls++
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'Condition.ndjson'), '{"resourceType":"Condition"}\n'.repeat(3))
  writeFileSync(join(outDir, 'Observation.ndjson'), '{"resourceType":"Observation"}\n'.repeat(5))
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'bench-'))
}

test('materialize generates, prunes siblings, and writes a manifest', async () => {
  const dataRoot = freshRoot()
  const manifest = await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  expect(existsSync(resourceFile(dataRoot, 'd', expectedRecipe(), 's', 'Condition'))).toBe(true)
  expect(existsSync(join(dataRoot, manifestDir(dataRoot), 'Observation.ndjson'))).toBe(false) // pruned
  expect(manifest.resources.Condition).toBe(3)
  expect(manifest.population).toBe(100)
  rmSync(dataRoot, { recursive: true })
})

test('materialize is idempotent — second call skips the executor', async () => {
  const dataRoot = freshRoot()
  calls = 0
  await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  await materialize({ dataset, size: 's', dataRoot, executor: fakeExecutor })
  expect(calls).toBe(1)
  rmSync(dataRoot, { recursive: true })
})

// helpers that mirror the recipe materialize() builds internally
function expectedRecipe() {
  return { kind: 'synthea', version: '3.2.0', resources: ['Condition'], params: { seed: 589 } }
}
function manifestDir() {
  return '' // unused placeholder; the explicit path check above is illustrative
}
```

> Note: the second `existsSync` line documents intent; if the helper path is awkward in your environment, assert pruning via `manifest.resources` having no `Observation` key instead.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd benchmark && bun test tests/materialize.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `benchmark/tools/materialize.js`**

```js
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { datasetDir, manifestFile } from './layout.js'

function recipeOf(dataset) {
  // the declarative recipe = the dataset minus presentation-only fields
  const { name, sizes, defaultSize, ...rest } = dataset
  return rest
}

function countLines(path) {
  const txt = readFileSync(path, 'utf8')
  if (txt.length === 0) return 0
  return txt.endsWith('\n') ? txt.split('\n').length - 1 : txt.split('\n').length
}

export async function materialize({ dataset, size, dataRoot, executor, force = false }) {
  const recipe = recipeOf(dataset)
  const population = dataset.sizes[size].population
  const dir = datasetDir(dataRoot, dataset.name, recipe, size)
  const manifestPath = manifestFile(dataRoot, dataset.name, recipe, size)

  if (!force && existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const present = dataset.resources.every((r) => existsSync(join(dir, `${r}.ndjson`)))
    if (existing.population === population && present) return existing
  }

  const staging = mkdtempSync(join(tmpdir(), 'bench-gen-'))
  try {
    await executor(recipe, population, staging)
    mkdirSync(dir, { recursive: true })
    // keep only selected resources; prune the rest
    const counts = {}
    for (const r of dataset.resources) {
      const src = join(staging, `${r}.ndjson`)
      if (!existsSync(src)) throw new Error(`executor did not produce ${r}.ndjson`)
      const dst = join(dir, `${r}.ndjson`)
      renameSync(src, dst)
      counts[r] = countLines(dst)
    }
    const manifest = {
      name: dataset.name,
      kind: dataset.kind,
      version: dataset.version,
      size,
      population,
      resources: counts,
      generatedAt: new Date().toISOString(),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd benchmark && bun test tests/materialize.test.js`
Expected: tests pass (`manifest.resources.Condition === 3`, executor called once on the second run).

- [ ] **Step 5: Commit**

```bash
git add benchmark/tools/materialize.js benchmark/tests/materialize.test.js
git commit -m "feat(benchmark): add materialization orchestration (generate-then-prune, idempotent, manifest)"
```

---

### Task 6: Synthea executor (`tools/executors/synthea.js`) + guarded integration test

**Files:**
- Create: `benchmark/tools/executors/synthea.js`
- Create: `benchmark/tools/executors.config.sample.json`
- Create: `benchmark/tests/synthea-executor.test.js`

**Interfaces:**
- Produces: `export function makeSyntheaExecutor(config)` → `async (recipe, population, outDir) => void`, where `config = { jar, java }`. `export function loadConfig()` reads `tools/executors.config.json` (gitignored) and returns `{ synthea: { jar, java } }` or `null`.

- [ ] **Step 1: Create `benchmark/tools/executors.config.sample.json`**

```json
{
  "synthea": {
    "java": "java",
    "jar": "/absolute/path/to/synthea-with-dependencies-3.2.0.jar"
  }
}
```

- [ ] **Step 2: Implement `benchmark/tools/executors/synthea.js`**

```js
import { existsSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function loadConfig() {
  const path = new URL('../executors.config.json', import.meta.url).pathname
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function makeSyntheaExecutor(config) {
  const java = config.java || 'java'
  const jar = config.jar
  return async (recipe, population, outDir) => {
    const p = recipe.params || {}
    const args = [
      '-jar', jar,
      '-p', String(population),
      '-s', String(p.seed ?? 589),
      '-cs', String(p.clinicianSeed ?? 1652609873669),
      '-r', String(p.referenceTime ?? 20240101),
      `--exporter.baseDirectory=${outDir}`,
      '--exporter.fhir.bulk_data=true',
      '--exporter.fhir.export=true',
      '--exporter.hospital.fhir.export=false',
      '--exporter.practitioner.fhir.export=false',
      `--exporter.years_of_history=${p.yearsOfHistory ?? 1}`,
    ]
    const res = spawnSync(java, args, { stdio: 'inherit' })
    if (res.status !== 0) throw new Error(`synthea exited with status ${res.status}`)
    // Synthea writes per-resource NDJSON under <outDir>/fhir/ ; lift them to <outDir>/
    const fhirDir = join(outDir, 'fhir')
    if (!existsSync(fhirDir)) throw new Error(`synthea produced no fhir/ directory in ${outDir}`)
    for (const f of readdirSync(fhirDir)) {
      if (f.endsWith('.ndjson')) renameSync(join(fhirDir, f), join(outDir, f))
    }
  }
}
```

- [ ] **Step 3: Write the guarded integration test `benchmark/tests/synthea-executor.test.js`**

```js
import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSyntheaExecutor, loadConfig } from '../tools/executors/synthea.js'

const config = loadConfig()
const guarded = config?.synthea?.jar && existsSync(config.synthea.jar) ? test : test.skip

guarded('synthea executor generates Patient.ndjson for a tiny population', async () => {
  const exec = makeSyntheaExecutor(config.synthea)
  const out = mkdtempSync(join(tmpdir(), 'synthea-it-'))
  await exec({ params: { seed: 589, yearsOfHistory: 1 } }, 1, out)
  expect(existsSync(join(out, 'Patient.ndjson'))).toBe(true)
  rmSync(out, { recursive: true, force: true })
}, 120000)
```

- [ ] **Step 4: Run the test**

Run: `cd benchmark && bun test tests/synthea-executor.test.js`
Expected: SKIPPED when no `tools/executors.config.json` points at a real jar; PASS when configured (≈10–30s for the JVM). The fast suite stays green without Synthea.

- [ ] **Step 5: Commit**

```bash
git add benchmark/tools/executors/synthea.js benchmark/tools/executors.config.sample.json benchmark/tests/synthea-executor.test.js
git commit -m "feat(benchmark): add synthea executor with guarded integration test"
```

---

### Task 7: Materialization CLI (`tools/cli.js`) → `bun run data`

**Files:**
- Create: `benchmark/tools/cli.js`
- Create: `benchmark/tests/cli.test.js`

**Interfaces:**
- Consumes: `materialize.js` (Task 5), `executors/synthea.js` (Task 6).
- Produces: `export async function run({ target, size, group, force, dir, dataRoot, registry })` — resolves benchmark file(s) and calls `materialize` for each dataset; returns the array of manifests. `registry` defaults to `{ synthea: makeSyntheaExecutor(...) }` but is injectable for tests.

- [ ] **Step 1: Write the failing test `benchmark/tests/cli.test.js`**

```js
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run } from '../tools/cli.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cli-'))
  const dataRoot = join(dir, 'data')
  const file = {
    title: 'clinical-flat', fhirVersion: '4.0.1', group: 'g',
    dataset: {
      name: 'd', kind: 'synthea', version: '3.2.0', resources: ['Condition'],
      sizes: { s: { population: 100 } }, defaultSize: 's', params: { seed: 589 },
    },
    cases: [{ title: 'c', view: { resource: 'Condition' } }],
  }
  writeFileSync(join(dir, 'clinical-flat.json'), JSON.stringify(file))
  return { dir, dataRoot }
}

const fakeRegistry = {
  synthea: async (recipe, population, outDir) => {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'Condition.ndjson'), '{"resourceType":"Condition"}\n'.repeat(2))
  },
}

test('run materializes a single benchmark file by name', async () => {
  const { dir, dataRoot } = setup()
  const manifests = await run({ target: 'clinical-flat.json', size: 's', dir, dataRoot, registry: fakeRegistry })
  expect(manifests).toHaveLength(1)
  expect(manifests[0].resources.Condition).toBe(2)
  rmSync(dir, { recursive: true, force: true })
})

test('run materializes all files in a group', async () => {
  const { dir, dataRoot } = setup()
  const manifests = await run({ group: 'g', size: 's', dir, dataRoot, registry: fakeRegistry })
  expect(manifests).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd benchmark && bun test tests/cli.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `benchmark/tools/cli.js`**

```js
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { materialize } from './materialize.js'
import { makeSyntheaExecutor, loadConfig } from './executors/synthea.js'

function loadBenchmarks(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'package.json')
    .map((f) => {
      try {
        return { file: f, doc: JSON.parse(readFileSync(join(dir, f), 'utf8')) }
      } catch {
        return null
      }
    })
    .filter((x) => x && x.doc.dataset && x.doc.cases)
}

function defaultRegistry() {
  const cfg = loadConfig()
  if (!cfg?.synthea?.jar) throw new Error('No synthea config — copy tools/executors.config.sample.json to executors.config.json')
  return { synthea: makeSyntheaExecutor(cfg.synthea) }
}

export async function run({ target, size, group, force = false, dir, dataRoot = join(dir, 'data'), registry }) {
  registry = registry || defaultRegistry()
  const all = loadBenchmarks(dir)
  const selected = group
    ? all.filter((b) => b.doc.group === group)
    : all.filter((b) => b.file === target || b.doc.title === target)
  if (selected.length === 0) throw new Error(`no benchmark matched target=${target} group=${group}`)

  const manifests = []
  for (const { doc } of selected) {
    const sz = size || doc.dataset.defaultSize
    const executor = registry[doc.dataset.kind]
    if (!executor) throw new Error(`no executor for kind "${doc.dataset.kind}"`)
    manifests.push(await materialize({ dataset: doc.dataset, size: sz, dataRoot, executor, force }))
  }
  return manifests
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const opts = { dir: new URL('..', import.meta.url).pathname }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--group') opts.group = args[++i]
    else if (args[i] === '--force') opts.force = true
    else opts.target = args[i]
  }
  const manifests = await run(opts)
  console.log(JSON.stringify(manifests, null, 2))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd benchmark && bun test tests/cli.test.js`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add benchmark/tools/cli.js benchmark/tests/cli.test.js
git commit -m "feat(benchmark): add materialization CLI with file/group resolution"
```

---

### Task 8: First benchmark file `clinical-flat.json`

**Files:**
- Create: `benchmark/clinical-flat.json`

**Interfaces:**
- Consumes: the schema (Task 1) and invariant validator (Task 2). `expectCount` is intentionally absent here (blessed in Task 11).

- [ ] **Step 1: Create `benchmark/clinical-flat.json`**

```json
{
  "title": "clinical-flat",
  "description": "Flatten clustered Synthea clinical resources (Condition, Observation).",
  "group": "synthea-clinical",
  "fhirVersion": "4.0.1",
  "iterations": { "warmup": 1, "measurement": 5 },
  "dataset": {
    "name": "synthea-clinical",
    "kind": "synthea",
    "version": "3.2.0",
    "resources": ["Condition", "Observation"],
    "params": { "seed": 589, "clinicianSeed": 1652609873669, "referenceTime": 20240101, "yearsOfHistory": 1 },
    "sizes": { "s": { "population": 100 }, "m": { "population": 1000 } },
    "defaultSize": "m"
  },
  "cases": [
    {
      "title": "condition flat",
      "description": "One row per Condition with code and clinical status.",
      "view": {
        "resource": "Condition",
        "select": [
          {
            "column": [
              { "name": "id", "path": "getResourceKey()", "type": "string" },
              { "name": "code", "path": "code.coding.first().code", "type": "string" },
              { "name": "clinical_status", "path": "clinicalStatus.coding.first().code", "type": "string" }
            ]
          }
        ]
      }
    },
    {
      "title": "observation components",
      "description": "One row per Observation component (forEach over component).",
      "view": {
        "resource": "Observation",
        "select": [
          { "column": [{ "name": "id", "path": "getResourceKey()", "type": "string" }] },
          {
            "forEach": "component",
            "column": [{ "name": "comp_code", "path": "code.coding.first().code", "type": "string" }]
          }
        ]
      }
    }
  ]
}
```

> `getResourceKey()` (the resource's own key) is used here; reference functions including `getReferenceKey()` are also permitted — the validator does not restrict them, since single-resource is a measurement-setup property, not a syntactic rule.

- [ ] **Step 2: Run validation to verify the file is well-formed and obeys invariants**

Run: `cd benchmark && bun run validate`
Expected: `ajv` reports the file valid AND `bench:validate — 1 benchmark file(s) OK`.

- [ ] **Step 3: Commit**

```bash
git add benchmark/clinical-flat.json
git commit -m "feat(benchmark): add clinical-flat benchmark file (Condition, Observation views)"
```

---

### Task 9: `sof-js` reference runner core (`sof-js/src/benchmark.js`)

**Files:**
- Create: `sof-js/src/benchmark.js`
- Create: `sof-js/tests/benchmark.test.js`
- Create: `sof-js/tests/fixtures/Observation.ndjson`

**Interfaces:**
- Consumes: `evaluate(def, node)` from `sof-js/src/index.js` (returns a materialized row array).
- Produces:
  - `export function loadResources(ndjsonPath): object[]` — parses NDJSON to an array (the `load` phase).
  - `export function timeEvaluate(view, resources, { warmup, measurement }): { samplesMs: number[], outputRows: number }` — times `evaluate` over warmup+measurement iterations; `outputRows` from the final run's `.length`.
  - `export function statsOf(samplesMs): { min, mean }`.

- [ ] **Step 1: Create the fixture `sof-js/tests/fixtures/Observation.ndjson`**

```
{"resourceType":"Observation","id":"o1","component":[{"code":{"coding":[{"code":"8480-6"}]}},{"code":{"coding":[{"code":"8462-4"}]}}]}
{"resourceType":"Observation","id":"o2","component":[{"code":{"coding":[{"code":"8480-6"}]}}]}
```

- [ ] **Step 2: Write the failing test `sof-js/tests/benchmark.test.js`**

```js
import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadResources, timeEvaluate, statsOf } from '../src/benchmark.js'

const view = {
  resource: 'Observation',
  select: [
    { column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] },
    { forEach: 'component', column: [{ name: 'comp_code', path: 'code.coding.first().code', type: 'string' }] },
  ],
}

test('loadResources parses NDJSON into an array', () => {
  const rows = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  expect(rows).toHaveLength(2)
  expect(rows[0].resourceType).toBe('Observation')
})

test('timeEvaluate returns one sample per measurement iteration and the output row count', () => {
  const resources = loadResources(join(import.meta.dir, 'fixtures/Observation.ndjson'))
  const { samplesMs, outputRows } = timeEvaluate(view, resources, { warmup: 1, measurement: 3 })
  expect(samplesMs).toHaveLength(3)
  expect(outputRows).toBe(3) // 2 components on o1 + 1 on o2
})

test('statsOf computes min and mean', () => {
  expect(statsOf([2, 4, 6])).toEqual({ min: 2, mean: 4 })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd sof-js && bun test tests/benchmark.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `sof-js/src/benchmark.js`**

```js
import { readFileSync } from 'node:fs'
import { evaluate } from './index.js'

export function loadResources(ndjsonPath) {
  return readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

export function timeEvaluate(view, resources, { warmup, measurement }) {
  for (let i = 0; i < warmup; i++) evaluate(view, resources)
  const samplesMs = []
  let outputRows = 0
  for (let i = 0; i < measurement; i++) {
    const t0 = performance.now()
    const rows = evaluate(view, resources)
    const t1 = performance.now()
    samplesMs.push(t1 - t0)
    outputRows = rows.length
  }
  return { samplesMs, outputRows }
}

export function statsOf(samplesMs) {
  const min = Math.min(...samplesMs)
  const mean = samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length
  return { min, mean }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd sof-js && bun test tests/benchmark.test.js`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add sof-js/src/benchmark.js sof-js/tests/benchmark.test.js sof-js/tests/fixtures/Observation.ndjson
git commit -m "feat(sof-js): add benchmark runner core (load, time, stats)"
```

---

### Task 10: Reference runner report + verify + bless (`sof-js/src/benchmark-run.js`)

**Files:**
- Create: `sof-js/src/benchmark-run.js`
- Create: `sof-js/tests/benchmark-run.test.js`

**Interfaces:**
- Consumes: `loadResources`, `timeEvaluate`, `statsOf` (Task 9); layout `resourceFile` (Task 4, imported from `../../benchmark/tools/layout.js`).
- Produces:
  - `export function buildReport({ benchmark, size, dataRoot, impl }): object` — conforms to `benchmark-report.schema.json`; per case sets `status` `ok`/`count_mismatch` (when `expectCount[size]` present) and timing.
  - `export function bless({ benchmark, size, dataRoot }): object` — returns the benchmark doc with `expectCount[size]` filled from observed output rows.

- [ ] **Step 1: Write the failing test `sof-js/tests/benchmark-run.test.js`**

```js
import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReport, bless } from '../src/benchmark-run.js'
import { datasetDir } from '../../benchmark/tools/layout.js'

const benchmark = {
  title: 'clinical-flat', fhirVersion: '4.0.1',
  iterations: { warmup: 0, measurement: 2 },
  dataset: {
    name: 'd', kind: 'synthea', version: '3.2.0', resources: ['Observation'],
    sizes: { s: { population: 100 } }, defaultSize: 's', params: { seed: 589 },
  },
  cases: [{ title: 'obs', view: { resource: 'Observation', select: [{ column: [{ name: 'id', path: 'getResourceKey()', type: 'string' }] }] }, expectCount: { s: 2 } }],
}

function seedData() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'run-'))
  const recipe = { kind: 'synthea', version: '3.2.0', resources: ['Observation'], params: { seed: 589 } }
  const dir = datasetDir(dataRoot, 'd', recipe, 's')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Observation.ndjson'), '{"resourceType":"Observation","id":"o1"}\n{"resourceType":"Observation","id":"o2"}\n')
  return dataRoot
}

test('buildReport marks a matching count as ok', () => {
  const dataRoot = seedData()
  const report = buildReport({ benchmark, size: 's', dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
  expect(report.results['clinical-flat'].cases[0].status).toBe('ok')
  expect(report.results['clinical-flat'].cases[0].outputRows).toBe(2)
  expect(report.measurement.iterations).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})

test('buildReport flags a count mismatch', () => {
  const dataRoot = seedData()
  const b2 = structuredClone(benchmark)
  b2.cases[0].expectCount.s = 99
  const report = buildReport({ benchmark: b2, size: 's', dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
  expect(report.results['clinical-flat'].cases[0].status).toBe('count_mismatch')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('bless fills expectCount from observed rows', () => {
  const dataRoot = seedData()
  const b3 = structuredClone(benchmark)
  delete b3.cases[0].expectCount
  const blessed = bless({ benchmark: b3, size: 's', dataRoot })
  expect(blessed.cases[0].expectCount.s).toBe(2)
  rmSync(dataRoot, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sof-js && bun test tests/benchmark-run.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sof-js/src/benchmark-run.js`**

```js
import { loadResources, timeEvaluate, statsOf } from './benchmark.js'
import { resourceFile } from '../../benchmark/tools/layout.js'

function recipeOf(dataset) {
  const { name, sizes, defaultSize, ...rest } = dataset
  return rest
}

function runCases({ benchmark, size, dataRoot }) {
  const recipe = recipeOf(benchmark.dataset)
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  return benchmark.cases.map((c) => {
    const path = resourceFile(dataRoot, benchmark.dataset.name, recipe, size, c.view.resource)
    const resources = loadResources(path)
    const { samplesMs, outputRows } = timeEvaluate(c.view, resources, { warmup, measurement })
    return { c, inputRows: resources.length, outputRows, samplesMs }
  })
}

export function buildReport({ benchmark, size, dataRoot, impl }) {
  const { warmup, measurement } = benchmark.iterations || { warmup: 1, measurement: 5 }
  const cases = runCases({ benchmark, size, dataRoot }).map(({ c, inputRows, outputRows, samplesMs }) => {
    const expected = c.expectCount?.[size]
    const status = expected == null ? 'ok' : outputRows === expected ? 'ok' : 'count_mismatch'
    return { title: c.title, status, inputRows, outputRows, samplesMs, stats: statsOf(samplesMs) }
  })
  return {
    implementation: impl,
    measurement: { phases: ['execute', 'extract'], sink: 'memory', warmup, iterations: measurement },
    results: { [benchmark.title]: { size, fhirVersion: benchmark.fhirVersion, cases } },
  }
}

export function bless({ benchmark, size, dataRoot }) {
  const doc = structuredClone(benchmark)
  const observed = runCases({ benchmark, size, dataRoot })
  observed.forEach(({ outputRows }, i) => {
    doc.cases[i].expectCount = { ...(doc.cases[i].expectCount || {}), [size]: outputRows }
  })
  return doc
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sof-js && bun test tests/benchmark-run.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Add a CLI wrapper to `sof-js/src/benchmark-run.js`** (append):

```js
if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const opts = { record: false, size: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') opts.size = args[++i]
    else if (args[i] === '--record') opts.record = true
    else if (args[i] === '--data') opts.dataRoot = args[++i]
    else opts.path = args[i]
  }
  const benchmark = JSON.parse(readFileSync(opts.path, 'utf8'))
  const size = opts.size || benchmark.dataset.defaultSize
  const dataRoot = opts.dataRoot || new URL('../../benchmark/data', import.meta.url).pathname
  if (opts.record) {
    const blessed = bless({ benchmark, size, dataRoot })
    writeFileSync(opts.path, JSON.stringify(blessed, null, 2) + '\n')
    console.error(`blessed ${opts.path} for size ${size}`)
  } else {
    const report = buildReport({ benchmark, size, dataRoot, impl: { name: 'sof-js', version: '2.0.0' } })
    console.log(JSON.stringify(report, null, 2))
  }
}
```

- [ ] **Step 6: Add root scripts** — modify root `package.json` `scripts`, adding:

```json
    "bench:run": "cd sof-js && bun run src/benchmark-run.js",
    "bench:data": "cd benchmark && bun run data"
```

- [ ] **Step 7: Commit**

```bash
git add sof-js/src/benchmark-run.js sof-js/tests/benchmark-run.test.js package.json
git commit -m "feat(sof-js): add reference benchmark-runner (report, verify, bless)"
```

---

### Task 11: Bless `clinical-flat` expected counts (integration)

Requires a configured Synthea jar. Produces the first committed `expectCount` values, analytically cross-checked.

**Files:**
- Modify: `benchmark/clinical-flat.json` (fills `expectCount`)

**Interfaces:**
- Consumes: `bench:data` (Task 7), `bench:run --record` (Task 10).

- [ ] **Step 1: Configure Synthea locally** (one-time, not committed)

```bash
cp benchmark/tools/executors.config.sample.json benchmark/tools/executors.config.json
# edit benchmark/tools/executors.config.json so "jar" points at synthea-with-dependencies-3.2.0.jar
```

- [ ] **Step 2: Materialize the small size**

Run: `bun run bench:data clinical-flat.json --size s`
Expected: `data/synthea-clinical_<hash>/s/{Condition,Observation}.ndjson` + `manifest.json`; printed manifest shows non-zero `Condition`/`Observation` counts.

- [ ] **Step 3: Bless the small size**

Run: `bun run bench:run -- clinical-flat.json --size s --record`
(Note the `--` so the flags reach the script.) Expected: `blessed .../clinical-flat.json for size s`; the file now has `expectCount.s` for both cases.

- [ ] **Step 4: Analytic cross-check before accepting** (Constitution III / §11)

Verify against the manifest's input counts:
- `condition flat` has no `forEach`/`where` ⇒ `expectCount.s` MUST equal the manifest's `Condition` count.
- `observation components` does `forEach: component` ⇒ `expectCount.s` MUST equal the total number of `component` entries across all Observations (≥ the Observation count; equals it only if every Observation has exactly one component). Spot-check with:

```bash
cd benchmark
# total components across all Observations at size s
grep -o '"component"' data/synthea-clinical_*/s/Observation.ndjson | wc -l   # presence sanity-check
bun -e 'const fs=require("fs");const g=require("glob");' 2>/dev/null || true
```
If the `forEach` count is not independently obvious, compute it directly:
```bash
cd benchmark
bun -e "const {readFileSync}=require('node:fs');const f=process.argv[1];let n=0;for(const l of readFileSync(f,'utf8').trim().split('\n')){const o=JSON.parse(l);n+=(o.component||[]).length}console.log('components:',n)" data/synthea-clinical_*/s/Observation.ndjson
```
Confirm the printed `components:` equals the blessed `observation components` `expectCount.s`. If they differ, STOP — the runner or view is wrong; do not commit.

- [ ] **Step 5: Repeat for size `m`**

Run:
```bash
bun run bench:data clinical-flat.json --size m
bun run bench:run -- clinical-flat.json --size m --record
```
Cross-check `m` the same way.

- [ ] **Step 6: Verify (non-record) run is green**

Run: `bun run bench:run -- clinical-flat.json --size s`
Expected: report JSON with every case `"status": "ok"`.

- [ ] **Step 7: Commit the blessed counts**

```bash
git add benchmark/clinical-flat.json
git commit -m "feat(benchmark): bless clinical-flat expected counts (cross-checked)"
```

---

### Task 12: `benchmark/README.md` — materialization & integration protocol

**Files:**
- Create: `benchmark/README.md`

- [ ] **Step 1: Create `benchmark/README.md`**

```markdown
# SQL on FHIR Benchmark

Implementation-agnostic performance benchmark for SQL on FHIR view runners — the
performance analog of the conformance suite in `../tests`. A benchmark file pairs
a declarative Synthea **dataset recipe** with ViewDefinition **cases** and
per-size **expected row counts**. The data is generated locally; it is not
checked in.

## Layout

- `*.json` — inline benchmark files (`benchmark.schema.json`).
- `benchmark.schema.json` / `benchmark-report.schema.json` — public contracts.
- `tools/` — the reference materialization tool (no runner/timing code).
- `data/` — materialized NDJSON + manifests (untracked).

## Materialize data

1. `cp tools/executors.config.sample.json tools/executors.config.json` and point
   `jar` at `synthea-with-dependencies-3.2.0.jar` (needs Java).
2. `bun run data <file|--group NAME> --size <s|m|...>`

Output: `data/<name>_<hash>/<size>/<ResourceType>.ndjson` + `manifest.json`.
`<size>` selects the population; `<hash>` is the recipe content hash (identical
recipes dedupe). Only the recipe's `resources` are kept; siblings are pruned.

## Run a benchmark (the runner contract)

A runner, in any language:
1. obtain this `benchmark/` directory at a pinned tag;
2. materialize the data (above, or reimplement from the recipe);
3. for each `*.json`, run each `case.view` over the materialized NDJSON for the
   chosen size with your own timing harness;
4. compare output row count to `expectCount[size]` (`ok` / `count_mismatch`);
5. emit `benchmark-report.json` per `benchmark-report.schema.json`.

Recommended measurement: time **execute + extract** (evaluate + a full
materialization of the result — a table or CSV, never a lazy count). Record what
you timed in the report's `measurement` block.

`sof-js` is the reference runner: `bun run bench:run -- <file> --size <s> [--record]`
(`--record` blesses `expectCount`).

## v1 scope

Synthea-generated single-resource benchmarks (one view over one materialized
resource type), FHIR R4 (4.0.1). Views may use any FHIRPath including reference
functions; single-resource is a measurement-setup property. Demographic datasets
are capped at 10k patients (generate-then-prune). Referenced datasets, QR/download
kinds, referentially-consistent multi-resource datasets, and result checksums are
future extensions. See `../docs/superpowers/specs/2026-06-29-benchmark-subproject-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/README.md
git commit -m "docs(benchmark): add materialization and integration protocol"
```

---

### Task 13: Wire validation into the verified-green pipeline

**Files:**
- Modify: `package.json` (root — extend `validate`)

**Interfaces:**
- Consumes: `bench:validate` (Task 1), `bench:test` (Task 1).

- [ ] **Step 1: Extend the root `validate` script** so the benchmark artifact is checked alongside the conformance suite. Modify root `package.json`:

```json
    "validate": "cd sof-js && bun run validate && cd .. && bun run bench:validate"
```

- [ ] **Step 2: Run the full validation**

Run: `bun run validate`
Expected: conformance suite validates AND `bench:validate — 1 benchmark file(s) OK`.

- [ ] **Step 3: Run the benchmark test suite**

Run: `bun run bench:test`
Expected: all benchmark unit tests pass; the Synthea integration test is `skip` unless configured.

- [ ] **Step 4: Run formatting check**

Run: `bun run check-fmt` (then `cd sof-js && bunx prettier -c "../benchmark/**/*.{js,json}"` to confirm the new files are formatted; run `bunx prettier -w` on any that fail, then re-check).
Expected: all files formatted.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(benchmark): wire bench:validate into the verification pipeline"
```

---

## Self-Review

**Spec coverage** (spec §→task):
- §4 declarative recipe (kind/version/params, WHAT-vs-HOW) → schema Task 1 (`dataset` block), Task 6 (config out of artifact).
- §5 inline file format (one dataset + N cases, multi-resource, group, fhirVersion, iterations, `view.resource` ∈ `dataset.resources` invariant; reference functions permitted) → Tasks 1, 2, 8.
- §6 scaling (size as parameter, per-dataset population; 10k demographic ceiling) → Task 8 `sizes`; ceiling is enforced by authoring (no demographic dataset in v1) and documented (Task 12) — no code path needed.
- §7 reference materializer (registry, generate-then-prune, idempotent, dedup, manifest) → Tasks 5, 6, 7.
- §8 layout contract → Task 4 + Task 5.
- §9 validation & test-first → Tasks 1–3, 13; every task is TDD.
- §10 report schema + measurement descriptor (reverse-ETL phases) → Tasks 3, 10.
- §11 packaging/integration + sof-js reference runner + analytic bless → Tasks 9, 10, 11, 12.
- §13 determinism follow-up → not a build task (documented follow-up); §14 future extensions → out of scope by design.

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". The one prose note in Task 5's test (alternate pruning assertion) and Task 11 Step 4 (analytic computation) both give concrete commands/assertions.

**Type consistency:** `recipeOf(dataset)` (strips `name`/`sizes`/`defaultSize`) is defined identically in `materialize.js` (Task 5) and `benchmark-run.js` (Task 10), so the recipe hashed at materialization matches the recipe the runner uses to locate data — the layout key agrees across tool and runner. `resourceFile(dataRoot, name, recipe, size, type)` signature is the same in Task 4 (definition), Task 5 (via `datasetDir`/`manifestFile`), and Task 10 (consumption). Executor signature `(recipe, population, outDir) => void` is consistent across Tasks 5, 6, 7. Report shape matches `benchmark-report.schema.json` between Task 3 and Task 10 (`measurement.phases/sink/warmup/iterations`, per-case `status/inputRows/outputRows/samplesMs/stats`).

> **Known coupling to confirm during execution:** `recipeOf` must strip exactly the dataset fields that are NOT part of the recipe (`name`, `sizes`, `defaultSize`) and keep `kind`/`version`/`resources`/`params`. If a field is added to `dataset` later, update `recipeOf` in BOTH files together or the runner will look in the wrong `data/` directory.
