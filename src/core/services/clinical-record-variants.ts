import type { ClinicalRecordVariant } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from './clinical-reconciliation'
import { logicalRestFullUrl } from './clinical-reconciliation'
import type { ClinicalSourceNode } from './clinical-source-graph'
import { clinicalSourceIdentityDigest } from './clinical-source-projection'
import { clinicalSourceNodesEqualWithContext } from './clinical-source-context'
import { clinicalSourceRestIdentity } from './clinical-source-rest-identity'

/** Carry already-established source-record ambiguity into every clinical view.
 * No chronology, preferred version, or cross-source equivalence is inferred. */
export function createClinicalRecordVariants(source: ClinicalReconciliationResult): ReadonlyMap<string, ClinicalRecordVariant> {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const parents = new Map<string, string>()
  const find = (key: string): string => {
    const parent = parents.get(key)
    if (!parent || parent === key) return key
    const root = find(parent)
    parents.set(key, root)
    return root
  }
  const assertions = [...source.evidence.revision, ...source.evidence.conflict]
  for (const assertion of assertions) {
    const keys = assertion.nodeKeys
    for (const key of keys) parents.set(find(key), find(keys[0]))
  }
  const groups = new Map<string, string[]>()
  for (const key of parents.keys()) {
    const root = find(key)
    groups.set(root, [...(groups.get(root) ?? []), key])
  }
  const recordIdentity = (node: ClinicalSourceNode): unknown[] => {
    const parent = nodes.get(node.parentKey ?? node.embeddedIn ?? '')
    return [node.sourceId, node.patientScope, node.restBase ?? null, logicalRestFullUrl(clinicalSourceRestIdentity(node) ?? undefined),
      node.resource.resourceType, node.resource.id ?? null,
      parent ? ((parent.resource.id || parent.fullUrl) ? recordIdentity(parent) : parent.key) : null]
  }
  const conflictRoots = new Set(source.evidence.conflict.flatMap(assertion => assertion.nodeKeys.map(find)))
  const groupIdentities = new Map<string, string>()
  const result = new Map<string, ClinicalRecordVariant>()
  for (const [root, keys] of groups) {
    const variants: ClinicalSourceNode[] = []
    for (const key of keys) {
      const node = nodes.get(key)
      if (!node) continue
      if (!variants.some(prior => prior.contentHash === node.contentHash && clinicalSourceNodesEqualWithContext(source.graph, prior, node))) {
        variants.push(node)
      }
    }
    const variantCount = variants.length
    if (variantCount < 2) continue
    const identity = JSON.stringify(recordIdentity(nodes.get(root)!))
    const groupId = 'cr' + clinicalSourceIdentityDigest(identity)
    const previous = groupIdentities.get(groupId)
    if (previous && previous !== identity) throw new Error('Clinical source variant group identity collision')
    groupIdentities.set(groupId, identity)
    const classification = conflictRoots.has(root) ? 'conflict' : 'revision'
    const annotation: ClinicalRecordVariant = {
      groupId, classification, variantCount,
      reason: classification === 'revision'
        ? 'Multiple versions of the same source record are present; their chronological order is not established.'
        : 'Conflicting content or resolved reference context exists for the same source record.',
    }
    for (const key of keys) result.set(key, annotation)
  }
  return result
}
