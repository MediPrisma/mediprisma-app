import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { GenerateClinicalContextUseCase } from '@/src/core/use-cases/clinical-context/generate-clinical-context.use-case'

function input() {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }, { resourceType: 'Observation', id: 'recent', status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { coding: [{ system: 'http://loinc.org', code: '2951-2' }] }, effectiveDateTime: '2026-10-01', valueQuantity: { value: 140 } }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'Observation', id: 'old', meta: { versionId: version }, status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Excluded historical measurement', coding: [{ system: 'http://loinc.org', code: '2823-3' }] }, effectiveDateTime: '2021-10-01', valueQuantity: { value: Number(version) } })
    resources.push({ resourceType: 'Composition', id: 'document', meta: { versionId: version }, status: 'final', title: 'Synthetic document', date: '2026-10-01', section: [{ text: { status: 'generated', div: '<div>Document version ' + version + '</div>' } }] })
  }
  return LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
}

it('redacts out-of-window variant details and unselected documents while retaining domain uncertainty', () => {
  const result = scopeClinicalDataForAi(input(), ALL_DATA_SELECTION, { ...ALL_DATA_FILTERS, labReportTimeRange: '3m' }, [], Date.parse('2026-10-02'))
  expect(result.clinicalRecordVariantExclusions).toHaveLength(4)
  expect(result.clinicalRecordVariantExclusions?.every(item => !item.code && !item.effectiveDate && !item.versionId && !item.sourceId)).toBe(true)
  expect(JSON.stringify(result)).not.toMatch(/Excluded historical measurement|2021-10-01|2823-3|Document version/)
})

it('retains selected value-free uncertainty but removes disabled domains entirely', () => {
  const all = scopeClinicalDataForAi(input(), ALL_DATA_SELECTION, ALL_DATA_FILTERS, [], Date.parse('2026-10-02'))
  expect(all.clinicalRecordVariantExclusions?.some(item => item.code?.coding?.some(code => code.code === '2823-3'))).toBe(true)
  const off = scopeClinicalDataForAi(input(), { ...ALL_DATA_SELECTION, labReports: false, vitalSigns: false, observations: false, documents: false }, ALL_DATA_FILTERS, [], Date.parse('2026-10-02'))
  expect(off.clinicalRecordVariantExclusions ?? []).toEqual([])
})

it('applies the same uncertainty selection to the direct context use case', () => {
  const useCase = new GenerateClinicalContextUseCase()
  const text = JSON.stringify(useCase.execute(null, input(), { selection: ALL_DATA_SELECTION, filters: { ...ALL_DATA_FILTERS, labReportTimeRange: '3m' } }))
  expect(text).toContain('outside the selected evidence')
  expect(text).not.toMatch(/Excluded historical measurement|2021-10-01|2823-3/)
  const disabled = useCase.execute(null, input(), { selection: { ...ALL_DATA_SELECTION, labReports: false, vitalSigns: false, observations: false, documents: false }, filters: ALL_DATA_FILTERS })
  expect(disabled.some(section => section.title === 'Unresolved source-record variants')).toBe(false)
})
