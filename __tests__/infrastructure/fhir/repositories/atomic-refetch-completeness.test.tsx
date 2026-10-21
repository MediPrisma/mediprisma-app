import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { getClinicalDataRepository } from '@/src/application/composition'
import { useClinicalData, useClinicalDataQuery } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { clinicalResourceQueryKey } from '@/src/application/hooks/clinical-data/clinical-data-fetch-plan'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/composition')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'a' }, isLoading: false, isFetching: false }) }))

it.each(['medications', 'procedures'] as const)('retains the complete %s snapshot while subqueries refresh, then switches atomically', async unit => {
 jest.resetAllMocks()
 ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
 let refresh = false
 let release!: () => void
 const pendingSubquery = new Promise<void>(resolve => { release = resolve })
 ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => {
  const type = url.split('?')[0]
  if (refresh && ((unit === 'medications' && type === 'MedicationStatement') || (unit === 'procedures' && type === 'Basic' && url.includes('special-material-record')))) await pendingSubquery
  return { entry: type === 'MedicationRequest' ? [{ resource: { resourceType: type, id: 'request', status: 'active', intent: 'order', medicationCodeableConcept: { text: refresh ? 'Refreshed medicine' : 'Initial medicine' } } }] : type === 'Procedure' ? [{ resource: { resourceType: type, id: 'procedure', status: 'completed', code: { text: refresh ? 'Refreshed procedure' : 'Initial procedure' } } }] : [] }
 })
 const repository = new FhirClinicalDataRepository()
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => ({ ui: useClinicalData(), whole: useClinicalDataQuery() }), { wrapper })
 await waitFor(() => expect(result.current.whole.data).toBeDefined())
 expect(result.current.ui[unit]).toHaveLength(1)
 const settledSource = result.current.whole.data!.clinicalSource
 refresh = true
 let refetch!: Promise<void>
 act(() => { refetch = client.refetchQueries({ queryKey: clinicalResourceQueryKey('a', unit), exact: true }) })
 const type = unit === 'medications' ? 'MedicationRequest' : 'Procedure'
 await waitFor(() => expect(repository.getClinicalSource('a').graph.nodes.some(node => node.resource.resourceType === type && JSON.stringify(node.resource).includes('Refreshed'))).toBe(true))
 // A different completed query forces projection against the newer live graph.
 await act(async () => { await client.refetchQueries({ queryKey: clinicalResourceQueryKey('a', 'conditions'), exact: true }) })
 expect(result.current.ui.isLoading).toBe(false)
 expect(result.current.ui.isFetching).toBe(true)
 expect(result.current.ui.resourceReady[unit]).toBe(true)
 expect(result.current.ui.resourceQueryStatus[type]).toMatchObject({ state: 'ok', count: 1 })
 expect(result.current.ui.queryIssues).toEqual([])
 expect(result.current.ui.hasBlockingQueryIssues).toBe(false)
 expect(result.current.whole.data?.clinicalSource).toBe(settledSource)
 expect(JSON.stringify(result.current.whole.data?.[unit])).toContain('Initial')
 expect(JSON.stringify(result.current.whole.data?.[unit])).not.toContain('Refreshed')
 await act(async () => { release(); await refetch })
 await waitFor(() => expect(result.current.ui.isFetching).toBe(false))
 expect(result.current.ui.resourceReady[unit]).toBe(true)
 expect(result.current.ui.resourceQueryStatus[type]).toMatchObject({ state: 'ok', count: 1 })
 expect(JSON.stringify(result.current.ui[unit])).toContain('Refreshed')
 expect(result.current.ui.isFetching).toBe(false)
 unmount(); client.clear()
})

it('retains the settled ownership error until a complete replacement clears it', async () => {
 jest.resetAllMocks()
 ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
 let refresh = false
 let release!: () => void
 const pending = new Promise<void>(resolve => { release = resolve })
 ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => {
   if (!url.startsWith('Condition?')) return { entry: [] }
   if (refresh) { await pending; return { entry: [] } }
   return { entry: [{ resource: { resourceType: 'Condition', id: 'foreign', subject: { reference: 'Patient/b' }, code: { text: 'Foreign condition' } } }] }
 })
 const repository = new FhirClinicalDataRepository()
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
 await waitFor(() => expect(result.current.resourceQueryStatus.Condition?.excludedCount).toBe(1))
 refresh = true
 let refetch!: Promise<void>
 act(() => { refetch = client.refetchQueries({ queryKey: clinicalResourceQueryKey('a', 'conditions'), exact: true }) })
 await waitFor(() => expect(result.current.isFetching).toBe(true))
 expect(result.current.resourceQueryStatus.Condition).toMatchObject({ state: 'error', excludedCount: 1, exclusionReason: 'foreign-patient-reference' })
 expect(result.current.resourceQueryStatus.Condition?.httpStatus).toBeUndefined()
 expect(result.current.hasBlockingQueryIssues).toBe(true)
 await act(async () => { release(); await refetch })
 await waitFor(() => expect(result.current.resourceQueryStatus.Condition?.state).toBe('empty'))
 expect(result.current.resourceQueryStatus.Condition?.excludedCount).toBeUndefined()
 expect(result.current.hasBlockingQueryIssues).toBe(false)
 unmount(); client.clear()
})
