// Case selection shared by the harness `run` CLI (benchmark-harness) and the
// bless CLI (benchmark-reference-runner). A pure predicate builder: given the
// benchmark's known case ids and the `--only` / `--exclude` id lists, it returns
// a `(case) => boolean` filter (or null when neither flag is set, meaning "all").
//
// Contract: `--exclude` wins over `--only` on a conflict, and an id that matches
// no known case is a loud error rather than a silent empty run.

// Parse a comma-separated `--only a,b,c` value into a trimmed, non-empty id list.
export function parseIdList(value) {
  if (!value) return []
  return value
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

export function buildCaseFilter({ only, exclude, knownIds }) {
  const onlyIds = Array.isArray(only) ? only : parseIdList(only)
  const excludeIds = Array.isArray(exclude) ? exclude : parseIdList(exclude)

  const known = new Set(knownIds)
  const unknown = [...new Set([...onlyIds, ...excludeIds])].filter((id) => !known.has(id))
  if (unknown.length) {
    throw new Error(
      `unknown case id(s): ${unknown.join(', ')} — known ids are: ${knownIds.join(', ') || '(none)'}`,
    )
  }

  // No selection flags => no filter (callers run/bless every case).
  if (!onlyIds.length && !excludeIds.length) return null

  const onlySet = new Set(onlyIds)
  const excludeSet = new Set(excludeIds)
  return (c) => {
    const id = typeof c === 'string' ? c : c.id
    if (excludeSet.has(id)) return false // exclude wins on conflict
    if (onlySet.size) return onlySet.has(id)
    return true
  }
}
