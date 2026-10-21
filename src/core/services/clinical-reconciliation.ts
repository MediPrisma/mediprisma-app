import { buildClinicalSourceGraph, type ClinicalSourceCapture, type ClinicalSourceGraph } from './clinical-source-graph'

export const CLINICAL_RECONCILIATION_POLICY_VERSION = 'conservative-source-v1'
export type ClinicalResourcePolicy = { assessment: 'supported' | 'not-assessed'; strategy: 'preserve-existing-view' | 'retain-source-only' }
const mappedTypes = ['Condition', 'MedicationRequest', 'MedicationStatement', 'AllergyIntolerance', 'Observation', 'DiagnosticReport', 'ImagingStudy', 'Procedure', 'Encounter', 'DocumentReference', 'Composition', 'Immunization', 'Consent', 'Device', 'CarePlan', 'Basic']
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
/** Evidence is deliberately separate from the clinical projection. Repeated audit
 * snapshots, identifiers, similar values and graph connectivity cannot create or
 * collapse clinical events. Unknown resource types remain available in the graph. */
export function reconcileClinicalSources(captures: readonly ClinicalSourceCapture[]): ClinicalReconciliationResult {
  const graph = buildClinicalSourceGraph(captures)
  const policies: Record<string, ClinicalResourcePolicy> = { ...CLINICAL_RESOURCE_POLICIES }
  const evidence: ClinicalReconciliationResult['evidence'] = { sameRecord: [], revision: [], candidate: [], conflict: [] }
  const identities = new Map<string, typeof graph.nodes[number][]>()
  for (const node of graph.nodes) {
    policies[node.resource.resourceType] ??= { assessment: 'not-assessed', strategy: 'retain-source-only' }
    if (((node as { occurrences?: number }).occurrences ?? 1) > 1) evidence.sameRecord.push({ nodeKeys: [node.key], reason: 'Exact duplicate transmissions retained in node occurrences' })
    if (!node.resource.id) continue
    const identity = JSON.stringify([node.sourceId, node.patientScope, node.fullUrl ?? null, node.resource.resourceType, node.resource.id])
    const existing = identities.get(identity) ?? []
    for (const prior of existing) {
      const pair = { nodeKeys: [prior.key, node.key], reason: 'Same source, patient, resource type and logical id' }
      if (canonical(prior.resource) === canonical(node.resource)) evidence.sameRecord.push(pair)
      else {
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
  Object.defineProperty(result, 'toJSON', { enumerable: false, value: () => ({ policyVersion: result.policyVersion, fingerprint: graph.nodes.map(node => node.key).join('|') }) })
  return result
}

/** Exact transmission equality only; never merge by clinical similarity. */
export function selectClinicalSourceNodes(result: ClinicalReconciliationResult) {
  const seen = new Set<string>()
  return result.graph.nodes.filter(node => {
    if ((node as { isContained?: boolean }).isContained) return false
    const identity = canonical([node.sourceId, node.patientScope, node.fullUrl ?? null, node.resource])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}
export function selectClinicalSourceResources(result: ClinicalReconciliationResult) {
  return selectClinicalSourceNodes(result).map(node => node.resource)
}
