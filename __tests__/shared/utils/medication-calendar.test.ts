import { medicationSupplyEndDay, medicationSupplyDaysRemaining, medicationClinicalDay } from '@/src/shared/utils/medication-calendar'
import { medicationExpectedEnd, medicationExpectedEndTimestamp, assessMedicationCurrentness, isLapsedDispensing } from '@/src/core/utils/clinical-context-selection.utils'

it('uses inclusive source calendar dates across month and timezone boundaries', () => {
  expect(medicationSupplyEndDay('2026-10-19T00:00:00+08:00', 28)).toBe('2026-11-15')
  expect(medicationSupplyEndDay('2028-02-28', 3)).toBe('2028-03-01')
  expect(medicationSupplyEndDay('2026-10-19', 1)).toBe('2026-10-19')
  expect(medicationSupplyDaysRemaining('2026-11-15', Date.parse('2026-10-20T23:59:00+08:00'))).toBe(27)
  expect(medicationSupplyDaysRemaining('2026-11-15', Date.parse('2026-11-15T23:59:00+08:00'))).toBe(1)
  expect(medicationSupplyDaysRemaining('2026-11-15', Date.parse('2026-11-16T00:01:00+08:00'))).toBe(-1)
})

it('prefers the recorded final date over a derived supply estimate', () => {
  const med = { status: 'active', authoredOn: '2026-10-19', meta: { source: 'ehr-fhir-bridge/scraper' }, dispenseRequest: {
    expectedSupplyDuration: { value: 28, code: 'd' }, validityPeriod: { end: '2026-11-14T23:59:59+08:00' },
  } }
  expect(medicationExpectedEnd(med)).toBe('2026-11-14')
  expect(assessMedicationCurrentness(med, new Date(2026, 10, 15, 0, 1).getTime()).current).toBe(false)
})

it('does not extend seven days of medication supply to the prescription dispensing authorization expiry', () => {
  const medication = { status: 'active', authoredOn: '2026-10-19', dispenseRequest: {
    expectedSupplyDuration: { value: 7, code: 'd' }, validityPeriod: { end: '2026-12-31' },
  } }
  expect(medicationExpectedEnd(medication)).toBe('2026-10-25')
  expect(assessMedicationCurrentness(medication, new Date(2026, 9, 26).getTime()).current).toBe(false)
})

it('uses the order interval as the supply span when no supply duration is recorded', () => {
  const medication = { status: 'active', authoredOn: '2024-06-14', dispenseRequest: {
    validityPeriod: { start: '2024-06-14', end: '2024-07-14' },
  } }
  expect(medicationExpectedEnd(medication)).toBe('2024-07-14')
  expect(assessMedicationCurrentness(medication, new Date(2024, 6, 14, 12).getTime())).toMatchObject({ current: true, uncertain: false })
  expect(assessMedicationCurrentness(medication, new Date(2026, 9, 1).getTime())).toMatchObject({ current: false, uncertain: false })
  // An interval ending before the order began is not a span.
  expect(medicationExpectedEnd({ ...medication, dispenseRequest: { validityPeriod: { end: '2024-06-01' } } })).toBeUndefined()
})

it.each(['active', 'unknown'])('does not count a %s order as current before its interval begins', (status) => {
  const future = { status, authoredOn: '2026-11-01', dispenseRequest: { validityPeriod: { start: '2026-11-01', end: '2026-11-30' } } }
  expect(assessMedicationCurrentness(future, new Date(2026, 9, 28).getTime())).toMatchObject({ current: false, uncertain: false })
  expect(assessMedicationCurrentness(future, new Date(2026, 10, 1, 9).getTime())).toMatchObject({ current: true, uncertain: false })
  expect(assessMedicationCurrentness(future, new Date(2026, 11, 1, 9).getTime())).toMatchObject({ current: false, uncertain: false })
  // With only the interval's own start, the same start applies.
  const { authoredOn: _authored, ...validityOnly } = future
  expect(assessMedicationCurrentness(validityOnly, new Date(2026, 9, 28).getTime()).current).toBe(false)
  expect(assessMedicationCurrentness(validityOnly, new Date(2026, 10, 1, 9).getTime()).current).toBe(true)
})

it.each(['active', 'unknown'])('opens a timed %s interval at its exact start, in its own time zone', (status) => {
  const timed = { status, dispenseRequest: { validityPeriod: { start: '2026-11-01T15:00:00+08:00', end: '2026-11-30T23:59:59+08:00' } } }
  expect(assessMedicationCurrentness(timed, Date.parse('2026-11-01T09:00:00+08:00'))).toMatchObject({ current: false, uncertain: false })
  expect(assessMedicationCurrentness(timed, Date.parse('2026-11-01T06:59:59Z'))).toMatchObject({ current: false, uncertain: false })
  expect(assessMedicationCurrentness(timed, Date.parse('2026-11-01T07:00:00Z'))).toMatchObject({ current: true, uncertain: false })
  expect(assessMedicationCurrentness(timed, Date.parse('2026-12-01T00:00:00+08:00')).current).toBe(false)
})

