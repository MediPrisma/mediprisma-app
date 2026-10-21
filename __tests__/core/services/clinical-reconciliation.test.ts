import { reconcileClinicalSources, selectClinicalSourceResources } from '@/src/core/services/clinical-reconciliation'
import { getClinicalSourceNodePatientExclusionReason } from '@/src/core/services/clinical-patient-scope'

const capture = (generation: string, resources: any[], sourceId = 'hospital-a', patientScope = 'synthetic') => ({ sourceId, patientScope, generation, resources })

describe('conservative clinical reconciliation', () => {
  it('keeps revisions and conflicting payloads separate from repeated records', () => {
    const resource = { resourceType: 'Observation', id: 'lab', meta: { versionId: '1' }, valueString: 'A' }
    const result = reconcileClinicalSources([
      capture('1', [resource]), capture('2', [resource]),
      capture('3', [{ ...resource, meta: { versionId: '2' }, valueString: 'B' }]),
      capture('4', [{ ...resource, valueString: 'conflict' }]),
    ])
    expect(result.graph.nodes).toHaveLength(4)
    expect(result.evidence.sameRecord).toHaveLength(1)
    expect(result.evidence.revision.length).toBeGreaterThan(0)
    expect(result.evidence.conflict.length).toBeGreaterThan(0)
    expect(result.evidence.candidate).toEqual([])
  })

  it('retains unknown types, snapshots and partial captures without merging matching values or deleting absent records', () => {
    const result = reconcileClinicalSources([
      capture('1', [{ resourceType: 'UnknownClinicalType', id: 'x' }, { resourceType: 'Observation', id: 'a', valueString: 'same' }]),
      capture('2', [{ resourceType: 'Observation', id: 'b', valueString: 'same' }]),
      capture('3', []),
    ])
    expect(result.graph.nodes).toHaveLength(3)
    expect(result.policies.UnknownClinicalType.assessment).toBe('not-assessed')
    expect(result.evidence).toEqual({ sameRecord: [], revision: [], candidate: [], conflict: [] })
  })

  it('never correlates logical ids across patient or source scopes', () => {
    const resource = { resourceType: 'Observation', id: 'shared' }
    const result = reconcileClinicalSources([capture('1', [resource]), capture('1', [resource], 'hospital-b'), capture('1', [resource], 'hospital-a', 'other-patient')])
    expect(result.graph.nodes).toHaveLength(3)
    expect(result.evidence.sameRecord).toEqual([])
  })
})

it('projects identical transmissions once and excludes raw source snapshots from JSON', () => {
  const raw = { resourceType: 'Observation', id: 'repeat', extension: [{ url: 'audit', valueString: 'snapshot-private-marker' }] }
  const model = reconcileClinicalSources([capture('1', [{ resource: raw, fullUrl: 'urn:uuid:repeat' }]), capture('2', [{ resource: raw, fullUrl: 'urn:uuid:repeat' }])])
  expect(selectClinicalSourceResources(model)).toHaveLength(1)
  expect(model.graph.nodes).toHaveLength(2)
  expect(model.evidence.sameRecord).toHaveLength(1)
  expect(JSON.stringify(model)).not.toContain('snapshot-private-marker')
  expect(JSON.stringify(model)).toContain('fingerprint')
})


it('preserves identical anonymous events without treating them as retransmissions', () => {
  const event = { resourceType: 'Procedure', status: 'completed', code: { text: 'synthetic procedure' } }
  const model = reconcileClinicalSources([capture('1', [event, event]), capture('2', [event])])
  expect(selectClinicalSourceResources(model)).toHaveLength(3)
  expect(model.evidence.sameRecord).toEqual([])
})

it('does not correlate contained ids owned by different parents', () => {
  const model = reconcileClinicalSources([capture('1', [
    { resourceType: 'DiagnosticReport', id: 'one', contained: [{ resourceType: 'Observation', id: 'same', valueString: 'one' }] },
    { resourceType: 'DiagnosticReport', id: 'two', contained: [{ resourceType: 'Observation', id: 'same', valueString: 'two' }] },
  ])])
  expect(model.evidence.sameRecord).toEqual([])
  expect(model.evidence.conflict).toEqual([])
  expect(selectClinicalSourceResources(model)).toHaveLength(2)
})

