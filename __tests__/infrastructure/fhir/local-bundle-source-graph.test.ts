import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ClinicalDataCollectionService } from '@/src/core/services/clinical-data-collection.service'

const fixture = () => ({ resourceType: 'Bundle', type: 'collection', timestamp: '2026-10-21T01:00:00Z', entry: [
  { fullUrl: 'urn:uuid:patient', resource: { resourceType: 'Patient', id: 'patient', gender: 'female' } },
  { fullUrl: 'https://synthetic.invalid/fhir/ServiceRequest/order', resource: { resourceType: 'ServiceRequest', id: 'order', status: 'active', subject: { reference: 'urn:uuid:patient' } } },
  { resource: { resourceType: 'Observation', id: 'result', status: 'final', code: { text: 'synthetic test' }, valueQuantity: { value: 7, unit: 'mg' }, basedOn: [{ reference: 'https://synthetic.invalid/fhir/ServiceRequest/order' }] } },
  { resource: { resourceType: 'Provenance', id: 'audit', target: [{ reference: 'Observation/result' }], contained: [{ resourceType: 'Observation', id: 'snapshot', valueString: 'AUDIT_ONLY_SECRET' }], entity: [{ role: 'source', what: { reference: '#snapshot' } }] } },
  { resource: { resourceType: 'FutureClinicalType', id: 'future', custom: { nested: ['retain', 42] } } },
] })

it('retains all original source types/fullUrls before mapper rewrites and keeps audit snapshots out of clinical rows', () => {
  const bundle = fixture()
  const before = JSON.stringify(bundle)
  const collection = LocalBundleService.parse(bundle)!.collection
  const source = collection.clinicalSource!
  expect(source.graph.nodes.map(node => node.resource.resourceType)).toEqual(expect.arrayContaining(['Patient', 'ServiceRequest', 'Observation', 'Provenance', 'FutureClinicalType']))
  expect(source.graph.nodes.find(node => node.resource.id === 'order')?.fullUrl).toBe('https://synthetic.invalid/fhir/ServiceRequest/order')
  expect(source.graph.nodes.find(node => node.resource.id === 'result')?.resource.basedOn).toEqual([{ reference: 'https://synthetic.invalid/fhir/ServiceRequest/order' }])
  expect(collection.observations.map(row => row.id)).toEqual(['result'])
  expect(source.policies.FutureClinicalType.assessment).toBe('not-assessed')
  expect(JSON.stringify(bundle)).toBe(before)
  expect(JSON.stringify(collection)).not.toContain('AUDIT_ONLY_SECRET')
  expect(ClinicalDataCollectionService.toClinicalDataCollection(collection).clinicalSource).toBe(source)
})

it('preserves the capture generation in the shared result', () => {
  const first = LocalBundleService.parse(fixture(), undefined, 'capture-one')!.collection.clinicalSource!
  const second = LocalBundleService.parse(fixture(), undefined, 'capture-two')!.collection.clinicalSource!
  expect(first.graph.nodes.every(node => node.generation === 'capture-one')).toBe(true)
  expect(second.graph.nodes.every(node => node.generation === 'capture-two')).toBe(true)
  expect(first.graph.nodes[0].key).not.toBe(second.graph.nodes[0].key)
})

it('projects a proven same-source record once while retaining transmission evidence', () => {
  const bundle = fixture()
  bundle.entry.push(JSON.parse(JSON.stringify(bundle.entry[2])))
  const collection = LocalBundleService.parse(bundle)!.collection
  expect(collection.observations.map(row => row.id)).toEqual(['result'])
  expect(collection.clinicalSource!.graph.nodes.find(node => node.resource.id === 'result')?.occurrences).toBe(2)
  expect(collection.clinicalSource!.evidence.sameRecord).toHaveLength(1)
})

it('does not merge anonymous identical events or records with different fullUrls', () => {
  const bundle: any = fixture()
  const event = { resourceType: 'Observation', status: 'final', code: { text: 'synthetic anonymous event' }, valueString: 'same' }
  bundle.entry.push({ resource: event }, { resource: event })
  bundle.entry.push({ fullUrl: 'https://other.invalid/Observation/result', resource: bundle.entry[2].resource })
  const collection = LocalBundleService.parse(bundle)!.collection
  expect(collection.observations).toHaveLength(4)
})
