import type { ClinicalDataCollection, ObservationEntity } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'
import { attachReportObservations } from '@/src/core/services/clinical-report-membership'
import { isVitalObservation } from '@/src/core/utils/observation-selectors'
import { mutableClinicalProjection } from '../services/clinical-source-session'
import { FhirMapper } from './fhir.mapper'

type SourceNode = ClinicalReconciliationResult['graph']['nodes'][number]
type SourceEdge = ClinicalReconciliationResult['graph']['references'][number]
export interface ClinicalProjectionContext {
  ids: ReadonlyMap<string, string>
  nodes: Map<string, SourceNode>
  edges: Map<string, SourceEdge[]>
}
export function createClinicalProjectionContext(source: ClinicalReconciliationResult): ClinicalProjectionContext {
  const context: ClinicalProjectionContext = { ids: createClinicalSourceProjectionIds(source), nodes: new Map(source.graph.nodes.map(node => [node.key, node])), edges: new Map() }
  for (const edge of source.graph.references) {
    const edges = context.edges.get(edge.origin.key) ?? []
    edges.push(edge)
    context.edges.set(edge.origin.key, edges)
  }
  return context
}

/** Copy only a changed reference path; never mutate a cached entity or raw graph. */
export function projectClinicalReferences<T>(resource: T, nodeKey: string, context: ClinicalProjectionContext): T {
  let projected = resource
  for (const edge of context.edges.get(nodeKey) ?? []) {
    if (edge.status !== 'resolved') continue
    const targetIds = [...new Set(edge.targetKeys.map(key => context.ids.get(key)).filter((id): id is string => Boolean(id)))]
    if (targetIds.length > 1) continue
    const target = edge.targetKeys.map(key => context.nodes.get(key)).find(node => node && (node.resource.resourceType === 'Observation' || node.resource.resourceType === 'DiagnosticReport'))
    if (!target) continue
    const parts = edge.path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let current: any = projected
    for (const part of parts) current = current?.[part]
    const reference = targetIds.length === 1 ? target.resource.resourceType + '/' + targetIds[0] : edge.reference
    if (!reference) continue
    if (!current || typeof current.reference !== 'string' || current.reference === reference) continue
    const copy = (value: any): any => Array.isArray(value) ? [...value] : { ...value }
    const root: any = copy(projected)
    let original: any = projected
    let cursor: any = root
    for (const part of parts) {
      cursor[part] = copy(original[part])
      cursor = cursor[part]
      original = original[part]
    }
    cursor.reference = reference
    projected = root
  }
  return projected
}

export function mapProjectedObservation(resource: any, nodeKey: string, context: ClinicalProjectionContext): ObservationEntity {
  return {
    ...FhirMapper.toObservation(projectClinicalReferences(mutableClinicalProjection(resource), nodeKey, context)),
    id: context.ids.get(nodeKey) ?? resource.id,
    sourceId: resource.id,
    clinicalSourceNodeKey: nodeKey,
  }
}

/** One projection for both complete and progressive clinical collections. Active
 * source Observations form the superset; every resolved report member aliases a
 * row in that same array. Only proven graph edges rewrite domain references. */
