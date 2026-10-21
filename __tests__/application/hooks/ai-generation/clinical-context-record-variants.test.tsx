import { renderHook } from '@testing-library/react'
import { useClinicalContext } from '@/src/application/hooks/use-clinical-context.hook'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ensureCategoriesInitialized } from '@/src/core/categories/init'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { useClinicalAiInput } from '@/src/application/hooks/ai-generation/use-clinical-ai-input.hook'
import { clinicalContextTokenTarget } from '@/src/core/utils/adaptive-clinical-context.utils'
let mockData: any
const mockProfile = { selection: ALL_DATA_SELECTION, filters: ALL_DATA_FILTERS, documentMode: 'all', documentIds: [] }
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => mockData }))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: () => ({ patient: { id: 'synthetic', age: 70 } }) }))
jest.mock('@/src/application/providers/data-selection.provider', () => ({ useDataSelection: () => ({ getProfile: () => mockProfile }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'en' }) }))
jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-03') }))

it('keeps unresolved report and observation payloads out of actual registry-generated AI context', () => {
  ensureCategoriesInitialized()
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'Observation', id: 'private-weight', meta: { versionId: version }, code: { text: 'Weight' }, category: [{ coding: [{ code: 'vital-signs' }] }], effectiveDateTime: '2026-10-01', valueQuantity: { value: Number(version) * 70, unit: 'kg' } })
    resources.push({ resourceType: 'DiagnosticReport', id: 'private-report', meta: { versionId: version }, code: { text: 'Echocardiography' }, category: [{ coding: [{ code: 'RAD' }] }], effectiveDateTime: '2026-10-01', conclusion: 'Private variant narrative ' + version })
  }
  mockData = { ...LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection, isLoading: false, isFetching: false, error: null }
  const { result } = renderHook(() => useClinicalContext('insights'))
  const text = result.current.getFullClinicalContext()
  expect(text).toContain('These records exist but their versions or conflicts are unresolved')
  expect(text).not.toContain('private-weight')
  expect(text).not.toContain('private-report')
  expect(text).not.toContain('Private variant narrative')
  expect(text).not.toContain('70 kg')
  expect(mockData.observations).toHaveLength(2)
})
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))

it('uses the same selected uncertainty scope in the rendered AI context', () => {
  ensureCategoriesInitialized()
  mockProfile.filters = { ...ALL_DATA_FILTERS, labReportTimeRange: '3m' }
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }, { resourceType: 'Observation', id: 'recent', status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Sodium', coding: [{ system: 'http://loinc.org', code: '2951-2' }] }, effectiveDateTime: '2026-10-01', valueQuantity: { value: 140 } }]
  for (const version of ['1', '2']) resources.push({ resourceType: 'Observation', id: 'old', meta: { versionId: version }, status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Excluded historical measurement', coding: [{ system: 'http://loinc.org', code: '2823-3' }] }, effectiveDateTime: '2021-10-01', valueQuantity: { value: Number(version) } })
  mockData = { ...LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection, isLoading: false, isFetching: false, error: null }
  try {
    const { result } = renderHook(() => useClinicalContext('insights'))
    const text = result.current.getFullClinicalContext()
    expect(text).toContain('Unresolved source records outside the selected evidence')
    expect(text).not.toMatch(/Excluded historical measurement|2021-10-01|2823-3/)
  } finally { mockProfile.filters = ALL_DATA_FILTERS }
})

it('retains selected pending measurements after actual token prioritization without restoring out-of-scope details', () => {
  ensureCategoriesInitialized()
  mockProfile.filters = { ...ALL_DATA_FILTERS, labReportTimeRange: '3m' }
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (let index = 0; index < 300; index++) resources.push({ resourceType: 'Observation', id: `lab-${index}`, status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: `Synthetic laboratory measurement ${index}`, coding: [{ code: `synthetic-${index}` }] }, effectiveDateTime: '2026-10-01', valueQuantity: { value: index, unit: 'mg/dL' } })
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'Observation', id: 'pending-potassium', meta: { versionId: version }, status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Potassium', coding: [{ system: 'http://loinc.org', code: '2823-3' }] }, effectiveDateTime: '2026-10-02', valueQuantity: { value: version === '1' ? 4.2 : 6.1, unit: 'mmol/L' } })
    resources.push({ resourceType: 'Observation', id: 'historical-pending', meta: { versionId: version }, status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Excluded historical measurement', coding: [{ system: 'http://loinc.org', code: '14749-6' }] }, effectiveDateTime: '2021-10-01', valueQuantity: { value: Number(version) } })
  }
  mockData = { ...LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection, isLoading: false, isFetching: false, error: null }
  try {
    const { result } = renderHook(() => useClinicalAiInput(32_768, 'insights', 4_000 / clinicalContextTokenTarget(32_768)))
    expect(result.current.contextAdaptation?.tier).toBe('prioritized')
    const text = result.current.formattedClinicalContext
    expect(text).toContain('http://loinc.org|2823-3')
    expect(text).toContain('date=2026-10-02')
    expect(text).toContain('Unresolved source records outside the selected evidence')
    expect(text).not.toMatch(/Excluded historical measurement|2021-10-01|14749-6|pending-potassium/)
    expect(text).not.toMatch(/4\.2 mmol\/L|6\.1 mmol\/L/)
  } finally { mockProfile.filters = ALL_DATA_FILTERS }
})
