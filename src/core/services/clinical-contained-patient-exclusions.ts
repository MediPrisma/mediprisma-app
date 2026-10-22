import { getClinicalSourceNodePatientExclusionReason, type ClinicalSourceNodePatientExclusionReason } from './clinical-patient-scope'
import { selectClinicalSourceNodes, type ClinicalReconciliationResult } from './clinical-reconciliation'
import type { ClinicalSourceNode } from './clinical-source-graph'

/** Ownership failures only on contained measurements reached through a live
 * clinical membership edge. Detached snapshots and embedded audit data do not
 * make a patient's result coverage incomplete. */
export function clinicalContainedPatientExclusions(source: ClinicalReconciliationResult): Array<{
  node: ClinicalSourceNode
  reason: ClinicalSourceNodePatientExclusionReason
  resourceTypes: Array<'Observation' | 'DiagnosticReport'>
}> {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const active = selectClinicalSourceNodes(source)
  const activeKeys = new Set(active.map(node => node.key))
  const edges = new Map<string, typeof source.graph.references[number][]>()
  for (const edge of source.graph.references) {
    const list = edges.get(edge.origin.key) ?? []
    list.push(edge)
    edges.set(edge.origin.key, list)
  }
  const excluded = new Map<string, { node: ClinicalSourceNode; reason: ClinicalSourceNodePatientExclusionReason; resourceTypes: Array<'Observation' | 'DiagnosticReport'> }>()
  for (const root of active) {
    if (!['DiagnosticReport', 'Observation'].includes(root.resource.resourceType)) continue
    const pending = [root], visited = new Set<string>()
    for (let index = 0; index < pending.length; index++) {
      const origin = pending[index]
      if (visited.has(origin.key)) continue
      visited.add(origin.key)
      const pattern = origin.resource.resourceType === 'DiagnosticReport' ? /^result\[\d+\]$/ : /^hasMember\[\d+\]$/
      for (const edge of edges.get(origin.key) ?? []) {
        if (edge.status !== 'resolved' || !pattern.test(edge.path)) continue
        for (const key of edge.targetKeys) {
          const target = nodes.get(key)
          if (!target || target.resource.resourceType !== 'Observation' || target.embeddedIn) continue
          if (target.isContained) {
            const owner = nodes.get(target.parentKey ?? '')
            if (!owner || !['DiagnosticReport', 'Observation'].includes(owner.resource.resourceType)) continue
            if (target.parentKey !== origin.key && target.parentKey !== origin.parentKey) continue
            const reason = getClinicalSourceNodePatientExclusionReason(target, source.graph.nodes)
            if (reason) {
              const entry: { node: ClinicalSourceNode; reason: ClinicalSourceNodePatientExclusionReason; resourceTypes: Array<'Observation' | 'DiagnosticReport'> } = excluded.get(key) ?? { node: target, reason, resourceTypes: ['Observation'] }
              if (root.resource.resourceType === 'DiagnosticReport' && !entry.resourceTypes.includes('DiagnosticReport')) entry.resourceTypes.push('DiagnosticReport')
              excluded.set(key, entry)
              continue
            }
          } else if (!activeKeys.has(key)) continue
          pending.push(target)
        }
      }
    }
  }
  return [...excluded.values()]
}
