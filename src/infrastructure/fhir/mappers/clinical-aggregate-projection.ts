import { includeCapturedClinicalRows } from './clinical-graph-intake'
import { getClinicalSourceNodePatientExclusionReason, isClinicalSourceNodePatientEligible } from '@/src/core/services/clinical-patient-scope'
import { createClinicalRecordVariants } from '@/src/core/services/clinical-record-variants'
import type { ClinicalDataCollection, ObservationEntity } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'
import { clinicalSourceNodesEqualWithContext } from '@/src/core/services/clinical-source-context'
import { attachReportObservations } from '@/src/core/services/clinical-report-membership'
import { isVitalObservation } from '@/src/core/utils/observation-selectors'
import { mutableClinicalProjection } from '../services/clinical-source-session'
import { FhirMapper } from './fhir.mapper'
import { projectClinicalMedicationContents, projectClinicalMedicationQueryStatus } from './clinical-medication-projection'

type SourceNode = ClinicalReconciliationResult['graph']['nodes'][number]
type SourceEdge = ClinicalReconciliationResult['graph']['references'][number]
export interface ClinicalProjectionContext {
  ids: ReadonlyMap<string, string>
  nodes: Map<string, SourceNode>
  edges: Map<string, SourceEdge[]>
}
export function createClinicalProjectionContext(source: ClinicalReconciliationResult, genericNodeKeys?: ReadonlySet<string>): ClinicalProjectionContext {
  const context: ClinicalProjectionContext = { ids: createClinicalSourceProjectionIds(source, genericNodeKeys), nodes: new Map(source.graph.nodes.map(node => [node.key, node])), edges: new Map() }
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
    const target = edge.targetKeys.map(key => context.nodes.get(key)).find(node => node && context.ids.has(node.key))
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
    sourceVersionId: resource.meta?.versionId,
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
  input = includeCapturedClinicalRows(input, source)
  const mappedNodeKeys = new Set(Object.values(input).filter(Array.isArray).flatMap(rows => rows.flatMap((row: any) => row?.clinicalSourceNodeKey ? [row.clinicalSourceNodeKey as string] : [])))
  const context = createClinicalProjectionContext(source, mappedNodeKeys)
  for (const [key, node] of context.nodes) if (!isClinicalSourceNodePatientEligible(node, source.graph.nodes)) context.nodes.delete(key)
  const variants = createClinicalRecordVariants(source)
  const annotate = <R extends { clinicalSourceNodeKey?: string; clinicalRecordVariant?: unknown }>(row: R): R => {
    const variant = row.clinicalSourceNodeKey ? variants.get(row.clinicalSourceNodeKey) : undefined
    if (JSON.stringify(row.clinicalRecordVariant) === JSON.stringify(variant)) return row
    const { clinicalRecordVariant: _previous, ...rest } = row
    return { ...rest, ...(variant ? { clinicalRecordVariant: variant } : {}) } as R
  }
  const activeNodes = selectClinicalSourceNodes(source)
  const activeKeys = new Set(activeNodes.map(node => node.key))
  const eligible = activeNodes.filter(node => node.resource.resourceType === 'Observation')
  // A resolved clinical member is an active result, including #contained
  // panels and their siblings. Merely storing a snapshot inside an audit
  // resource never promotes it into the patient's measurements.
  const pending = [
    ...eligible.map(node => node.key),
    ...(input.diagnosticReports ?? []).flatMap(row => row.clinicalSourceNodeKey && activeKeys.has(row.clinicalSourceNodeKey) ? [row.clinicalSourceNodeKey] : []),
  ]
  const visited = new Set<string>()
  const promoted = new Set<string>()
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index]
    if (visited.has(key)) continue
    visited.add(key)
    const origin = context.nodes.get(key)
    if (!origin) continue
    for (const edge of context.edges.get(key) ?? []) {
      if (edge.status !== 'resolved' || !/^(result|hasMember)\[\d+\]$/.test(edge.path)) continue
      for (const targetKey of edge.targetKeys) {
        const target = context.nodes.get(targetKey)
        if (!target || target.resource.resourceType !== 'Observation' || target.embeddedIn) continue
        if (target.isContained) {
          const owner = context.nodes.get(target.parentKey ?? '')
          if (!owner || !['DiagnosticReport', 'Observation'].includes(owner.resource.resourceType)) continue
          if (target.parentKey !== origin.key && target.parentKey !== origin.parentKey) continue
          if (!promoted.has(targetKey)) { promoted.add(targetKey); eligible.push(target) }
        } else if (!activeKeys.has(targetKey)) continue
        pending.push(targetKey)
      }
    }
  }
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
  const alignRecordId = <R extends { id?: string; sourceId?: string; clinicalSourceNodeKey?: string }>(row: R): R => {
    const key = row.clinicalSourceNodeKey
    const node = key ? context.nodes.get(key) : undefined
    const id = node ? context.ids.get(node.key) : undefined
    return id && id !== row.id ? { ...row, id, sourceId: node?.resource.id ?? row.sourceId ?? row.id } : row
  }
  const activeReports = (input.diagnosticReports ?? []).filter(row => !row.clinicalSourceNodeKey || context.nodes.has(row.clinicalSourceNodeKey)).map(alignRecordId)
  const reportIds = new Set(activeReports.map(row => row.id))
  const visibleGenericIds = new Set(Object.entries(input).filter(([key, rows]) => Array.isArray(rows) && !['observations', 'vitalSigns', 'diagnosticReports'].includes(key)).flatMap(([, rows]) => (rows as Array<{ clinicalSourceNodeKey?: string }>).flatMap(row => row.clinicalSourceNodeKey && context.nodes.has(row.clinicalSourceNodeKey) ? [context.ids.get(row.clinicalSourceNodeKey)] : [])))
  const activeContext: ClinicalProjectionContext = { ...context, ids: new Map([...context.ids].filter(([key, id]) => {
    const type = context.nodes.get(key)?.resource.resourceType
    return type === 'Observation' ? observationsById.has(id) : type === 'DiagnosticReport' ? reportIds.has(id) : Boolean(type && visibleGenericIds.has(id))
  })) }
  for (const [id, row] of observationsById) observationsById.set(id, annotate(projectClinicalReferences(row, row.clinicalSourceNodeKey!, activeContext)))
  const canonicalRows = [...observationsById.values()]
  const legacySeen = new Set<ObservationEntity>()
  for (const row of legacyRows) {
    if (!legacySeen.has(row)) { legacySeen.add(row); canonicalRows.push(row) }
  }
  const observations = canonicalRows.length === input.observations?.length && canonicalRows.every((row, index) => row === input.observations![index]) ? input.observations! : canonicalRows
  const aliases = new Map<string, ObservationEntity>()
  for (const node of source.graph.nodes) {
    if (node.resource.resourceType !== 'Observation' || node.embeddedIn || !context.nodes.has(node.key)) continue
    const row = observationsById.get(context.ids.get(node.key)!)
    if (row) aliases.set(node.key, row)
  }
  const next: any = { ...input, observations, clinicalSource: source }
  for (const [key, rows] of Object.entries(input)) {
    if (!Array.isArray(rows) || key === 'observations' || key === 'vitalSigns') continue
    let changed = false
    const retainedSources = new Map<string, SourceNode[]>()
    const projected = rows.filter((row: any) => {
      const active = !row?.clinicalSourceNodeKey || context.nodes.has(row.clinicalSourceNodeKey)
      if (!active) changed = true
      if (!active) return false
      const node = row?.clinicalSourceNodeKey ? context.nodes.get(row.clinicalSourceNodeKey) : undefined
      if (!node || (!node.resource.id && !node.fullUrl)) return true
      const identity = JSON.stringify([node.resource.resourceType, node.resource.id ?? null, node.fullUrl ?? null])
      const candidates = retainedSources.get(identity) ?? []
      if (candidates.some(prior => clinicalSourceNodesEqualWithContext(source.graph, prior, node))) {
        changed = true
        return false
      }
      candidates.push(node)
      retainedSources.set(identity, candidates)
      return true
    }).map((row: any) => {
      if (!row?.clinicalSourceNodeKey) return row
      const result = annotate(projectClinicalReferences(alignRecordId(row), row.clinicalSourceNodeKey, activeContext))
      if (result !== row) changed = true
      return result
    })
    if (changed) next[key] = projected
  }
  if (next.medications) next.medications = projectClinicalMedicationContents(next.medications, source)
  next.diagnosticReports = attachReportObservations(next.diagnosticReports ?? [], observations, source, aliases)
  const vitalIds = new Set((input.vitalSigns ?? []).map(row => row.id))
  const vitalSigns = observations.filter(row => isVitalObservation(row) || vitalIds.has(row.id))
  next.vitalSigns = vitalSigns.length === input.vitalSigns?.length && vitalSigns.every((row, index) => row === input.vitalSigns![index]) ? input.vitalSigns : vitalSigns
  // Projection and completeness must use the same final graph: another query
  // can resolve an opaque Patient reference after this query was marked ok.
  if (input.resourceQueryStatus) {
    const arrayByType: Record<string, string> = { Condition: 'conditions', MedicationRequest: 'medications', MedicationStatement: 'medications', AllergyIntolerance: 'allergies', Observation: 'observations', DiagnosticReport: 'diagnosticReports', Encounter: 'encounters', Procedure: 'procedures', ImagingStudy: 'imagingStudies', DocumentReference: 'documentReferences', Composition: 'compositions', Immunization: 'immunizations', CarePlan: 'carePlans', Consent: 'consents', Device: 'devices', Basic: 'medicationRemainingSummaries' }
    const captureKey = (node: SourceNode) => JSON.stringify([node.sourceId, node.patientScope, node.generation])
    const reportCaptures = new Set(source.graph.nodes.filter(node => !node.isContained && !node.embeddedIn && node.resource.resourceType === 'DiagnosticReport').map(captureKey))
    const exclusions = new Map<string, { 'foreign-patient-reference'?: number; 'unresolved-patient-reference'?: number }>()
    for (const node of source.graph.nodes) {
      if (node.isContained || node.embeddedIn) continue
      const reason = getClinicalSourceNodePatientExclusionReason(node, source.graph.nodes)
      if (!reason) continue
      const types = [node.resource.resourceType, ...(node.resource.resourceType === 'Observation' && reportCaptures.has(captureKey(node)) ? ['DiagnosticReport'] : [])]
      for (const type of types) {
        const counts = exclusions.get(type) ?? {}
        counts[reason] = (counts[reason] ?? 0) + node.occurrences
        exclusions.set(type, counts)
      }
    }
    let statuses = input.resourceQueryStatus
    for (const [key, status] of Object.entries(input.resourceQueryStatus)) {
      if (!status) continue
      const type = key.split(':')[0]
      const counts = exclusions.get(type)
      const excludedCount = Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0)
      if (!excludedCount) {
        if (status.state === 'ok' || status.state === 'empty') {
          const rows = key === 'Observation:vital-signs' ? next.vitalSigns : next[arrayByType[type]]
          if (Array.isArray(rows)) {
            const count = rows.filter((row: any) => !row.clinicalSourceNodeKey || context.nodes.get(row.clinicalSourceNodeKey)?.resource.resourceType === type).length
            const state = count ? 'ok' : 'empty'
            if (count !== status.count || state !== status.state) {
              if (statuses === input.resourceQueryStatus) statuses = { ...statuses }
              statuses[key as keyof typeof statuses] = { ...status, count, state }
            }
          }
        }
        continue
      }
      // Retain real transport/auth failures rather than replacing them with success.
      if (!status.exclusionReason && status.state !== 'ok' && status.state !== 'empty') continue
      const rows = key === 'Observation:vital-signs' ? next.vitalSigns : next[arrayByType[type]]
      const count = Array.isArray(rows) ? rows.filter((row: any) => !row.clinicalSourceNodeKey || context.nodes.get(row.clinicalSourceNodeKey)?.resource.resourceType === type).length : status.count
      const { excludedCount: _oldCount, exclusionReason: _oldReason, exclusionCounts: _oldCounts, message: _oldMessage, ...rest } = status
      const projectedStatus = { ...rest, count, state: 'error', excludedCount, exclusionCounts: counts,
        exclusionReason: counts?.['unresolved-patient-reference'] ? 'unresolved-patient-reference' : 'foreign-patient-reference',
        message: 'Some returned clinical records have foreign or unresolved patient ownership and were excluded. This domain is incomplete; absence cannot be concluded.' }

      if (JSON.stringify(projectedStatus) !== JSON.stringify(status)) {
        if (statuses === input.resourceQueryStatus) statuses = { ...statuses }
        statuses[key as keyof typeof statuses] = projectedStatus as typeof status
      }
    }
    next.resourceQueryStatus = statuses
  }
  next.resourceQueryStatus = projectClinicalMedicationQueryStatus(next.medications ?? [], next.resourceQueryStatus)
  return next as T
}
