import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Ajv from 'ajv'
import hookSchema from '../../benchmark-hook.schema.json'

const validateManifest = new Ajv({ strict: false }).compile(hookSchema)

// Load and validate a hook manifest (benchmark-hook-format). In spawn mode a
// relative `cwd` (or an absent one) resolves against the manifest file's own
// directory, so a manifest can ship inside an implementation's repo and
// reference its hook script relatively; a connect-mode manifest has no cwd.
export function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (!validateManifest(manifest)) {
    const detail = (validateManifest.errors || []).map((e) => `${e.instancePath} ${e.message}`).join('; ')
    throw new Error(`hook manifest ${path} fails benchmark-hook.schema.json: ${detail}`)
  }
  if (manifest.endpoint) return manifest
  const base = dirname(resolve(path))
  return { ...manifest, cwd: manifest.cwd ? resolve(base, manifest.cwd) : base }
}
