import { render, renderHook, screen } from '@testing-library/react'
import fixture from '@/e2e/fixtures/cross-source-prescriptions.json'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { groupMedications } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import { MedicationItem } from '@/features/clinical-summary/medications/components/MedicationItem'
import { useDiagnosisRows } from '@/features/clinical-summary/diagnosis/hooks/useDiagnosisRows'
import { buildIcdDictionary } from '@/src/shared/utils/icd-lookup'
import { useOverviewMeds } from '@/features/clinical-summary/overview/hooks/useOverviewMeds'
import { buildOverviewWindow } from '@/features/clinical-summary/overview/utils/overview-selectors'
import { useVisitHistory } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'
import { useEncounterDetails } from '@/features/clinical-summary/visit-history/hooks/useEncounterDetails'
import { mapMedications } from '@/features/ips-export/utils/ips-fhir-mappers'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-20T04:00:00+08:00') }))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }) }))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/shared/components/TapTooltip', () => ({ TapTooltip: ({ children, content }: any) => <>{children}<div>{content}</div></> }))

it('compares possible source copies without deleting either, retaining two real identical orders, self-pay and cancellation', () => {
  const before = JSON.stringify(fixture)
  const collection = LocalBundleService.parse(fixture)!.collection
  expect(collection.encounters).toHaveLength(2)
  expect(collection.medications).toHaveLength(6)
  const { result } = renderHook(() => useMedicationRows(collection.medications))
  const rows = result.current
  const integrated = rows.find(row => row.id === 'synthetic-order-a')!
  expect(integrated).toMatchObject({ dataOrigin: 'hospital', nhiDrugCode: undefined, isChronic: true,
    totalQuantity: undefined, durationDays: 28, route: 'PO', sourceOrderIdentifiers: ['SYNTHETIC-ORDER-A'] })
  expect(integrated.sourceComparison).toMatchObject({ status: 'candidate', records: [
    { dataOrigin: 'hospital' }, { dataOrigin: 'medcloud', nhiDrugCode: 'BC23097100' },
  ] })
  expect(integrated.endDateIso).toBe('2026-11-15')
  expect(integrated.reconciledOrderIds).toContain('synthetic-cloud-order-a')
  expect(rows.filter(row => row.id.startsWith('synthetic-distinct-order'))).toHaveLength(2)
  expect(rows.find(row => row.id === 'synthetic-self-pay')).toMatchObject({ selfPurchased: true, dataOrigin: 'hospital', nhiDrugCode: undefined })
  expect(rows.find(row => row.id === 'synthetic-cancelled')).toMatchObject({ isInactive: true, status: 'cancelled' })
  const grouped = groupMedications(rows)
  expect(grouped.activeMedications).toHaveLength(4)
  expect(grouped.activeMedications.filter(row => row.id.startsWith('synthetic-distinct-order'))).toHaveLength(2)
  render(<>{rows.map(row => <MedicationItem key={row.id} medication={row} />)}</>)
  expect(screen.getByText('跨來源待核對')).toBeInTheDocument()
  expect(screen.getByText('自費／自購')).toBeInTheDocument()
  expect(screen.getByText('已取消')).toBeInTheDocument()
  expect(screen.getAllByText(/BC23097100/).length).toBeGreaterThan(0)
  expect(screen.getAllByText('Aromasin SC tab 25 mg').length).toBeGreaterThan(0)
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

it('shares currentness semantics with AI/IPS and does not invent a stop date or one-day supply from completed status', () => {
  const source = { id: 'source-completed', status: 'completed', authoredOn: '2026-10-19', medicationCodeableConcept: { text: 'Synthetic medicine' } }
  const { result } = renderHook(() => useMedicationRows([
    source,
    { ...source, id: 'open-prescription', dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } },
    { ...source, id: 'ended-reported-use', _sourceResourceType: 'MedicationStatement', dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } },
    { ...source, id: 'uncertain-status', status: 'unknown' },
  ]))
  expect(result.current.find(row => row.id === source.id)).toMatchObject({ isInactive: true, durationDays: undefined, stoppedOn: undefined })
  expect(result.current.find(row => row.id === 'open-prescription')?.isInactive).toBe(false)
  expect(result.current.find(row => row.id === 'ended-reported-use')?.isInactive).toBe(true)
  expect(result.current.find(row => row.id === 'uncertain-status')).toMatchObject({ isInactive: true, currentnessUncertain: true })
})

it('keeps a current cloud source visible when its hospital comparison has unknown status and no supply period', () => {
  const source: any = JSON.parse(JSON.stringify(fixture))
  const hospital = source.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource
  hospital.status = 'unknown'; delete hospital.dispenseRequest
  const collection = LocalBundleService.parse(source)!.collection
  const { result } = renderHook(() => {
    const rows = useMedicationRows(collection.medications)
    const overview = useOverviewMeds(collection.medications, buildOverviewWindow(12, Date.parse('2026-10-20T04:00:00+08:00')), 'medical', 'zh-TW')
    return { rows, overview }
  })
  const comparison = result.current.rows.find(row => row.sourceComparison)!
  expect(comparison).toMatchObject({ id: 'synthetic-cloud-order-a', isInactive: false, currentnessUncertain: false })
  expect(comparison.sourceComparison?.warnings).toContain('source-currentness-differs')
  expect(comparison.sourceComparison?.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'synthetic-order-a', status: 'unknown', isInactive: true }),
    expect.objectContaining({ id: 'synthetic-cloud-order-a', status: 'active', isInactive: false }),
  ]))
  expect(result.current.overview.meds.items.find(item => item.row.sourceComparison)?.isCurrent).toBe(true)
  render(<MedicationItem medication={comparison} />)
  expect(screen.getAllByText(/來源狀態或供藥期間不同/).length).toBeGreaterThan(0)
})

