import { renderHook } from '@testing-library/react'
import { useClinicalContext } from '@/src/application/hooks/use-clinical-context.hook'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ensureCategoriesInitialized } from '@/src/core/categories/init'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
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
