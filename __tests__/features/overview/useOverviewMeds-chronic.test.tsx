// 慢箋 belongs to the drug across its whole history. The overview builds rows
// for its window only, and a window holding only a drug's non-chronic refills
// must not un-mark it — the 用藥 tab and 複製現在用藥 both rely on it.
import { renderHook } from '@testing-library/react'
import { useOverviewMeds } from '@/features/clinical-summary/overview/hooks/useOverviewMeds'
import { buildOverviewWindow } from '@/features/clinical-summary/overview/utils/overview-selectors'

const NOW = Date.parse('2026-10-03T09:00:00+08:00')
jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => NOW }))

function refill(id: string, authoredOn: string, chronic: boolean) {
  return {
    resourceType: 'MedicationRequest',
    id,
    status: 'active',
    intent: 'order',
    authoredOn,
    medicationCodeableConcept: { text: 'LATANOPROST 50 MCG/ML', coding: [{ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code', code: 'X1' }] },
    ...(chronic ? { courseOfTherapyType: { coding: [{ code: 'continuous' }] } } : {}),
    dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days', code: 'd' } },
  }
}

it('does not infer that this order is 慢箋 from another prescription of the same drug', () => {
  const medications = [
    refill('old', '2026-04-20T00:00:00+08:00', true),
    refill('latest', '2026-09-20T00:00:00+08:00', false),
  ]
  const { result } = renderHook(() => useOverviewMeds(medications, buildOverviewWindow(3, NOW), 'medical', 'zh-TW'))
  const current = result.current.meds.items.filter((item) => item.isCurrent)
  expect(current).toHaveLength(1)
  expect(current[0].id).toBe('latest')
  expect(current[0].isChronic).toBe(false)
})

// 「用到哪天」 prints the source's own end day: the remaining-day count is
// rounded up, and a supply ending later in the day than now would read a day late.
it('writes the until-date from the source end day, not the rounded-up count', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toMedCopySourceItems } = require('@/features/clinical-summary/overview/utils/overview-med-copy')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildMedicationCopyText, selectMedicationsForCopy, BUILTIN_MED_COPY_FORMATS } = require('@/features/clinical-summary/medications/utils/medication-copy-text')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW } = require('@/src/shared/i18n/locales/zh-TW')
  const medication = {
    ...refill('m1', '2026-09-12T09:00:00+08:00', false),
    dispenseRequest: { validityPeriod: { start: '2026-09-12T09:00:00+08:00', end: '2026-10-10T18:00:00+08:00' } },
  }
  const { result } = renderHook(() => useOverviewMeds([medication], buildOverviewWindow(3, NOW), 'medical', 'zh-TW'))
  const selection = selectMedicationsForCopy(toMedCopySourceItems(result.current.meds.items))
  const text: string = buildMedicationCopyText(selection, BUILTIN_MED_COPY_FORMATS['builtin:full'], { today: '2026-10-03', labels: zhTW.medCopy.text }).text
  expect(text).toContain('10/10')
  expect(text).not.toContain('10/11')
})
