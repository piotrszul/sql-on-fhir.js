import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Ordinal (code-unit) line comparator — the SAME order the old in-memory
// canonicaliser used (`a < b ? -1 : a > b ? 1 : 0`). Keeping this identical is
// what makes the streamed sort byte-for-byte compatible with existing checkfiles.
const ORDINAL = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Stream a file's non-empty lines. Mirrors the old `.filter(l => l.length > 0)`.
async function* readLines(path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.length > 0) yield line
    }
  } finally {
    rl.close()
  }
}

// Write lines (already sorted) to a file, each followed by '\n', respecting
// backpressure so the writer buffer stays bounded. Empty list => empty file.
async function writeLines(path, lines) {
  const out = createWriteStream(path)
  try {
    for (const line of lines) {
      if (!out.write(line + '\n')) await once(out, 'drain')
    }
  } finally {
    out.end()
    await once(out, 'finish')
  }
}

// A binary min-heap over {line, iterIndex}, ordered by ORDINAL(line). Used to
// merge the sorted runs while holding only one line per run in memory.
class Heap {
  constructor() {
    this.a = []
  }
  get size() {
    return this.a.length
  }
  push(x) {
    const a = this.a
    a.push(x)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (ORDINAL(a[i].line, a[p].line) >= 0) break
      ;[a[i], a[p]] = [a[p], a[i]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let s = i
        if (l < a.length && ORDINAL(a[l].line, a[s].line) < 0) s = l
        if (r < a.length && ORDINAL(a[r].line, a[s].line) < 0) s = r
        if (s === i) break
        ;[a[i], a[s]] = [a[s], a[i]]
        i = s
      }
    }
    return top
  }
}

// External merge sort of an NDJSON file's lines: split the input into on-disk
// sorted runs each bounded by ~maxBytes, then k-way merge them into `dst`. Memory
// is bounded by maxBytes (one run being sorted) plus one line per run during the
// merge — never the whole file — so the largest tiers stay materialisable.
// Byte-identical to the in-memory ordinal sort. Returns the line count.
export async function sortFileLines(src, dst, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'extsort-run-'))
  try {
    // Phase 1: sorted runs.
    const runs = []
    let buf = []
    let bytes = 0
    let total = 0
    const flush = async () => {
      if (buf.length === 0) return
      buf.sort(ORDINAL)
      const runPath = join(work, `run-${runs.length}.ndjson`)
      await writeLines(runPath, buf)
      runs.push(runPath)
      buf = []
      bytes = 0
    }
    for await (const line of readLines(src)) {
      buf.push(line)
      total++
      bytes += line.length + 1
      if (bytes >= maxBytes) await flush()
    }
    await flush()

    // Phase 2: k-way merge (a single run still streams through the same path).
    const iters = runs.map((r) => readLines(r)[Symbol.asyncIterator]())
    const heap = new Heap()
    for (let i = 0; i < iters.length; i++) {
      const { value, done } = await iters[i].next()
      if (!done) heap.push({ line: value, iterIndex: i })
    }
    const out = createWriteStream(dst)
    try {
      while (heap.size > 0) {
        const { line, iterIndex } = heap.pop()
        if (!out.write(line + '\n')) await once(out, 'drain')
        const { value, done } = await iters[iterIndex].next()
        if (!done) heap.push({ line: value, iterIndex })
      }
    } finally {
      out.end()
      await once(out, 'finish')
    }
    return total
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
