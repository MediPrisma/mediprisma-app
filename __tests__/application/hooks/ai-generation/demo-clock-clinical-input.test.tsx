import { renderHook } from '@testing-library/react'
import { useClinicalAiInput } from '@/src/application/hooks/ai-generation/use-clinical-ai-input.hook'
import { ensureCategoriesInitialized } from '@/src/core/categories/init'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import {
  MEDCLOUD_DEMO_DATA_AS_OF_MS,
  MEDCLOUD_DEMO_PATIENT_ID,
} from '@/src/shared/constants/demo-data.constants'

// The 雲端病歷 demo is judged against its own as-of date (2026-10-26). A
// 28-day prescription from 2026-10-20 is in use then and long finished by the
// real clock below; the text sent to the AI must follow the as-of date, as the
// source catalog does.
let mockNowMs = MEDCLOUD_DEMO_DATA_AS_OF_MS
const mockPatient = { id: MEDCLOUD_DEMO_PATIENT_ID, gender: 'male', birthDate: '1932-01-15' }
const mockProfile = {
  selection: { ...ALL_DATA_SELECTION },
  filters: { ...ALL_DATA_FILTERS },
  documentMode: 'all' as const,
  documentIds: [],
}
const mockData = {
  isLoading: false,
  isFetching: false,
  error: null,
  hasBlockingQueryIssues: false,
  conditions: [],
  medications: [{
    id: 'recent-rx',
    status: 'active',
    authoredOn: '2026-10-20',
    medicationCodeableConcept: { text: 'Synthetic medicine 5 mg' },
    dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
  }],
  medicationRemainingSummaries: [],
  allergies: [],
  observations: [],
  vitalSigns: [],
  diagnosticReports: [],
  imagingStudies: [],
  procedures: [],
  encounters: [{ id: 'visit', status: 'finished', class: { code: 'AMB' }, period: { start: '2026-10-20' } }],
  documentReferences: [],
  compositions: [],
  immunizations: [],
  consents: [],
  devices: [],
  carePlans: [],
}

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: () => ({ patient: mockPatient }) }))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => mockData }))
jest.mock('@/src/application/providers/data-selection.provider', () => ({ useDataSelection: () => ({ getProfile: () => mockProfile }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'en' }) }))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/hooks/ai-generation/ai-data-source', () => ({
  ...jest.requireActual('@/src/application/hooks/ai-generation/ai-data-source'),
  isDemoDataActive: () => true,
}))
jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => mockNowMs }))

describe('demo clinical AI input clock', () => {
  beforeAll(() => ensureCategoriesInitialized())

  it('builds the same AI text months later as on the demo as-of date', () => {
    mockNowMs = MEDCLOUD_DEMO_DATA_AS_OF_MS
    const onAsOf = renderHook(() => useClinicalAiInput(128_000, 'insights', 0.62)).result.current
    mockNowMs = Date.parse('2027-03-01T12:00:00+08:00')
    const later = renderHook(() => useClinicalAiInput(128_000, 'insights', 0.62)).result.current

    expect(onAsOf.dataReady).toBe(true)
    expect(onAsOf.clinicalContext).toContain('Synthetic medicine 5 mg')
    expect(later.clinicalContext).toBe(onAsOf.clinicalContext)
    const keys = (catalog: typeof later.catalog) => catalog.map(({ key, resourceId }) => `${key}:${resourceId}`)
    expect(keys(later.catalog)).toEqual(keys(onAsOf.catalog))
  })
})