it.each([{ value: 6, code: 'h', hours: 6, end: '2026-10-19' }, { value: 2.4, code: 'd', hours: 57.6, end: '2026-10-21' }, { value: 30, code: 'min', hours: 0.5, end: '2026-10-19' }])('shares exact coverage for $value $code across dates and currentness', ({ value, code, hours, end }) => {
  const medication = { status: 'unknown', authoredOn: '2026-10-19T00:00:00+08:00', dispenseRequest: { expectedSupplyDuration: { value, code } } }
  const expectedEnd = Date.parse(medication.authoredOn) + hours * 3600000 - 1
  expect(medicationExpectedEndTimestamp(medication)).toBeCloseTo(expectedEnd, 0)
  expect(medicationExpectedEnd(medication)).toBe(end)
  expect(assessMedicationCurrentness(medication, expectedEnd - 1).current).toBe(true)
  expect(assessMedicationCurrentness(medication, expectedEnd + 1)).toMatchObject({ current: false, uncertain: false })
})

it('does not call a source-status-conflicted cloud record a previously dispensed medicine after its estimated window ends', () => {
  expect(isLapsedDispensing({ status: 'active', authoredOn: '2026-10-01', dispenseRequest: { expectedSupplyDuration: { value: 7, code: 'd' } },
    _sourceRecordComparison: { warnings: ['source-status-conflict'] } }, Date.parse('2026-10-20'))).toBe(false)
})

it('keeps a midnight Taiwan source date while evaluating the exact ending instant', () => {
  const medication = { status: 'active', dosageInstruction: [{ timing: { repeat: { boundsPeriod: { end: '2026-10-21T00:00:00+08:00' } } } }] }
  expect(medicationExpectedEnd(medication)).toBe('2026-10-21')
  expect(medicationExpectedEndTimestamp(medication)).toBe(Date.parse('2026-10-20T16:00:00Z'))
  expect(assessMedicationCurrentness(medication, Date.parse('2026-10-20T16:00:01Z')).current).toBe(false)
  const utcRepresentation = { ...medication, dosageInstruction: [{ timing: { repeat: { boundsPeriod: { end: '2026-10-20T16:00:00Z' } } } }] }
  expect(medicationExpectedEnd(utcRepresentation)).toBe('2026-10-21')
  expect(medicationExpectedEndTimestamp(utcRepresentation)).toBe(medicationExpectedEndTimestamp(medication))
})

it.each([23, 24, 48])('keeps %s hours as elapsed time even when it converts to whole days', hours => {
  const medication = { status: 'active', authoredOn: '2026-10-19T15:00:00+08:00', dispenseRequest: { expectedSupplyDuration: { value: hours, code: 'h' } } }
  expect(medicationExpectedEndTimestamp(medication)).toBe(Date.parse(medication.authoredOn) + hours * 3600000 - 1)
})

it('marks unrecognised supply units uncertain instead of keeping a stale active record current indefinitely', () => {
  expect(assessMedicationCurrentness({ status: 'active', authoredOn: '2026-10-01', dispenseRequest: { expectedSupplyDuration: { value: 7, unit: 'unrecognised' } } }, Date.parse('2026-10-20')))
    .toMatchObject({ current: false, uncertain: true })
})

it('takes the amount and unit from the same valid fallback duration', () => {
  const medication = { authoredOn: '2026-10-19T15:00:00+08:00', dispenseRequest: { expectedSupplyDuration: { code: 'h' } }, dosageInstruction: [{ timing: { repeat: { boundsDuration: { value: 2, code: 'd' } } } }] }
  expect(medicationExpectedEndTimestamp(medication)).toBe(Date.parse('2026-10-20T23:59:59.999+08:00'))
  expect(medicationSupplyDaysRemaining('2026-10-20T16:00:00Z', Date.parse('2026-10-21T00:00:00+08:00'))).toBe(1)
})

it('does not throw on an out-of-range duration or timestamp', () => {
  expect(medicationClinicalDay(1e20)).toBeUndefined()
  expect(medicationSupplyEndDay('2026-10-19', 1e20)).toBeUndefined()
  expect(medicationExpectedEnd({ authoredOn: '2026-10-19', dispenseRequest: { expectedSupplyDuration: { value: 1e12, code: 'h' } } })).toBeUndefined()
})

it('does not infer ongoing use from dispensing authorization alone', () => {
  expect(assessMedicationCurrentness({ status: 'active', dispenseRequest: { validityPeriod: { end: '2026-01-01' } } }, Date.parse('2026-10-21')))
    .toMatchObject({ current: false, uncertain: true })
})

it('shows zero remaining days after an exact ending instant, even on the same clinical day', () => {
  expect(medicationSupplyDaysRemaining('2026-10-21T00:00:00+08:00', Date.parse('2026-10-21T10:00:00+08:00'))).toBe(0)
  expect(medicationSupplyDaysRemaining('2026-10-21T23:59:59+08:00', Date.parse('2026-10-21T10:00:00+08:00'))).toBe(1)
})
