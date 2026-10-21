import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { recordClinicalEncounterAliases } from '@/src/core/services/clinical-encounter-alias'
import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const restBase = 'https://ehr.example/fhir'

function compositionOrganization(resources: any[], currentReference: string, aliases: Array<[string, string]> = []) {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'patient', generation: 'synthetic', restBase, resources,
  }])
  const encounters = source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter')
  const document = source.graph.nodes.find(node => node.resource.resourceType === 'Composition')!
  const retainedRows = aliases.length
    ? [encounters.find(node => node.resource.id === 'cloud')!]
    : encounters
  if (aliases.length) recordClinicalEncounterAliases(source, new Map(aliases))
  const catalog = buildSourceCatalog({
    clinicalSource: source,
    encounters: retainedRows.map(node => ({
      id: node.resource.id!,
      clinicalSourceNodeKey: node.key,
      serviceProvider: { display: String(node.resource.serviceProvider?.display ?? '') },
      period: { start: '2026-09-17' },
    })) as any,
    compositions: [{
      id: 'document',
      clinicalSourceNodeKey: document.key,
      title: 'Synthetic document',
      date: '2026-09-17',
      encounter: { reference: currentReference },
    }] as any,
  })
  return catalog.find(entry => entry.resourceType === 'Composition')?.organization
}

it('uses only a resolved graph Encounter edge for source-backed catalog organizations', () => {
  expect(compositionOrganization([
    { resourceType: 'Encounter', id: 'visit', serviceProvider: { display: 'Local hospital' } },
    { resourceType: 'Composition', id: 'document', encounter: { reference: 'Encounter/visit' } },
  ], 'Encounter/visit')).toBe('Local hospital')

  expect(compositionOrganization([
    { fullUrl: `${restBase}/Encounter/visit`, resource: { resourceType: 'Encounter', id: 'visit', serviceProvider: { display: 'Local hospital' } } },
    { resourceType: 'Composition', id: 'document', encounter: { reference: 'https://foreign.example/fhir/Encounter/visit' } },
  ], 'https://foreign.example/fhir/Encounter/visit')).toBeUndefined()

  expect(compositionOrganization([
    { fullUrl: `${restBase}/Encounter/visit/_history/2`, resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '2' }, serviceProvider: { display: 'Local hospital' } } },
    { resourceType: 'Composition', id: 'document', encounter: { reference: `${restBase}/Encounter/visit/_history/1` } },
  ], `${restBase}/Encounter/visit/_history/1`)).toBeUndefined()

  expect(compositionOrganization([
    { fullUrl: `${restBase}/Encounter/visit/_history/2`, resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '2' }, serviceProvider: { display: 'Hospital two' } } },
    { fullUrl: `${restBase}/Encounter/visit/_history/3`, resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '3' }, serviceProvider: { display: 'Hospital three' } } },
    { resourceType: 'Composition', id: 'document', encounter: { reference: 'Encounter/visit' } },
  ], 'Encounter/visit')).toBeUndefined()
})

it('preserves a confirmed local Encounter alias without trusting a raw source comparison field', () => {
  const resources = [
    { resourceType: 'Encounter', id: 'hospital', serviceProvider: { display: 'Hospital source' } },
    { resourceType: 'Encounter', id: 'cloud', serviceProvider: { display: 'Confirmed retained hospital' } },
    { resourceType: 'Composition', id: 'document', encounter: { reference: 'Encounter/hospital' } },
  ]
  const source = reconcileClinicalSources([{ sourceId: 'ehr', patientScope: 'patient', generation: 'synthetic', resources }])
  const hospital = source.graph.nodes.find(node => node.resource.resourceType === 'Encounter' && node.resource.id === 'hospital')!
  const cloud = source.graph.nodes.find(node => node.resource.resourceType === 'Encounter' && node.resource.id === 'cloud')!
  const document = source.graph.nodes.find(node => node.resource.resourceType === 'Composition')!
  recordClinicalEncounterAliases(source, new Map([[hospital.key, cloud.key]]))
  const catalog = buildSourceCatalog({
    clinicalSource: source,
    encounters: [{ id: 'cloud', clinicalSourceNodeKey: cloud.key, serviceProvider: { display: 'Confirmed retained hospital' } }] as any,
    compositions: [{ id: 'document', clinicalSourceNodeKey: document.key, encounter: { reference: 'Encounter/cloud' } }] as any,
  })
  expect(catalog.find(entry => entry.resourceType === 'Composition')?.organization).toBe('Confirmed retained hospital')
})

it('keeps legacy suffix lookup only when no source graph is available', () => {
  const catalog = buildSourceCatalog({
    encounters: [{ id: 'visit', serviceProvider: { display: 'Legacy hospital' } }] as any,
    compositions: [{ id: 'document', encounter: { reference: 'https://foreign.example/fhir/Encounter/visit' } }] as any,
  })
  expect(catalog.find(entry => entry.resourceType === 'Composition')?.organization).toBe('Legacy hospital')
})
