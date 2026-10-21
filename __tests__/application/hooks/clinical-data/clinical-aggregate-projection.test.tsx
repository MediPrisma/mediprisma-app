import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useClinicalData, useClinicalDataQuery } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { getClinicalDataRepository } from '@/src/application/composition'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'

jest.mock('@/src/application/composition')
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'synthetic' }, isLoading: false, isFetching: false }) }))
function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
const observation = (version: string, value: number) => ({ resourceType: 'Observation', id: 'same', meta: { versionId: version }, status: 'final', code: { text: 'Synthetic lab' }, category: [{ coding: [{ code: 'laboratory' }] }], valueQuantity: { value }, effectiveDateTime: '2026-07-02' })

it.each(['composition-first', 'observation-first'])('shares every active Observation and cross-query reference in %s progressive settlement', async order => {
  jest.resetAllMocks()
  const observations = deferred()
  const reports = deferred()
  const compositions = deferred()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://progressive.example/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => url.startsWith('Observation?') ? observations.promise : url.startsWith('DiagnosticReport?') ? reports.promise : url.startsWith('Composition?') ? compositions.promise : { entry: [] })
  jest.mocked(getClinicalDataRepository).mockResolvedValue(new FhirClinicalDataRepository() as any)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => ({ progressive: useClinicalData(), complete: useClinicalDataQuery() }), { wrapper })
  await act(async () => reports.resolve({ entry: [
    { resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Synthetic report' }, category: [{ coding: [{ code: 'LAB' }] }], result: [{ reference: 'Observation/same/_history/1' }] } },
    { resource: observation('1', 7) },
  ] }))
  await waitFor(() => expect(result.current.progressive.observations.map(row => row.valueQuantity?.value)).toEqual([7]))
  const resolveComposition = () => compositions.resolve({ entry: [{ resource: { resourceType: 'Composition', id: 'composition', status: 'final', type: { text: 'Synthetic' }, section: [{ entry: [{ reference: 'Observation/same/_history/2' }, { reference: 'DiagnosticReport/report' }, { reference: 'https://foreign.example/fhir/Observation/same' }] }] } }] })
  const resolveObservations = () => observations.resolve({ entry: [{ resource: observation('2', 9) }] })
  if (order === 'composition-first') { await act(async () => resolveComposition()); await act(async () => resolveObservations()) }
  else { await act(async () => resolveObservations()); await act(async () => resolveComposition()) }
  await waitFor(() => expect(result.current.complete.data).toBeDefined())
  const collection = result.current.complete.data!
  expect(collection.observations.map(row => row.valueQuantity?.value).sort()).toEqual([7, 9])
  expect(collection.diagnosticReports[0]._observations![0]).toBe(collection.observations.find(row => row.valueQuantity?.value === 7))
  expect(collection.compositions[0].section?.[0].entry?.map(entry => entry.reference)).toEqual([
    'Observation/' + collection.observations.find(row => row.valueQuantity?.value === 9)!.id,
    'DiagnosticReport/' + collection.diagnosticReports[0].id,
    'https://foreign.example/fhir/Observation/same',
  ])
  expect(result.current.progressive.observations).toBe(collection.observations)
  unmount()
  queryClient.clear()
})

