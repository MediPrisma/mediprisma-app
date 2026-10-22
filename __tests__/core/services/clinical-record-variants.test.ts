import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalRecordVariants } from '@/src/core/services/clinical-record-variants'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

const resource = (value: number, versionId?: string) => ({ resourceType: 'Observation', id: 'lab', status: 'final', code: { text: 'Synthetic lab' }, valueQuantity: { value }, ...(versionId ? { meta: { versionId } } : {}) })
const capture = (generation: string, value: number, version?: string) => ({ sourceId: 'source', patientScope: 'patient', generation, resources: [{ fullUrl: 'https://one.invalid/Observation/lab', resource: resource(value, version) }] })

it('keeps the same variant group when versioned REST fullUrls arrive in reverse order', () => {
  const captures = ['1', '2'].map(version => ({ ...capture(version, Number(version), version), resources: [{ fullUrl: `https://one.invalid/Observation/lab/_history/${version}`, resource: resource(Number(version), version) }] }))
  const forward = [...createClinicalRecordVariants(reconcileClinicalSources(captures)).values()]
  const reverse = [...createClinicalRecordVariants(reconcileClinicalSources([...captures].reverse())).values()]
  expect(forward).toHaveLength(2)
  expect(new Set([...forward, ...reverse].map(item => item.groupId)).size).toBe(1)
})

it('carries one unresolved revision group without inventing chronological order', () => {
  const first = reconcileClinicalSources([capture('a', 7, '10'), capture('b', 9, '2'), capture('duplicate', 7, '10')])
  const annotations = [...createClinicalRecordVariants(first).values()]
  expect(annotations).toHaveLength(3)
  expect(new Set(annotations.map(value => value.groupId)).size).toBe(1)
  expect(annotations[0]).toEqual({ groupId: expect.any(String), classification: 'revision', variantCount: 2, reason: expect.stringContaining('chronological order is not established') })
  const refreshed = createClinicalRecordVariants(reconcileClinicalSources([capture('new-a', 7, '10'), capture('new-b', 9, '2')]))
  expect([...refreshed.values()][0].groupId).toBe(annotations[0].groupId)
})

it('marks conflicting payloads but does not group other sources or exact retransmissions', () => {
  expect([...createClinicalRecordVariants(reconcileClinicalSources([capture('a', 7), capture('b', 9)])).values()][0].classification).toBe('conflict')
  expect(createClinicalRecordVariants(reconcileClinicalSources([capture('a', 7), capture('b', 7)])).size).toBe(0)
  expect(createClinicalRecordVariants(reconcileClinicalSources([capture('a', 7), { ...capture('b', 9), sourceId: 'another-source' }])).size).toBe(0)
})

it('retains both local clinical rows with the same shared semantic annotation', () => {
  const bundle = { resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'patient' } },
    { resource: resource(7, '1') }, { resource: resource(9, '2') },
  ] }
  const observations = LocalBundleService.parse(bundle)!.collection.observations
  expect(observations).toHaveLength(1)
  expect([7,9]).toContain(observations[0].valueQuantity?.value)
  expect(observations[0].clinicalRecordVariant).toBeUndefined()
})

it('labels incompatible resolved reference contexts as conflicts of one source record', () => {
  const panel = { resourceType: 'Observation', id: 'panel', status: 'final', hasMember: [{ reference: 'Observation/lab' }] }
  const sources = [7, 9].map((value, index) => ({ sourceId: 'source', patientScope: 'patient', generation: String(index), resources: [resource(value), panel] }))
  const source = reconcileClinicalSources(sources)
  const variants = createClinicalRecordVariants(source)
  const panels = source.graph.nodes.filter(node => node.resource.id === 'panel')
  expect(panels).toHaveLength(2)
  expect(variants.get(panels[0].key)).toEqual(variants.get(panels[1].key))
  expect(variants.get(panels[0].key)).toMatchObject({ classification: 'conflict', variantCount: 2 })
})

it.each(['MedicationRequest', 'Condition', 'SyntheticUnknown'])('annotates evidence-backed %s variants without relying on Observation projection ids', (resourceType) => {
  const make = (generation: string, value: number, version: string) => ({
    sourceId: 'generic-source', patientScope: 'patient', generation,
    resources: [{
      resourceType, id: 'same-record', meta: { versionId: version }, valueInteger: value,
    }],
  })
  const source = reconcileClinicalSources([
    make('first-copy', 7, '1'), make('exact-repeat', 7, '1'), make('second-version', 9, '2'),
  ])
  const group = [...createClinicalRecordVariants(source).values()]
  expect(group).toHaveLength(3)
  expect(new Set(group.map(entry => entry.groupId)).size).toBe(1)
  expect(group.every(entry => entry.variantCount === 2 && entry.classification === 'revision')).toBe(true)
})

it('does not group generic resource variants from different sources', () => {
  const source = reconcileClinicalSources([
    { sourceId: 'source-a', patientScope: 'patient', generation: 'one', resources: [{ resourceType: 'MedicationRequest', id: 'rx', status: 'active', dosageInstruction: [{ text: 'once daily' }] }] },
    { sourceId: 'source-a', patientScope: 'patient', generation: 'two', resources: [{ resourceType: 'MedicationRequest', id: 'rx', status: 'active', dosageInstruction: [{ text: 'twice daily' }] }] },
    { sourceId: 'source-b', patientScope: 'patient', generation: 'three', resources: [{ resourceType: 'MedicationRequest', id: 'rx', status: 'active', dosageInstruction: [{ text: 'three times daily' }] }] },
  ])
  const variants = createClinicalRecordVariants(source)
  const sourceA = source.graph.nodes.filter(node => node.sourceId === 'source-a')
  const sourceB = source.graph.nodes.find(node => node.sourceId === 'source-b')!
  expect(sourceA.map(node => variants.get(node.key)?.groupId)).toEqual([expect.any(String), expect.any(String)])
  expect(variants.has(sourceB.key)).toBe(false)
  expect(variants.get(sourceA[0].key)?.variantCount).toBe(2)
})
