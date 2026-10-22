import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { prioritizeClinicalDataForTokenBudget } from '@/src/core/utils/prioritized-clinical-context.utils'
import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const restBase = 'https://ehr.example/fhir'

function catalogAfterAiScope(resources: any[], compositionReference: string) {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'patient', generation: 'synthetic', restBase,
    resources: [...resources, { resourceType: 'Composition', id: 'doc', encounter: { reference: compositionReference } }],
  }])
  const encounters = source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter').map(node => ({
    id: node.resource.id!, clinicalSourceNodeKey: node.key,
    serviceProvider: { display: String((node.resource.serviceProvider as { display?: string } | undefined)?.display ?? '') },
    period: { start: '2026-09-17' },
  }))
  const documentNode = source.graph.nodes.find(node => node.resource.resourceType === 'Composition')!
  const scoped = scopeClinicalDataForAi({
    clinicalSource: source,
    encounters: encounters as any,
    medications: [{ id: 'pending-med', clinicalRecordVariant: { groupId: 'synthetic-group', classification: 'revision', variantCount: 2, reason: 'Synthetic unresolved variant' } }] as any,
    compositions: [{ id: 'doc', clinicalSourceNodeKey: documentNode.key, encounter: { reference: compositionReference }, date: '2026-09-17' }] as any,
  }, ALL_DATA_SELECTION, ALL_DATA_FILTERS, ['doc'], Date.parse('2026-10-01'))

  expect(scoped.clinicalSource).toBeUndefined()
  expect(scoped.compositions?.[0].clinicalSourceNodeKey).toBeUndefined()
  expect(JSON.stringify(scoped)).not.toContain('clinicalSourceNodeKey')
  return buildSourceCatalog(scoped as any).find(entry => entry.resourceType === 'Composition')?.organization
}

it('preserves graph-resolved encounter linkage after AI scope strips graph metadata', () => {
  expect(catalogAfterAiScope([
    { resourceType: 'Encounter', id: 'visit', serviceProvider: { display: 'Synthetic local hospital' } },
  ], 'Encounter/visit')).toBe('Synthetic local hospital')
})

it('does not cite an encounter removed by token-budget prioritization', () => {
  const resources = [
    { resourceType: 'Encounter', id: 'old-visit', period: { start: '2018-01-01' }, serviceProvider: { display: 'Synthetic old hospital' } },
    { resourceType: 'Encounter', id: 'latest-visit', period: { start: '2026-09-17' }, serviceProvider: { display: 'Synthetic current hospital' } },
  ]
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'patient', generation: 'synthetic', restBase,
    resources: [...resources, { resourceType: 'Composition', id: 'doc', encounter: { reference: 'Encounter/old-visit' } }],
  }])
  const encounters = source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter').map(node => ({
    id: node.resource.id!, clinicalSourceNodeKey: node.key,
    serviceProvider: { display: String((node.resource.serviceProvider as { display?: string } | undefined)?.display ?? '') },
    period: node.resource.period as { start: string },
  }))
  const documentNode = source.graph.nodes.find(node => node.resource.resourceType === 'Composition')!
  const scoped = scopeClinicalDataForAi({
    clinicalSource: source,
    encounters: encounters as any,
    compositions: [{ id: 'doc', clinicalSourceNodeKey: documentNode.key, encounter: { reference: 'Encounter/old-visit' }, date: '2026-09-17' }] as any,
  }, ALL_DATA_SELECTION, ALL_DATA_FILTERS, ['doc'], Date.parse('2026-10-01'))
  const prioritized = prioritizeClinicalDataForTokenBudget(scoped as any, 1, 100_000, Date.parse('2026-10-01')).data

  expect(prioritized.encounters?.map(encounter => encounter.id)).not.toContain('old-visit')
  expect(prioritized.compositions?.map(document => document.id)).toContain('doc')
  expect(buildSourceCatalog(prioritized as any).find(entry => entry.resourceType === 'Composition')?.organization).toBeUndefined()
})

it.each([
  ['foreign host', 'https://foreign.example/fhir/Encounter/visit', [
    { fullUrl: `${restBase}/Encounter/visit`, resource: { resourceType: 'Encounter', id: 'visit', serviceProvider: { display: 'Synthetic local hospital' } } },
  ]],
  ['wrong version', `${restBase}/Encounter/visit/_history/1`, [
    { fullUrl: `${restBase}/Encounter/visit/_history/2`, resource: { resourceType: 'Encounter', id: 'visit', meta: { versionId: '2' }, serviceProvider: { display: 'Synthetic local hospital' } } },
  ]],

])('does not restore a %s reference through legacy suffix matching after scope', (_case, reference, resources) => {
  expect(catalogAfterAiScope(resources as any[], reference as string)).toBeUndefined()
})

it('uses the selected same-record encounter version for AI citation organization',()=>{
 expect(catalogAfterAiScope([
  {fullUrl:`${restBase}/Encounter/visit/_history/2`,resource:{resourceType:'Encounter',id:'visit',meta:{versionId:'2',lastUpdated:'2026-09-16'},serviceProvider:{display:'Synthetic old hospital'}}},
  {fullUrl:`${restBase}/Encounter/visit/_history/3`,resource:{resourceType:'Encounter',id:'visit',meta:{versionId:'3',lastUpdated:'2026-09-17'},serviceProvider:{display:'Synthetic current hospital'}}},
 ],'Encounter/visit')).toBe('Synthetic current hospital')
})
