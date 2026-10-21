import { reconcileClinicalSources, selectClinicalSourceResources } from '@/src/core/services/clinical-reconciliation'

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