it('does not treat records from distinct REST bases as the same source identity', () => {
  const resource = { resourceType: 'Observation', id: 'collision' }
  const model = reconcileClinicalSources([
    { ...capture('1', [resource]), restBase: 'https://one.example/fhir' },
    { ...capture('2', [resource]), restBase: 'https://two.example/fhir' },
  ])
  expect(selectClinicalSourceResources(model)).toHaveLength(2)
  expect(model.evidence.sameRecord).toEqual([])
})

it('excludes only explicit subject contradictions and retains foreign nodes in the source graph', () => {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'a', generation: 'query', restBase: 'https://ehr.example/fhir', resources: [
      { resource: { resourceType: 'Patient', id: 'a' }, fullUrl: 'urn:uuid:patient-a' },
      { resource: { resourceType: 'Patient', id: 'b' }, fullUrl: 'urn:uuid:patient-b' },
      { resourceType: 'Observation', id: 'relative-foreign', subject: { reference: 'Patient/b' } },
      { resourceType: 'Observation', id: 'urn-foreign', subject: { reference: 'urn:uuid:patient-b' } },
      { resourceType: 'Observation', id: 'other-server', subject: { reference: 'https://other.example/fhir/Patient/a' } },
      { resourceType: 'Observation', id: 'normalized-server', subject: { reference: 'https://EHR.example:443/fhir/Patient/a' } },
      { resourceType: 'Observation', id: 'different-scheme', subject: { reference: 'http://ehr.example/fhir/Patient/a' } },
      { resourceType: 'Observation', id: 'matching', subject: { reference: 'urn:uuid:patient-a' } },
      { resourceType: 'Observation', id: 'missing-subject' },
    ],
  }])
  expect(source.graph.nodes.map(node => node.resource.id)).toContain('urn-foreign')
  expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual(['a', 'normalized-server', 'matching', 'missing-subject'])

  const unknownBase = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'a', generation: 'unknown-base', resources: [
      { resourceType: 'Observation', id: 'same-id-unknown-base', subject: { reference: 'https://unknown.example/fhir/Patient/a' } },
      { resourceType: 'Observation', id: 'unknown-urn', subject: { reference: 'urn:uuid:unresolved' } },
    ],
  }])
  expect(selectClinicalSourceResources(unknownBase).map(resource => resource.id)).toEqual(['same-id-unknown-base', 'unknown-urn'])
})

it('does not let a same-id Patient from another host expand an authenticated REST base', () => {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'a', generation: 'foreign-patient-host', restBase: 'https://a.example/fhir', resources: [
      { resource: { resourceType: 'Patient', id: 'a' }, fullUrl: 'https://b.example/fhir/Patient/a' },
      { resource: { resourceType: 'Observation', id: 'foreign-host', subject: { reference: 'https://b.example/fhir/Patient/a' } } },
      { resource: { resourceType: 'Patient', id: 'a' }, fullUrl: 'https://a.example/fhir/Patient/a' },
      { resource: { resourceType: 'Observation', id: 'legal', subject: { reference: 'https://a.example/fhir/Patient/a' } } },
    ],
  }])
  expect(source.graph.nodes.map(node => node.resource.id)).toEqual(['a', 'foreign-host', 'a', 'legal'])
  expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual(['a', 'legal'])
})

it('quarantines uniquely resolved contained Patient references without treating local ids as global', () => {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'a', generation: 'contained-patients', restBase: 'https://ehr.example/fhir', resources: [
      { resourceType: 'Observation', id: 'contained-foreign', subject: { reference: '#foreign' }, contained: [{ resourceType: 'Patient', id: 'foreign' }] },
      { resourceType: 'Observation', id: 'contained-local-match', subject: { reference: '#local' }, contained: [{ resourceType: 'Patient', id: 'local' }] },
      { resourceType: 'Observation', id: 'ambiguous', subject: { reference: '#duplicate' }, contained: [
        { resourceType: 'Patient', id: 'duplicate', name: [{ text: 'candidate one' }] },
        { resourceType: 'Patient', id: 'duplicate', name: [{ text: 'candidate two' }] },
      ] },
      { resourceType: 'Observation', id: 'unknown', subject: { reference: '#missing' } },
    ],
  }])
  const graph = source.graph
  const byId = (id: string) => graph.nodes.find(node => node.resource.id === id && node.resource.resourceType === 'Observation')!
  const edgeFor = (id: string) => graph.references.find(edge => edge.origin.key === byId(id).key && edge.path === 'subject')

  expect(edgeFor('contained-foreign')?.status).toBe('resolved')
  expect(edgeFor('contained-local-match')?.status).toBe('resolved')
  expect(edgeFor('ambiguous')?.status).toBe('ambiguous')
  expect(edgeFor('unknown')?.status).toBe('unresolved')
  expect(getClinicalSourceNodePatientExclusionReason(byId('contained-foreign'), graph.nodes)).toBe('unresolved-patient-reference')
  expect(getClinicalSourceNodePatientExclusionReason(byId('contained-local-match'), graph.nodes)).toBe('unresolved-patient-reference')
  expect(getClinicalSourceNodePatientExclusionReason(byId('ambiguous'), graph.nodes)).toBeUndefined()
  expect(getClinicalSourceNodePatientExclusionReason(byId('unknown'), graph.nodes)).toBeUndefined()
  expect(graph.nodes.some(node => node.resource.id === 'foreign' && node.isContained)).toBe(true)
  expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual(['ambiguous', 'unknown'])
})

