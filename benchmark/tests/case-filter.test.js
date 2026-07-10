import { test, expect } from 'bun:test'
import { buildCaseFilter, parseIdList } from '../tools/case-filter.js'

const known = ['a', 'b', 'c']
const cases = known.map((id) => ({ id }))
const selected = (filter) => (filter ? cases.filter(filter).map((c) => c.id) : known)

test('parseIdList splits, trims and drops empties', () => {
  expect(parseIdList('a, b ,c')).toEqual(['a', 'b', 'c'])
  expect(parseIdList('')).toEqual([])
  expect(parseIdList(undefined)).toEqual([])
  expect(parseIdList('a,,b,')).toEqual(['a', 'b'])
})

test('no flags => null filter (run everything)', () => {
  expect(buildCaseFilter({ knownIds: known })).toBeNull()
})

test('--only selects exactly the named cases', () => {
  const f = buildCaseFilter({ only: 'a,b', knownIds: known })
  expect(selected(f)).toEqual(['a', 'b'])
})

test('--exclude removes the named cases', () => {
  const f = buildCaseFilter({ exclude: 'c', knownIds: known })
  expect(selected(f)).toEqual(['a', 'b'])
})

test('--only and --exclude combine with exclude winning on conflict', () => {
  const f = buildCaseFilter({ only: 'a,b', exclude: 'b', knownIds: known })
  expect(selected(f)).toEqual(['a'])
})

test('an unknown id is a loud error', () => {
  expect(() => buildCaseFilter({ only: 'a,nope', knownIds: known })).toThrow(/unknown case id/)
  expect(() => buildCaseFilter({ exclude: 'ghost', knownIds: known })).toThrow(/ghost/)
})

test('accepts pre-split arrays as well as comma strings', () => {
  const f = buildCaseFilter({ only: ['a', 'c'], knownIds: known })
  expect(selected(f)).toEqual(['a', 'c'])
})