export function projectClinicalAggregate<T extends Partial<ClinicalDataCollection>>(
  input: T,
  source: ClinicalReconciliationResult | undefined = input.clinicalSource,
): T {
  if (!source?.graph) return input
  const context = createClinicalProjectionContext(source)
  const eligible = selectClinicalSourceNodes(source).filter(node => node.resource.resourceType === 'Observation')
  const eligibleById = new Map(eligible.map(node => [context.ids.get(node.key)!, node]))
  const observationsById = new Map<string, ObservationEntity>()
  const legacyRows: ObservationEntity[] = []
  const accept = (row: ObservationEntity, requireActive: boolean) => {
    const originalKey = row.clinicalSourceNodeKey
    if (!originalKey) { if (!requireActive) legacyRows.push(row); return }
    let node = context.nodes.get(originalKey)
    if (!node && !requireActive) node = eligibleById.get(row.id ?? '')
    if (!node || node.resource.resourceType !== 'Observation' || node.embeddedIn) return
    const id = context.ids.get(node.key)
    if (!id || (requireActive && node.isContained && !observationsById.has(id))) return
    const projected = row.clinicalSourceNodeKey === node.key && row.id === id
      ? row : { ...row, id, clinicalSourceNodeKey: node.key }
    const previous = observationsById.get(id)
    if (!previous) observationsById.set(id, projected)
    else if (projected.clinicalSourceDerivedMemberKeys?.some(key => !previous.clinicalSourceDerivedMemberKeys?.includes(key))) {
      observationsById.set(id, { ...previous, clinicalSourceDerivedMemberKeys: [...new Set([...(previous.clinicalSourceDerivedMemberKeys ?? []), ...projected.clinicalSourceDerivedMemberKeys])] })
    }
  }
  for (const row of input.observations ?? []) accept(row, false)
  for (const row of input.vitalSigns ?? []) accept(row, false)
  for (const report of input.diagnosticReports ?? []) for (const row of report._observations ?? []) accept(row, true)
  for (const node of eligible) {
    const id = context.ids.get(node.key)!
    if (!observationsById.has(id)) observationsById.set(id, mapProjectedObservation(node.resource, node.key, { ...context, edges: new Map() }))
  }
  const activeReports = (input.diagnosticReports ?? []).filter(row => !row.clinicalSourceNodeKey || context.nodes.has(row.clinicalSourceNodeKey))
  const reportIds = new Set(activeReports.map(row => row.id))
  const activeContext: ClinicalProjectionContext = { ...context, ids: new Map([...context.ids].filter(([key, id]) => context.nodes.get(key)?.resource.resourceType === 'Observation' ? observationsById.has(id) : reportIds.has(id))) }
  for (const [id, row] of observationsById) observationsById.set(id, projectClinicalReferences(row, row.clinicalSourceNodeKey!, activeContext))
  const canonicalRows = [...observationsById.values()]
  const legacySeen = new Set<ObservationEntity>()
  for (const row of legacyRows) {
    if (!legacySeen.has(row)) { legacySeen.add(row); canonicalRows.push(row) }
  }
  const observations = canonicalRows.length === input.observations?.length && canonicalRows.every((row, index) => row === input.observations![index]) ? input.observations! : canonicalRows
  const aliases = new Map<string, ObservationEntity>()
  for (const node of source.graph.nodes) {
    if (node.resource.resourceType !== 'Observation' || node.embeddedIn) continue
    const row = observationsById.get(context.ids.get(node.key)!)
    if (row) aliases.set(node.key, row)
  }
  const next: any = { ...input, observations, clinicalSource: source }
  for (const [key, rows] of Object.entries(input)) {
    if (!Array.isArray(rows) || key === 'observations' || key === 'vitalSigns') continue
    let changed = false
    const projected = rows.filter((row: any) => {
      const active = !row?.clinicalSourceNodeKey || context.nodes.has(row.clinicalSourceNodeKey)
      if (!active) changed = true
      return active
    }).map((row: any) => {
      if (!row?.clinicalSourceNodeKey) return row
      const result = projectClinicalReferences(row, row.clinicalSourceNodeKey, activeContext)
      if (result !== row) changed = true
      return result
    })
    if (changed) next[key] = projected
  }
  next.diagnosticReports = attachReportObservations(next.diagnosticReports ?? [], observations, source, aliases)
  const vitalIds = new Set((input.vitalSigns ?? []).map(row => row.id))
  const vitalSigns = observations.filter(row => isVitalObservation(row) || vitalIds.has(row.id))
  next.vitalSigns = vitalSigns.length === input.vitalSigns?.length && vitalSigns.every((row, index) => row === input.vitalSigns![index]) ? input.vitalSigns : vitalSigns
  return next as T
}
