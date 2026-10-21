import type { ClinicalDataQueryKey, ClinicalDataQueryStatus } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { selectClinicalModifierNodes } from '@/src/core/services/clinical-record-variants'
import { hasMalformedClinicalModifier } from '@/src/core/services/clinical-record-variant-modifier'
import { isClinicalSourceNodePatientEligible } from '@/src/core/services/clinical-patient-scope'

type Node = ClinicalReconciliationResult['graph']['nodes'][number]
export function malformedClinicalProjectionNodes(source: ClinicalReconciliationResult, additionalNodeKeys?: ReadonlySet<string>): readonly Node[] {
  return selectClinicalModifierNodes(source, additionalNodeKeys).filter(node => hasMalformedClinicalModifier(node.resource))
}
/** Record-level quarantine is domain incompleteness, never an invented revision. */
export function projectClinicalModifierQueryStatus(input: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}, invalidNodes: readonly Node[], source: ClinicalReconciliationResult): Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const reverse = new Map<string, typeof source.graph.references[number][]>()
  for (const edge of source.graph.references) {
    if (edge.status !== 'resolved' || !(edge.path === 'medicationReference' || /^(result|hasMember)\[\d+\]$/.test(edge.path))) continue
    for (const key of edge.targetKeys) { const list = reverse.get(key) ?? []; list.push(edge); reverse.set(key, list) }
  }
  const counts = new Map<string, Set<string>>()
  for (const invalid of invalidNodes) {
    const pending = [invalid.key], visited = new Set<string>()
    for (let index = 0; index < pending.length; index++) {
      const node = nodes.get(pending[index])
      if (!node || visited.has(node.key) || node.embeddedIn || !isClinicalSourceNodePatientEligible(node, source.graph.nodes)) continue
      visited.add(node.key)
      if (node.resource.resourceType !== 'Patient' && source.policies[node.resource.resourceType]?.strategy === 'preserve-existing-view') {
        const keys = counts.get(node.resource.resourceType) ?? new Set<string>(); keys.add(invalid.key); counts.set(node.resource.resourceType, keys)
      }
      for (const edge of reverse.get(node.key) ?? []) pending.push(edge.origin.key)
    }
  }
  let result = input
  for (const key of Object.keys(input) as ClinicalDataQueryKey[]) {
    const previous = input[key]
    if (!previous?.invalidModifierCount || counts.has(key === 'Observation:vital-signs' ? 'Observation' : key)) continue
    const { invalidModifierCount: _count, invalidModifierPreviousStatus: prior, ...rest } = previous
    const status: ClinicalDataQueryStatus = prior && previous.state === 'incomplete' && !previous.medicationContentUncertaintyCount
      ? { ...rest, state: prior.state, message: prior.message } : rest
    if (result === input) result = { ...input }
    result[key] = status
  }
  for (const [type, keys] of counts) {
    for (const key of [type, ...(type === 'Observation' && input['Observation:vital-signs'] ? ['Observation:vital-signs'] : [])] as ClinicalDataQueryKey[]) {
      const previous = input[key]
      const preserve = previous && !['ok', 'empty', 'incomplete'].includes(previous.state)
      const status: ClinicalDataQueryStatus = { ...previous, resourceType: previous?.resourceType ?? type, state: preserve ? previous.state : 'incomplete', invalidModifierCount: keys.size,
        ...(previous?.state === 'ok' || previous?.state === 'empty' ? { invalidModifierPreviousStatus: { state: previous.state, message: previous.message } } : {}),
        message: previous && !['ok', 'empty'].includes(previous.state) ? previous.message : 'Some clinical records have malformed recognized modifiers and were quarantined. This domain is incomplete; absence cannot be concluded.' }
      if (JSON.stringify(previous) === JSON.stringify(status)) continue
      if (result === input) result = { ...input }
      result[key] = status
    }
  }
  return result
}
