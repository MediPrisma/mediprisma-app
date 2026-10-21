import { reconcileClinicalSources } from '../clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '../clinical-source-projection'
import { selectClinicalSourceNodes } from '../clinical-reconciliation'
import type { ClinicalReconciliationResult } from '../clinical-reconciliation'

const scope = { sourceId: 'ehr-source', patientScope: 'patient-1', restBase: 'https://ehr.example/fhir' }

describe('createClinicalSourceProjectionIds', () => {
  it('assigns the same ID to exact copies across query generations without putting generation in the ID', () => {
    const resource = { resourceType: 'Observation', id: 'o-1', meta: { versionId: '3' }, valueQuantity: { value: 7 } }
    const source = reconcileClinicalSources([
      { ...scope, generation: 'query-1', resources: [{ resource, fullUrl: 'https://ehr.example/fhir/Observation/o-1' }] },
      { ...scope, generation: 'query-2', resources: [{ resource: { ...resource, valueQuantity: { value: 7 } }, fullUrl: 'https://ehr.example/fhir/Observation/o-1' }] },
    ])
    const ids = createClinicalSourceProjectionIds(source)
    const nodes = source.graph.nodes.filter((node) => node.resource.resourceType === 'Observation')
    expect(nodes).toHaveLength(2)
    expect(ids.get(nodes[0].key)).toBe(ids.get(nodes[1].key))
    expect(ids.get(nodes[0].key)).toMatch(/^[A-Za-z0-9.-]{1,64}$/)
  })

  it('separates versions, payload revisions, and distinct fullUrls', () => {
    const source = reconcileClinicalSources([{
      ...scope,
      generation: 'query',
      resources: [
        { resource: { resourceType: 'Observation', id: 'same', meta: { versionId: '1' }, valueInteger: 1 }, fullUrl: 'https://ehr.example/fhir/Observation/same' },
        { resource: { resourceType: 'Observation', id: 'same', meta: { versionId: '2' }, valueInteger: 1 }, fullUrl: 'https://ehr.example/fhir/Observation/same' },
        { resource: { resourceType: 'Observation', id: 'same', meta: { versionId: '1' }, valueInteger: 2 }, fullUrl: 'https://ehr.example/fhir/Observation/same' },
        { resource: { resourceType: 'Observation', id: 'same', meta: { versionId: '1' }, valueInteger: 1 }, fullUrl: 'urn:uuid:other-copy' },
      ],
    }])
    const nodes = source.graph.nodes.filter((node) => node.resource.resourceType === 'Observation')
    const ids = createClinicalSourceProjectionIds(source)
    expect(new Set(nodes.map((node) => ids.get(node.key))).size).toBe(4)
  })

  it('uses stable parent identity for contained resources and includes them in the result map', () => {
    const capture = (generation: string) => ({
      ...scope,
      generation,
      resources: [
        { resourceType: 'List', id: 'a', contained: [{ resourceType: 'Observation', id: 'member', valueInteger: 1 }] },
        { resourceType: 'List', id: 'b', contained: [{ resourceType: 'Observation', id: 'member', valueInteger: 1 }] },
      ],
    })
    const source = reconcileClinicalSources([capture('one'), capture('two')])
    const ids = createClinicalSourceProjectionIds(source)
    const contained = source.graph.nodes.filter((node) => node.isContained && node.resource.resourceType === 'Observation')
    expect(contained).toHaveLength(4)
    expect(ids.get(contained[0].key)).toBe(ids.get(contained[2].key))
    expect(ids.get(contained[1].key)).toBe(ids.get(contained[3].key))
    expect(ids.get(contained[0].key)).not.toBe(ids.get(contained[1].key))
  })

  it('retains identical anonymous event occurrences with deterministic IDs for repeated input', () => {
    const capture = { ...scope, generation: 'query', resources: [
      { resourceType: 'Observation', status: 'final', valueInteger: 4 },
      { resourceType: 'Observation', status: 'final', valueInteger: 4 },
    ] }
    const source = reconcileClinicalSources([capture])
    const first = createClinicalSourceProjectionIds(source)
    const second = createClinicalSourceProjectionIds(reconcileClinicalSources([capture]))
    const nodes = source.graph.nodes.filter((node) => node.resource.resourceType === 'Observation')
    expect(nodes).toHaveLength(2)
    expect(first.get(nodes[0].key)).not.toBe(first.get(nodes[1].key))
    expect(nodes.map((node) => first.get(node.key))).toEqual(nodes.map((node) => second.get(node.key)))
  })

  it('keeps anonymous events from independent captures distinct in separate and combined projections', () => {
    const event = { resourceType: 'Observation', status: 'final', valueInteger: 4 }
    const firstCapture = { ...scope, generation: 'query-capture', resources: [event] }
    const secondCapture = { ...scope, generation: 'include-capture', resources: [event] }
    const firstSource = reconcileClinicalSources([firstCapture])
    const secondSource = reconcileClinicalSources([secondCapture])
    const firstNode = firstSource.graph.nodes.find((node) => node.resource.resourceType === 'Observation')!
    const secondNode = secondSource.graph.nodes.find((node) => node.resource.resourceType === 'Observation')!
    const firstId = createClinicalSourceProjectionIds(firstSource).get(firstNode.key)
    const secondId = createClinicalSourceProjectionIds(secondSource).get(secondNode.key)
    expect(firstId).not.toBe(secondId)

    const combined = reconcileClinicalSources([firstCapture, secondCapture])
    const combinedIds = createClinicalSourceProjectionIds(combined)
    const combinedNodes = combined.graph.nodes.filter((node) => node.resource.resourceType === 'Observation')
    expect(combinedNodes).toHaveLength(2)
    expect(combinedIds.get(combinedNodes[0].key)).not.toBe(combinedIds.get(combinedNodes[1].key))
  })

  it('keeps contained children under anonymous parents capture-scoped', () => {
    const capture = (generation: string) => ({
      ...scope,
      generation,
      resources: [{ resourceType: 'List', contained: [{ resourceType: 'Observation', id: 'member', valueInteger: 1 }] }],
    })
    const source = reconcileClinicalSources([capture('one'), capture('two')])
    const ids = createClinicalSourceProjectionIds(source)
    const children = source.graph.nodes.filter((node) => node.isContained && node.resource.resourceType === 'Observation')
    expect(children).toHaveLength(2)
    expect(ids.get(children[0].key)).not.toBe(ids.get(children[1].key))
  })

  it('throws instead of silently reusing an ID when content hashes collide', () => {
    const source = reconcileClinicalSources([{
      ...scope,
      generation: 'query',
      resources: [
        { resourceType: 'DiagnosticReport', id: 'r', status: 'final', conclusion: 'first' },
        { resourceType: 'DiagnosticReport', id: 'r', status: 'final', conclusion: 'second' },
      ],
    }])
    const collided = {
      ...source,
      graph: {
        ...source.graph,
        nodes: source.graph.nodes.map((node) => ({ ...node, contentHash: 'forced-collision' })),
      },
    } as unknown as ClinicalReconciliationResult
    expect(() => createClinicalSourceProjectionIds(collided)).toThrow(/hash collision/i)
  })

  it('checks parent payload equality when parent content hashes collide', () => {
    const source = reconcileClinicalSources([{
      ...scope,
      generation: 'query',
      resources: [
        { resourceType: 'List', id: 'list', note: [{ text: 'first' }], contained: [{ resourceType: 'Observation', id: 'member', valueInteger: 1 }] },
        { resourceType: 'List', id: 'list', note: [{ text: 'second' }], contained: [{ resourceType: 'Observation', id: 'member', valueInteger: 1 }] },
      ],
    }])
    const collided = {
      ...source,
      graph: {
        ...source.graph,
        nodes: source.graph.nodes.map((node) => node.resource.resourceType === 'List'
          ? { ...node, contentHash: 'forced-parent-collision' }
          : node),
      },
    } as unknown as ClinicalReconciliationResult
    expect(() => createClinicalSourceProjectionIds(collided)).toThrow(/parent identity metadata has different resources/i)
  })

  it('returns only Observation and DiagnosticReport node keys', () => {
    const source = reconcileClinicalSources([{
      ...scope,
      generation: 'query',
      resources: [
        { resourceType: 'Patient', id: 'p' },
        { resourceType: 'Observation', id: 'o', valueString: 'x' },
        { resourceType: 'DiagnosticReport', id: 'r' },
      ],
    }])
    const ids = createClinicalSourceProjectionIds(source)
    expect(ids.size).toBe(2)
    expect([...ids.keys()].every((key) => ['Observation', 'DiagnosticReport'].includes(source.graph.nodes.find((node) => node.key === key)!.resource.resourceType))).toBe(true)
  })

  it('keeps identical panels distinct when their resolved members differ across captures', () => {
    const capture = (generation: string, value: number) => ({
      ...scope,
      generation,
      resources: [
        { resourceType: 'Observation', id: 'panel', hasMember: [{ reference: 'Observation/leaf' }] },
        { resourceType: 'Observation', id: 'leaf', valueInteger: value },
        { resourceType: 'DiagnosticReport', id: `report-${generation}`, result: [{ reference: 'Observation/panel' }] },
      ],
    })
    const source = reconcileClinicalSources([capture('capture-a', 7), capture('capture-b', 9)])
    const panels = source.graph.nodes.filter((node) => node.resource.id === 'panel')
    expect(panels).toHaveLength(2)
    expect(selectClinicalSourceNodes(source).filter((node) => node.resource.id === 'panel')).toHaveLength(2)
    const ids = createClinicalSourceProjectionIds(source)
    expect(ids.get(panels[0].key)).not.toBe(ids.get(panels[1].key))
    expect(source.evidence.sameRecord.some((item) => item.nodeKeys.every((key) => panels.some((panel) => panel.key === key)))).toBe(false)
  })

  it('merges identical resolved context across generations and terminates on reference cycles', () => {
    const capture = (generation: string) => ({
      ...scope,
      generation,
      resources: [
        { resourceType: 'Observation', id: 'panel', hasMember: [{ reference: 'Observation/leaf' }] },
        { resourceType: 'Observation', id: 'leaf', valueInteger: 7, hasMember: [{ reference: 'Observation/panel' }] },
      ],
    })
    const source = reconcileClinicalSources([capture('capture-a'), capture('capture-b')])
    const panels = source.graph.nodes.filter((node) => node.resource.id === 'panel')
    expect(selectClinicalSourceNodes(source).filter((node) => node.resource.id === 'panel')).toHaveLength(1)
    const ids = createClinicalSourceProjectionIds(source)
    expect(ids.get(panels[0].key)).toBe(ids.get(panels[1].key))
    const reversed = { ...source, graph: { ...source.graph, nodes: [...source.graph.nodes].reverse() } } as typeof source
    const reversedIds = createClinicalSourceProjectionIds(reversed)
    expect(panels.map((node) => ids.get(node.key))).toEqual(panels.map((node) => reversedIds.get(node.key)))
  })

  it('treats multiple equivalent resolved transmission targets as one context target', () => {
    const origin = { resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: 'Observation/leaf' }] }
    const leaf = { resourceType: 'Observation', id: 'leaf', valueInteger: 7 }
    const single = reconcileClinicalSources([
      { ...scope, generation: 'origin', resources: [origin] },
      { ...scope, generation: 'leaf-copy-a', resources: [leaf] },
    ])
    const repeated = reconcileClinicalSources([
      { ...scope, generation: 'origin', resources: [origin] },
      { ...scope, generation: 'leaf-copy-a', resources: [leaf] },
      { ...scope, generation: 'leaf-copy-b', resources: [leaf] },
    ])
    const singleReport = single.graph.nodes.find((node) => node.resource.resourceType === 'DiagnosticReport')!
    const repeatedReport = repeated.graph.nodes.find((node) => node.resource.resourceType === 'DiagnosticReport')!
    expect(repeated.graph.references.find((edge) => edge.origin.key === repeatedReport.key)?.targetKeys).toHaveLength(2)
    expect(createClinicalSourceProjectionIds(single).get(singleReport.key)).toBe(
      createClinicalSourceProjectionIds(repeated).get(repeatedReport.key),
    )
  })
})
