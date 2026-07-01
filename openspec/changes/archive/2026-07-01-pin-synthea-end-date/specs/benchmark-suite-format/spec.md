## ADDED Requirements

### Requirement: Synthea recipe pins every output-affecting input

A `synthea`-kind dataset recipe SHALL declare, in its `params`, every input
that affects the generated data, so that the language-neutral artifact — and its
content hash — describe the dataset completely rather than deferring inputs to
executor-hardcoded defaults or to the machine wall clock. In addition to the
existing `seed`, `clinicianSeed`, and `referenceTime`, the `params` SHALL
include a pinned simulation end date `endTime` (`YYYYMMDD`), and SHALL carry the
export toggles that shape the output — `yearsOfHistory`, `hospitalExport`,
`practitionerExport`, and `bulkData`. The invariant validator SHALL report an
error naming any of these output-affecting params (`endTime`, `yearsOfHistory`,
`hospitalExport`, `practitionerExport`, `bulkData`) that a `synthea` recipe
omits. Because the boolean toggles are meaningful when `false`, the validator
treats only an absent (null/undefined) value as an omission, not an explicit
`false`.

#### Scenario: Recipe declares an explicit end date

- **WHEN** a `synthea` recipe's `params` are inspected
- **THEN** they include an `endTime` (`YYYYMMDD`) that pins Synthea's simulation
  end date rather than relying on the wall-clock default

#### Scenario: Missing endTime is rejected

- **WHEN** a `synthea` recipe's `params` omit `endTime`
- **THEN** the invariant validator returns an error naming the recipe and the
  missing `endTime`

#### Scenario: Any missing output-affecting param is rejected

- **WHEN** a `synthea` recipe's `params` omit any output-affecting input —
  `endTime`, `yearsOfHistory`, `hospitalExport`, `practitionerExport`, or
  `bulkData`
- **THEN** the invariant validator returns an error naming the missing param,
  so an unspecified input can never be interpolated into the executor as
  `undefined` (and silently read as false / wall-clock)
- **AND** an explicit `false` for a boolean toggle is accepted as a declared
  value, not treated as omitted

#### Scenario: Export toggles live in the recipe

- **WHEN** a `synthea` recipe is inspected
- **THEN** the output-affecting export toggles (`yearsOfHistory`,
  `hospitalExport`, `practitionerExport`, `bulkData`) are present in `params`
  and are not left to executor-hardcoded values

#### Scenario: Content hash covers the pinned inputs

- **WHEN** two `synthea` recipes differ only in `endTime` (or in any moved
  export toggle)
- **THEN** their content hashes — and therefore their materialized directories —
  differ, and reordering the `params` keys does not change the hash
