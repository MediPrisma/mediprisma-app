import { LocalBundleService, canonicalizeBundleResources } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { ClinicalDataCollectionService } from '@/src/core/services/clinical-data-collection.service'
import { attachReportObservations } from '@/src/core/services/clinical-report-membership'

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
  expect(collection.observations.map(row => row.sourceId)).toEqual(['result'])
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

it('keeps anonymous generated ids separate from explicit ids and preserves source joins through encounter enrichment', () => {
  const observation = { resourceType: 'Observation', status: 'final', code: { text: 'Synthetic lab' }, effectiveDateTime: '2026-10-21', valueQuantity: { value: 7 } }
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'patient' } },
    { resource: observation },
    { resource: { ...observation, id: 'Observation-1', valueQuantity: { value: 99 } } },
    { resource: { resourceType: 'Encounter', id: 'visit', status: 'finished', class: { code: 'AMB' }, period: { start: '2026-10-21' } } },
    { resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Synthetic report' }, effectiveDateTime: '2026-10-21', result: [{ reference: 'Observation/Observation-1' }] } },
  ] }
  const before = JSON.stringify(bundle)
  const collection = LocalBundleService.parse(bundle)!.collection
  expect(collection.observations).toHaveLength(2)
  expect(new Set(collection.observations.map(row => row.id)).size).toBe(2)
  expect(new Set(collection.observations.map(row => row.clinicalSourceNodeKey)).size).toBe(2)
  for (const row of collection.observations) {
    const node = collection.clinicalSource!.graph.nodes.find(item => item.key === row.clinicalSourceNodeKey)
    expect(node?.resource.valueQuantity).toEqual(row.valueQuantity)
    expect(row.encounter?.reference).toBe('Encounter/visit')
  }
  const report = collection.diagnosticReports[0]
  expect(report.clinicalSourceNodeKey).toBeDefined()
  expect(report._observations).toHaveLength(1)
  expect(report._observations?.[0].valueQuantity?.value).toBe(99)
  expect(report._observations?.[0].clinicalSourceNodeKey).toBe(collection.observations[1].clinicalSourceNodeKey)
  expect(JSON.stringify(bundle)).toBe(before)
})

it('projects a proven same-source record once while retaining transmission evidence', () => {
  const bundle = fixture()
  bundle.entry.push(JSON.parse(JSON.stringify(bundle.entry[2])))
  const collection = LocalBundleService.parse(bundle)!.collection
  expect(collection.observations.map(row => row.sourceId)).toEqual(['result'])
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

it('preserves distinct fullUrl identities in mapped rows and does not attach an ambiguous relative member', () => {
  const bundle: any = fixture()
  bundle.entry[2].fullUrl = 'https://one.invalid/Observation/result'
  bundle.entry.push({ fullUrl: 'https://two.invalid/Observation/result', resource: { ...bundle.entry[2].resource, valueQuantity: { value: 99, unit: 'mg' } } })
  bundle.entry.push({ resource: { resourceType: 'DiagnosticReport', id: 'ambiguous-report', status: 'final', code: { text: 'synthetic' }, result: [{ reference: 'Observation/result' }] } })
  bundle.entry.push({ resource: { resourceType: 'DiagnosticReport', id: 'exact-report', status: 'final', code: { text: 'synthetic' }, result: [{ reference: 'https://one.invalid/Observation/result' }] } })
  const collection = LocalBundleService.parse(bundle)!.collection
  expect(new Set(collection.observations.map(row => row.id)).size).toBe(2)
  expect((collection.diagnosticReports.find(row => row.sourceId === 'ambiguous-report') as any)?._observations ?? []).toHaveLength(0)
  expect((collection.diagnosticReports.find(row => row.sourceId === 'exact-report') as any)?._observations[0].valueQuantity.value).toBe(7)
})

it('uses the report origin base to preserve a legal relative member across colliding server ids', () => {
  const bundle: any = fixture()
  bundle.entry[2].fullUrl = 'https://one.invalid/Observation/result'
  bundle.entry.push({ fullUrl: 'https://two.invalid/Observation/result', resource: { ...bundle.entry[2].resource, valueQuantity: { value: 99, unit: 'mg' } } })
  bundle.entry.push({ fullUrl: 'https://one.invalid/DiagnosticReport/report', resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'synthetic' }, result: [{ reference: 'Observation/result' }] } })
  const report: any = LocalBundleService.parse(bundle)!.collection.diagnosticReports[0]
  expect(report._observations).toHaveLength(1)
  expect(report._observations[0].valueQuantity.value).toBe(7)
})

