import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
it('retains trusted Claim-derived visits through Local parse and common projection', async () => {
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
  { resourceType: 'Patient', id: 'p' }, { resourceType: 'Encounter', id: 'visit', status: 'finished', class: { code: 'AMB' } },
  { resourceType: 'Claim', id: 'claim', patient: { reference: 'Patient/p' }, created: '2025-01-01', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: 'Encounter/visit' } }], procedure: [{ procedureCodeableConcept: { text: 'Claim procedure' } }], supportingInfo: [{ category: { coding: [{ code: 'weight' }] }, valueQuantity: { value: 59, code: 'kg' } }] },
 ].map(resource => ({ resource })) } as any)!
 const collection = projectClinicalAggregate(parsed.collection)
 const tool = createFhirTools(() => ({ patient: parsed.patient, collection }))
 const output: any = await tool.getEncounterDetails.execute!({ encounterId: collection.encounters[0].id }, { toolCallId: 'synthetic', messages: [] })
 expect(output.data.procedures).toHaveLength(1)
 expect(output.data.observations).toHaveLength(1)
 const recent: any = await tool.getRecentVisits.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(recent.data[0]).toMatchObject({ procedureCount: 1, labCount: 1 })
 const untrusted = { ...collection, procedures: [...collection.procedures, { id: 'untrusted', code: { text: 'Untrusted key-less row' }, encounter: { reference: 'Encounter/visit' } }] }
 const untrustedOutput: any = await createFhirTools(() => ({ patient: parsed.patient, collection: untrusted as any })).getEncounterDetails.execute!({ encounterId: collection.encounters[0].id }, { toolCallId: 'synthetic', messages: [] })
 expect(untrustedOutput.data.procedures).toHaveLength(1)
 expect(untrustedOutput.incomplete).toBe(true)
})
it('updates repository-mapped result and hasMember references after later capture context collisions', async () => {
 const client = { state: { serverUrl: 'https://synthetic.example/fhir' } }
 jest.mocked(fhirClient.getClient).mockResolvedValue(client as any)
 let value = 7
 jest.mocked(fhirClient.requestAllPages).mockImplementation(async () => ({ entry: [
  { resourceType: 'Observation', id: 'leaf', encounter: { reference: 'Encounter/context-visit' }, status: 'final', code: { text: 'Leaf' }, valueQuantity: { value: 7 } },
  { resourceType: 'Encounter', id: 'context-visit', status: 'finished', class: { code: 'AMB' }, period: { start: value === 7 ? '2025-01-01' : '2025-02-01' } },
  { resourceType: 'Observation', id: 'panel', encounter: { reference: 'Encounter/context-visit' }, status: 'final', code: { text: 'Panel' }, hasMember: [{ reference: 'Observation/leaf' }] },
  { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Report' }, result: [{ reference: 'Observation/panel' }] },
 ].map(resource => ({ resource })) }) as any)
 const repo = new FhirClinicalDataRepository()
 const reports = await repo.fetchDiagnosticReports('p')
 value = 9
 const observations = await repo.fetchObservations('p')
 const collection = projectClinicalAggregate({ observations, diagnosticReports: reports }, repo.getClinicalSource('p'))
 for (const report of collection.diagnosticReports) {
  const panel = report._observations!.find(row => row.sourceId === 'panel')!
  const leaf = report._observations!.find(row => row.sourceId === 'leaf')!
  expect(report.result![0].reference).toBe('Observation/' + panel.id)
  expect(panel.hasMember![0].reference).toBe('Observation/' + leaf.id)
 }
})

it.each(['https://foreign.example/fhir/Encounter/visit', 'Encounter/visit/_history/old'])('does not grant a Claim-derived link for unproven reference %s', async reference => {
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
  { resourceType: 'Patient', id: 'p' }, { resourceType: 'Encounter', id: 'visit', status: 'finished', class: { code: 'AMB' } },
  { resourceType: 'Claim', id: 'claim', patient: { reference: 'Patient/p' }, created: '2025-01-01', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference } }], procedure: [{ procedureCodeableConcept: { text: 'Unproven procedure' } }] },
  { resourceType: 'Procedure', id: 'raw', status: 'completed', encounter: { reference }, code: { text: 'Raw foreign procedure' }, claimEncounterLink: 'Encounter/visit' },
 ].map(resource => ({ resource })) } as any)!
 const collection = projectClinicalAggregate(parsed.collection)
 const output: any = await createFhirTools(() => ({ patient: parsed.patient, collection })).getEncounterDetails.execute!({ encounterId: collection.encounters[0].id }, { toolCallId: 'synthetic', messages: [] })
 expect(output.data.procedures).toEqual([])
 expect(output.incomplete).toBe(true)
})
it('does not grant a cross-base relative Claim link that the source graph cannot resolve', async () => {
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
  { resource: { resourceType: 'Patient', id: 'p' } },
  { fullUrl: 'https://local.example/fhir/Encounter/visit', resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', class: { code: 'AMB' } } },
  { fullUrl: 'https://foreign.example/fhir/Claim/claim', resource: { resourceType: 'Claim', id: 'claim', patient: { reference: 'Patient/p' }, created: '2025-01-01', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: 'Encounter/visit' } }], procedure: [{ procedureCodeableConcept: { text: 'Foreign Claim procedure' } }] } },
 ] } as any)!
 const source = parsed.collection.clinicalSource!
 expect(source.graph.references.find(edge => edge.origin.resource.resourceType === 'Claim' && edge.path === 'extension[0].valueReference')?.status).toBe('unresolved')
 const collection = projectClinicalAggregate(parsed.collection)
 const output: any = await createFhirTools(() => ({ patient: parsed.patient, collection })).getEncounterDetails.execute!({ encounterId: collection.encounters[0].id }, { toolCallId: 'synthetic', messages: [] })
 expect(output.data.procedures).toEqual([])
 expect(output.incomplete).toBe(true)
})
