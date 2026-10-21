import { fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import fixture from '@/e2e/fixtures/cross-source-prescriptions.json'
import copiesFixture from '@/e2e/fixtures/cross-source-prescription-copies.json'
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
import { useMedicationTimeline } from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-20T04:00:00+08:00') }))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }) }))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/shared/components/TapTooltip', () => ({ TapTooltip: ({ children, content }: any) => <>{children}<div>{content}</div></> }))

it('projects one hospital and two cloud copies as one comparison while preserving all source facts', () => {
  const original = JSON.stringify(copiesFixture)
  const collection = LocalBundleService.parse(copiesFixture)!.collection
  const { result } = renderHook(() => useMedicationRows(collection.medications))
  expect(collection.medications).toHaveLength(3)
  expect(result.current).toHaveLength(1)
  const row = result.current[0]
  expect(row).toMatchObject({ id: 'synthetic-order-a', dataOrigin: 'hospital', isInactive: true,
    totalQuantity: undefined, durationDays: 28, endDateIso: '2026-06-03' })
  expect(row.sourceComparison?.status).toBe('ambiguous')
  expect(row.sourceComparison?.records).toHaveLength(3)
  expect(row.reconciledOrderIds).toHaveLength(3)
  expect(JSON.stringify(copiesFixture)).toBe(original)
  const exported = mapMedications(collection.medications, 'Patient/synthetic-export').entries
  expect(exported).toHaveLength(3)
  const exportNotes = exported.map(entry => JSON.stringify(entry.resource.note))
  expect(exportNotes.filter(note => note.includes('Hospital record: MedicationRequest/synthetic-order-a'))).toHaveLength(1)
  expect(exportNotes.filter(note => note.includes('MediCloud record: MedicationRequest/synthetic-cloud-order-a'))).toHaveLength(2)
  expect(exportNotes.some(note => note.includes('MediCloud record: MedicationRequest/synthetic-cloud-order-a-copy'))).toBe(true)
  const exportedGroup = mapMedications(collection.medications, 'Patient/synthetic-export').referencedOnly
  expect(exportedGroup).toHaveLength(1)
  expect(exportedGroup[0].resource.activity).toMatchObject({ coding: [{ code: 'ambiguous' }] })
  const { container } = render(<MedicationItem medication={row} />)
  expect(container.querySelector('details')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '院內：查看來源紀錄' }))
  const details = within(screen.getByRole('dialog', { name: '來源紀錄' }))
  expect(details.queryByText(/核對|尚未確認|請勿/)).not.toBeInTheDocument()
  expect(details.getByText('雲端 1')).toBeInTheDocument()
  expect(details.getByText('雲端 2')).toBeInTheDocument()
  expect(details.getAllByText(/總量 28/)).toHaveLength(2)
})

it('uses the same one-group projection for the medication timeline', () => {
  const collection = LocalBundleService.parse(copiesFixture)!.collection
  const { result } = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW'))
  expect(result.current.drugs).toHaveLength(1)
  expect(result.current.drugs[0].bars).toHaveLength(1)
  expect(result.current.drugs[0].bars[0].sourceComparisonUnconfirmed).toBe(true)
})

it('uses the hospital interval when its cloud copies have a supply duration the hospital did not record', () => {
  const input: any = JSON.parse(JSON.stringify(copiesFixture))
  const hospital = input.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource
  delete hospital.dispenseRequest
  const collection = LocalBundleService.parse(input)!.collection
  const { result } = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW'))
  expect(result.current.drugs).toHaveLength(1)
  expect(result.current.drugs[0].bars).toHaveLength(1)
  expect(result.current.drugs[0].refillCount).toBe(1)
  const bar = result.current.drugs[0].bars[0]
  expect(bar.supplyDaysUnrecorded).toBe(true)
  expect(bar.supplyEndDay).toBeUndefined()
  expect(bar.sourceComparison).toContain('院內 1:')
  expect(bar.sourceComparison).toContain('未提供供藥期間')
})

it('collapses timed and date-only copies of the same whole-day supply interval', () => {
  const input: any = JSON.parse(JSON.stringify(copiesFixture))
  input.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource.authoredOn = '2026-05-07T09:00:00+08:00'
  const collection = LocalBundleService.parse(input)!.collection
  const { result } = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW'))
  expect(result.current.drugs).toHaveLength(1)
  expect(result.current.drugs[0].bars).toHaveLength(1)
  expect(result.current.drugs[0].refillCount).toBe(1)
})

it('does not create a cross-source comparison when the hospital source is absent', () => {
  const input: any = JSON.parse(JSON.stringify(copiesFixture))
  input.entry = input.entry.filter((entry: any) => entry.resource.id !== 'synthetic-order-a')
  const collection = LocalBundleService.parse(input)!.collection
  expect(collection.medications).toHaveLength(2)
  expect(collection.medications.every(med => !med._sourceRecordComparison)).toBe(true)
})

