import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { getClinicalDataRepository } from '@/src/application/composition'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/composition')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'a' }, isLoading: false, isFetching: false }) }))

function setup(first: string) {
 jest.resetAllMocks()
 ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
 let release!: () => void
 const second = new Promise<void>(resolve => { release = resolve })
 ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => {
  const type = url.split('?')[0]
  if (['Condition', 'Encounter'].includes(type) && type !== first) await second
  return { entry: type === 'Condition' ? [{ resource: { resourceType: 'Condition', id: 'foreign-condition', subject: { reference: 'urn:uuid:patient-b' }, code: { text: 'Synthetic disease' } } }] : type === 'Encounter' ? [{ fullUrl: 'urn:uuid:patient-b', resource: { resourceType: 'Patient', id: 'b' } }] : [] }
 })
 return { repository: new FhirClinicalDataRepository(), release }
}
it.each(['Condition', 'Encounter'])('keeps actual fetchAll completeness aligned with final graph when %s settles first', async first => {
 const { repository, release } = setup(first)
 const pending = repository.fetchAllClinicalData('a')
 await waitFor(() => expect(repository.getQueryStatus(first as any)).toBeDefined())
 release()
 const collection = await pending
 expect(collection.conditions).toEqual([])
 expect(collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'foreign-condition')).toBe(true)
 expect(collection.resourceQueryStatus?.Condition).toMatchObject({ state: 'error', excludedCount: 1, count: 0, exclusionReason: 'foreign-patient-reference' })
 const overview: any = await createFhirTools(() => ({ patient: null, collection })).getDataOverview.execute!({}, { toolCallId: 'synthetic-overview', messages: [] })
 expect(overview.data.conditions).toMatchObject({ count: 0, incomplete: true, canConcludeAbsence: false })
})
it.each(['Condition', 'Encounter'])('keeps progressive hook completeness aligned with final graph when %s settles first', async first => {
 const { repository, release } = setup(first)
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
 await waitFor(() => expect(repository.getQueryStatus(first as any)).toBeDefined())
 release()
 await waitFor(() => expect(result.current.isLoading).toBe(false))
 expect(result.current.conditions).toEqual([])
 expect(result.current.resourceQueryStatus.Condition).toMatchObject({ state: 'error', excludedCount: 1, count: 0 })
 expect(result.current.hasBlockingQueryIssues).toBe(true)
 unmount(); client.clear()
})
