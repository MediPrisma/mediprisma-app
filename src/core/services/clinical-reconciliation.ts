import { buildClinicalSourceGraph, clinicalSourceResourcesEqual, type ClinicalSourceCapture, type ClinicalSourceGraph, type ClinicalSourceNode } from './clinical-source-graph'
import { clinicalSourceContextIdentity, clinicalSourceNodesEqualWithContext } from './clinical-source-context'
import { isClinicalSourceNodePatientEligible } from './clinical-patient-scope'

export const CLINICAL_RECONCILIATION_POLICY_VERSION = 'conservative-source-v1'
export type ClinicalResourcePolicy = { assessment: 'supported' | 'not-assessed'; strategy: 'preserve-existing-view' | 'retain-source-only' }
const mappedTypes = ['Patient', 'Condition', 'MedicationRequest', 'MedicationStatement', 'AllergyIntolerance', 'Observation', 'DiagnosticReport', 'ImagingStudy', 'Procedure', 'Encounter', 'DocumentReference', 'Composition', 'Immunization', 'Consent', 'Device', 'CarePlan', 'Basic']
export const CLINICAL_RESOURCE_POLICIES: Readonly<Record<string, ClinicalResourcePolicy>> = Object.freeze(Object.fromEntries(mappedTypes.map(type => [type, Object.freeze({ assessment: 'supported', strategy: 'preserve-existing-view' })])))
export type ClinicalReconciliationEvidence = { nodeKeys: readonly string[]; reason: string }
export interface ClinicalReconciliationResult {
  policyVersion: string
  graph: ClinicalSourceGraph
  policies: Readonly<Record<string, ClinicalResourcePolicy>>
  evidence: { sameRecord: ClinicalReconciliationEvidence[]; revision: ClinicalReconciliationEvidence[]; candidate: ClinicalReconciliationEvidence[]; conflict: ClinicalReconciliationEvidence[] }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
/** Remove only the explicit FHIR history suffix from an absolute REST URL for
 * logical record grouping. The graph keeps the original versioned fullUrl. */
export function logicalRestFullUrl(fullUrl: string | undefined): string | null {
  if (!fullUrl) return null
  try {
    const url = new URL(fullUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fullUrl
  } catch {
    return fullUrl
  }
  const history = fullUrl.match(/^(https?:\/\/[^/?#]+(?:\/[^/?#]+)*\/[A-Z][A-Za-z0-9]*\/[A-Za-z0-9.-]{1,64})\/_history\/[A-Za-z0-9.-]{1,64}([?#].*)?$/i)
  return history ? history[1] + (history[2] ?? '') : fullUrl
}
function parentSourceIdentity(node: ClinicalSourceNode, nodes: ReadonlyMap<string, ClinicalSourceNode>, seen = new Set<string>()): unknown {
  const parentKey = node.parentKey ?? node.embeddedIn
  if (!parentKey) return null
  const parent = nodes.get(parentKey)
  if (!parent) return ['missing-parent', parentKey]
  // Anonymous parent identity is not strong enough to correlate contained
  // records across captures. Keep it capture-local by retaining the node key.
  if (!parent.resource.id && !parent.fullUrl) return ['anonymous-parent', parent.key]
  if (seen.has(parent.key)) return ['parent-cycle', parent.resource.resourceType, parent.resource.id ?? parent.fullUrl]
  seen.add(parent.key)
  const fullUrl = logicalRestFullUrl(parent.fullUrl)
  return [
    parent.sourceId,
    parent.patientScope,
    parent.restBase ?? null,
    parent.resource.resourceType,
    parent.resource.id ?? null,
    fullUrl,
    parentSourceIdentity(parent, nodes, seen),
  ]
}

// Only bounded identity metadata enters map keys; payloads remain in the graph.
// A contained record follows its parent's logical source identity across
// parent revisions, while anonymous or differently identified parents remain
// isolated. The existing resolved-context comparison still distinguishes
// children whose references land in different parent-version contexts.
function recordScopeIdentity(node: ClinicalSourceNode, nodes: ReadonlyMap<string, ClinicalSourceNode>): string {
  return JSON.stringify([node.sourceId, node.patientScope, node.restBase ?? null, logicalRestFullUrl(node.fullUrl),
    node.parentKey ? 'contained' : node.embeddedIn ? 'embedded' : null,
    parentSourceIdentity(node, nodes), node.resource.resourceType, node.resource.id ?? null])
}
/** Evidence is deliberately separate from the clinical projection. Repeated audit
 * snapshots, identifiers, similar values and graph connectivity cannot create or
 * collapse clinical events. Unknown resource types remain available in the graph. */
export function reconcileClinicalSources(captures: readonly ClinicalSourceCapture[]): ClinicalReconciliationResult {
  const graph = buildClinicalSourceGraph(captures)
  const graphNodesByKey = new Map(graph.nodes.map(node => [node.key, node]))
  const policies: Record<string, ClinicalResourcePolicy> = { ...CLINICAL_RESOURCE_POLICIES }
  const evidence: ClinicalReconciliationResult['evidence'] = { sameRecord: [], revision: [], candidate: [], conflict: [] }
  const identities = new Map<string, typeof graph.nodes[number][]>()
  for (const node of graph.nodes) {
    policies[node.resource.resourceType] ??= { assessment: 'not-assessed', strategy: 'retain-source-only' }
    if ((node.occurrences ?? 1) > 1) evidence.sameRecord.push({ nodeKeys: [node.key], reason: 'Exact duplicate transmissions retained in node occurrences' })
    if (!node.resource.id && !node.fullUrl) continue
    const identity = recordScopeIdentity(node, graphNodesByKey)
    const existing = identities.get(identity) ?? []
    for (const prior of existing) {
      const pair = { nodeKeys: [prior.key, node.key], reason: 'Same source, patient, resource type and logical id' }
      if (prior.contentHash === node.contentHash && clinicalSourceResourcesEqual(prior.resource, node.resource)) {
        if (clinicalSourceNodesEqualWithContext(graph, prior, node)) evidence.sameRecord.push(pair)
        else evidence.conflict.push({ ...pair, reason: 'Same payload has different resolved reference context' })
      } else {
        const previousVersion = (prior.resource.meta as { versionId?: string } | undefined)?.versionId
        const version = (node.resource.meta as { versionId?: string } | undefined)?.versionId
        if (version && previousVersion && version !== previousVersion) evidence.revision.push({ ...pair, reason: 'Distinct explicit version ids; chronology is not inferred' })
        else evidence.conflict.push({ ...pair, reason: 'Different payloads without distinct explicit version ids' })
      }
    }
    existing.push(node)
    identities.set(identity, existing)
  }
  const result = { policyVersion: CLINICAL_RECONCILIATION_POLICY_VERSION, policies, evidence } as ClinicalReconciliationResult
  Object.defineProperty(result, 'graph', { value: graph, enumerable: false })
  // Source keys encode capture scope, generation and payload without serializing
  // raw source resources (including provenance snapshots) into AI prompts.
  const signature = canonical([result.policyVersion, captures.map(capture => [capture.sourceId, capture.patientScope, capture.generation, capture.restBase ?? null]), graph.nodes.map(node => node.key)])
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < signature.length; index++) {
    first = Math.imul(first ^ signature.charCodeAt(index), 0x01000193) >>> 0
    second = Math.imul(second ^ (signature.charCodeAt(index) + index), 0x85ebca6b) >>> 0
  }
  const fingerprint = first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0')
  Object.defineProperty(result, 'toJSON', { enumerable: false, value: () => ({ policyVersion: result.policyVersion, fingerprint }) })
  Object.values(policies).forEach(Object.freeze)
  Object.freeze(policies)
  Object.values(evidence).forEach(entries => {
    entries.forEach(entry => {
      Object.freeze(entry.nodeKeys)
      Object.freeze(entry)
    })
    Object.freeze(entries)
  })
  Object.freeze(evidence)
  return Object.freeze(result)
}

/** Exact transmission equality only; never merge by clinical similarity. */
export function selectClinicalSourceNodes(result: ClinicalReconciliationResult) {
  const seen = new Map<string, ClinicalSourceNode[]>()
  const graphNodesByKey = new Map(result.graph.nodes.map(node => [node.key, node]))
  return result.graph.nodes.filter(node => {
    if (node.isContained || node.embeddedIn) return false
    if (!isClinicalSourceNodePatientEligible(node, result.graph.nodes)) return false
    if (!node.resource.id && !node.fullUrl) return true
    const identity = recordScopeIdentity(node, graphNodesByKey) + '|' + node.contentHash + '|' + clinicalSourceContextIdentity(result.graph, node)
    const bucket = seen.get(identity) ?? []
    if (bucket.some(prior => clinicalSourceNodesEqualWithContext(result.graph, prior, node))) return false
    bucket.push(node)
    seen.set(identity, bucket)
    return true
  })
}
export function selectClinicalSourceResources(result: ClinicalReconciliationResult) {
  return selectClinicalSourceNodes(result).map(node => node.resource)
}
