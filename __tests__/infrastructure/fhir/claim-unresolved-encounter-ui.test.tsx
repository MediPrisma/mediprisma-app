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
it.each(['unresolved-and-valid', 'two-valid-targets', 'conflicting-dates', 'original-explicit', 'original-identifier', 'original-display'])('projects multiple Claim enrichments as an order-independent set: %s', async scenario => {
 const actual: unknown[] = []
 for (const reverse of [false, true]) {
  const original = scenario.startsWith('original-')
  const originalEncounter = scenario === 'original-identifier' ? { identifier: { system: 'https://synthetic.example/visits', value: 'unknown-visit' } } : scenario === 'original-display' ? { display: 'Unresolved visit' } : { reference: 'Encounter/a' }
  const claims = [
   { id: 'one', reference: scenario === 'unresolved-and-valid' ? 'https://foreign.example/fhir/Encounter/a' : 'Encounter/a', date: '2025-01-01' },
   { id: 'two', reference: scenario === 'two-valid-targets' || original ? 'Encounter/b' : 'Encounter/a', date: scenario === 'conflicting-dates' ? '2025-01-02' : '2025-01-01' },
  ]
  if (reverse) claims.reverse()
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
   { resourceType: 'Patient', id: 'p' },
   ...['a', 'b'].map(id => ({ resourceType: 'Encounter', id, status: 'finished', class: { code: 'AMB' }, period: { start: '2025-01-01' }, serviceProvider: { display: 'Same provider' } })),
   { resourceType: 'MedicationRequest', id: 'med', status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Synthetic medication' }, requester: { display: 'Same provider' }, ...(original ? { encounter: originalEncounter, authoredOn: '2024-01-01' } : {}) },
   ...claims.map(claim => ({ resourceType: 'Claim', id: claim.id, patient: { reference: 'Patient/p' }, created: claim.date, extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: claim.reference } }], item: [{ extension: [{ url: 'requestedService', valueReference: { reference: 'MedicationRequest/med' } }] }], procedure: [{ procedureCodeableConcept: { text: 'Procedure ' + claim.id } }] })),
  ].map(resource => ({ resource })) } as any)!
  const collection = projectClinicalAggregate(parsed.collection)
  const { result, unmount } = renderHook(() => useEncounterDetails(collection.medications, collection.diagnosticReports, collection.observations, collection.procedures, [], collection.conditions, 'en-US', 'medical', [], undefined, collection.encounters))
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection }))
  const counts = []
  for (const id of ['a', 'b']) {
   const output: any = await tools.getEncounterDetails.execute!({ encounterId: id }, { toolCallId: 'synthetic', messages: [] })
   if (['two-valid-targets', 'unresolved-and-valid', 'original-identifier', 'original-display'].includes(scenario)) { expect(output.incomplete).toBe(true); expect(output.canConcludeAbsence).toBe(false) }
   counts.push({ id, ui: result.current.get(id)?.medications.length ?? 0, tool: output.data.medications.length })
  }
  const medication = collection.medications[0]
  const expectedReference = ['two-valid-targets', 'unresolved-and-valid', 'original-identifier', 'original-display'].includes(scenario) ? undefined : 'Encounter/a'
  if (original) expect(medication.encounter).toEqual(originalEncounter)
  expect(medication.encounter?.reference).toBe(expectedReference)
  expect(medication.authoredOn).toBe(original ? '2024-01-01' : scenario === 'conflicting-dates' ? undefined : '2025-01-01')
  expect(counts).toEqual([{ id: 'a', ui: expectedReference ? 1 : 0, tool: expectedReference ? 1 : 0 }, { id: 'b', ui: 0, tool: 0 }])
  expect(collection.procedures).toHaveLength(2)
  expect(collection.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Claim')).toHaveLength(2)
  actual.push({ reference: medication.encounter?.reference, authoredOn: medication.authoredOn, counts })
  unmount()
 }
 expect(actual[0]).toEqual(actual[1])
})
