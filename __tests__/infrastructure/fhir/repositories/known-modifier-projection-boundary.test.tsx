import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { CLINICAL_RECORD_VARIANT_EXTENSION, CLINICAL_MEDICATION_CONTENT_EXTENSION } from '@/src/core/services/clinical-record-variant-modifier'
import { getClinicalDataRepository } from '@/src/application/composition'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/composition')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'a' }, isLoading: false, isFetching: false }) }))
const invalid = () => ({ resourceType: 'Condition', id: 'bad', code: { text: 'Unusable condition' }, modifierExtension: [{ url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: [{ url: 'classification', valueCode: 'resolved' }] }] })
const good = () => ({ resourceType: 'Condition', id: 'good', code: { text: 'Independent condition' } })
function repository(resources: any[], queryType = 'Condition') {
 jest.resetAllMocks()
 ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
 ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith(queryType + '?') ? resources.map(resource => ({ resource })) : [] }))
 return new FhirClinicalDataRepository()
}
it.each(['unknown', 'contained-audit', 'embedded-history', 'medication-support', 'unknown-basic'])('keeps malformed modifiers in %s source-only resources without rejecting a valid Local chart', kind => {
 const bad = invalid()
 const sourceOnly = kind === 'medication-support' ? { ...bad, resourceType: 'Medication' } : kind === 'unknown-basic' ? { ...bad, resourceType: 'Basic' } : kind === 'unknown' ? { ...bad, resourceType: 'MolecularSequence' } : kind === 'contained-audit' ? { resourceType: 'Provenance', id: 'audit', contained: [bad] } : { resourceType: 'Bundle', id: 'history', type: 'history', entry: [{ resource: bad }] }
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resourceType: 'Patient', id: 'a' }, good(), sourceOnly].map(resource => ({ resource })) } as any)!
 expect(parsed.collection.conditions).toHaveLength(1)
 expect(parsed.collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'bad')).toBe(true)
})
it('continues to reject a malformed known modifier on an actually mapped Local record', () => {
 expect(() => LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resourceType: 'Patient', id: 'a' }, invalid()].map(resource => ({ resource })) } as any)).toThrow(/modifier/i)
})
it('quarantines malformed SMART records before direct repository consumers while retaining raw evidence', async () => {
 const repo = repository([good(), invalid()])
 expect((await repo.fetchConditions('a')).map(row => row.code?.text)).toEqual(['Independent condition'])
 expect(repo.getQueryStatus('Condition')).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 expect(repo.getClinicalSource('a').graph.nodes.some(node => node.resource.id === 'bad')).toBe(true)
})
it('keeps aggregate and tools available with explicit domain incompleteness', async () => {
 const repo = repository([good(), invalid()])
 const collection = await repo.fetchAllClinicalData('a')
 expect(collection.conditions.map(row => row.code?.text)).toEqual(['Independent condition'])
 expect(collection.resourceQueryStatus?.Condition).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 const overview: any = await createFhirTools(() => ({ patient: null, collection })).getDataOverview.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(overview.data.conditions).toMatchObject({ count: 1, incomplete: true, canConcludeAbsence: false })
})
it('does not turn a foreign source-only malformed modifier into a projection exception', async () => {
 const repo = repository([good(), { ...invalid(), subject: { reference: 'Patient/b' } }])
 const collection = await repo.fetchAllClinicalData('a')
 expect(collection.conditions).toHaveLength(1)
 expect(collection.resourceQueryStatus?.Condition?.invalidModifierCount).toBeUndefined()
})
it('does not throw from progressive hook projection for a quarantined SMART row', async () => {
 const repo = repository([good(), invalid()])
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repo)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
 await waitFor(() => expect(result.current.isLoading).toBe(false))
 expect(result.current.conditions).toHaveLength(1)
 expect(result.current.resourceQueryStatus.Condition).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 unmount(); client.clear()
})