it('keeps the refill count for id-less records with distinct source dates', () => {
  const base = { status: 'completed', medicationCodeableConcept: { text: 'Synthetic product' },
    dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } }
  const { result } = renderHook(() => useMedicationTimeline([
    { ...base, authoredOn: '2026-05-07' }, { ...base, authoredOn: '2026-06-07' },
  ], 'medical', 'all', '其他', 'zh-TW'))
  expect(result.current.drugs[0].bars).toHaveLength(2)
  expect(result.current.drugs[0].refillCount).toBe(2)
})

it('uses one calendar supply basis when an invalid recorded end is ignored', () => {
  const input: any = JSON.parse(JSON.stringify(copiesFixture))
  const hospital = input.entry.find((entry: any) => entry.resource.id === 'synthetic-order-a').resource
  hospital.authoredOn = '2026-05-07T09:00:00+08:00'
  hospital.dispenseRequest.validityPeriod = { end: '20260603' }
  const collection = LocalBundleService.parse(input)!.collection
  const { result } = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW'))
  expect(result.current.drugs[0].bars).toHaveLength(1)
  expect(result.current.drugs[0].bars[0].supplyEndDay).toBe('2026-06-03')
  const rows = renderHook(() => useMedicationRows(collection.medications))
  expect(rows.result.current[0].endDateIso).toBe('2026-06-03')
  expect(rows.result.current[0].endDateSource).toBe('estimated')
})

it('keeps overview and list dates aligned for UTC midnight equivalents and fractional supply', () => {
  const medication = { id: 'fractional-utc', authoredOn: '2026-10-18T16:00:00Z', status: 'active',
    medicationCodeableConcept: { text: 'Synthetic product' }, dispenseRequest: { expectedSupplyDuration: { value: 2.4, code: 'd' } } }
  const { result } = renderHook(() => useOverviewMeds([medication], buildOverviewWindow(12, Date.parse('2026-10-20T04:00:00+08:00')), 'medical', 'zh-TW'))
  expect(result.current.medicationRows[0].startedOn).toBe('2026/10/19')
  expect(result.current.medicationRows[0].endDateIso).toBe('2026-10-21')
  expect(result.current.meds.items[0].supplyEndDay).toBe('2026-10-21')
})

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
  expect(screen.getByRole('button', { name: '院內：查看來源紀錄' })).toBeInTheDocument()
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

it('keeps hospital unknown status instead of promoting a cloud copy into the primary current medication', () => {
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
  expect(comparison).toMatchObject({ id: 'synthetic-order-a', dataOrigin: 'hospital', isInactive: true, currentnessUncertain: true })
  expect(comparison.sourceComparison?.warnings).toContain('source-currentness-differs')
  expect(comparison.sourceComparison?.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'synthetic-order-a', status: 'unknown', isInactive: true }),
    expect.objectContaining({ id: 'synthetic-cloud-order-a', status: 'active', isInactive: false }),
  ]))
  expect(result.current.overview.meds.items.find(item => item.row.sourceComparison)?.isCurrent).toBe(false)
  const timeline = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW'))
  expect(timeline.result.current.drugs.find(drug => drug.bars.some(bar => bar.refillId === 'synthetic-order-a'))?.bars[0]).toMatchObject({ sourceCurrent: false, supplyDaysUnrecorded: true })
  render(<MedicationItem medication={comparison} />)
  expect(screen.getByText('狀態未確認')).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '來源紀錄' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '院內：查看來源紀錄' }))
  expect(within(screen.getByRole('dialog', { name: '來源紀錄' })).queryByText(/核對|來源狀態或供藥期間不同/)).not.toBeInTheDocument()
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
  expect(exported.filter(resource => JSON.stringify(resource.note).includes('Hospital records determine'))).toHaveLength(2)
  expect(exported.filter(resource => JSON.stringify(resource.note).includes('self-pay'))).toHaveLength(1)
  expect(exported.some(resource => JSON.stringify(resource.note).includes('status: cancelled'))).toBe(true)
})

it('signals source fact conflicts in the existing row button without adding a disclosure row',()=>{
 const collection=LocalBundleService.parse(copiesFixture)!.collection
 const row=renderHook(()=>useMedicationRows(collection.medications)).result.current[0]
 row.sourceComparison={...row.sourceComparison!,warnings:['source-facts-differ']}
 const {container}=render(<MedicationItem medication={row}/>)
  expect(screen.getByRole('button',{name:'院內：查看來源紀錄'})).toBeInTheDocument()
  expect(screen.queryByText('差異',{exact:true})).not.toBeInTheDocument()
 expect(container.querySelector('details')).toBeNull()
})
