import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

const serverUrl = 'https://ehr.example/fhir'

async function fetchCollection(entries: Record<string, any[]>) {
  jest.mocked(fhirClient.getClient).mockResolvedValue({ state: { serverUrl } } as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: any) => ({
    entry: entries[String(url).split('?')[0]] ?? [],
  } as any))
  return new FhirClinicalDataRepository().fetchAllClinicalData('current')
}

it.each([
  ['urn:uuid:visit', 'urn:uuid:visit'],
  ['https://ehr.example/fhir/Encounter/visit', 'https://ehr.example/fhir/Encounter/visit'],
] as const)('rewrites a resolved singleton Encounter %s reference using its visible mapped row ID', async (fullUrl, reference) => {
  const collection = await fetchCollection({
    Encounter: [{ fullUrl, resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', period: { start: '2026-10-01' }, subject: { reference: 'Patient/current' } } }],
    Procedure: [{ resource: { resourceType: 'Procedure', id: 'procedure', status: 'completed', code: { text: 'Synthetic procedure' }, subject: { reference: 'Patient/current' }, encounter: { reference } } }],
  })

  expect(collection.encounters).toHaveLength(1)
  expect(collection.procedures).toHaveLength(1)
  expect(collection.procedures[0].encounter?.reference).toBe('Encounter/' + collection.encounters[0].id)

  const tools = createFhirTools(() => ({ patient: null, collection }))
  const details = await (tools.getEncounterDetails as any).execute({ encounterId: collection.encounters[0].id })
  expect(details.data.procedures).toHaveLength(1)
})

it('preserves wrong-version, foreign-host, and ambiguous Encounter references while collision rows keep distinct IDs', async () => {
  const source = await fetchCollection({
    Encounter: [
      { fullUrl: 'https://ehr.example/fhir/Encounter/visit/_history/2', resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '2' }, status: 'finished', period: { start: '2026-10-02' }, subject: { reference: 'Patient/current' } } },
      { fullUrl: 'https://ehr.example/fhir/Encounter/visit/_history/3', resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '3' }, status: 'finished', period: { start: '2026-10-03' }, subject: { reference: 'Patient/current' } } },
      { fullUrl: 'https://ehr.example/fhir/Encounter/foreign', resource: { resourceType: 'Encounter', id: 'foreign', status: 'finished', subject: { reference: 'Patient/current' } } },
    ],
    Procedure: [
      { resource: { resourceType: 'Procedure', id: 'wrong-version', status: 'completed', code: { text: 'Wrong version' }, subject: { reference: 'Patient/current' }, encounter: { reference: 'https://ehr.example/fhir/Encounter/visit/_history/1' } } },
      { resource: { resourceType: 'Procedure', id: 'version-2', status: 'completed', code: { text: 'Version two' }, subject: { reference: 'Patient/current' }, encounter: { reference: 'https://ehr.example/fhir/Encounter/visit/_history/2' } } },
      { resource: { resourceType: 'Procedure', id: 'version-3', status: 'completed', code: { text: 'Version three' }, subject: { reference: 'Patient/current' }, encounter: { reference: 'https://ehr.example/fhir/Encounter/visit/_history/3' } } },
      { resource: { resourceType: 'Procedure', id: 'foreign-host', status: 'completed', code: { text: 'Foreign host' }, subject: { reference: 'Patient/current' }, encounter: { reference: 'https://foreign.example/fhir/Encounter/foreign' } } },
      { resource: { resourceType: 'Procedure', id: 'ambiguous', status: 'completed', code: { text: 'Ambiguous' }, subject: { reference: 'Patient/current' }, encounter: { reference: 'Encounter/visit' } } },
    ],
  })
  const collisionRows = source.encounters.filter(row => row.sourceId === 'visit')
  expect(collisionRows).toHaveLength(2)
  expect(new Set(collisionRows.map(row => row.id)).size).toBe(2)
  const byVersion = new Map(collisionRows.map(row => [
    source.clinicalSource!.graph.nodes.find(node => node.key === row.clinicalSourceNodeKey)?.resource.meta?.versionId,
    row.id,
  ]))
  expect(source.procedures.map(row => row.encounter?.reference)).toEqual([
    'https://ehr.example/fhir/Encounter/visit/_history/1',
    `Encounter/${byVersion.get('2')}`,
    `Encounter/${byVersion.get('3')}`,
    'https://foreign.example/fhir/Encounter/foreign',
    'Encounter/visit',
  ])
})

it('uses a visible mapped row ID for singleton targets and preserves an already-reconciled domain alias', () => {
  const source = reconcileClinicalSources([{ sourceId: 'synthetic', patientScope: 'patient', generation: '1', resources: [
    { resourceType: 'Encounter', id: 'raw-target', status: 'finished' },
    { resourceType: 'Encounter', id: 'domain-alias', status: 'finished' },
    { resourceType: 'Procedure', id: 'linked', status: 'completed', encounter: { reference: 'Encounter/raw-target' } },
    { resourceType: 'Procedure', id: 'aliased', status: 'completed', encounter: { reference: 'Encounter/raw-target' } },
  ] }])
  const encounterNodes = source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter')
  const linkedNode = source.graph.nodes.find(node => node.resource.id === 'linked')!
  const rawTarget = encounterNodes.find(node => node.resource.id === 'raw-target')!
  const domainAlias = encounterNodes.find(node => node.resource.id === 'domain-alias')!
  const projected = projectClinicalAggregate({
    encounters: [
      { id: 'mapped-target-row', clinicalSourceNodeKey: rawTarget.key, status: 'finished' },
      { id: 'mapped-alias-row', clinicalSourceNodeKey: domainAlias.key, status: 'finished' },
    ],
    procedures: [
      { id: 'mapped-procedure-row', clinicalSourceNodeKey: linkedNode.key, status: 'completed', encounter: { reference: 'Encounter/raw-target' } },
      { id: 'mapped-alias-procedure-row', clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === 'aliased')!.key, status: 'completed', encounter: { reference: 'Encounter/domain-alias' } },
    ],
  } as any, source)
  expect(projected.procedures[0].encounter.reference).toBe('Encounter/mapped-target-row')
  expect(projected.procedures[1].encounter.reference).toBe('Encounter/domain-alias')
  expect(projected.encounters.map((row: any) => row.id)).toEqual(['mapped-target-row', 'mapped-alias-row'])
})
