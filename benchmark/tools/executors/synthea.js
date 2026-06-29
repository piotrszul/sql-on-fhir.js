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
