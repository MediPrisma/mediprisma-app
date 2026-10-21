import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { getClinicalDataRepository } from '@/src/application/composition'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'

jest.mock('@/src/application/composition')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'p' }, isLoading: false, isFetching: false }) }))
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({
  LocalBundleModeError: class LocalBundleModeError extends Error {},
  fhirClient: { getClient: jest.fn(), requestAllPages: jest.fn() },
}))
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}

it.each(['absolute', 'urn', 'version'].flatMap(style => ['report-first', 'observation-first'].map(order => [style, order])))('joins separate SMART queries using %s references with %s completion', async (style, order) => {
  jest.clearAllMocks()
  const reportResult = deferred()
  const observationResult = deferred()
  const client = { state: { serverUrl: 'https://one.invalid/fhir' } }
  jest.mocked(fhirClient.getClient).mockResolvedValue(client as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: string) => url.startsWith('DiagnosticReport?') ? reportResult.promise : url.startsWith('Observation?') ? observationResult.promise : { entry: [] })
  jest.mocked(getClinicalDataRepository).mockResolvedValue(new FhirClinicalDataRepository())
  const fullUrl = style === 'urn' ? 'urn:uuid:result' : 'https://one.invalid/fhir/Observation/result'
  const reference = style === 'version' ? fullUrl + '/_history/2' : fullUrl
  const report = { entry: [{ fullUrl: 'https://one.invalid/fhir/DiagnosticReport/report', resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Synthetic report' }, result: [{ reference }] } }] }
  const observation = { entry: [{ fullUrl, resource: { resourceType: 'Observation', id: 'result', meta: { versionId: '2' }, status: 'final', code: { text: 'Synthetic test' }, valueQuantity: { value: 7, unit: 'mg' } } }] }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
  try {
    if (order === 'report-first') {
      reportResult.resolve(report)
      await waitFor(() => expect(result.current.diagnosticReports).toHaveLength(1))
      expect(result.current.observations).toHaveLength(0)
      observationResult.resolve(observation)
    } else {
      observationResult.resolve(observation)
      await waitFor(() => expect(result.current.observations).toHaveLength(1))
      expect(result.current.diagnosticReports).toHaveLength(0)
      reportResult.resolve(report)
    }
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const members = result.current.diagnosticReports[0]._observations
    expect(members).toHaveLength(1)
    expect(members![0]).toBe(result.current.observations[0])
    expect(members![0].valueQuantity?.value).toBe(7)
  } finally { unmount(); queryClient.clear() }
})