it('rejects or quarantines a known medication-content modifier on the wrong clinical resource type', async () => {
 const wrong = { ...good(), id: 'wrong-type', modifierExtension: [{ url: CLINICAL_MEDICATION_CONTENT_EXTENSION, extension: [{ url: 'reason', valueCode: 'ambiguous-reference' }] }] }
 expect(() => LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resourceType: 'Patient', id: 'a' }, wrong].map(resource => ({ resource })) } as any)).toThrow(/modifier/i)
 const repo = repository([good(), wrong])
 const data = await repo.fetchAllClinicalData('a')
 expect(data.conditions).toHaveLength(1)
 expect(data.resourceQueryStatus?.Condition).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
})
it('blocks a nonstandard blocking domain from concluding absent history when an invalid Procedure is quarantined', async () => {
 const repo = repository([{ resourceType: 'Procedure', id: 'good-procedure', status: 'completed', code: { text: 'Independent procedure' } }, { ...invalid(), resourceType: 'Procedure', status: 'completed' }], 'Procedure')
 jest.mocked(getClinicalDataRepository).mockResolvedValue(repo)
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
 await waitFor(() => expect(result.current.isLoading).toBe(false))
 expect(result.current.procedures).toHaveLength(1)
 expect(result.current.resourceQueryStatus.Procedure).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 expect(result.current.hasBlockingQueryIssues).toBe(true)
 unmount(); client.clear()
})
it('does not promote a malformed Medication support target as a drug code', async () => {
 const resources = [{ resourceType: 'MedicationRequest', id: 'prescription', status: 'active', intent: 'order', medicationReference: { reference: 'Medication/bad' } }, { ...invalid(), resourceType: 'Medication', code: { text: 'Do not use this drug' } }]
 const repo = repository(resources, 'MedicationRequest')
 const medications = await repo.fetchMedications('a')
 expect(medications).toHaveLength(1)
 expect(medications[0].medicationCodeableConcept).toBeUndefined()
 expect(medications[0].clinicalRecordVariant).toBeUndefined()
 expect(medications[0].clinicalMedicationContentUncertainty).toBeDefined()
 expect(repo.getQueryStatus('MedicationRequest')).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 expect(() => LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resourceType: 'Patient', id: 'a' }, ...resources].map(resource => ({ resource })) } as any)).toThrow(/modifier/i)
})
it('quarantines a malformed actually referenced contained report member before repository attachment', async () => {
 const report = { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Synthetic report' }, result: [{ reference: '#bad' }], contained: [{ ...invalid(), resourceType: 'Observation', status: 'final', valueQuantity: { value: 9 } }] }
 const repo = repository([report], 'DiagnosticReport')
 const reports = await repo.fetchDiagnosticReports('a')
 expect(reports).toHaveLength(1)
 expect(reports[0]._observations ?? []).toEqual([])
 expect(repo.getQueryStatus('DiagnosticReport')).toMatchObject({ state: 'incomplete', invalidModifierCount: 1 })
 const collection = await repo.fetchAllClinicalData('a')
 expect(collection.observations).toEqual([])
 expect(collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'bad')).toBe(true)
})

it.each([{ resources: [] }, { resources: [good()] }])('recovers only quarantine-owned incompleteness after an authoritative corrected capture: %j', async ({ resources }) => {
 const oldRepo = repository([good(), invalid()])
 const old = await oldRepo.fetchAllClinicalData('a')
 const repeated = projectClinicalAggregate(old, old.clinicalSource!)
 expect(repeated.resourceQueryStatus?.Condition).toEqual(old.resourceQueryStatus?.Condition)
 const freshRepo = repository(resources)
 const fresh = await freshRepo.fetchAllClinicalData('a')
 const recovered = projectClinicalAggregate(old, fresh.clinicalSource!)
 expect(recovered.resourceQueryStatus?.Condition?.invalidModifierCount).toBeUndefined()
 expect(recovered.conditions).toHaveLength(resources.length)
 expect(recovered.resourceQueryStatus?.Condition?.state).toBe(resources.length ? 'ok' : 'empty')
 expect(recovered.resourceQueryStatus?.Condition?.count).toBe(resources.length)
 for (const state of ['pending', 'error', 'unauthorized', 'forbidden', 'unsupported', 'incomplete'] as const) {
  const independent = { ...old, resourceQueryStatus: { ...old.resourceQueryStatus, Condition: { ...old.resourceQueryStatus!.Condition!, state, message: 'Independent issue', invalidModifierPreviousStatus: undefined } } }
  const next = projectClinicalAggregate(independent, fresh.clinicalSource!)
  expect(next.resourceQueryStatus?.Condition).toMatchObject({ state, message: 'Independent issue' })
  expect(next.resourceQueryStatus?.Condition?.invalidModifierCount).toBeUndefined()
 }
 const content = { ...old, resourceQueryStatus: { ...old.resourceQueryStatus, Condition: { ...old.resourceQueryStatus!.Condition!, medicationContentUncertaintyCount: 1 } } }
 expect(projectClinicalAggregate(content, fresh.clinicalSource!).resourceQueryStatus?.Condition?.state).toBe('incomplete')
})
