import { isClinicalSourceNodePatientEligible } from './clinical-patient-scope'
import { readClinicalRecordVariantModifier, readClinicalMedicationContentModifier, hasMalformedClinicalModifier } from './clinical-record-variant-modifier'
import type { ClinicalRecordVariant } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from './clinical-reconciliation'
import { logicalRestFullUrl, selectClinicalSourceNodes } from './clinical-reconciliation'
import type { ClinicalSourceNode } from './clinical-source-graph'
import { clinicalSourceIdentityDigest } from './clinical-source-projection'
import { clinicalSourceNodesEqualWithContext } from './clinical-source-context'
import { clinicalSourceRestIdentity } from './clinical-source-rest-identity'

/** Projectable rows plus only graph-proven clinical members/content targets.
 * Audit/history snapshots and unassessed types never validate as clinical rows. */
export function selectClinicalModifierNodes(source: ClinicalReconciliationResult, additionalNodeKeys: ReadonlySet<string> = new Set()): readonly ClinicalSourceNode[] {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const roots = selectClinicalSourceNodes(source).filter(node => !['Patient', 'Basic'].includes(node.resource.resourceType) && (node.resource.resourceType === 'Claim' || source.policies[node.resource.resourceType]?.strategy === 'preserve-existing-view')).map(node => node.key)
  const pending = [...roots, ...additionalNodeKeys]
  const selected = new Map<string, ClinicalSourceNode>()
  const edges = new Map<string, typeof source.graph.references[number][]>()
  for (const edge of source.graph.references) {
    if (!(edge.status === 'resolved' || edge.status === 'ambiguous' && edge.path === 'medicationReference') || !(edge.path === 'medicationReference' || /^(result|hasMember)\[\d+\]$/.test(edge.path))) continue
    const group = edges.get(edge.origin.key) ?? []; group.push(edge); edges.set(edge.origin.key, group)
  }
  for (let index = 0; index < pending.length; index++) {
    const node = nodes.get(pending[index])
    if (!node || selected.has(node.key) || node.embeddedIn || !isClinicalSourceNodePatientEligible(node, source.graph.nodes)) continue
    selected.set(node.key, node)
    for (const edge of edges.get(node.key) ?? []) for (const key of edge.targetKeys) {
      const target = nodes.get(key)
      if (target && (edge.path === 'medicationReference' ? target.resource.resourceType === 'Medication' : target.resource.resourceType === 'Observation')) pending.push(key)
    }
  }
  return [...selected.values()]
}
export function scopedImportedClinicalRecordVariant(node: Pick<ClinicalSourceNode, 'sourceId' | 'patientScope'>, variant: ClinicalRecordVariant): ClinicalRecordVariant {
  return { ...variant, groupId: 'cr' + clinicalSourceIdentityDigest(JSON.stringify([node.sourceId, node.patientScope, variant.groupId])) }
}

/** Carry already-established source-record ambiguity into every clinical view.
 * No chronology, preferred version, or cross-source equivalence is inferred. */
export function createClinicalRecordVariants(source: ClinicalReconciliationResult, options: { additionalNodeKeys?: ReadonlySet<string>; quarantineMalformed?: boolean } = {}): ReadonlyMap<string, ClinicalRecordVariant> {
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
  for (const node of selectClinicalModifierNodes(source, options.additionalNodeKeys)) {
    if (options.quarantineMalformed && hasMalformedClinicalModifier(node.resource)) continue
    readClinicalMedicationContentModifier(node.resource)
    const imported = readClinicalRecordVariantModifier(node.resource)
    if (!imported) continue
    const current = result.get(node.key)
    // Imported source ids are audit metadata, never evidence of equivalence.
    // An imported label cannot establish equivalence between different logical
    // records. Only graph evidence may join their versions into one group.
    const groupId = current?.groupId ?? 'cr' + clinicalSourceIdentityDigest(JSON.stringify([recordIdentity(node), imported.variant.groupId]))
    result.set(node.key, Object.freeze({ ...imported.variant, groupId,
      ...(current ? { classification: current.classification === 'conflict' ? 'conflict' : imported.variant.classification, variantCount: Math.max(current.variantCount, imported.variant.variantCount) } : {}) }))
  }
  return result
}
