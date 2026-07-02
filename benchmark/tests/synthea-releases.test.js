import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SYNTHEA_RELEASES, resolveSyntheaJar } from '../tools/executors/synthea-releases.js'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function freshCache() {
  return mkdtempSync(join(tmpdir(), 'synthea-cache-'))
}

test('the pinned map records the v3.2.0 release URL and its verified sha256', () => {
  const entry = SYNTHEA_RELEASES['3.2.0']
  expect(entry).toBeDefined()
  expect(entry.url).toBe(
    'https://github.com/synthetichealth/synthea/releases/download/v3.2.0/synthea-with-dependencies.jar',
  )
  // the checksum verified against the blessed jar at implementation time
  expect(entry.sha256).toBe('57216a99a4ffc12450e4aba28f9d42e1678abb3b31ec7cd5ac2c4014e9db0720')
})

test('with no config, resolving the pinned version fetches the pinned url and caches the verified jar', async () => {
  const cacheDir = freshCache()
  const bytes = Buffer.from('fake-synthea-jar-bytes')
  // pin the map's sha to our fake bytes so the checksum gate passes for the test
  const pinned = { url: SYNTHEA_RELEASES['3.2.0'].url, sha256: sha256(bytes) }
  let fetchedUrl = null
  const fetchImpl = async (url) => {
    fetchedUrl = url
    return bytes
  }
  const { jar, fetched } = await resolveSyntheaJar({
    syntheaVersion: '3.2.0',
    config: null,
    cacheDir,
    fetchImpl,
    releases: { '3.2.0': pinned },
  })
  expect(fetchedUrl).toBe(pinned.url) // the pinned url, not discovered at runtime
  expect(fetched).toBe(true)
  expect(existsSync(jar)).toBe(true)
  expect(sha256(readFileSync(jar))).toBe(pinned.sha256) // cached bytes are the fetched bytes
  rmSync(cacheDir, { recursive: true, force: true })
})

test('a fetch whose bytes fail the pinned checksum fails loudly and caches nothing', async () => {
  const cacheDir = freshCache()
  const pinned = { url: SYNTHEA_RELEASES['3.2.0'].url, sha256: sha256(Buffer.from('the-right-bytes')) }
  const fetchImpl = async () => Buffer.from('WRONG-bytes') // sha will not match
  let threw = false
  try {
    await resolveSyntheaJar({
      syntheaVersion: '3.2.0',
      config: null,
      cacheDir,
      fetchImpl,
      releases: { '3.2.0': pinned },
    })
  } catch (e) {
    threw = true
    expect(String(e.message)).toMatch(/sha256|checksum/i)
  }
  expect(threw).toBe(true)
  // nothing unverified was left in the cache
  expect(existsSync(join(cacheDir, 'synthea-with-dependencies-3.2.0.jar'))).toBe(false)
  rmSync(cacheDir, { recursive: true, force: true })
})

test('a second resolve with the jar already cached does NOT re-fetch', async () => {
  const cacheDir = freshCache()
  const bytes = Buffer.from('cached-jar-bytes')
  const pinned = { url: SYNTHEA_RELEASES['3.2.0'].url, sha256: sha256(bytes) }
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount++
    return bytes
  }
  const opts = { syntheaVersion: '3.2.0', config: null, cacheDir, fetchImpl, releases: { '3.2.0': pinned } }
  const first = await resolveSyntheaJar(opts)
  const second = await resolveSyntheaJar(opts)
  expect(fetchCount).toBe(1) // fetched once, cache hit on the second
  expect(first.jar).toBe(second.jar)
  expect(second.fetched).toBe(false)
  rmSync(cacheDir, { recursive: true, force: true })
})

test('a config with a jar path WINS and no fetch is invoked (config is the override)', async () => {
  const cacheDir = freshCache()
  const localJar = join(cacheDir, 'my-local-synthea.jar')
  writeFileSync(localJar, 'local')
  let fetched = false
  const fetchImpl = async () => {
    fetched = true
    return Buffer.from('x')
  }
  const {
    jar,
    java,
    fetched: didFetch,
  } = await resolveSyntheaJar({
    syntheaVersion: '3.2.0',
    config: { jar: localJar, java: '/opt/jdk/bin/java' },
    cacheDir,
    fetchImpl,
  })
  expect(jar).toBe(localJar)
  expect(java).toBe('/opt/jdk/bin/java')
  expect(fetched).toBe(false)
  expect(didFetch).toBe(false)
  rmSync(cacheDir, { recursive: true, force: true })
})

test('an unpinned syntheaVersion fails loudly (no guessed url)', async () => {
  const cacheDir = freshCache()
  const fetchImpl = async () => Buffer.from('x')
  let threw = false
  try {
    await resolveSyntheaJar({ syntheaVersion: '9.9.9', config: null, cacheDir, fetchImpl })
  } catch (e) {
    threw = true
    expect(String(e.message)).toMatch(/9\.9\.9|pin/i)
  }
  expect(threw).toBe(true)
  rmSync(cacheDir, { recursive: true, force: true })
})
