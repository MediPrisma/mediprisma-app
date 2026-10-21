/** @jest-environment node */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

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
  expect(visits).toMatchObject({ count: 2, incomplete: true, canConcludeAbsence: false })
  expect(visits.data).toEqual(expect.arrayContaining([expect.objectContaining({ medCount: null, labCount: null, procedureCount: null })]))
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
