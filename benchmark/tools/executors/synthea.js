import { existsSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function loadConfig() {
  const path = new URL('../executors.config.json', import.meta.url).pathname
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function makeSyntheaExecutor(config) {
  const java = config.java || 'java'
  const jar = config.jar
  return async (recipe, population, outDir) => {
    const p = recipe.params || {}
    const args = [
      '-jar',
      jar,
      '-p',
      String(population),
      '-s',
      String(p.seed ?? 589),
      '-cs',
      String(p.clinicianSeed ?? 1652609873669),
      '-r',
      String(p.referenceTime ?? 20240101),
      // Pin the simulation end date; never fall back to the wall clock. A missing
      // endTime is surfaced by the benchmark invariant validator, not defaulted here.
      '-e',
      String(p.endTime),
      // Serialise generation so the export order is deterministic (counts are
      // already deterministic given -e; only order depends on thread count).
      '--generate.thread_count=1',
      `--exporter.baseDirectory=${outDir}`,
      // --exporter.fhir.export is a mode selector (turning it off yields no data),
      // so it is an executor invariant rather than a recipe-controlled dataset dial.
      '--exporter.fhir.export=true',
      // Output-affecting toggles are sourced from the recipe params so that
      // recipe + version fully determines the dataset and the content hash covers them.
      `--exporter.fhir.bulk_data=${p.bulkData}`,
      `--exporter.hospital.fhir.export=${p.hospitalExport}`,
      `--exporter.practitioner.fhir.export=${p.practitionerExport}`,
      `--exporter.years_of_history=${p.yearsOfHistory}`,
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
