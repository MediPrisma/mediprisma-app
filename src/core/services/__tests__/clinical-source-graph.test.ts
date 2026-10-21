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

  it('resolves versioned absolute fullUrls without a capture REST base', () => {
    const graph = buildClinicalSourceGraph([{
      sourceId: 'ehr-a', patientScope: 'patient-1', generation: 'import-1', resources: [
        { resourceType: 'Observation', id: 'origin', subject: { reference: 'https://ehr.example/fhir/Patient/p/_history/2' } },
        { resource: { resourceType: 'Patient', id: 'p', meta: { versionId: '2' } }, fullUrl: 'https://ehr.example/fhir/Patient/p' },
      ],
    }])
    expect(graph.references[0].status).toBe('resolved')
  })

  it('keeps relative references on the origin fullUrl base when multiple hosts share the scope', () => {
    const graph = buildClinicalSourceGraph([{
      sourceId: 'multi-host', patientScope: 'patient-1', generation: 'import-1', resources: [
        { resource: { resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/x' }] }, fullUrl: 'https://a.example/fhir/DiagnosticReport/r' },
        { resource: { resourceType: 'Observation', id: 'x' }, fullUrl: 'https://a.example/fhir/Observation/x' },
        { resource: { resourceType: 'Observation', id: 'x' }, fullUrl: 'https://b.example/fhir/Observation/x' },
      ],
    }])
    const edge = graph.references.find((item) => item.origin.resource.resourceType === 'DiagnosticReport')!
    expect(edge.status).toBe('resolved')
    expect(edge.targetKeys).toEqual([graph.nodes.find((node) => node.fullUrl === 'https://a.example/fhir/Observation/x')!.key])
  })

  it('uses an absolute reference host to select among same-id resources from different hosts', () => {
    const graph = buildClinicalSourceGraph([{
      sourceId: 'multi-host', patientScope: 'patient-1', generation: 'import-1', resources: [
        { resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'https://b.example/fhir/Observation/x' }] },
        { resource: { resourceType: 'Observation', id: 'x' }, fullUrl: 'https://a.example/fhir/Observation/x' },
        { resource: { resourceType: 'Observation', id: 'x' }, fullUrl: 'https://b.example/fhir/Observation/x' },
      ],
    }])
    const edge = graph.references.find((item) => item.origin.resource.resourceType === 'DiagnosticReport')!
    expect(edge.status).toBe('resolved')
    expect(edge.targetKeys).toEqual([graph.nodes.find((node) => node.fullUrl === 'https://b.example/fhir/Observation/x')!.key])
  })

  it('resolves byte-identical records repeated across capture generations and retains both nodes', () => {
    const graph = buildClinicalSourceGraph([
      capture([{ resourceType: 'ServiceRequest', id: 'order', subject: { reference: 'Observation/x' } }, { resourceType: 'Observation', id: 'x', status: 'final', valueQuantity: { value: 42 } }]),
      capture([{ resourceType: 'Observation', id: 'x', status: 'final', valueQuantity: { value: 42 } }], { generation: 'import-2' }),
    ])
    const edge = graph.references.find((item) => item.origin.resource.resourceType === 'ServiceRequest')!
    expect(graph.nodes.filter((node) => node.resource.resourceType === 'Observation')).toHaveLength(2)
    expect(edge.status).toBe('resolved')
    expect(edge.targetKeys).toHaveLength(2)
  })

  it('keeps same-id records ambiguous when payload or version differs across generations', () => {
    const payloadMismatch = buildClinicalSourceGraph([
      capture([{ resourceType: 'ServiceRequest', id: 'order', subject: { reference: 'Observation/x' } }, { resourceType: 'Observation', id: 'x', status: 'final', valueQuantity: { value: 42 } }]),
      capture([{ resourceType: 'Observation', id: 'x', status: 'final', valueQuantity: { value: 43 } }], { generation: 'import-2' }),
    ])
    const versionMismatch = buildClinicalSourceGraph([
      capture([{ resourceType: 'ServiceRequest', id: 'order', subject: { reference: 'Observation/x' } }, { resourceType: 'Observation', id: 'x', meta: { versionId: '1' }, valueQuantity: { value: 42 } }]),
      capture([{ resourceType: 'Observation', id: 'x', meta: { versionId: '2' }, valueQuantity: { value: 42 } }], { generation: 'import-2' }),
    ])
    expect(payloadMismatch.references.find((item) => item.origin.resource.resourceType === 'ServiceRequest')?.status).toBe('ambiguous')
    expect(versionMismatch.references.find((item) => item.origin.resource.resourceType === 'ServiceRequest')?.status).toBe('ambiguous')
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
    expect(graph.nodes[0].occurrences).toBe(1)
  })

  it('preserves identical anonymous events by position while making a replayed capture idempotent', () => {
    const resources = [
      { resourceType: 'Procedure', status: 'completed', code: { text: 'same event' } },
      { resourceType: 'Procedure', status: 'completed', code: { text: 'same event' } },
    ]
    const graph = buildClinicalSourceGraph([capture(resources), capture(resources)])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].key).not.toBe(graph.nodes[1].key)
  })

  it('scopes resource identity by REST base and exposes that base on nodes', () => {
    const graph = buildClinicalSourceGraph([
      capture([{ resourceType: 'Patient', id: 'p' }]),
      capture([{ resourceType: 'Patient', id: 'p' }], { restBase: 'https://ehr.example/other-fhir' }),
    ])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map((node) => node.restBase)).toEqual(['https://ehr.example/fhir', 'https://ehr.example/other-fhir'])
  })

  it('records display-only and unresolved references without inventing targets', () => {
    const graph = buildClinicalSourceGraph([capture([{ resourceType: 'Observation', id: 'o', subject: { display: 'Unknown patient' }, basedOn: { reference: 'ServiceRequest/missing' }, focus: { identifier: { value: 'unknown' } }, code: { coding: [{ display: 'a code, not a reference' }] }, entity: [{ what: { identifier: { value: 'audit-target' } } }], extension: [{ valueReference: { display: 'Referenced from extension' } }] }])])
    expect(graph.references.map((e) => e.status).sort()).toEqual(['display-only', 'display-only', 'unresolved', 'unresolved', 'unresolved'])
    expect(graph.references.every((e) => e.targetKeys.length === 0)).toBe(true)
  })
})