it.each([
  ['https://foreign.invalid/Medication/drug', false],
  ['https://one.invalid/Medication/drug/_history/2', false],
  ['https://one.invalid/Medication/drug/_history/1', true],
  ['https://one.invalid/Medication/drug', true],
])('promotes local medication only when its graph reference resolves: %s', (reference, resolved) => {
  const bundle: any = fixture()
  bundle.entry.push({ fullUrl: 'https://one.invalid/Medication/drug', resource: { resourceType: 'Medication', id: 'drug', meta: { versionId: '1' }, code: { text: 'Correct synthetic medication' } } })
  bundle.entry.push({ fullUrl: 'https://one.invalid/MedicationRequest/rx', resource: { resourceType: 'MedicationRequest', id: 'rx', status: 'active', intent: 'order', medicationReference: { reference }, subject: { reference: 'urn:uuid:patient' } } })
  const medication: any = LocalBundleService.parse(bundle)!.collection.medications[0]
  expect(medication.medicationCodeableConcept?.text).toBe(resolved ? 'Correct synthetic medication' : undefined)
})

it('retains nested history Bundle resources in the graph without adding current clinical events', () => {
  const bundle: any = fixture()
  bundle.entry.push({ resource: { resourceType: 'Bundle', id: 'history', type: 'history', entry: [
    { resource: { resourceType: 'Observation', id: 'historical-result', status: 'final', code: { text: 'Historical only' }, valueString: 'OLD' } },
    { resource: { resourceType: 'Patient', id: 'historical-patient', gender: 'male' } },
  ] } })
  const parsed = LocalBundleService.parse(bundle)!
  expect(parsed.patient.id).toBe('patient')
  expect(parsed.collection.observations.map(row => row.sourceId)).toEqual(['result'])
  expect(parsed.collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'historical-result')).toBe(true)
})

it('promotes mutable local medication code without mutating its immutable source', () => {
  const bundle: any = fixture()
  bundle.entry.push({ resource: { resourceType: 'Medication', id: 'drug', code: { coding: [{ system: 'synthetic', code: 'original' }] } } })
  bundle.entry.push({ resource: { resourceType: 'MedicationRequest', id: 'rx', status: 'active', intent: 'order', medicationReference: { reference: 'Medication/drug' } } })
  const collection = LocalBundleService.parse(bundle)!.collection
  const code = collection.medications[0].medicationCodeableConcept!
  expect(() => code.coding!.push({ system: 'synthetic', code: 'enrichment' })).not.toThrow()
  const source = collection.clinicalSource!.graph.nodes.find(node => node.resource.id === 'drug')!
  expect((source.resource.code as any).coding).toHaveLength(1)
  expect(Object.isFrozen((source.resource.code as any).coding)).toBe(true)
})

it('canonicalizes contained references and retains graph and explicit Roche derived members through the common read model', () => {
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { fullUrl: 'urn:uuid:patient-alias', resource: { resourceType: 'Patient', id: 'patient' } },
    { fullUrl: 'https://synthetic.invalid/fhir/Observation/member', resource: { resourceType: 'Observation', id: 'member', status: 'final', code: { text: 'member' }, valueString: 'member value' } },
    { resource: { resourceType: 'List', id: 'biomarkers', code: { text: 'Biomarkers' }, extension: [{ url: 'https://dip.roche.com/synthetic', valueBoolean: true }], contained: [
      { resourceType: 'Observation', id: 'biomarker', status: 'final', code: { text: 'marker' }, valueString: 'marker value', subject: { reference: 'urn:uuid:patient-alias' }, hasMember: [{ reference: 'https://synthetic.invalid/fhir/Observation/member' }] },
    ] } },
    { resource: { resourceType: 'DiagnosticReport', id: 'pathology', status: 'final', code: { text: 'Pathology' }, result: [{ reference: '#histology' }], contained: [
      { resourceType: 'Observation', id: 'histology', status: 'final', code: { text: 'histology' }, valueString: 'histology value', subject: { reference: 'urn:uuid:patient-alias' } },
    ] } },
  ] }
  const before = JSON.stringify(bundle)
  const collection = LocalBundleService.parse(bundle)!.collection
  const biomarker = collection.observations.find(row => row.sourceId === 'biomarker')!
  const canonical = canonicalizeBundleResources(bundle, collection.clinicalSource)
  const contained = canonical.find(resource => resource.id === 'biomarkers').contained[0]
  expect(contained.subject.reference).toBe('Patient/patient')
  expect(contained.hasMember).toEqual([{ reference: 'Observation/' + collection.observations.find(row => row.sourceId === 'member')!.id }])
  expect(biomarker.clinicalSourceNodeKey).toBeDefined()
  const reports = attachReportObservations(collection.diagnosticReports, collection.observations, collection.clinicalSource)
  expect(reports[0]._observations?.map(row => row.valueString)).toEqual(['histology value', 'marker value', 'member value'])
  expect(reports[0]._observations?.every(row => collection.observations.includes(row))).toBe(true)
  expect(JSON.stringify(bundle)).toBe(before)
})
