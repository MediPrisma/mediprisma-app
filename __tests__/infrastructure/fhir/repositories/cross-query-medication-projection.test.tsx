import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { getClinicalDataRepository } from '@/src/application/composition'
import { projectClinicalMedicationContents, projectClinicalMedicationQueryStatus } from '@/src/infrastructure/fhir/mappers/clinical-medication-projection'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
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
  if (['MedicationRequest', 'MedicationStatement'].includes(type) && type !== first) await second
  return { entry: type === 'MedicationRequest' ? [{ resource: { resourceType: type, id: 'request', status: 'active', intent: 'order', medicationReference: { reference: 'Medication/drug' } } }] : type === 'MedicationStatement' ? [ { resource: { resourceType: type, id: 'statement', status: 'active', medicationCodeableConcept: { text: 'Other confirmed medication' } } }, { resource: { resourceType: 'Medication', id: 'drug', code: { text: 'Synthetic apixaban', coding: [{ system: 'http://www.whocc.no/atc', code: 'B01AF02' }] } } } ] : [] }
 })
 return { repository: new FhirClinicalDataRepository(), release }
}
it.each(['MedicationRequest', 'MedicationStatement'])('projects cross-query Medication code in fetchAll when %s settles first', async first => {
 const { repository, release } = setup(first)
 const pending = repository.fetchAllClinicalData('a')
 await waitFor(() => expect(fhirClient.requestAllPages).toHaveBeenCalledWith(expect.stringMatching(first + '?')))
 // The first response can finish mapping before the other query provides support.
 await new Promise(resolve => setTimeout(resolve, 0))
 release()
 const data = await pending
 const request = data.medications.find(row => row.sourceId === 'request')!
 expect(request.medicationCodeableConcept?.text).toBe('Synthetic apixaban')
 expect(data.clinicalSource!.graph.nodes.find(node => node.resource.id === 'request')!.resource.medicationCodeableConcept).toBeUndefined()
 request.medicationCodeableConcept!.coding![0].code = 'mutable-domain'
 expect((data.clinicalSource!.graph.nodes.find(node => node.resource.id === 'drug')!.resource.code as any).coding[0].code).toBe('B01AF02')
})
it.each(['MedicationRequest', 'MedicationStatement'])('projects cross-query Medication code in progressive hook when %s settles first', async first => {
 const { repository, release } = setup(first)
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repository)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
 await waitFor(() => expect(fhirClient.requestAllPages).toHaveBeenCalledWith(expect.stringMatching(first + '?')))
 await new Promise(resolve => setTimeout(resolve, 0))
 release()
 await waitFor(() => expect(result.current.isLoading).toBe(false))
 expect(result.current.medications.find(row => row.sourceId === 'request')?.medicationCodeableConcept?.text).toBe('Synthetic apixaban')
 unmount(); client.clear()
})
it.each(['https://foreign.example/fhir/Medication/drug', 'Medication/drug/_history/99'])('does not promote unresolved reference %s or retain a stale promoted code', reference => {
 const source = reconcileClinicalSources([{ sourceId: 'source', patientScope: 'a', generation: '1', restBase: 'https://synthetic.example/fhir', resources: [{ resourceType: 'MedicationRequest', id: 'request', medicationReference: { reference } }, { resourceType: 'Medication', id: 'drug', meta: { versionId: '1' }, code: { text: 'Wrong drug' } }] }])
 const key = source.graph.nodes.find(node => node.resource.id === 'request')!.key
 const rows: any[] = [{ id: 'request', clinicalSourceNodeKey: key, clinicalMedicationCodeProvenance: 'graph-reference', medicationCodeableConcept: { text: 'Stale promoted drug' } }]
 expect(projectClinicalMedicationContents(rows, source)[0].medicationCodeableConcept).toBeUndefined()
})

