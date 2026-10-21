import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
const condition = (version: string) => ({ fullUrl: 'https://ehr.invalid/fhir/Condition/c', resource: { resourceType: 'Condition', id: 'c', meta: { versionId: version }, subject: { reference: 'Patient/p' }, code: { text: 'Condition ' + version } } })
beforeEach(() => {
  jest.resetAllMocks()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://ehr.invalid/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Encounter?') ? [{ resource: { resourceType: 'Encounter', id: 'e', status: 'finished' } }, condition('1')] : url.startsWith('Procedure?') ? [condition('2')] : [] }))
})
it.each([true, false])('projects included Conditions when Condition query is empty, conditionFirst=%s', async first => {
  const repo = new FhirClinicalDataRepository()
  let conditions: any[], encounters: any[]
  if (first) { conditions = await repo.fetchConditions('p'); encounters = await repo.fetchEncounters('p') }
  else { encounters = await repo.fetchEncounters('p'); conditions = await repo.fetchConditions('p') }
  const data = projectClinicalAggregate({ conditions, encounters, clinicalSource: repo.getClinicalSource('p') })
  expect(data.conditions.map(row => row.code?.text)).toEqual(['Condition 1'])
  expect(data.encounters).toHaveLength(1)
})
it('retains versions included by separate queries and updates authoritative-empty status', async () => {
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('p')
  expect(data.conditions.map(row => row.code?.text).sort()).toEqual(['Condition 1', 'Condition 2'])
  expect(data.conditions.every(row => row.clinicalRecordVariant?.variantCount === 2)).toBe(true)
  expect(data.resourceQueryStatus?.Condition).toMatchObject({ state: 'ok', count: 2 })
})

it('uses explicit adapters for included domains while audit and support resources stay graph-only', async () => {
  const domains: Record<string, string> = { Condition: 'conditions', MedicationRequest: 'medications', AllergyIntolerance: 'allergies', DiagnosticReport: 'diagnosticReports', ImagingStudy: 'imagingStudies', Procedure: 'procedures', DocumentReference: 'documentReferences', Composition: 'compositions', Immunization: 'immunizations', Consent: 'consents', Device: 'devices', CarePlan: 'carePlans' }
  const included = Object.keys(domains).map(resourceType => ({ resource: { resourceType, id: resourceType, status: 'active', medicationCodeableConcept: { text: 'Drug' } } }))
  const extras = [
    { resource: { resourceType: 'Medication', id: 'support', code: { text: 'support only' } } },
    { resource: { resourceType: 'Basic', id: 'unknown-basic' } },
    { resource: { resourceType: 'SyntheticUnknown', id: 'unknown' } },
    { resource: { resourceType: 'Bundle', id: 'audit', entry: [{ resource: { resourceType: 'Condition', id: 'audit-condition' } }] } },
  ]
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Encounter?') ? [{ resource: { resourceType: 'Encounter', id: 'e' } }, ...included, ...extras] : [] }))
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('p')
  for (const [type, array] of Object.entries(domains)) expect((data as any)[array].map((row: any) => row.sourceId)).toEqual([type])
  expect(data.medicationRemainingSummaries).toHaveLength(0)
  expect(data.clinicalSource!.graph.nodes.some(node => node.resource.id === 'audit-condition')).toBe(true)
  expect(data.conditions.some(row => row.sourceId === 'audit-condition')).toBe(false)
})
