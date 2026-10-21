import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalRecordVariants } from '@/src/core/services/clinical-record-variants'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

const resource = (value: number, versionId?: string) => ({ resourceType: 'Observation', id: 'lab', status: 'final', code: { text: 'Synthetic lab' }, valueQuantity: { value }, ...(versionId ? { meta: { versionId } } : {}) })
const capture = (generation: string, value: number, version?: string) => ({ sourceId: 'source', patientScope: 'patient', generation, resources: [{ fullUrl: 'https://one.invalid/Observation/lab', resource: resource(value, version) }] })

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
  expect(observations.map(row => row.valueQuantity?.value)).toEqual([7, 9])
  expect(new Set(observations.map(row => row.id)).size).toBe(2)
  expect(observations[0].clinicalRecordVariant).toBe(observations[1].clinicalRecordVariant)
  expect(observations[0].clinicalRecordVariant?.variantCount).toBe(2)
})