it('keeps explicit inline code and does not choose an ambiguous Medication revision', () => {
 const source = reconcileClinicalSources([{ sourceId: 'source', patientScope: 'a', generation: '1', resources: [
  { resourceType: 'MedicationRequest', id: 'inline', medicationReference: { reference: 'Medication/drug' }, medicationCodeableConcept: { text: 'Explicit inline drug' } },
  { resourceType: 'MedicationRequest', id: 'reference', medicationReference: { reference: 'Medication/drug' } },
  ...['1', '2'].map(versionId => ({ resourceType: 'Medication', id: 'drug', meta: { versionId }, code: { text: 'Drug version ' + versionId } })),
 ] }])
 const row = (id: string): any => ({ id, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === id)!.key })
 const inline = { ...row('inline'), medicationCodeableConcept: { text: 'Explicit inline drug' } }
 const rows = [inline, row('reference')]
 const projected = projectClinicalMedicationContents(rows, source)
 expect(projected[0].medicationCodeableConcept).toEqual(inline.medicationCodeableConcept)
 expect(projected[1].clinicalMedicationContentUncertainty).toBeUndefined()
 expect(['Drug version 1','Drug version 2']).toContain(projected[1].medicationCodeableConcept?.text)
 expect(projectClinicalMedicationContents(projected, source)).toBe(projected)
 expect(rows[1].medicationCodeableConcept).toBeUndefined()
})

it('clears content-only incompleteness after resolution while preserving independent query failures', () => {
 const rows: any[] = [{ id: 'request', _sourceResourceType: 'MedicationRequest', clinicalMedicationContentUncertainty: { reason: 'ambiguous-reference' } }]
 const pending = projectClinicalMedicationQueryStatus(rows, { MedicationRequest: { resourceType: 'MedicationRequest', state: 'ok', count: 1 } })
 expect(pending.MedicationRequest).toMatchObject({ state: 'incomplete', medicationContentUncertaintyCount: 1, medicationContentOnlyIncomplete: true })
 const resolved = [{ id: 'request', _sourceResourceType: 'MedicationRequest' }] as any
 expect(projectClinicalMedicationQueryStatus(resolved, pending).MedicationRequest).toMatchObject({ state: 'ok', count: 1 })
 expect(projectClinicalMedicationQueryStatus(resolved, pending).MedicationRequest).not.toHaveProperty('medicationContentOnlyIncomplete')
 const network = projectClinicalMedicationQueryStatus(rows, { MedicationRequest: { resourceType: 'MedicationRequest', state: 'error', httpStatus: 401, message: 'Unauthorized' } })
 expect(projectClinicalMedicationQueryStatus(resolved, network).MedicationRequest).toMatchObject({ state: 'error', httpStatus: 401, message: 'Unauthorized' })
 for (const state of ['pending', 'unauthorized', 'forbidden', 'unsupported'] as const) {
  const independent = projectClinicalMedicationQueryStatus(rows, { MedicationRequest: { resourceType: 'MedicationRequest', state, message: 'Independent status' } })
  expect(independent.MedicationRequest).toMatchObject({ state, message: 'Independent status', medicationContentUncertaintyCount: 1 })
  expect(projectClinicalMedicationQueryStatus(resolved, independent).MedicationRequest).toMatchObject({ state, message: 'Independent status' })
  const withoutMessage = projectClinicalMedicationQueryStatus(rows, { MedicationRequest: { resourceType: 'MedicationRequest', state } })
  expect(projectClinicalMedicationQueryStatus(resolved, withoutMessage).MedicationRequest?.state).toBe(state)
 }
})

it.each(['pending', 'unauthorized', 'forbidden', 'unsupported', 'error', 'incomplete'] as const)('preserves independent %s without a message across repeated projections and content resolution', state => {
 const rows: any[] = [{ id: 'request', _sourceResourceType: 'MedicationRequest', clinicalMedicationContentUncertainty: { reason: 'ambiguous-reference' } }]
 const once = projectClinicalMedicationQueryStatus(rows, { MedicationRequest: { resourceType: 'MedicationRequest', state } })
 const twice = projectClinicalMedicationQueryStatus(rows, once)
 const third = projectClinicalMedicationQueryStatus(rows, twice)
 expect(once.MedicationRequest?.state).toBe(state)
 expect(twice.MedicationRequest?.state).toBe(state)
 expect(third).toBe(twice)
 expect(twice).toBe(once)
 const resolved = projectClinicalMedicationQueryStatus([{ id: 'request', _sourceResourceType: 'MedicationRequest' }] as any, third)
 expect(resolved.MedicationRequest?.state).toBe(state)
 expect(resolved.MedicationRequest).not.toHaveProperty('medicationContentUncertaintyCount')
 expect(resolved.MedicationRequest).not.toHaveProperty('medicationContentOnlyIncomplete')
 expect(resolved.MedicationRequest?.message).toBeUndefined()
})
