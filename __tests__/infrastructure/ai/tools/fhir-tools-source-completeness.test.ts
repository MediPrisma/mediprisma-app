import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('marks recent visits and encounter details incomplete when the real repository quarantines linked foreign rows', async () => {
  jest.mocked(fhirClient.getClient).mockResolvedValue({ state: { serverUrl: 'https://ehr.example/fhir' } } as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: any) => {
    const resourceType = String(url).split('?')[0]
    const resourceByType: Record<string, any[]> = {
      Encounter: [{ resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', period: { start: '2026-10-01' } } }],
      MedicationRequest: [{ resource: { resourceType: 'MedicationRequest', id: 'foreign-med', status: 'active', subject: { reference: 'Patient/other' }, medicationCodeableConcept: { text: 'Synthetic medication' }, encounter: { reference: 'Encounter/visit' } } }],
      Observation: [{ resource: { resourceType: 'Observation', id: 'foreign-lab', status: 'final', subject: { reference: 'Patient/other' }, code: { text: 'Synthetic lab' }, valueInteger: 1, encounter: { reference: 'Encounter/visit' } } }],
      Procedure: [{ resource: { resourceType: 'Procedure', id: 'foreign-procedure', status: 'completed', subject: { reference: 'Patient/other' }, code: { text: 'Synthetic procedure' }, encounter: { reference: 'Encounter/visit' } } }],
    }
    return { entry: resourceByType[resourceType] ?? [] } as any
  })
  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('current')
  expect(collection.resourceQueryStatus).toMatchObject({
    MedicationRequest: { state: 'error', excludedCount: 1 },
    Observation: { state: 'error', excludedCount: 1 },
    Procedure: { state: 'error', excludedCount: 1 },
  })

  const tools = createFhirTools(() => ({ patient: null, collection }))
  const recent = await (tools.getRecentVisits as any).execute({ limit: 5 })
  expect(recent).toMatchObject({ success: true, count: 1, incomplete: true, canConcludeAbsence: false })
  expect(recent.queryIssues.map((issue: any) => issue.resourceType)).toEqual(expect.arrayContaining(['MedicationRequest', 'Observation', 'Procedure']))

  const details = await (tools.getEncounterDetails as any).execute({ encounterId: 'visit' })
  expect(details).toMatchObject({ success: true, incomplete: true, canConcludeAbsence: false })
  expect(details.queryIssues.map((issue: any) => issue.resourceType)).toEqual(expect.arrayContaining(['MedicationRequest', 'Observation', 'Procedure']))
})

it.each(['error', 'pending'] as const)('propagates %s query state through the shared domain wrapper', async state => {
  const tools = createFhirTools(() => ({ patient: null, collection: {
    conditions: [], medications: [], medicationRemainingSummaries: [], allergies: [], observations: [], vitalSigns: [],
    diagnosticReports: [], imagingStudies: [], procedures: [], encounters: [], documentReferences: [], compositions: [],
    immunizations: [], consents: [], devices: [], carePlans: [],
    resourceQueryStatus: { Procedure: { resourceType: 'Procedure', state } },
  } as any }))
  const result = await (tools.getRecentVisits as any).execute({})
  expect(result).toMatchObject({ incomplete: true, canConcludeAbsence: false })
  expect(result.queryIssues).toContainEqual(expect.objectContaining({ resourceType: 'Procedure', state }))
})

it('keeps zero recent visits unconfirmed after an actual repository request failure', async () => {
  jest.mocked(fhirClient.getClient).mockResolvedValue({ state: { serverUrl: 'https://ehr.example/fhir' } } as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: any) => {
    if (String(url).startsWith('MedicationRequest')) throw new Error('synthetic request failure')
    return { entry: [] } as any
  })
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  let collection: Awaited<ReturnType<FhirClinicalDataRepository['fetchAllClinicalData']>>
  try {
    collection = await new FhirClinicalDataRepository().fetchAllClinicalData('current')
  } finally {
    errorSpy.mockRestore()
  }
  expect(collection.resourceQueryStatus?.MedicationRequest).toMatchObject({ state: 'error' })
  const tools = createFhirTools(() => ({ patient: null, collection }))
  const result = await (tools.getRecentVisits as any).execute({})
  expect(result).toMatchObject({ success: false, count: 0, incomplete: true, canConcludeAbsence: false })
  expect(result.queryIssues).toContainEqual(expect.objectContaining({ resourceType: 'MedicationRequest', state: 'error' }))
})
