import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import type { ObservationEntity } from '@/src/core/entities/clinical-data.entity'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('retains SMART contained result panels and leaves as shared rows without promoting audit snapshots', async () => {
  const client = { state: { serverUrl: 'https://contained.example/fhir' } }
  jest.mocked(fhirClient.getClient).mockResolvedValue(client as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: any) => ({ entry: String(url).startsWith('DiagnosticReport?') ? [
    { resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Panel' }, result: [{ reference: '#panel' }], contained: [
      { resourceType: 'Observation', id: 'panel', status: 'final', code: { text: 'Panel' }, hasMember: [{ reference: '#leaf' }] },
      { resourceType: 'Observation', id: 'leaf', status: 'final', code: { text: 'Synthetic value' }, valueQuantity: { value: 7 } },
      { resourceType: 'Observation', id: 'unreferenced', status: 'final', code: { text: 'Not a result' }, valueQuantity: { value: 8 } },
    ] } },
    { resource: { resourceType: 'Provenance', id: 'audit', contained: [{ resourceType: 'Observation', id: 'audit-only', valueQuantity: { value: 99 } }] } },
  ] : [] }) as any)
  const repository = new FhirClinicalDataRepository()
  const collection = await repository.fetchAllClinicalData('synthetic')
  expect(collection.observations.map(row => row.sourceId).sort()).toEqual(['leaf', 'panel'])
  const panel = collection.observations.find(row => row.sourceId === 'panel')!
  const leaf = collection.observations.find(row => row.sourceId === 'leaf')!
  expect(panel.hasMember?.[0].reference).toBe('Observation/' + leaf.id)
  expect(collection.diagnosticReports[0]._observations).toHaveLength(2)
  for (const member of collection.diagnosticReports[0]._observations!) expect(member).toBe(collection.observations.find(row => row.id === member.id))
  expect(collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'audit-only')).toBe(true)
  expect(collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'unreferenced')).toBe(true)
  const progressive = projectClinicalAggregate({ observations: [] as ObservationEntity[], diagnosticReports: await repository.fetchDiagnosticReports('synthetic') }, repository.getClinicalSource('synthetic'))
  expect(progressive.observations.map(row => row.sourceId).sort()).toEqual(['leaf', 'panel'])
  for (const member of progressive.diagnosticReports[0]._observations!) expect(member).toBe(progressive.observations.find(row => row.id === member.id))
})
