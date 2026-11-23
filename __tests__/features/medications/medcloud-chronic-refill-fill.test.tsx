import { renderHook } from '@testing-library/react'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { visitKeyOfRow } from '@/features/clinical-summary/medications/utils/visit-bands'
import { assessMedicationCurrentness, medicationExpectedEnd } from '@/src/core/utils/clinical-context-selection.utils'
import { MEDCLOUD_REFILL_DISPENSE_DAY_URL } from '@/src/shared/constants/medcloud.constants'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-08-20T04:00:00+08:00') }))

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'

/** One synthetic 慢連箋 as MediCloud lists it: three fills under the 6/24
 * visit, the later two with the day each was dispensed. */
function fill(id: string, dispensed?: string): any {
  return {
    resourceType: 'MedicationRequest', id, meta: { source: 'https://medcloud2.nhi.gov.tw/' },
    status: 'unknown', intent: 'order', subject: { reference: 'Patient/synthetic' }, authoredOn: '2026-06-24',
    requester: { display: '臺北榮總;門診' }, reasonCode: [{ coding: [{ code: 'I25.9' }], text: '慢性缺血性心臟病' }],
    medicationCodeableConcept: { coding: [{ system: NHI, code: 'BC23001100', display: 'SYNTHETIC DILTIAZEM 120MG' }] },
    dispenseRequest: { expectedSupplyDuration: { value: 30, unit: 'days', system: 'http://unitsofmeasure.org', code: 'd' } },
    ...(dispensed ? { extension: [{ url: MEDCLOUD_REFILL_DISPENSE_DAY_URL, valueString: `${dispensed}T00:00:00` }] } : {}),
  }
}

describe('a later 慢連箋 fill MediCloud lists under the visit that wrote it', () => {
  it('covers its supply from the day it was dispensed', () => {
    expect(medicationExpectedEnd(fill('first'))).toBe('2026-07-23')
    expect(medicationExpectedEnd(fill('second', '2026-07-16'))).toBe('2026-08-14')
    expect(medicationExpectedEnd(fill('third', '2026-08-17'))).toBe('2026-09-15')
    const now = Date.parse('2026-08-20T04:00:00+08:00')
    expect(assessMedicationCurrentness(fill('second', '2026-07-16'), now).current).toBe(false)
    expect(assessMedicationCurrentness(fill('third', '2026-08-17'), now).current).toBe(true)
  })

  it('stays in the visit that wrote it and shows its own fill window', () => {
    const rows = renderHook(() => useMedicationRows([fill('first'), fill('second', '2026-07-16'), fill('third', '2026-08-17')])).result.current
    const byId = Object.fromEntries(rows.map(row => [row.id, row]))
    expect(new Set(rows.map(row => visitKeyOfRow(row, row.id))).size).toBe(1)
    expect(byId.first).toMatchObject({ startedOnIso: '2026-06-24', endDateIso: '2026-07-23' })
    expect(byId.first.dispensedOn).toBeUndefined()
    expect(byId.second).toMatchObject({ startedOnIso: '2026-06-24', endDateIso: '2026-08-14' })
    expect(byId.second.dispensedOn).toBeDefined()
    expect(byId.third).toMatchObject({ endDateIso: '2026-09-15', isInactive: false })
  })
})
