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
