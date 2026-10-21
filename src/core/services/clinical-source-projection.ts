import { clinicalSourceResourcesEqual } from './clinical-source-graph'
import { clinicalSourceContextIdentity, clinicalSourceNodesEqualWithContext } from './clinical-source-context'
import type { ClinicalSourceGraph, ClinicalSourceNode } from './clinical-source-graph'
import type { ClinicalReconciliationResult } from './clinical-reconciliation'

const projectedResourceTypes = new Set(['Observation', 'DiagnosticReport'])
const membershipGraphs = new WeakMap<ClinicalSourceGraph, ClinicalSourceGraph>()

function projectionMembershipGraph(graph: ClinicalSourceGraph): ClinicalSourceGraph {
  const cached = membershipGraphs.get(graph)
  if (cached) return cached
  // Patient, encounter and performer captures may settle or refresh separately.
  // They must not change a clinical row's navigation identity. Membership still
  // distinguishes identical panels/reports that resolve to different values.
  // Reconciliation continues to use the complete graph for transmission equality.
  const membership = { ...graph, references: graph.references.filter(edge => /^(?:result|hasMember)(?:\[|$)/.test(edge.path)) }
  membershipGraphs.set(graph, membership)
  return membership
}

function stableMetadata(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableMetadata).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableMetadata(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function clinicalSourceIdentityDigest(value: string): string {
  // Two independent 32-bit streams form a compact 64-bit, browser-safe digest.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0')
}

/**
 * Build UI/AI projection IDs for source-backed observations and reports.
 * Generation and graph node keys are excluded for identified records so exact
 * query and _include copies share one row ID. Anonymous records use the graph
 * key because equal payloads alone do not prove retransmission. FHIR's original
 * id remains in sourceId.
 * Stability is scoped to one source/session/import. A different login or import
 * deliberately has a different source scope; IDs are not cross-session cache keys.
 */
export function createClinicalSourceProjectionIds(
  source: ClinicalReconciliationResult,
): ReadonlyMap<string, string> {
  const membershipGraph = projectionMembershipGraph(source.graph)
  const nodesByKey = new Map(source.graph.nodes.map((node) => [node.key, node]))
  const stableIdentityCache = new Map<string, string>()
  const resourcesByParentIdentity = new Map<string, ClinicalSourceNode['resource']>()

  const stableParentIdentity = (node: ClinicalSourceNode, visiting = new Set<string>()): string | undefined => {
    const relationship = node.parentKey ? 'contained' : node.embeddedIn ? 'embedded' : undefined
    const parentKey = node.parentKey ?? node.embeddedIn
    if (!relationship || !parentKey) return undefined
    const cached = stableIdentityCache.get(parentKey)
    if (cached) return `${relationship}:${cached}`
    if (visiting.has(parentKey)) throw new Error('Clinical source graph has a parent cycle; cannot create stable projection IDs')
    const parent = nodesByKey.get(parentKey)
    if (!parent) throw new Error(`Clinical source parent ${parentKey} is missing; cannot create stable projection IDs`)
    visiting.add(parentKey)
    const identity = stableMetadata([
      parent.sourceId,
      parent.patientScope,
      parent.restBase ?? null,
      parent.fullUrl ?? null,
      parent.resource.resourceType,
      parent.resource.id ?? null,
      (parent.resource.meta as { versionId?: unknown } | undefined)?.versionId ?? null,
      parent.contentHash,
      stableParentIdentity(parent, visiting) ?? null,
      // Anonymous parents have no reliable cross-capture identity. Keep their
      // descendants separate by the graph's stable capture slot.
      (!parent.resource.id && !parent.fullUrl) ? parent.key : null,
    ])
    visiting.delete(parentKey)
    const priorResource = resourcesByParentIdentity.get(identity)
    if (priorResource && !clinicalSourceResourcesEqual(priorResource, parent.resource)) {
      throw new Error('Clinical source projection ID hash collision: matching parent identity metadata has different resources')
    }
    if (!priorResource) resourcesByParentIdentity.set(identity, parent.resource)
    stableIdentityCache.set(parentKey, identity)
    return `${relationship}:${identity}`
  }

  const anonymousOccurrences = new Map<string, number>()
  const records: Array<{ node: ClinicalSourceNode; identity: string; digest: string }> = []
  for (const node of source.graph.nodes) {
    if (!projectedResourceTypes.has(node.resource.resourceType)) continue
    const parentIdentity = stableParentIdentity(node)
    const versionId = (node.resource.meta as { versionId?: unknown } | undefined)?.versionId ?? null
    const hasReliableIdentity = Boolean(node.resource.id || node.fullUrl)
    const anonymousScope = stableMetadata([
      node.sourceId,
      node.patientScope,
      node.restBase ?? null,
      parentIdentity ?? null,
      node.resource.resourceType,
      node.contentHash,
    ])
    let occurrence: number | undefined
    if (!hasReliableIdentity) {
      occurrence = anonymousOccurrences.get(anonymousScope) ?? 0
      anonymousOccurrences.set(anonymousScope, occurrence + 1)
    }

    // This tuple contains only bounded identity metadata and the graph's
    // streaming content digest; resource payloads (including base64) are never
    // serialized for the row id.
    const identity = stableMetadata([
      node.sourceId,
      node.patientScope,
      node.restBase ?? null,
      node.fullUrl ?? null,
      node.resource.resourceType,
      node.resource.id ?? null,
      versionId,
      node.contentHash,
      clinicalSourceContextIdentity(membershipGraph, node),
      parentIdentity ?? null,
      occurrence ?? null,
      // Without an id or fullUrl, equal payloads in independent query captures
      // are not proven retransmissions. Keep each graph capture slot distinct.
      hasReliableIdentity ? null : node.key,
    ])
    records.push({ node, identity, digest: clinicalSourceIdentityDigest(identity) })
  }

  const buckets = new Map<string, Array<{ identity: string; resource: ClinicalSourceNode['resource']; node: ClinicalSourceNode; nodeKeys: string[] }>>()
  for (const record of records) {
    const bucket = buckets.get(record.digest) ?? []
    const existing = bucket.find((candidate) => candidate.identity === record.identity)
    if (existing) {
      if (!clinicalSourceNodesEqualWithContext(membershipGraph, existing.node, record.node)) {
        throw new Error('Clinical source projection ID hash collision: matching identity metadata has different resources')
      }
      existing.nodeKeys.push(record.node.key)
    } else {
      bucket.push({ identity: record.identity, resource: record.node.resource, node: record.node, nodeKeys: [record.node.key] })
    }
    buckets.set(record.digest, bucket)
  }

  const idsByNodeKey = new Map<string, string>()
  for (const [hash, bucket] of buckets) {
    if (bucket.length > 1) {
      throw new Error('Clinical source projection ID hash collision: distinct source identities share a row ID digest')
    }
    // The navigation base stays stable as supporting queries settle. When
    // multiple records actually share that base, retain the full-context
    // distinctions already proved by reconciliation instead of folding rows.
    const contexts = new Map<string, { node: ClinicalSourceNode; keys: string[] }>()
    for (const key of bucket[0].nodeKeys) {
      const node = nodesByKey.get(key)!
      const context = clinicalSourceContextIdentity(source.graph, node)
      const previous = contexts.get(context)
      if (previous && !clinicalSourceNodesEqualWithContext(source.graph, previous.node, node)) {
        throw new Error('Clinical source projection context hash collision: distinct records share a context digest')
      }
      if (previous) previous.keys.push(key)
      else contexts.set(context, { node, keys: [key] })
    }
    for (const [context, group] of contexts) {
      const rowId = `cs${hash}${contexts.size > 1 ? `-${context}` : ''}`
      if (rowId.length > 64 || !/^[A-Za-z0-9.-]+$/.test(rowId)) {
        throw new Error('Clinical source projection produced an invalid FHIR row ID')
      }
      for (const key of group.keys) idsByNodeKey.set(key, rowId)
    }
  }
  return idsByNodeKey
}
