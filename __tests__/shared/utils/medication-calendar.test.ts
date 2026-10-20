import { medicationSupplyEndDay, medicationSupplyDaysRemaining } from '@/src/shared/utils/medication-calendar'
import { medicationExpectedEnd, assessMedicationCurrentness } from '@/src/core/utils/clinical-context-selection.utils'

it('uses inclusive source calendar dates across month and timezone boundaries', () => {
  expect(medicationSupplyEndDay('2026-10-19T00:00:00+08:00', 28)).toBe('2026-11-15')
  expect(medicationSupplyEndDay('2028-02-28', 3)).toBe('2028-03-01')
  expect(medicationSupplyEndDay('2026-10-19', 1)).toBe('2026-10-19')
  expect(medicationSupplyDaysRemaining('2026-11-15', new Date(2026, 9, 20, 23, 59).getTime())).toBe(27)
  expect(medicationSupplyDaysRemaining('2026-11-15', new Date(2026, 10, 15, 23, 59).getTime())).toBe(1)
  expect(medicationSupplyDaysRemaining('2026-11-15', new Date(2026, 10, 16, 0, 1).getTime())).toBe(-1)
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
  expect(medicationExpectedEnd({ ...medication, dispenseRequest: { validityPeriod: { end: '2026-12-31' } } })).toBeUndefined()
})
