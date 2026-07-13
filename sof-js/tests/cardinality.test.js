import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardinality } from '../src/benchmark-run.js'
import { evaluate } from '../src/index.js'

// The analytic row-cardinality derivation (benchmark-reference-runner): a
// count-only walk over the select tree that must agree, resource by resource,
// with evaluate()'s row-composition. It shares the FHIRPath layer but never the
// row-composition code, so it is a genuine cross-check of the bless.

// ---- the cardinality algebra, one construct at a time ----

const R = { resourceType: 'X' }

function view(select, extra = {}) {
  return { resource: 'X', select, ...extra }
}

test('no forEach/where => one row per resource', () => {
  const v = view([{ column: [{ name: 'a', path: 'id', type: 'string' }] }])
  expect(cardinality(v, R)).toBe(1)
})

test('single forEach => collection length', () => {
  const v = view([{ forEach: 'items', column: [{ name: 'a', path: 'v', type: 'string' }] }])
  expect(cardinality(v, { resourceType: 'X', items: [1, 2, 3] })).toBe(3)
  expect(cardinality(v, { resourceType: 'X', items: [] })).toBe(0)
})

test('forEachOrNull empty => one all-null row; non-empty => length', () => {
  const v = view([{ forEachOrNull: 'items', column: [{ name: 'a', path: 'v', type: 'string' }] }])
  expect(cardinality(v, { resourceType: 'X', items: [] })).toBe(1)
  expect(cardinality(v, { resourceType: 'X', items: [1, 2] })).toBe(2)
})

test('nested forEach => product across levels', () => {
  const v = view([
    {
      forEach: 'outer',
      select: [{ forEach: 'inner', column: [{ name: 'a', path: 'v', type: 'string' }] }],
    },
  ])
  // outer has 2 elements, each with inner of length 2 and 3 => 2 + 3 = 5
  const r = { resourceType: 'X', outer: [{ inner: [1, 2] }, { inner: [1, 2, 3] }] }
  expect(cardinality(v, r)).toBe(5)
})

test('sibling select[] => cross-join product', () => {
  const v = view([
    { column: [{ name: 'a', path: 'id', type: 'string' }] },
    { forEach: 'left', column: [{ name: 'l', path: 'v', type: 'string' }] },
    { forEach: 'right', column: [{ name: 'r', path: 'v', type: 'string' }] },
  ])
  const r = { resourceType: 'X', left: [1, 2], right: [1, 2, 3] }
  expect(cardinality(v, r)).toBe(6) // 1 * 2 * 3
})

test('unionAll => sum of branches', () => {
  const v = view([
    {
      column: [{ name: 'a', path: 'id', type: 'string' }],
      unionAll: [
        { forEach: 'left', column: [{ name: 'x', path: 'v', type: 'string' }] },
        { forEach: 'right', column: [{ name: 'x', path: 'v', type: 'string' }] },
      ],
    },
  ])
  const r = { resourceType: 'X', left: [1, 2], right: [1, 2, 3] }
  expect(cardinality(v, r)).toBe(5) // 2 + 3
})

test('view-level where filters resources out', () => {
  const v = view([{ column: [{ name: 'a', path: 'id', type: 'string' }] }], {
    where: [{ path: "flag = 'yes'" }],
  })
  expect(cardinality(v, { resourceType: 'X', flag: 'yes' })).toBe(1)
  expect(cardinality(v, { resourceType: 'X', flag: 'no' })).toBe(0)
})

// ---- the self-protecting invariant against the real imported views ----
//
// For every clinical-wide case, over a hand-built fixture that exercises the
// view's structure, Σ cardinality(view, r) MUST equal evaluate(view, rs).length.
// This is the invariant bless asserts; if it holds here it holds in bless.

const clinicalWide = JSON.parse(
  readFileSync(join(import.meta.dir, '../../benchmark/clinical-wide.json'), 'utf8'),
)
const caseOf = (id) => clinicalWide.cases.find((c) => c.id === id).view

function coding(system, code) {
  return { system, code }
}

const FIXTURES = {
  'condition-flat': [
    {
      resourceType: 'Condition',
      id: 'c1',
      subject: { reference: 'Patient/p1' },
      encounter: { reference: 'Encounter/e1' },
      onsetDateTime: '2020-01-01',
      code: { coding: [coding('s', 'x'), coding('s', 'y')] },
      category: [{ coding: [coding('s', 'a')] }],
      clinicalStatus: { coding: [coding('s', 'active')] },
      verificationStatus: { coding: [] },
    },
    { resourceType: 'Condition', id: 'c2' },
  ],
  'encounter-flat': [
    {
      resourceType: 'Encounter',
      id: 'e1',
      status: 'finished',
      subject: { reference: 'Patient/p1' },
      type: [{ coding: [coding('s', 't1'), coding('s', 't2')] }],
      participant: [{ individual: { reference: 'Practitioner/pr1' } }],
      location: [{ location: { reference: 'Location/l1' } }, { location: { reference: 'Location/l2' } }],
    },
    { resourceType: 'Encounter', id: 'e2', status: 'planned' },
  ],
  'patient-addresses': [
    { resourceType: 'Patient', id: 'p1', address: [{ city: 'A' }, { city: 'B' }] },
    { resourceType: 'Patient', id: 'p2' },
  ],
  'patient-and-contact-addresses': [
    {
      resourceType: 'Patient',
      id: 'p1',
      address: [{ city: 'A' }, { city: 'B' }],
      contact: [{ address: { city: 'C' } }],
    },
    { resourceType: 'Patient', id: 'p2' },
  ],
  'patient-demographics': [
    {
      resourceType: 'Patient',
      id: 'p1',
      gender: 'female',
      name: [
        { use: 'official', given: ['Ann'], family: 'Smith' },
        { use: 'nickname', given: ['Annie'] },
      ],
    },
    { resourceType: 'Patient', id: 'p2', gender: 'male', name: [{ use: 'nickname', given: ['Bo'] }] },
  ],
  'us-core-blood-pressures': [
    {
      resourceType: 'Observation',
      id: 'o1',
      subject: { reference: 'Patient/p1' },
      effectiveDateTime: '2020-01-01',
      code: { coding: [coding('http://loinc.org', '85354-9')] },
      component: [
        {
          code: { coding: [coding('http://loinc.org', '8480-6')] },
          valueQuantity: { system: 'u', code: 'mm[Hg]', unit: 'mmHg', value: 120 },
        },
        {
          code: { coding: [coding('http://loinc.org', '8462-4')] },
          valueQuantity: { system: 'u', code: 'mm[Hg]', unit: 'mmHg', value: 80 },
        },
      ],
    },
    // fails the view-level where (not a blood-pressure panel) => 0 rows
    {
      resourceType: 'Observation',
      id: 'o2',
      code: { coding: [coding('http://loinc.org', '1234-5')] },
    },
    // passes where, has systolic but no diastolic => forEach.first() empty => 0 rows
    {
      resourceType: 'Observation',
      id: 'o3',
      code: { coding: [coding('http://loinc.org', '85354-9')] },
      component: [
        {
          code: { coding: [coding('http://loinc.org', '8480-6')] },
          valueQuantity: { system: 'u', code: 'mm[Hg]', unit: 'mmHg', value: 118 },
        },
      ],
    },
  ],
}

for (const [id, resources] of Object.entries(FIXTURES)) {
  test(`Σ cardinality === evaluate().length for "${id}"`, () => {
    const v = caseOf(id)
    const derived = resources.reduce((sum, r) => sum + cardinality(v, r), 0)
    const observed = evaluate(v, resources).length
    expect(derived).toBe(observed)
  })
}
