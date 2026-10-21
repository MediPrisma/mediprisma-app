import { clinicalResourceQueryKey, clinicalDataSourceQueryKey } from '@/src/application/hooks/clinical-data/clinical-data-fetch-plan'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useClinicalData, useClinicalDataQuery } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { getClinicalDataRepository } from '@/src/application/composition'

jest.mock('@/src/application/composition')

const mockUsePatientQuery = jest.fn()
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatientQuery: () => mockUsePatientQuery(),
}))

const mockGetClinicalDataRepository = jest.mocked(getClinicalDataRepository)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const VITAL = {
  id: 'vital-1',
  status: 'final',
  category: [{ coding: [{ code: 'vital-signs' }] }],
}
const LAB = {
  id: 'lab-1',
  status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }],
}

/** A SMART-shaped repository: every per-type fetcher, plus the status probe. */
function fakeSmartRepository(overrides: Record<string, unknown> = {}) {
  const empty = async () => []
  return {
    fetchAllClinicalData: jest.fn(async () => {
      throw new Error('fetchAllClinicalData must not run when every type has its own fetcher')
    }),
    fetchConditions: jest.fn(async () => [{ id: 'cond-1' }]),
    fetchMedications: jest.fn(async () => [{ id: 'med-1' }]),
    fetchMedicationRemainingSummaries: jest.fn(empty),
    fetchAllergies: jest.fn(empty),
    fetchObservations: jest.fn(async () => [VITAL, LAB]),
    fetchDiagnosticReports: jest.fn(empty),
    fetchImagingStudies: jest.fn(empty),
    fetchProcedures: jest.fn(empty),
    fetchEncounters: jest.fn(empty),
    fetchDocumentReferences: jest.fn(empty),
    fetchCompositions: jest.fn(empty),
    fetchImmunizations: jest.fn(empty),
    fetchConsents: jest.fn(empty),
    fetchDevices: jest.fn(empty),
    fetchCarePlans: jest.fn(empty),
    getQueryStatus: jest.fn((key: string) =>
      key === 'Condition'
        ? { resourceType: 'Condition', state: 'ok', count: 1 }
        : undefined,
    ),
    ...overrides,
  }
}

function renderClinicalData(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { ...renderHook(() => useClinicalData(), { wrapper }), queryClient }
}

describe('useClinicalData', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePatientQuery.mockReturnValue({
      data: { id: 'patient-1' },
      isLoading: false,
      isFetching: false,
    })
  })

  it('fills each resource type as its own query settles', async () => {
    const observations = deferred<unknown[]>()
    const repository = fakeSmartRepository({
      fetchObservations: jest.fn(() => observations.promise),
    })
    mockGetClinicalDataRepository.mockResolvedValue(repository as any)

    const { result } = renderClinicalData()

    await waitFor(() => expect(result.current.resourceReady.conditions).toBe(true))

    // Conditions rendered while Observation is still paginating…
    expect(result.current.conditions).toEqual([{ id: 'cond-1' }])
    expect(result.current.resourceReady.observations).toBe(false)
    expect(result.current.resourceReady.vitalSigns).toBe(false)
    // …but the AI-facing flags stay all-or-nothing until everything settles.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isFetching).toBe(true)

    observations.resolve([VITAL, LAB])

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.observations).toEqual([VITAL, LAB])
    expect(result.current.resourceReady.vitalSigns).toBe(true)
    // Vitals are the vital-signs subset of the Observation result, not a
    // second search.
    expect(result.current.vitalSigns).toEqual([VITAL])
    expect(result.current.resourceQueryStatus.Condition).toMatchObject({ state: 'ok' })
  })

  it('resolves the data source once for all resource types', async () => {
    mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository() as any)

    const { result } = renderClinicalData()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockGetClinicalDataRepository).toHaveBeenCalledTimes(1)
  })

  it('keeps the same bundle snapshot after an idle-day remount', async () => {
    const dateNow = jest.spyOn(Date, 'now')
    dateNow.mockReturnValue(new Date('2026-08-19T09:00:00+08:00').getTime())
    mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository() as any)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const first = renderClinicalData(queryClient)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    first.unmount()

    dateNow.mockReturnValue(new Date('2026-08-20T09:00:00+08:00').getTime())
    const second = renderClinicalData(queryClient)
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    expect(mockGetClinicalDataRepository).toHaveBeenCalledTimes(1)
    expect(second.result.current.conditions).toEqual([{ id: 'cond-1' }])
    second.unmount()
    dateNow.mockRestore()
  })

  // Local bundles parse the whole chart in one pass and only implement the core
  // nine fetchers; that single collection must be sliced, never re-parsed once
  // per resource type.
  it('fans one collection out to every type when the source cannot serve them all', async () => {
    const collection = {
      conditions: [{ id: 'cond-1' }],
      medications: [], medicationRemainingSummaries: [], allergies: [], observations: [VITAL, LAB],
      vitalSigns: [VITAL], diagnosticReports: [], imagingStudies: [], procedures: [],
      encounters: [], documentReferences: [{ id: 'doc-1' }], compositions: [],
      immunizations: [], consents: [], devices: [], carePlans: [],
      sourceMetadata: { source: 'health-bank-sdk-json' },
    }
    const fetchAllClinicalData = jest.fn(async () => collection)
    mockGetClinicalDataRepository.mockResolvedValue({
      fetchAllClinicalData,
      fetchConditions: jest.fn(async () => collection.conditions),
    } as any)

    const { result } = renderClinicalData()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(fetchAllClinicalData).toHaveBeenCalledTimes(1)
    expect(result.current.documentReferences).toEqual([{ id: 'doc-1' }])
    expect(result.current.vitalSigns).toEqual([VITAL])
    expect(result.current.sourceMetadata).toEqual({ source: 'health-bank-sdk-json' })
  })

  // The FHIR issues banner's retry has to re-resolve the data source, not
  // replay the repository the failed load was built on.
  it('re-resolves the source and every type on refetch', async () => {
    mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository() as any)

    const { result } = renderClinicalData()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const repository = fakeSmartRepository({
      fetchConditions: jest.fn(async () => [{ id: 'cond-2' }]),
    })
    mockGetClinicalDataRepository.mockResolvedValue(repository as any)

    await result.current.refetch()

    await waitFor(() => expect(result.current.conditions).toEqual([{ id: 'cond-2' }]))
    expect(mockGetClinicalDataRepository).toHaveBeenCalledTimes(2)
  })

  it('reports nothing as ready while the patient query is still loading', () => {
    mockUsePatientQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
    })
    mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository() as any)

    const { result } = renderClinicalData()

    expect(result.current.resourceReady.conditions).toBe(false)
    expect(result.current.resourceReady.vitalSigns).toBe(false)
    expect(result.current.isLoading).toBe(true)
  })

  it('keeps the returned snapshot stable across unrelated parent renders', async () => {
    mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository() as any)

    const { result, rerender } = renderClinicalData()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const settled = result.current

    rerender()

    expect(result.current).toBe(settled)
    expect(result.current.observations).toBe(settled.observations)
  })
})

 it('shares the same reconciliation result and row arrays across UI and whole-collection AI/CDSS reads', async () => {
  const { reconcileClinicalSources } = await import('@/src/core/services/clinical-reconciliation')
  const clinicalSource = reconcileClinicalSources([])
  const repository = fakeSmartRepository({ getClinicalSource: () => clinicalSource })
  mockGetClinicalDataRepository.mockResolvedValue(repository as any)
  mockUsePatientQuery.mockReturnValue({ data: { id: 'patient-1' }, isLoading: false, isFetching: false })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result } = renderHook(() => ({ ui: useClinicalData(), ai: useClinicalDataQuery() }), { wrapper })
  await waitFor(() => expect(result.current.ai.data).toBeDefined())
  expect(result.current.ui.clinicalSource).toBe(clinicalSource)
  expect(result.current.ai.data!.clinicalSource).toBe(result.current.ui.clinicalSource)
  expect(result.current.ai.data!.observations).toBe(result.current.ui.observations)
  expect(result.current.ai.data!.medications).toBe(result.current.ui.medications)
 })