it('retains the comparison warning when only one source is in the current view', () => {
  const collection = LocalBundleService.parse(fixture)!.collection
  const hospital = collection.medications.find(order => order.id === 'synthetic-order-a')!
  const { result } = renderHook(() => useMedicationRows([hospital]))
  expect(result.current[0].sourceComparison).toMatchObject({ status: 'candidate', warnings: expect.arrayContaining(['source-partners-not-in-view']) })
})

it('labels cloud date-derived completion as an estimate rather than a source-reported completion', () => {
  const medication = { id: 'synthetic-expired-cloud', status: 'completed', authoredOn: '2025-01-01',
    meta: { source: 'https://medcloud2.nhi.gov.tw/', tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0008' }] },
    medicationCodeableConcept: { text: 'Synthetic product' }, dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } }
  const { result } = renderHook(() => useMedicationRows([medication]))
  expect(result.current[0]).toMatchObject({ statusEstimated: true, isInactive: true })
  render(<MedicationItem medication={result.current[0]} />)
  expect(screen.getByText('供藥估計到期')).toBeInTheDocument()
  expect(screen.queryByText('已完成')).not.toBeInTheDocument()
})

it('never promotes a cancelled hospital order into current use from a cloud supply-date estimate', () => {
  const input: any = JSON.parse(JSON.stringify(fixture))
  input.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource.status = 'cancelled'
  const cloud = input.entry.find((entry: any) => entry.resource.id === 'synthetic-cloud-order-a').resource
  cloud.meta.tag = [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0008' }]
  const collection = LocalBundleService.parse(input)!.collection
  const { result } = renderHook(() => useOverviewMeds(collection.medications, buildOverviewWindow(12, Date.parse('2026-10-20T04:00:00+08:00')), 'medical', 'zh-TW'))
  const row = result.current.medicationRows.find(row => row.id === 'synthetic-order-a')!
  expect(row.isInactive).toBe(true)
  expect(row.sourceComparison?.warnings).toContain('source-status-conflict')
  expect(result.current.meds.items.find(item => item.row.sourceComparison)?.isCurrent).toBe(false)
})

it.each(['2026-10-19T00:00:00+08:00', '2026-10-18T16:00:00Z'])('uses the same Taiwan clinical dates for equivalent source instant %s', authoredOn => {
  const medication = { id: 'synthetic-fractional-course', status: 'active', authoredOn, medicationCodeableConcept: { text: 'Synthetic product' }, dispenseRequest: { expectedSupplyDuration: { value: 2.4, code: 'd' } } }
  const { result } = renderHook(() => useMedicationRows([medication]))
  expect(result.current[0]).toMatchObject({ durationDays: 2.4, startedOnIso: '2026-10-19', endDateIso: '2026-10-21' })
})

it('keeps overview, visit detail and IPS consistent without presenting cancellation as current use', () => {
  const collection = LocalBundleService.parse(fixture)!.collection
  const { result } = renderHook(() => {
    const overview = useOverviewMeds(collection.medications, buildOverviewWindow(12, Date.parse('2026-10-20T04:00:00+08:00')), 'medical', 'zh-TW')
    const visits = useVisitHistory(collection.encounters)
    const details = useEncounterDetails(collection.medications, [], [], [], [], collection.conditions,
      'zh-TW', 'medical', overview.medicationRows, undefined, collection.encounters)
    return { overview, visits, details }
  })
  expect(result.current.overview.meds.items.filter(item => item.isCurrent)).toHaveLength(4)
  const cancelled = result.current.overview.meds.items.find(item => item.id === 'synthetic-cancelled')!
  expect(cancelled).toMatchObject({ isCurrent: false, daysRemaining: undefined })
  expect(result.current.visits).toHaveLength(1)
  expect(result.current.visits[0]).toMatchObject({ sourceComparisonStatus: 'candidate', sourceIds: [
    'synthetic-hospital-visit', 'synthetic-cloud-visit',
  ] })
  expect(result.current.visits[0].sourceRecords).toHaveLength(2)
  const detail = result.current.details.get(result.current.visits[0].id)!
  expect(detail.medications).toHaveLength(5)
  expect(detail.medications.filter(medication => medication.id.startsWith('synthetic-distinct-order'))).toHaveLength(2)
  const exported = mapMedications(collection.medications, 'Patient/synthetic-export').entries.map(entry => entry.resource)
  expect(exported).toHaveLength(6)
  expect(exported.filter(resource => JSON.stringify(resource.note).includes('Possible cross-source copies'))).toHaveLength(2)
  expect(exported.filter(resource => JSON.stringify(resource.note).includes('self-pay'))).toHaveLength(1)
  expect(exported.some(resource => JSON.stringify(resource.note).includes('status: cancelled'))).toBe(true)
})
