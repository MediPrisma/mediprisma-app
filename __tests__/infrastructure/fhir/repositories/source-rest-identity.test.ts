import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
const base = 'https://synthetic.example/fhir'
const observation = (version?: string): any => ({ resourceType: 'Observation', id: 'result', status: 'final', subject: { reference: 'Patient/p' }, code: { text: 'Synthetic potassium' }, valueQuantity: { value: version === '2' ? 6.1 : 4.2 }, ...(version ? { meta: { versionId: version } } : {}) })
beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(fhirClient.getClient).mockResolvedValue({ state: { serverUrl: base } } as any)
})
async function load(includeUrl: string, versions = false, includeHasFullUrl = true) {
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: string) => ({ resourceType: 'Bundle', entry: url.startsWith('DiagnosticReport?')
    ? [{ ...(includeHasFullUrl ? { fullUrl: includeUrl } : {}), resource: observation(versions ? '1' : undefined) }]
    : url.startsWith('Observation?') ? [{ ...(!includeHasFullUrl ? { fullUrl: includeUrl } : {}), resource: observation(versions ? '2' : undefined) }] : [] }) as any)
  return new FhirClinicalDataRepository().fetchAllClinicalData('p')
}
it.each([true, false])('unifies exact include/search retransmissions with fullUrl on the include: %s', async includeHasFullUrl => {
  const data = await load(base + '/Observation/result', false, includeHasFullUrl)
  expect(data.observations).toHaveLength(1)
  expect(data.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Observation')).toHaveLength(2)
  expect(data.clinicalSource!.evidence.sameRecord.length).toBeGreaterThan(0)
})
it.each([true, false])('keeps differing versions in one uncertainty group with fullUrl on the include: %s', async includeHasFullUrl => {
  const data = await load(base + '/Observation/result', true, includeHasFullUrl)
  expect(data.observations).toHaveLength(2)
  expect(data.observations.every(row => row.clinicalRecordVariant?.classification === 'revision')).toBe(true)
  expect(new Set(data.observations.map(row => row.clinicalRecordVariant?.groupId)).size).toBe(1)
})
it('uses the same authenticated REST identity for generic clinical retransmissions', async () => {
  const condition = { resourceType: 'Condition', id: 'condition', subject: { reference: 'Patient/p' }, code: { text: 'Synthetic diagnosis' } }
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: string) => ({ resourceType: 'Bundle', entry: url.startsWith('Condition?') ? [{ resource: condition }] : url.startsWith('Encounter?') ? [{ fullUrl: base + '/Condition/condition', resource: condition }] : [] }) as any)
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('p')
  expect(data.conditions).toHaveLength(1)
  expect(data.conditions[0].id).toBe('condition')
  expect(data.conditions[0].clinicalRecordVariant).toBeUndefined()
})
it('resolves a third query report against equivalent include/search copies instead of making membership ambiguous', async () => {
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: string) => ({ resourceType: 'Bundle', entry: url.startsWith('Condition?')
    ? [{ fullUrl: base + '/Observation/result', resource: observation() }]
    : url.startsWith('Observation?') ? [{ resource: observation() }]
    : url.startsWith('DiagnosticReport?') ? [{ resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', result: [{ reference: 'Observation/result' }] } }] : [] }) as any)
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('p')
  expect(data.clinicalSource!.graph.references.find(edge => edge.path === 'result[0]')?.status).toBe('resolved')
  expect(data.observations).toHaveLength(1)
  expect(data.diagnosticReports[0]._observations).toHaveLength(1)
  expect(data.diagnosticReports[0]._observations![0]).toBe(data.observations[0])
})
it.each(['https://other.example/fhir/Observation/result', 'urn:uuid:separate-source'])('does not infer equivalence to an explicit unrelated fullUrl %s', async fullUrl => {
  const data = await load(fullUrl)
  expect(data.observations).toHaveLength(2)
  expect(data.observations.every(row => !row.clinicalRecordVariant)).toBe(true)
})
it.each(['pat_123', 'p'.repeat(80)])('preserves an explicitly selected opaque patient id %s without accepting another patient', async id => {
  const own = { ...observation(), subject: { reference: `Patient/${id}` } }
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id } }, { resource: own }] } as any)
  expect(parsed?.collection.observations).toHaveLength(1)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: string) => ({ resourceType: 'Bundle', entry: url.startsWith('Observation?') ? [{ resource: own }, { resource: { ...observation(), id: 'foreign', subject: { reference: 'Patient/other' } } }] : [] }) as any)
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData(id)
  expect(data.observations).toHaveLength(1)
  expect(data.resourceQueryStatus?.Observation?.excludedCount).toBe(1)
})
