import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'

const source = (generation: string, resources: any[], sourceId = 'ehr', patientScope = 'patient') => ({
  sourceId, patientScope, generation, restBase: 'https://ehr.example/fhir', resources,
})

it('assigns generic projection IDs only to distinct mapped records sharing a UI id namespace', () => {
  const model = reconcileClinicalSources([
    source('one', [
      { resourceType: 'Condition', id: 'shared', code: { text: 'first' } },
      { resourceType: 'Condition', id: 'solo', code: { text: 'unchanged' } },
      { resourceType: 'MedicationRequest', id: 'med', status: 'active' },
      { resourceType: 'MedicationStatement', id: 'med', status: 'active' },
      { resourceType: 'Patient', id: 'patient' },
      { resourceType: 'SyntheticUnknown', id: 'shared' },
      { resourceType: 'Observation', id: 'observation' },
      { resourceType: 'DiagnosticReport', id: 'report' },
    ]),
    source('two', [
      { resourceType: 'Condition', id: 'shared', code: { text: 'second' } },
    ]),
  ])
  const ids = createClinicalSourceProjectionIds(model)
  const idFor = (resourceType: string, id: string, generation?: string) => {
    const node = model.graph.nodes.find(item => item.resource.resourceType === resourceType && item.resource.id === id && (!generation || item.generation === generation))!
    return ids.get(node.key) ?? node.resource.id
  }

  expect(idFor('Condition', 'shared', 'one')).not.toBe(idFor('Condition', 'shared', 'two'))
  expect(idFor('Condition', 'shared', 'one')).toMatch(/^cs[A-Za-z0-9.-]+$/)
  expect(ids.has(model.graph.nodes.find(node => node.resource.resourceType === 'Condition' && node.resource.id === 'solo')!.key)).toBe(false)
  expect(idFor('MedicationRequest', 'med')).not.toBe(idFor('MedicationStatement', 'med'))
  expect(ids.has(model.graph.nodes.find(node => node.resource.resourceType === 'Patient')!.key)).toBe(false)
  expect(ids.has(model.graph.nodes.find(node => node.resource.resourceType === 'SyntheticUnknown')!.key)).toBe(false)
  expect(idFor('Observation', 'observation')).toMatch(/^cs/)
  expect(idFor('DiagnosticReport', 'report')).toMatch(/^cs/)
})

it('keeps exact generic retransmissions on the legacy ID and separates source, version, and resolved-context collisions', () => {
  const exact = { resourceType: 'Condition', id: 'exact', code: { text: 'same' } }
  const sameId = (generation: string, version: string, encounterStatus: string) => source(generation, [
    { resourceType: 'Encounter', id: 'visit', meta: { versionId: version }, status: encounterStatus },
    { resourceType: 'Condition', id: 'context', encounter: { reference: 'Encounter/visit' }, code: { text: 'same' } },
  ])
  const model = reconcileClinicalSources([
    source('copy-one', [exact]),
    source('copy-two', [exact]),
    source('version-one', [{ resourceType: 'Condition', id: 'versioned', meta: { versionId: '1' }, code: { text: 'first' } }]),
    source('version-two', [{ resourceType: 'Condition', id: 'versioned', meta: { versionId: '2' }, code: { text: 'second' } }]),
    sameId('context-one', '1', 'in-progress'),
    sameId('context-two', '2', 'finished'),
    source('foreign-source', [{ resourceType: 'Condition', id: 'source-shared', code: { text: 'source' } }], 'other-ehr'),
    source('local-source', [{ resourceType: 'Condition', id: 'source-shared', code: { text: 'source' } }]),
  ])
  const ids = createClinicalSourceProjectionIds(model)
  const nodes = (id: string) => model.graph.nodes.filter(node => node.resource.resourceType === 'Condition' && node.resource.id === id)
  const exactNodes = nodes('exact')
  expect(exactNodes).toHaveLength(2)
  expect(exactNodes.map(node => ids.get(node.key) ?? node.resource.id)).toEqual(['exact', 'exact'])
  for (const id of ['versioned', 'context', 'source-shared']) {
    const values = nodes(id).map(node => ids.get(node.key) ?? node.resource.id)
    expect(new Set(values).size).toBe(2)
    expect(values.every(value => typeof value === 'string' && value.startsWith('cs'))).toBe(true)
  }
})

it('throws when a forced content-hash collision hides different generic resources with the same identity', () => {
  const model = reconcileClinicalSources([source('one', [
    { resourceType: 'Condition', id: 'collision', code: { text: 'first' } },
    { resourceType: 'Condition', id: 'collision', code: { text: 'second' } },
  ])])
  const collisionGraph = {
    ...model.graph,
    nodes: model.graph.nodes.map(node => ({ ...node, contentHash: 'forced-content-hash' })),
  }

  expect(() => createClinicalSourceProjectionIds({ ...model, graph: collisionGraph } as any)).toThrow(/matching generic identity metadata has different resources/)
})

it('preserves collision IDs when supporting patient references resolve later', () => {
  const records = source('records', [
    { resource: { resourceType: 'Condition', id: 'shared', subject: { reference: 'Patient/patient' }, code: { text: 'one' } }, fullUrl: 'urn:uuid:first' },
    { resource: { resourceType: 'Condition', id: 'shared', subject: { reference: 'Patient/patient' }, code: { text: 'two' } }, fullUrl: 'urn:uuid:second' },
  ])
  const before = reconcileClinicalSources([records])
  const after = reconcileClinicalSources([records, source('patient', [{ resourceType: 'Patient', id: 'patient' }])])
  const rowIds = (model: typeof before) => {
    const ids = createClinicalSourceProjectionIds(model)
    return model.graph.nodes.filter(node => node.resource.resourceType === 'Condition').map(node => ids.get(node.key))
  }
  expect(new Set(rowIds(before)).size).toBe(2)
  expect(rowIds(after)).toEqual(rowIds(before))
})
