import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'

const schema = JSON.parse(readFileSync(new URL('../benchmark.schema.json', import.meta.url), 'utf8'))
const validate = new Ajv({ strict: false }).compile(schema)

export function validateSchema(file) {
  const valid = validate(file)
  if (valid) return []
  return (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`)
}

export function validateBenchmark(file) {
  const errors = []
  const ds = file.dataset || {}
  const sizes = Object.keys(ds.sizes || {})

  if (ds.defaultSize && !sizes.includes(ds.defaultSize))
    errors.push(`defaultSize "${ds.defaultSize}" is not a declared size`)

  // A synthea dataset must declare every output-affecting param in the recipe so
  // that recipe + version fully determines the dataset. If any is omitted the
  // executor would interpolate `undefined` into the Synthea CLI (silently read as
  // false / wall-clock), yielding the wrong dataset with no error. The booleans are
  // guarded on `== null` (not falsy) so an explicit `false` is a valid declared value.
  if (ds.kind === 'synthea') {
    const requiredParams = {
      endTime: 'pinned simulation end date',
      yearsOfHistory: 'exported years of history',
      hospitalExport: 'hospital FHIR export toggle',
      practitionerExport: 'practitioner FHIR export toggle',
      bulkData: 'bulk-data export toggle',
    }
    for (const [name, desc] of Object.entries(requiredParams)) {
      if (ds.params?.[name] == null) errors.push(`synthea dataset must declare params.${name} (${desc})`)
    }
  }

  for (const c of file.cases || []) {
    const res = c.view?.resource
    if (res && !(ds.resources || []).includes(res))
      errors.push(`case "${c.title}": view.resource "${res}" not in dataset.resources`)

    for (const sz of Object.keys(c.expectCount || {})) {
      if (!sizes.includes(sz))
        errors.push(`case "${c.title}": expectCount size "${sz}" is not a declared size`)
    }
  }
  return errors
}

export function validateGroup(files) {
  const errors = []
  const groups = {}
  for (const f of files) if (f.group) (groups[f.group] ||= []).push(f)
  for (const [g, members] of Object.entries(groups)) {
    const tierSets = members.map((m) =>
      Object.keys(m.dataset?.sizes || {})
        .sort()
        .join(','),
    )
    if (new Set(tierSets).size > 1)
      errors.push(
        `group "${g}": members declare differing size-tier names (${[...new Set(tierSets)].join(' vs ')})`,
      )
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
    const schemaErrs = validateSchema(doc)
    const invariantErrs = validateBenchmark(doc)
    const errs = [...schemaErrs, ...invariantErrs]
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
