import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Committed pin of the Synthea generator jar keyed by syntheaVersion. Adding a new
// version means adding one entry with its verified sha256 — the URL and checksum
// are BOTH pinned here, never discovered at runtime. The checksum guards the
// GENERATOR JAR's identity (a different, complementary checksum from the checkfile's
// per-file NDJSON sha256). The 3.2.0 checksum was verified at pin time against the
// blessed jar that produced the committed checkfile:
//   shasum -a 256 synthea-with-dependencies.jar (v3.2.0 release asset)
//   == the blessed local jar → 57216a99...db0720 (byte-identical).
export const SYNTHEA_RELEASES = {
  '3.2.0': {
    url: 'https://github.com/synthetichealth/synthea/releases/download/v3.2.0/synthea-with-dependencies.jar',
    sha256: '57216a99a4ffc12450e4aba28f9d42e1678abb3b31ec7cd5ac2c4014e9db0720',
  },
}

function sha256Of(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

// Default network fetch: only reached when there is no config override and the jar
// is not already cached. Unit tests inject a fetchImpl and never hit the network.
async function defaultFetch(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`synthea jar download failed: ${res.status} ${res.statusText} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// Resolve the Synthea jar to use for a materialization.
//   - If `config.jar` is set it WINS (optional override): return it as-is, no fetch.
//   - Otherwise resolve the pinned syntheaVersion to { url, sha256 }, reuse a
//     checksum-verified cached jar if present, else fetch + verify + cache. A
//     checksum mismatch fails loudly and leaves nothing unverified in the cache.
export async function resolveSyntheaJar({
  syntheaVersion,
  config,
  cacheDir,
  fetchImpl = defaultFetch,
  releases = SYNTHEA_RELEASES,
}) {
  if (config?.jar) {
    return { jar: config.jar, java: config.java || 'java', fetched: false }
  }

  const pin = releases[syntheaVersion]
  if (!pin) {
    throw new Error(
      `no pinned Synthea jar for syntheaVersion "${syntheaVersion}"; add it to SYNTHEA_RELEASES with a verified sha256`,
    )
  }

  const jarPath = join(cacheDir, `synthea-with-dependencies-${syntheaVersion}.jar`)
  // Cache hit only counts if the cached bytes still match the pinned checksum.
  if (existsSync(jarPath) && sha256Of(readFileSync(jarPath)) === pin.sha256) {
    return { jar: jarPath, java: config?.java || 'java', fetched: false }
  }

  const bytes = await fetchImpl(pin.url)
  const actual = sha256Of(bytes)
  if (actual !== pin.sha256) {
    throw new Error(
      `Synthea jar checksum mismatch for ${syntheaVersion}: expected sha256 ${pin.sha256}, got ${actual} from ${pin.url}`,
    )
  }
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(jarPath, bytes)
  return { jar: jarPath, java: config?.java || 'java', fetched: true }
}

// The default gitignored cache directory for fetched jars: benchmark/.cache/synthea/.
export function defaultCacheDir() {
  return new URL('../../.cache/synthea/', import.meta.url).pathname
}
