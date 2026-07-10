import { existsSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveSyntheaJar, defaultCacheDir } from './synthea-releases.js'
import { pathFrom } from '../layout.js'

// tools/executors.config.json is now an OPTIONAL OVERRIDE, not a prerequisite: when
// present it supplies a custom jar path and/or java binary that WIN over auto-fetch;
// when absent (null) the materializer auto-fetches the pinned Synthea jar.
export function loadConfig() {
  const path = pathFrom(import.meta.url, '../executors.config.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function makeSyntheaExecutor({
  config = null,
  resolveJar = resolveSyntheaJar,
  cacheDir = defaultCacheDir(),
} = {}) {
  return async (recipe, population, outDir) => {
    const p = recipe.params || {}
    // Resolve the jar per run: config jar WINS; otherwise auto-fetch the pinned
    // syntheaVersion (checksum-verified, cached). syntheaVersion travels on the
    // recipe object the materializer passes through.
    const { jar, java } = await resolveJar({
      syntheaVersion: recipe.syntheaVersion,
      config,
      cacheDir,
    })
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
      // No generation thread flag: `--generate.thread_count` is not a real Synthea
      // property (silently ignored), and even a genuine single-threaded pool does
      // not make bulk NDJSON export order deterministic — export runs on the
      // multi-threaded generator pool as patients finish. Counts are deterministic
      // given the pinned seeds/-e; line ORDER is not, so the materializer
      // canonicalises (external merge sort) to stabilise the persisted bytes.
      `--exporter.baseDirectory=${outDir}`,
      // --exporter.fhir.export is a mode selector (turning it off yields no data),
      // so it is an executor invariant rather than a recipe-controlled dataset dial.
      '--exporter.fhir.export=true',
      // Output-affecting toggles are sourced from the recipe params so that
      // recipe + version fully determines the dataset (the version tag records intent).
      `--exporter.fhir.bulk_data=${p.bulkData}`,
      `--exporter.hospital.fhir.export=${p.hospitalExport}`,
      `--exporter.practitioner.fhir.export=${p.practitionerExport}`,
      `--exporter.years_of_history=${p.yearsOfHistory}`,
    ]
    // Export-filtered generation: constrain the FHIR bulk export to the recipe's
    // resource types so Synthea never converts/serialises/writes the unwanted ones
    // (a big saving at xl for large resources like Claim/ExplanationOfBenefit).
    // Synthea force-exports Patient and Encounter regardless; the materializer's
    // prune mops those up when they are not in the recipe. When the recipe lists no
    // resources, no filter is emitted (generate everything, as before).
    if (recipe.resources && recipe.resources.length) {
      args.push(`--exporter.fhir.included_resources=${recipe.resources.join(',')}`)
    }
    // Run Synthea in an ISOLATED working directory (the per-materialization staging
    // dir, which lives outside the repo tree) so its incidental db.sqlite and
    // public/export/<epoch>/ artifacts never land in the repo root; the staging dir
    // is cleaned up by the materializer. Pin TZ=UTC so Synthea renders emitted
    // dateTime/instant fields in UTC rather than the host timezone offset, making the
    // generated NDJSON byte-identical across environments (the precondition for the
    // checkfile's sha256 checksums).
    const res = spawnSync(java, args, { stdio: 'inherit', cwd: outDir, env: { ...process.env, TZ: 'UTC' } })
    if (res.status !== 0) throw new Error(`synthea exited with status ${res.status}`)
    // Synthea writes per-resource NDJSON under <outDir>/fhir/ ; lift them to <outDir>/
    const fhirDir = join(outDir, 'fhir')
    if (!existsSync(fhirDir)) throw new Error(`synthea produced no fhir/ directory in ${outDir}`)
    for (const f of readdirSync(fhirDir)) {
      if (f.endsWith('.ndjson')) renameSync(join(fhirDir, f), join(outDir, f))
    }
  }
}
