import { buildClinicalSourceGraph, type ClinicalSourceCapture } from '../clinical-source-graph'

const capture = (resources: ClinicalSourceCapture['resources'], overrides: Partial<ClinicalSourceCapture> = {}): ClinicalSourceCapture => ({
  sourceId: 'ehr-a', patientScope: 'patient-1', generation: 'import-1', restBase: 'https://ehr.example/fhir', resources, ...overrides,
})

describe('buildClinicalSourceGraph', () => {
  it('keeps all resource types and unknown fields, deeply clones and freezes input', () => {
    const input = { resourceType: 'AlienResource', id: 'x', custom: { list: [1, { value: 'original' }] } }
    const graph = buildClinicalSourceGraph([capture([input])])
    input.custom.list[1].value = 'changed'
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].resource.resourceType).toBe('AlienResource')
    expect((graph.nodes[0].resource.custom as any).list[1].value).toBe('original')
    expect(Object.isFrozen(graph.nodes[0].resource.custom)).toBe(true)
    expect(Object.isFrozen((graph.nodes[0].resource.custom as any).list)).toBe(true)
  })

  it('resolves exact fullUrls, REST references and version-specific references within source and patient scope', () => {
    const graph = buildClinicalSourceGraph([capture([
      { resource: { resourceType: 'Patient', id: 'p', meta: { versionId: '2' } }, fullUrl: 'urn:uuid:p' },
      { resourceType: 'Observation', id: 'o', subject: { reference: 'urn:uuid:p' }, performer: { reference: 'Patient/p/_history/2' }, focus: { reference: 'https://ehr.example/fhir/Patient/p' } },
    ])])
    const edges = graph.references.filter((edge) => edge.origin.resource.id === 'o')
    expect(edges.map((edge) => edge.status)).toEqual(['resolved', 'resolved', 'resolved'])
    const patientKey = graph.nodes.find((node) => node.resource.resourceType === 'Patient')!.key
    expect(edges.every((edge) => edge.targetKeys[0] === patientKey)).toBe(true)
  })

  it('does not cross source or patient boundaries and reports ambiguous logical references', () => {
    const graph = buildClinicalSourceGraph([
      capture([{ resourceType: 'Patient', id: 'p' }, { resourceType: 'Observation', id: 'o', subject: { reference: 'Patient/p' } }]),
      capture([{ resourceType: 'Patient', id: 'p' }], { sourceId: 'ehr-b' }),
      capture([{ resourceType: 'Patient', id: 'p' }], { patientScope: 'patient-2' }),
      capture([{ resourceType: 'Patient', id: 'p', meta: { versionId: '2' } }], { generation: 'import-2' }),
    ])
    const edge = graph.references.find((item) => item.origin.resource.id === 'o')!
    expect(edge.status).toBe('ambiguous')
    expect(edge.targetKeys).toHaveLength(2)
    expect(edge.targetKeys).not.toContain(graph.nodes.find((n) => n.sourceId === 'ehr-b')!.key)
  })

  it('resolves contained references only to a contained resource on the owning parent', () => {
    const graph = buildClinicalSourceGraph([capture([
      { resourceType: 'Observation', id: 'o', contained: [{ resourceType: 'Practitioner', id: 'staff' }, { resourceType: 'Organization', id: 'clinic', partOf: { reference: '#staff' } }], performer: { reference: '#staff' } },
      { resourceType: 'Observation', id: 'other', performer: { reference: '#staff' } },
      { resourceType: 'Observation', id: 'plain-ref', performer: { reference: 'Practitioner/staff' } },
    ])])
    expect(graph.references.find((e) => e.origin.resource.id === 'o')?.status).toBe('resolved')
    expect(graph.references.find((e) => e.origin.resource.id === 'other')?.status).toBe('unresolved')
    expect(graph.references.find((e) => e.origin.resource.id === 'clinic')?.status).toBe('resolved')
    expect(graph.references.find((e) => e.origin.resource.id === 'plain-ref')?.status).toBe('unresolved')
  })

  it('does not reinterpret an absolute URL from an unrelated server as a local REST reference', () => {
    const graph = buildClinicalSourceGraph([capture([
      { resourceType: 'Observation', id: 'o', subject: { reference: 'https://foreign.invalid/Patient/p' } },
      { resourceType: 'Patient', id: 'p' },
    ])])
    expect(graph.references[0].status).toBe('unresolved')
  })

  it('keeps unknown audit resource types but does not promote nested provenance snapshots', () => {
    const graph = buildClinicalSourceGraph([capture([
      { resourceType: 'Provenance', id: 'audit' },
      { resourceType: 'Observation', id: 'o', extension: [{ valueResource: { resourceType: 'Provenance', id: 'embedded-snapshot' } }] },
      { resourceType: 'Bundle', entry: [{ fullUrl: 'urn:uuid:condition', resource: { resourceType: 'Condition', id: 'c' } }] },
    ])])
    expect(graph.nodes.map((n) => n.resource.id)).toEqual(expect.arrayContaining(['audit', 'o', 'c']))
    expect(graph.nodes.some((n) => n.resource.id === 'embedded-snapshot')).toBe(false)
  })

  it('is deterministic, idempotent for repeated captures, and distinguishes generations', () => {
    const resources = [{ resourceType: 'Observation', id: 'o', valueQuantity: { value: 5 } }]
    const graph = buildClinicalSourceGraph([capture(resources), capture(resources), capture(resources, { generation: 'import-2' })])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map((n) => n.key).sort()).toEqual(buildClinicalSourceGraph([capture(resources, { generation: 'import-2' }), capture(resources)]).nodes.map((n) => n.key).sort())
    expect(graph.nodes[0].occurrences).toBe(2)
  })

  it('records display-only and unresolved references without inventing targets', () => {
    const graph = buildClinicalSourceGraph([capture([{ resourceType: 'Observation', id: 'o', subject: { display: 'Unknown patient' }, basedOn: { reference: 'ServiceRequest/missing' } }])])
    expect(graph.references.map((e) => e.status).sort()).toEqual(['display-only', 'unresolved'])
    expect(graph.references.every((e) => e.targetKeys.length === 0)).toBe(true)
  })
})