it('marks logical Patient references unresolved when a URN scope has no verified Patient id', () => {
  const source = reconcileClinicalSources([{
    sourceId: 'ehr', patientScope: 'urn:uuid:active-patient', generation: 'urn-scope-without-id', restBase: 'https://ehr.example/fhir', resources: [
      { resource: { resourceType: 'Patient' }, fullUrl: 'urn:uuid:active-patient' },
      { resourceType: 'Observation', id: 'unverified-logical-patient', subject: { reference: 'Patient/other' } },
      { resourceType: 'Observation', id: 'unknown-urn-patient', subject: { reference: 'urn:uuid:not-in-graph' } },
    ],
  }])
  const logical = source.graph.nodes.find(node => node.resource.id === 'unverified-logical-patient')!
  expect(getClinicalSourceNodePatientExclusionReason(logical, source.graph.nodes)).toBe('unresolved-patient-reference')
  expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual([undefined, 'unknown-urn-patient'])
})

it('uses a compact signature that includes empty-capture generations', () => {
  const first = JSON.stringify(reconcileClinicalSources([capture('1', [])]))
  const second = JSON.stringify(reconcileClinicalSources([capture('2', [])]))
  expect(first).not.toEqual(second)
  expect(first.length).toBeLessThan(120)
})

it('freezes all shared policy and evidence structures', () => {
  const resource = { resourceType: 'Observation', id: 'immutable' }
  const model = reconcileClinicalSources([capture('1', [resource]), capture('2', [resource])])
  expect(Object.isFrozen(model)).toBe(true)
  expect(Object.isFrozen(model.policies)).toBe(true)
  expect(Object.isFrozen(model.policies.Observation)).toBe(true)
  expect(Object.isFrozen(model.evidence)).toBe(true)
  expect(Object.isFrozen(model.evidence.sameRecord)).toBe(true)
  expect(Object.isFrozen(model.evidence.sameRecord[0])).toBe(true)
  expect(Object.isFrozen(model.evidence.sameRecord[0].nodeKeys)).toBe(true)
})

it('retains nested audit Bundle resources only in the source graph', () => {
  const model = reconcileClinicalSources([capture('nested', [{ resourceType: 'Bundle', id: 'audit', type: 'history', entry: [{ resource: { resourceType: 'Observation', id: 'snapshot' } }] }])])
  expect(model.graph.nodes.some(node => node.resource.id === 'snapshot')).toBe(true)
  expect(selectClinicalSourceResources(model).map(resource => resource.resourceType)).toEqual(['Bundle'])
})

it('preserves large source payloads while projecting only proven identical transmissions once', () => {
  const payload = 'A'.repeat(2 * 1024 * 1024)
  const original = { resourceType: 'DocumentReference', id: 'large', content: [{ attachment: { contentType: 'application/pdf', data: payload } }] }
  const different = { ...original, content: [{ attachment: { contentType: 'application/pdf', data: payload.slice(0, -1) + 'B' } }] }
  const model = reconcileClinicalSources([capture('large-1', [original, original]), capture('large-2', [original]), capture('large-3', [different])])
  expect(model.graph.nodes.reduce((count, node) => count + node.occurrences, 0)).toBe(4)
  expect(selectClinicalSourceResources(model)).toHaveLength(2)
  expect(model.evidence.sameRecord).toHaveLength(2)
  expect(model.evidence.conflict).toHaveLength(2)
  expect((selectClinicalSourceResources(model)[0].content as any)[0].attachment.data).toBe(payload)
})
