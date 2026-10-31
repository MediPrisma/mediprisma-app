/** @jest-environment node */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('retains existing local date/provider inferred visit links through mapping and tools', async () => {
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'patient' } },
    { resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', period: { start: '2026-10-01' }, serviceProvider: { display: 'Synthetic hospital' } } },
    { resource: { resourceType: 'MedicationRequest', id: 'med', authoredOn: '2026-10-01', requester: { display: 'Synthetic hospital' }, medicationCodeableConcept: { text: 'Synthetic medicine' } } },
    { resource: { resourceType: 'Condition', id: 'condition', recordedDate: '2026-10-01', code: { text: 'Synthetic condition' } } },
    { resource: { resourceType: 'Procedure', id: 'procedure', performedDateTime: '2026-10-01', code: { text: 'Synthetic procedure' } } },
    { resource: { resourceType: 'ImagingStudy', id: 'study', started: '2026-10-01', description: 'Synthetic imaging' } },
    { resource: { resourceType: 'Observation', id: 'lab', status: 'final', effectiveDateTime: '2026-10-01', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Synthetic lab' }, valueQuantity: { value: 7 } } },
  ] })!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  const visits = await (tools.getRecentVisits as any).execute({})
  expect(visits.data[0]).toMatchObject({ medCount: 1, labCount: 1 })
  const details = await (tools.getEncounterDetails as any).execute({ encounterId: parsed.collection.encounters[0].id })
  expect(details.data.medications).toHaveLength(1)
  expect(details.data.observations).toHaveLength(1)
  expect(details.data.procedures).toHaveLength(1)
  expect(details.data.imagingStudies).toHaveLength(1)
  expect(parsed.collection.conditions[0]._encounterInferred).toBe(true)
})

async function capturedTools(includeSecondEncounter: boolean) {
  jest.clearAllMocks()
  const mock = fhirClient as jest.Mocked<typeof fhirClient>
  mock.getClient.mockResolvedValue({ state: { serverUrl: 'https://one.example/fhir' } } as any)
  mock.requestAllPages.mockImplementation(async (query: any) => {
    const resourceType = String(query).split('?')[0]
    if (resourceType === 'Encounter') return { entry: ['one', ...(includeSecondEncounter ? ['two'] : [])].map((source, index) => ({
      fullUrl: `https://${source}.example/fhir/Encounter/same`,
      resource: { resourceType, id: 'same', status: 'finished', period: { start: `2026-10-0${index + 1}` }, reasonCode: [{ text: `Synthetic visit ${source}` }] },
    })) } as any
    if (resourceType === 'MedicationRequest') return { entry: ['one', 'two'].map(source => ({
      resource: { resourceType, id: `med-${source}`, status: 'active', intent: 'order', medicationCodeableConcept: { text: `Synthetic medicine ${source}` }, encounter: { reference: `https://${source}.example/fhir/Encounter/same` } },
    })) } as any
    return { entry: [] } as any
  })
  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic')
  return createFhirTools(() => ({ patient: null, collection }))
}

it('does not select the first encounter or mix medicines when two source hosts use the same ID', async () => {
  const tools = await capturedTools(true)
  const result = await (tools.getEncounterDetails as any).execute({ encounterId: 'same' })
  expect(result).toMatchObject({ success: false, code: 'ambiguous-encounter-identity', incomplete: true, canConcludeAbsence: false, data: null })
  const visits = await (tools.getRecentVisits as any).execute({})
  expect(visits).toMatchObject({ count: 2 })
  expect(new Set(visits.data.map((visit: any) => visit.encounterId)).size).toBe(2)
  for (const visit of visits.data) {
    expect(visit.medCount).toBe(1)
    const detail = await (tools.getEncounterDetails as any).execute({ encounterId: visit.encounterId })
    expect(detail.success).toBe(true)
    expect(detail.data.medications).toHaveLength(1)
    expect(JSON.stringify(detail.data.medications)).toContain(visit.date === '2026-10-01' ? 'Synthetic medicine one' : 'Synthetic medicine two')
  }
})

it('uses only the resolved source encounter and reports the other host link as unknown', async () => {
  const tools = await capturedTools(false)
  const result = await (tools.getEncounterDetails as any).execute({ encounterId: 'same' })
  expect(result).toMatchObject({ success: true, incomplete: true, canConcludeAbsence: false })
  expect(result.data.medications).toHaveLength(1)
  expect(JSON.stringify(result.data.medications)).toContain('Synthetic medicine one')
  expect(JSON.stringify(result.data.medications)).not.toContain('Synthetic medicine two')
  const visits = await (tools.getRecentVisits as any).execute({})
  expect(visits).toMatchObject({ incomplete: true, canConcludeAbsence: false })
  expect(visits.data[0].medCount).toBe(1)
})

it('joins MedicationStatement context by its resolved source edge without tail-ID fallback', async () => {
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'patient' } },
    { fullUrl: 'https://ehr.example/fhir/Encounter/visit', resource: { resourceType: 'Encounter', id: 'visit', status: 'finished' } },
    { fullUrl: 'https://ehr.example/fhir/MedicationStatement/known', resource: { resourceType: 'MedicationStatement', id: 'known', status: 'active', context: { reference: 'https://ehr.example/fhir/Encounter/visit' }, medicationCodeableConcept: { text: 'Known medicine' } } },
    { fullUrl: 'https://ehr.example/fhir/MedicationStatement/foreign', resource: { resourceType: 'MedicationStatement', id: 'foreign', status: 'active', context: { reference: 'https://other.example/fhir/Encounter/visit' }, medicationCodeableConcept: { text: 'Foreign medicine' } } },
  ] })!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  const result = await (tools.getEncounterDetails as any).execute({ encounterId: parsed.collection.encounters[0].id })
  expect(result.data.medications).toHaveLength(1)
  expect(JSON.stringify(result.data.medications)).toContain('Known medicine')
  expect(JSON.stringify(result.data.medications)).not.toContain('Foreign medicine')
  expect(result).toMatchObject({ incomplete: true, canConcludeAbsence: false })
})