it('isolates the same patient id across import generations in source and resource caches', () => {
  const old = sessionStorage.getItem('fhir_bundle_override')
  try {
    sessionStorage.setItem('fhir_bundle_override', 'import:synthetic-one')
    const firstSource = clinicalDataSourceQueryKey('same-patient')
    const firstRows = clinicalResourceQueryKey('same-patient', 'observations')
    sessionStorage.setItem('fhir_bundle_override', 'import:synthetic-two')
    expect(clinicalDataSourceQueryKey('same-patient')).not.toEqual(firstSource)
    expect(clinicalResourceQueryKey('same-patient', 'observations')).not.toEqual(firstRows)
  } finally {
    if (old === null) sessionStorage.removeItem('fhir_bundle_override')
    else sessionStorage.setItem('fhir_bundle_override', old)
  }
})

it('refreshes the shared source generation after a same-id patient refresh without refetching clinical rows', async () => {
  let currentSource = { policyVersion: 'generation-one' }
  const repository = fakeSmartRepository({ getClinicalSource: () => currentSource })
  mockGetClinicalDataRepository.mockResolvedValue(repository as any)
  mockUsePatientQuery.mockReturnValue({ data: { id: 'patient-1' }, isLoading: false, isFetching: false })
  const { result, rerender } = renderClinicalData()
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  const originalRows = result.current.observations
  expect(result.current.clinicalSource).toBe(currentSource)
  currentSource = { policyVersion: 'generation-two' }
  mockUsePatientQuery.mockReturnValue({ data: { id: 'patient-1', name: 'refreshed synthetic patient' }, isLoading: false, isFetching: false })
  rerender()
  expect(result.current.clinicalSource).toBe(currentSource)
  expect(result.current.observations).toBe(originalRows)
  expect(repository.fetchObservations).toHaveBeenCalledTimes(1)
})

describe('content-only completeness is not a transport failure',()=>{
 it('allows the chart consumers to use available facts while retaining missing drug content for safety',async()=>{
  mockUsePatientQuery.mockReturnValue({data:{id:'patient-1'},isLoading:false,isFetching:false})
  mockGetClinicalDataRepository.mockResolvedValue(fakeSmartRepository({
   fetchMedications:jest.fn(async()=>[{id:'missing-drug',clinicalMedicationContentUncertainty:{reason:'unresolved-reference'}}]),
   getQueryStatus:jest.fn((key:string)=>key==='MedicationRequest'?{resourceType:key,state:'incomplete',medicationContentOnlyIncomplete:true,medicationContentUncertaintyCount:1}:key==='ImagingStudy'?{resourceType:key,state:'unsupported'}:undefined),
  }) as any)
  const{result,unmount,queryClient}=renderClinicalData()
  try{
   await waitFor(()=>expect(result.current.isLoading).toBe(false))
   expect(result.current.resourceQueryStatus.MedicationRequest?.state).toBe('incomplete')
   expect(result.current.medications[0].clinicalMedicationContentUncertainty).toBeDefined()
   expect(result.current.queryIssues.map(([key])=>key)).not.toContain('MedicationRequest')
   expect(result.current.queryIssues.map(([key])=>key)).toContain('ImagingStudy')
   expect(result.current.hasBlockingQueryIssues).toBe(false)
  }finally{unmount();queryClient.clear()}
 })
})