it('refetches every type and withholds complete data on a same-patient authenticated-source switch and logout', async () => {
  jest.resetAllMocks()
  const { CLINICAL_RESOURCE_UNITS } = await import('@/src/application/hooks/clinical-data/clinical-data-fetch-plan')
  const { reconcileClinicalSources } = await import('@/src/core/services/clinical-reconciliation')
  const { clinicalSourceSession, purgeClinicalSourceSession } = await import('@/src/infrastructure/fhir/services/clinical-source-session')
  const owner = {}
  clinicalSourceSession({}, 'https://old.example/fhir', owner)
  let source = reconcileClinicalSources([{ sourceId: 'old-client', patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'Condition', id: 'old' }] }])
  const oldKey = source.graph.nodes[0].key
  const repository: any = { getClinicalSource: () => source }
  let pending: ReturnType<typeof deferred> | undefined
  for (const unit of CLINICAL_RESOURCE_UNITS) repository[unit.method] = jest.fn(async () => pending ? pending.promise : [{ id: 'old', clinicalSourceNodeKey: oldKey }])
  jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => ({ progressive: useClinicalData(), complete: useClinicalDataQuery() }), { wrapper })
  await waitFor(() => expect(result.current.complete.data).toBeDefined())
  expect(result.current.complete.data!.conditions).toHaveLength(1)
  source = reconcileClinicalSources([{ sourceId: 'new-client', patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'Patient', id: 'synthetic' }] }])
  pending = deferred()
  act(() => { clinicalSourceSession({}, 'https://new.example/fhir', owner) })
  await waitFor(() => expect(result.current.progressive.isLoading).toBe(true))
  expect(result.current.complete.data).toBeUndefined()
  expect(result.current.progressive.conditions).toEqual([])
  await act(async () => pending!.resolve([]))
  await waitFor(() => {
    expect(result.current.complete.data).toBeDefined()
    for (const unit of CLINICAL_RESOURCE_UNITS) {
      expect(result.current.complete.data![unit.id]).toEqual([])
      expect(result.current.progressive[unit.id]).toEqual([])
      expect(repository[unit.method]).toHaveBeenCalledTimes(2)
    }
  })
  source = reconcileClinicalSources([])
  pending = deferred()
  act(() => purgeClinicalSourceSession(owner))
  await waitFor(() => expect(result.current.progressive.isLoading).toBe(true))
  expect(result.current.complete.data).toBeUndefined()
  expect(result.current.progressive.conditions).toEqual([])
  unmount()
  queryClient.clear()
})

it('subscribes all consumers to a same-source Patient capture without manual rerender', async () => {
  jest.resetAllMocks()
  const { CLINICAL_RESOURCE_UNITS } = await import('@/src/application/hooks/clinical-data/clinical-data-fetch-plan')
  const { clinicalSourceSession, captureClinicalSource, readClinicalSource, invalidateClinicalSource } = await import('@/src/infrastructure/fhir/services/clinical-source-session')
  const session = clinicalSourceSession({}, 'https://ehr.test/fhir')
  captureClinicalSource(session, 'Observation', 'synthetic', [observation('1', 7)])
  const repository: any = { getClinicalSource: () => readClinicalSource(session, 'synthetic') }
  for (const unit of CLINICAL_RESOURCE_UNITS) repository[unit.method] = jest.fn(async () => [])
  jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => ({ ui: useClinicalData(), ai: useClinicalDataQuery(), cdss: useClinicalData() }), { wrapper })
  await waitFor(() => expect(result.current.ai.data).toBeDefined())
  act(() => { captureClinicalSource(session, 'Patient', 'synthetic', [{ resourceType: 'Patient', id: 'synthetic' }]) })
  await waitFor(() => expect(result.current.ai.data!.clinicalSource!.graph.nodes.some(node => node.resource.resourceType === 'Patient')).toBe(true))
  expect(result.current.ui.observations).toBe(result.current.ai.data!.observations)
  expect(result.current.cdss.observations).toBe(result.current.ui.observations)
  expect(result.current.cdss.observations[0]).toBe(result.current.ai.data!.observations[0])
  expect(result.current.ui.observations[0].valueQuantity?.value).toBe(7)
  act(() => { invalidateClinicalSource(session, 'Patient', 'synthetic') })
  await waitFor(() => expect(result.current.ai.data!.clinicalSource!.graph.nodes.some(node => node.resource.resourceType === 'Patient')).toBe(false))
  expect(result.current.ui.observations).toBe(result.current.ai.data!.observations)
  expect(result.current.cdss.observations).toBe(result.current.ui.observations)
  for (const unit of CLINICAL_RESOURCE_UNITS) expect(repository[unit.method]).toHaveBeenCalledTimes(1)
  unmount()
  queryClient.clear()
})
