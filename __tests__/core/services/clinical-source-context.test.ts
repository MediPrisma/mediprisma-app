import { buildClinicalSourceGraph, type FhirSourceResource } from '@/src/core/services/clinical-source-graph'
import { clinicalSourceContextIdentity } from '@/src/core/services/clinical-source-context'

let restIdentityCalls = 0
jest.mock('@/src/core/services/clinical-source-rest-identity', () => {
  const actual = jest.requireActual('@/src/core/services/clinical-source-rest-identity')
  return {
    ...actual,
    clinicalSourceRestIdentity: (...args: Parameters<typeof actual.clinicalSourceRestIdentity>) => {
      restIdentityCalls += 1
      return actual.clinicalSourceRestIdentity(...args)
    },
  }
})

/** The 雲端病歷 shape: each prescription points at its group (Basic) and the
 * group points back at every prescription in it, so each group is a cycle. */
function groupedPrescriptions(groups: number, perGroup: number) {
  const resources: FhirSourceResource[] = [{ resourceType: 'Patient', id: 'pt-1' }]
  for (let g = 0; g < groups; g++) {
    const ids = Array.from({ length: perGroup }, (_, i) => `mr-${g}-${i}`)
    resources.push({
      resourceType: 'Basic', id: `group-${g}`, subject: { reference: 'Patient/pt-1' },
      extension: [{ url: 'https://example.test/group', extension: ids.map(id => ({ url: 'member', valueReference: { reference: `MedicationRequest/${id}` } })) }],
    })
    for (const id of ids) {
      resources.push({
        resourceType: 'MedicationRequest', id, status: 'completed', intent: 'order', subject: { reference: 'Patient/pt-1' },
        extension: [{ url: 'https://example.test/in-group', valueReference: { reference: `Basic/group-${g}` } }],
      })
    }
  }
  return buildClinicalSourceGraph([{ sourceId: 'cloud', patientScope: 'pt-1', generation: 'g1', resources }])
}

describe('clinicalSourceContextIdentity on prescription groups that point at each other', () => {
  it('works out each node once, however many times it is asked', () => {
    const graph = groupedPrescriptions(10, 8)
    restIdentityCalls = 0
    const first = graph.nodes.map(node => clinicalSourceContextIdentity(graph, node))
    const firstPassCalls = restIdentityCalls
    expect(firstPassCalls).toBeGreaterThan(0)

    // Every projection in an import asks again for every node (13–15 times for
    // the 雲端病歷 demo). Nodes inside a cycle used to be rehashed each time.
    for (let pass = 0; pass < 5; pass++) {
      expect(graph.nodes.map(node => clinicalSourceContextIdentity(graph, node))).toEqual(first)
    }
    expect(restIdentityCalls).toBe(firstPassCalls)
  })

  it('gives the same identity whichever node is asked first', () => {
    const forward = groupedPrescriptions(3, 4)
    const backward = groupedPrescriptions(3, 4)
    const asked = new Map(forward.nodes.map(node => [node.key, clinicalSourceContextIdentity(forward, node)]))
    for (const node of [...backward.nodes].reverse()) {
      expect(clinicalSourceContextIdentity(backward, node)).toBe(asked.get(node.key))
    }
  })

  it('still tells apart prescriptions whose groups differ', () => {
    const graph = groupedPrescriptions(2, 3)
    const identities = new Set(graph.nodes.map(node => clinicalSourceContextIdentity(graph, node)))
    expect(identities.size).toBe(graph.nodes.length)
  })
})
