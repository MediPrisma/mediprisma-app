import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import { QueryClient } from '@tanstack/react-query'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_SELECTION, ALL_DATA_FILTERS } from '@/src/shared/constants/data-selection.constants'
import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
afterEach(() => jest.restoreAllMocks())
function bundle(versions = ['1', '2']) {
 return { resourceType: 'Bundle', entry: [
  { resourceType: 'Patient', id: 'synthetic' },
  ...['1', '2'].map(version => ({ resourceType: 'Encounter', id: 'visit-' + version, status: 'finished', class: { code: 'AMB' } })),
  { resourceType: 'MedicationRequest', id: 'prescription', status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Independent prescription' } },
  { resourceType: 'Condition', id: 'unrelated', code: { text: 'Independent condition' } },
  ...versions.map(version => ({ resourceType: 'Claim', id: 'same-claim', meta: { versionId: version }, patient: { reference: 'Patient/synthetic' }, created: version === '1' ? '2026-09-01' : '2026-09-02', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: 'Encounter/visit-' + version } }], diagnosis: [1, 2].map(sequence => ({ sequence, diagnosisCodeableConcept: { text: 'Claim diagnosis ' + version + '-' + sequence }, type: [{ text: 'Synthetic narrative ' + version }] })), supportingInfo: [{ category: { coding: [{ code: 'weight' }] }, valueQuantity: { value: version === '1' ? 60 : 80, code: 'kg' } }], procedure: [1, 2].map(sequence => ({ sequence, procedureCodeableConcept: { text: 'Claim procedure ' + version + '-' + sequence } })), item: [{ extension: [{ url: 'requestedService', valueReference: { reference: 'MedicationRequest/prescription' } }] }] })),
 ].map(resource => ({ resource })) }
}
it('keeps Claim revision-derived facts visible and distinct but uncertain across actual AI and CDSS boundaries', () => {
 const encounterMapper = jest.spyOn(FhirMapper, 'toEncounter')
 const parsed = LocalBundleService.parse(bundle() as any)!
 const collection = projectClinicalAggregate(parsed.collection)
 const derived = [collection.conditions.filter(row => row.id !== 'unrelated'), collection.observations, collection.procedures, collection.documentReferences]
 for (const rows of derived) {
  expect(rows.length).toBeGreaterThan(1)
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  expect(rows.every(row => row.clinicalRecordVariant?.variantCount === 2)).toBe(true)
  expect(rows.every(row => !row.clinicalSourceNodeKey)).toBe(true)
  expect(new Set(rows.map(row => row.sourceVersionId))).toEqual(new Set(['1', '2']))
 }
 expect(collection.encounters.every(row => !row.period?.start)).toBe(true)
 expect(encounterMapper.mock.calls.every(([resource]) => !resource.subject && !resource.period?.start)).toBe(true)
 expect(collection.medications[0].authoredOn).toBeUndefined()
 expect(collection.medications[0].encounter).toBeUndefined()
 const selected = selectCdssClinicalInputs(collection)
 expect(selected.input.conditions.map(row => row.id)).toEqual(['unrelated'])
 expect(selected.input.observations).toEqual([])
 expect(selected.input.procedures).toEqual([])
 expect(selected.input.documentReferences).toEqual([])
 expect(selected.excluded).toHaveLength(12)
 expect(selected.excluded.every(row => row.reason && row.versionId)).toBe(true)
 const scoped = scopeClinicalDataForAi(collection, ALL_DATA_SELECTION, ALL_DATA_FILTERS, collection.documentReferences.map(row => row.id))
 expect(scoped.conditions?.map(row => row.id)).toEqual(['unrelated'])
 expect(scoped.procedures).toEqual([])
 expect(scoped.documentReferences).toEqual([])
 expect(buildSourceCatalog(scoped as any).filter(row => row.resourceType === 'Condition')).toHaveLength(1)
 expect(JSON.stringify(scoped)).not.toContain('clinicalSourceNodeKey')
 expect(JSON.stringify(scoped)).not.toContain('clinicalClaimDerivedSource')
 expect(JSON.stringify(scoped)).not.toContain('clinicalClaimEncounterRelation')
 expect(JSON.stringify(scoped)).not.toContain('originNodeKey')
 expect(collection.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Claim')).toHaveLength(2)
})
it('re-evaluates trusted Claim-derived variants from the current source graph instead of retaining stale annotations', () => {
 const old = LocalBundleService.parse(bundle() as any)!.collection
 const resolved = LocalBundleService.parse(bundle(['1']) as any)!.collection
 const updated = projectClinicalAggregate(old, resolved.clinicalSource)
 const rows = [...updated.conditions, ...updated.observations, ...updated.procedures, ...updated.documentReferences].filter(row => row.sourceVersionId)
 expect(rows.length).toBeGreaterThan(0)
 expect(rows.every(row => row.sourceVersionId === '1')).toBe(true)
 expect(rows.every(row => !row.clinicalRecordVariant)).toBe(true)
})

it('keeps trusted Claim origin and positions through actual query-cache structural sharing', () => {
 const client = new QueryClient()
 const initial = LocalBundleService.parse(bundle() as any, undefined, 'first')!.collection
 client.setQueryData(['synthetic'], initial)
 const replacement = LocalBundleService.parse(bundle() as any, undefined, 'second')!.collection
 client.setQueryData(['synthetic'], replacement)
 const cached = client.getQueryData<typeof replacement>(['synthetic'])!
 const projected = projectClinicalAggregate(cached, replacement.clinicalSource)
 expect(projected.conditions.filter(row => row.sourceVersionId)).toHaveLength(4)
 expect(projected.conditions.filter(row => row.sourceVersionId).every(row => row.clinicalRecordVariant?.variantCount === 2)).toBe(true)
 expect(projected.observations).toHaveLength(2)
 for (const row of [...projected.conditions.filter(row => row.sourceVersionId), ...projected.observations, ...projected.procedures, ...projected.documentReferences]) {
  expect(replacement.clinicalSource!.graph.nodes.some(node => node.key === row.clinicalClaimDerivedSource?.originNodeKey && node.resource.resourceType === 'Claim')).toBe(true)
  expect(row.clinicalClaimDerivedSource?.path).toBeTruthy()
 }
 client.clear()
})
it('keeps separate Claim source positions distinct even when source sequence/category labels repeat', () => {
 const data: any = bundle(['1'])
 const claim = data.entry.find((entry: any) => entry.resource.resourceType === 'Claim').resource
 claim.diagnosis[1].sequence = claim.diagnosis[0].sequence
 claim.procedure[1].sequence = claim.procedure[0].sequence
 claim.supportingInfo.push({ ...claim.supportingInfo[0], valueQuantity: { value: 61, code: 'kg' } })
 const collection = projectClinicalAggregate(LocalBundleService.parse(data)!.collection)
 for (const rows of [collection.conditions.filter(row => row.sourceVersionId), collection.procedures, collection.observations]) {
  expect(rows).toHaveLength(2)
  expect(new Set(rows.map(row => row.id)).size).toBe(2)
  expect(new Set(rows.map(row => row.clinicalClaimDerivedSource?.path)).size).toBe(2)
 }
})

it('does not trust source-supplied derived identity and preserves original target fields against Claim versions', () => {
 const data: any = bundle()
 const rawEncounter = data.entry.find((entry: any) => entry.resource.id === 'visit-1').resource
 rawEncounter.period = { start: '2025-01-01' }
 rawEncounter.subject = { reference: 'Patient/synthetic' }
 const rawPrescription = data.entry.find((entry: any) => entry.resource.resourceType === 'MedicationRequest').resource
 rawPrescription.clinicalClaimEncounterRelation = { state: 'unresolved' }
 rawPrescription.authoredOn = '2025-01-02'
 rawPrescription.encounter = { reference: 'Encounter/visit-1' }
 const rawCondition = data.entry.find((entry: any) => entry.resource.id === 'unrelated').resource
 rawCondition.clinicalClaimDerivedSource = { originNodeKey: 'forged', path: 'diagnosis[0]' }
 const collection = projectClinicalAggregate(LocalBundleService.parse(data)!.collection)
 expect(collection.conditions.find(row => row.id === 'unrelated')?.clinicalClaimDerivedSource).toBeUndefined()
 expect(collection.medications[0].authoredOn).toBe('2025-01-02')
 expect(collection.medications[0].clinicalClaimEncounterRelation).toBeUndefined()
 expect(collection.medications[0].encounter?.reference).toBe('Encounter/visit-1')
 expect(collection.encounters.find(row => row.id === 'visit-1')?.period?.start).toBe('2025-01-01')
})
it.each(['medication', 'encounter'])('does not infer a shared %s date from one known Claim while Claim revisions also participate', target => {
 for (const reverse of [false, true]) {
  const data: any = bundle()
  const known = { resourceType: 'Claim', id: 'independent-claim', patient: { reference: 'Patient/synthetic' }, created: '2026-09-03', extension: [{ url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter', valueReference: { reference: 'Encounter/visit-1' } }], item: [{ extension: [{ url: 'requestedService', valueReference: { reference: 'MedicationRequest/prescription' } }] }], procedure: [{ procedureCodeableConcept: { text: 'Independent claim procedure' } }] }
  data.entry.push({ resource: known })
  if (reverse) data.entry.reverse()
  const collection = projectClinicalAggregate(LocalBundleService.parse(data)!.collection)
  if (target === 'medication') expect(collection.medications[0].authoredOn).toBeUndefined()
  else expect(collection.encounters.find(row => row.id === 'visit-1')?.period?.start).toBeUndefined()
  expect(collection.medications[0].clinicalClaimEncounterRelation?.state).toBe('unresolved')
  expect(collection.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Claim')).toHaveLength(3)
  expect(collection.procedures).toHaveLength(5)
 }
})
it('preserves explicit shared-target dates when uncertain and known Claims coexist', () => {
 const data: any = bundle()
 data.entry.find((entry: any) => entry.resource.resourceType === 'MedicationRequest').resource.authoredOn = '2025-01-01'
 data.entry.find((entry: any) => entry.resource.id === 'visit-1').resource.period = { start: '2025-01-02' }
 const claim = { ...data.entry.find((entry: any) => entry.resource.resourceType === 'Claim').resource, id: 'independent-claim', meta: undefined, created: '2026-09-03' }
 data.entry.push({ resource: claim })
 const collection = projectClinicalAggregate(LocalBundleService.parse(data)!.collection)
 expect(collection.medications[0].authoredOn).toBe('2025-01-01')
 expect(collection.encounters.find(row => row.id === 'visit-1')?.period?.start).toBe('2025-01-02')
})
