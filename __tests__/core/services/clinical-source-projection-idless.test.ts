/** @jest-environment node */
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'
import { clinicalSourceContextIdentity } from '@/src/core/services/clinical-source-context'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('assigns distinct stable ids to fullUrl-only generic records and keeps anonymous occurrences separate', () => {
  const source = reconcileClinicalSources([{
    sourceId: 'smart-session', patientScope: 'patient', generation: 'encounters', restBase: 'https://ehr.example/fhir',
    resources: [
      { resource: { resourceType: 'Encounter', status: 'finished' }, fullUrl: 'https://ehr.example/fhir/Encounter/first' },
      { resource: { resourceType: 'Encounter', status: 'finished' }, fullUrl: 'https://ehr.example/fhir/Encounter/second' },
      { resource: { resourceType: 'Procedure', status: 'completed' } },
      { resource: { resourceType: 'Procedure', status: 'completed' } },
    ],
  }])
  const ids = createClinicalSourceProjectionIds(source)
  const encounters = source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter')
  const procedures = source.graph.nodes.filter(node => node.resource.resourceType === 'Procedure')

  expect(encounters.map(node => ids.get(node.key))).toEqual(expect.arrayContaining([expect.any(String), expect.any(String)]))
  expect(new Set(encounters.map(node => ids.get(node.key))).size).toBe(2)
  expect(new Set(procedures.map(node => ids.get(node.key))).size).toBe(2)
  expect([...encounters, ...procedures].every(node => /^cs[A-Za-z0-9.-]{16}$/.test(ids.get(node.key) ?? ''))).toBe(true)
})

it('keeps a fullUrl-only row id stable when a later capture resolves its supporting reference', () => {
  const encounterCapture = {
    sourceId: 'smart-session', patientScope: 'patient', generation: 'encounters', restBase: 'https://ehr.example/fhir',
    resources: [{ resource: { resourceType: 'Encounter', status: 'finished', subject: { reference: 'Patient/patient' } }, fullUrl: 'https://ehr.example/fhir/Encounter/opaque' }],
  }
  const before = reconcileClinicalSources([encounterCapture])
  const after = reconcileClinicalSources([encounterCapture, {
    sourceId: 'smart-session', patientScope: 'patient', generation: 'patient', restBase: 'https://ehr.example/fhir',
    resources: [{ resource: { resourceType: 'Patient', id: 'patient' }, fullUrl: 'https://ehr.example/fhir/Patient/patient' }],
  }])
  const beforeEncounter = before.graph.nodes.find(node => node.resource.resourceType === 'Encounter')!
  const afterEncounter = after.graph.nodes.find(node => node.resource.resourceType === 'Encounter')!

  expect(clinicalSourceContextIdentity(before.graph, beforeEncounter)).not.toBe(clinicalSourceContextIdentity(after.graph, afterEncounter))
  expect(createClinicalSourceProjectionIds(before).get(beforeEncounter.key)).toBe(
    createClinicalSourceProjectionIds(after).get(afterEncounter.key),
  )
})

it('projects SMART fullUrl-only encounters through the aggregate into navigable encounter details', async () => {
  const client = fhirClient as jest.Mocked<typeof fhirClient>
  client.getClient.mockResolvedValue({ state: { serverUrl: 'https://ehr.example/fhir' } } as any)
  client.requestAllPages.mockImplementation(async (query: any) => {
    const type = String(query).split('?')[0]
    if (type === 'Encounter') return { entry: [
      { fullUrl: 'https://ehr.example/fhir/Encounter/opaque-one', resource: { resourceType: 'Encounter', status: 'finished', period: { start: '2026-10-01' }, reasonCode: [{ text: 'Synthetic visit one' }] } },
      { fullUrl: 'https://ehr.example/fhir/Encounter/opaque-two', resource: { resourceType: 'Encounter', status: 'finished', period: { start: '2026-10-02' }, reasonCode: [{ text: 'Synthetic visit two' }] } },
    ] } as any
    if (type === 'MedicationRequest') return { entry: [
      { resource: { resourceType: 'MedicationRequest', status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Synthetic medicine one' }, encounter: { reference: 'https://ehr.example/fhir/Encounter/opaque-one' } } },
      { resource: { resourceType: 'MedicationRequest', status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Synthetic medicine two' }, encounter: { reference: 'https://ehr.example/fhir/Encounter/opaque-two' } } },
    ] } as any
    return { entry: [] } as any
  })

  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('patient')
  const tools = createFhirTools(() => ({ patient: null, collection }))
  expect(collection.encounters).toHaveLength(2)
  expect(collection.encounters.every(encounter => /^cs[A-Za-z0-9.-]{16}$/.test(encounter.id))).toBe(true)
  expect(new Set(collection.encounters.map(encounter => encounter.id)).size).toBe(2)
  expect(collection.medications.map(medication => medication.encounter?.reference)).toEqual(collection.encounters.map(encounter => `Encounter/${encounter.id}`))

  for (const [index, encounter] of collection.encounters.entries()) {
    const result = await (tools.getEncounterDetails as any).execute({ encounterId: encounter.id })
    expect(result.success).toBe(true)
    expect(result.data.medications).toHaveLength(1)
    expect(result.data.medications[0].medication).toContain(`Synthetic medicine ${index === 0 ? 'one' : 'two'}`)
  }
})
