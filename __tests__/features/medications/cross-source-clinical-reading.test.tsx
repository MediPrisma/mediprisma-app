import { render, renderHook, screen } from '@testing-library/react'
import fixture from '@/e2e/fixtures/cross-source-prescriptions.json'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { groupMedications } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import { MedicationItem } from '@/features/clinical-summary/medications/components/MedicationItem'
import { useDiagnosisRows } from '@/features/clinical-summary/diagnosis/hooks/useDiagnosisRows'
import { buildIcdDictionary } from '@/src/shared/utils/icd-lookup'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-20T04:00:00+08:00') }))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }) }))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/shared/components/TapTooltip', () => ({ TapTooltip: ({ children, content }: any) => <>{children}<div>{content}</div></> }))

it('integrates a known cross-source order while retaining two real identical orders, self-pay and cancellation', () => {
  const before = JSON.stringify(fixture)
  const collection = LocalBundleService.parse(fixture)!.collection
  expect(collection.encounters).toHaveLength(1)
  expect(collection.medications).toHaveLength(5)
  const { result } = renderHook(() => useMedicationRows(collection.medications))
  const rows = result.current
  const integrated = rows.find(row => row.id === 'synthetic-order-a')!
  expect(integrated).toMatchObject({ dataOrigin: 'integrated', nhiDrugCode: 'BC23097100', isChronic: true,
    totalQuantity: 28, durationDays: 28, route: 'PO', sourceOrderIdentifiers: ['SYNTHETIC-ORDER-A'] })
  expect(integrated.reconciledOrderIds).toContain('synthetic-cloud-order-a')
  expect(rows.filter(row => row.id.startsWith('synthetic-distinct-order'))).toHaveLength(2)
  expect(rows.find(row => row.id === 'synthetic-self-pay')).toMatchObject({ selfPurchased: true, dataOrigin: 'hospital', nhiDrugCode: undefined })
  expect(rows.find(row => row.id === 'synthetic-cancelled')).toMatchObject({ isInactive: true, status: 'cancelled' })
  const grouped = groupMedications(rows)
  expect(grouped.activeMedications).toHaveLength(4)
  expect(grouped.activeMedications.filter(row => row.id.startsWith('synthetic-distinct-order'))).toHaveLength(2)
  render(<>{rows.map(row => <MedicationItem key={row.id} medication={row} />)}</>)
  expect(screen.getByText('院內＋雲端')).toBeInTheDocument()
  expect(screen.getByText('自費／自購')).toBeInTheDocument()
  expect(screen.getByText('已取消')).toBeInTheDocument()
  expect(screen.getByText('雲端紀錄健保藥碼')).toBeInTheDocument()
  expect(screen.getByText('BC23097100')).toBeInTheDocument()
  expect(screen.getByText('Aromasin SC tab 25 mg')).toBeInTheDocument()
  expect(JSON.stringify(fixture)).toBe(before)
})

it('uses a complete shared diagnosis code for Chinese wording and keeps every recorded diagnosis', () => {
  const collection = LocalBundleService.parse(fixture)!.collection
  const dictionary = buildIcdDictionary(collection.conditions, 'zh-TW', collection.encounters)
  const { result } = renderHook(() => useDiagnosisRows(collection.conditions, 'zh-TW', dictionary, collection.encounters))
  expect(result.current.map(row => row.icdCodes)).toEqual([['C50.912'], ['E11.9']])
  expect(result.current.map(row => row.title)).toEqual(['左側女性乳房未明示部位惡性腫瘤', '第二型糖尿病，未伴有併發症'])
})

it('does not transfer a chronic flag from another prescription of the same product', () => {
  const base = { id: 'synthetic-acute', authoredOn: '2026-10-19', status: 'active', medicationCodeableConcept: { text: 'Synthetic medicine' } }
  const chronic = { ...base, id: 'synthetic-chronic', courseOfTherapyType: { coding: [{ code: 'continuous' }] } }
  const { result } = renderHook(() => useMedicationRows([base], 'medical', 'zh-TW', [base, chronic]))
  expect(result.current[0].isChronic).toBe(false)
  expect(result.current[0].refillCount).toBe(2)
})
