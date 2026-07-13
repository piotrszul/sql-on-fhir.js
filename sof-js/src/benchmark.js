import { openSync, readSync, closeSync, createReadStream } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { createInterface } from 'node:readline'

// Shared NDJSON loading for the sof-js hook (src/hook.js) and bless mode
// (src/benchmark-run.js). The measurement loop and statistics live in the
// shared harness (benchmark/tools/harness), not here.

// Batch loader: the whole file parsed into an array. Used by the hook, which
// prepares an in-memory table per resource before the timed region. It reads the
// file in fixed-size byte chunks and decodes/splits incrementally rather than
// reading it whole, so a single large resource file never has to fit in one JS
// string (which an ~9 GB xl file would exceed). The parsed array it returns is
// still held in full — the preloaded_repeated scenario requires the whole dataset
// resident between runs — so this bounds the LOAD, not the resident dataset.
// `chunkBytes` is injectable only so tests can force many chunk boundaries.
export function loadResources(ndjsonPath, { chunkBytes = 1 << 16 } = {}) {
  const fd = openSync(ndjsonPath, 'r')
  const decoder = new StringDecoder('utf8')
  const buf = Buffer.allocUnsafe(chunkBytes)
  const out = []
  const pending = [] // decoded pieces of the current, not-yet-terminated line
  const parseLine = (line) => {
    if (line.trim().length > 0) out.push(JSON.parse(line))
  }
  try {
    let n
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      const chunk = buf.subarray(0, n)
      // StringDecoder holds back an incomplete trailing multibyte sequence until
      // the bytes completing it arrive in a later chunk, so a UTF-8 character
      // split across a chunk boundary is never corrupted. Held-back bytes are
      // never '\n' (0x0A cannot occur inside a multibyte sequence), so probing
      // the raw chunk for a newline is exact — a chunk without one just
      // accumulates its decoded text, and a line spanning k chunks is joined
      // once when its newline arrives, not re-scanned on every chunk.
      const text = decoder.write(chunk)
      if (chunk.indexOf(10) === -1) {
        if (text.length > 0) pending.push(text)
        continue
      }
      const parts = (pending.length > 0 ? pending.join('') + text : text).split('\n')
      pending.length = 0
      const tail = parts.pop() // the last part is an unterminated line; hold it back
      if (tail.length > 0) pending.push(tail)
      for (const line of parts) parseLine(line)
    }
    pending.push(decoder.end())
    parseLine(pending.join(''))
  } finally {
    closeSync(fd)
  }
  return out
}

// Streaming loader for the bless path: yields one parsed resource per NDJSON
// line without ever holding the whole file (or the whole parsed array) in
// memory. This is what bounds bless memory at the xl (100k) tier — see
// blessCheckfile in benchmark-run.js.
export async function* streamResources(ndjsonPath) {
  const rl = createInterface({ input: createReadStream(ndjsonPath), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.trim().length > 0) yield JSON.parse(line)
    }
  } finally {
    rl.close()
  }
}
