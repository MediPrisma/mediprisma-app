import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { renderHook } from '@testing-library/react'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { useEncounterDetails } from '@/features/clinical-summary/visit-history/hooks/useEncounterDetails'

it.each([false, true])('keeps Claim-derived visit relations only when source-resolved, including same-day fallback: resolved=%s', async valid => {
 const base = valid ? 'https://local.example/fhir' : 'https://foreign.example/fhir'
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
  { resource: { resourceType: 'Patient', id: 'p' } },
  { fullUrl: 'https://local.example/fhir/Encounter/visit', resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', class: { code: 'AMB' }, period: { start: '2025-01-01' }, serviceProvider: { display: 'Same provider' } } },
  ...['med', 'explicit-med'].map(id => ({ fullUrl: base + '/MedicationRequest/' + id, resource: { resourceType: 'MedicationRequest', id, status: 'active', intent: 'order', medicationCodeableConcept: { text: id }, requester: { display: 'Same provider' }, ...(id === 'explicit-med' ? { encounter: { reference: 'https://local.example/fhir/Encounter/visit' } } : {}) } })),
  { fullUrl: base + '/Claim/claim', resource: { resourceType: 'Claim', id: 'claim', patient: { reference: 'Patient/p' }, created: '2025-01-01', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: 'Encounter/visit' } }], procedure: [{ procedureCodeableConcept: { text: 'Claim procedure' } }], supportingInfo: [{ category: { coding: [{ code: 'weight' }] }, valueQuantity: { value: 59, code: 'kg' } }], diagnosis: [{ diagnosisCodeableConcept: { text: 'Claim diagnosis' }, type: [{ text: 'Synthetic narrative' }] }], item: ['med', 'explicit-med'].map(id => ({ extension: [{ url: 'requestedService', valueReference: { reference: 'MedicationRequest/' + id } }] })) } },
 ] } as any)!
 const collection = projectClinicalAggregate(parsed.collection)
 const { result } = renderHook(() => useEncounterDetails(collection.medications, collection.diagnosticReports, collection.observations, collection.procedures, [], collection.conditions, 'en-US', 'medical', [], undefined, collection.encounters))
 const visit = result.current.get(collection.encounters[0].id)
 expect(visit?.medications ?? []).toHaveLength(valid ? 2 : 1)
 expect(visit?.procedures ?? []).toHaveLength(valid ? 1 : 0)
 expect(visit?.tests ?? []).toHaveLength(valid ? 1 : 0)
 expect(collection.medications.find(row => row.sourceId === 'med')?.authoredOn).toBe('2025-01-01')
 expect(collection.medications.find(row => row.sourceId === 'explicit-med')?.encounter?.reference).toBe('Encounter/' + collection.encounters[0].id)
 expect(collection.procedures).toHaveLength(1)
 expect(collection.observations).toHaveLength(1)
 expect(collection.conditions).toHaveLength(1)
 expect(collection.documentReferences).toHaveLength(1)
 if (!valid) {
  for (const row of [...collection.procedures, ...collection.observations, ...collection.conditions, collection.medications.find(row => row.sourceId === 'med')!]) {
   expect(row.encounter).toBeUndefined()
   expect(row._encounterInferred).not.toBe(true)
  }
  expect(collection.documentReferences[0].context?.encounter).toBeUndefined()
 }
 const tools = createFhirTools(() => ({ patient: parsed.patient, collection }))
 const output: any = await tools.getEncounterDetails.execute!({ encounterId: collection.encounters[0].id }, { toolCallId: 'synthetic', messages: [] })
 expect(output.data.medications).toHaveLength(valid ? 2 : 1)
 expect(output.data.procedures).toHaveLength(valid ? 1 : 0)
 if (!valid) { expect(output.incomplete).toBe(true); expect(output.canConcludeAbsence).toBe(false) }
 const claim = collection.clinicalSource!.graph.nodes.find(node => node.resource.resourceType === 'Claim')!
 expect((claim.resource.extension as any[])[0].valueReference.reference).toBe('Encounter/visit')
 expect(collection.clinicalSource!.graph.references.find(edge => edge.origin.key === claim.key && edge.path === 'extension[0].valueReference')?.status).toBe(valid ? 'resolved' : 'unresolved')
})
