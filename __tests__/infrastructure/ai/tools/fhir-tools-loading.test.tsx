import { renderHook } from '@testing-library/react'
import { useFhirTools } from '@/src/application/hooks/ai/use-fhir-tools.hook'

const mockUsePatientQuery = jest.fn()
const mockUseClinicalDataQuery = jest.fn()

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatientQuery: () => mockUsePatientQuery(),
}))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalDataQuery: () => mockUseClinicalDataQuery(),
}))

it('keeps direct domain queries incomplete while the whole-collection hook has no settled data', async () => {
  mockUsePatientQuery.mockReturnValue({ data: { id: 'synthetic' } })
  mockUseClinicalDataQuery.mockReturnValue({ data: {
    conditions: [], medications: [], medicationRemainingSummaries: [], allergies: [],
    observations: [], vitalSigns: [], diagnosticReports: [], imagingStudies: [], procedures: [],
    encounters: [], documentReferences: [], compositions: [], immunizations: [], consents: [],
    devices: [], carePlans: [],
  }, isFetching: false })

  const { result, rerender } = renderHook(() => useFhirTools())
  expect(await (result.current.queryConditions as any).execute({})).toMatchObject({ success: true, count: 0 })

  // useClinicalDataQuery keeps data undefined until every per-resource query
  // settles, including while an active refetch temporarily removes its data.
  mockUseClinicalDataQuery.mockReturnValue({ data: undefined, isFetching: true })
  rerender()
  const refetching = await (result.current.queryAllergies as any).execute({})
  expect(refetching).toMatchObject({ success: false, count: 0, incomplete: true, canConcludeAbsence: false })
  expect(refetching.queryIssues).toMatchObject([{ state: 'not-loaded' }])
})
