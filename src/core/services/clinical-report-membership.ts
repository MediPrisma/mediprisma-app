import type { DiagnosticReportEntity, ObservationEntity } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from './clinical-reconciliation'

/** Attach only graph-resolved members across progressive query snapshots. */
export function attachReportObservations(
  reports: DiagnosticReportEntity[],
  observations: ObservationEntity[],
  source?: ClinicalReconciliationResult,
): DiagnosticReportEntity[] {
  if (reports.length === 0 || observations.length === 0) return reports

  const byId = new Map<string, ObservationEntity[]>()
  for (const observation of observations) {
    const key = 'Observation/' + observation.id
    byId.set(key, [...(byId.get(key) ?? []), observation])
  }
  const byNodeKey = new Map(observations.filter(row => row.clinicalSourceNodeKey).map(row => [row.clinicalSourceNodeKey!, row]))
  const graphEdges = new Map<string, Array<ClinicalReconciliationResult['graph']['references'][number]>>()
  for (const edge of source?.graph.references ?? []) {
    const edges = graphEdges.get(edge.origin.key) ?? []
    edges.push(edge)
    graphEdges.set(edge.origin.key, edges)
  }
  let enrichedAny = false

  const next = reports.map((report) => {
    const existing = (report as any)._observations
    if (source && report.clinicalSourceNodeKey) {
      const existingByKey = new Map<string, ObservationEntity>((Array.isArray(existing) ? existing : []).filter((row: ObservationEntity) => row.clinicalSourceNodeKey).map((row: ObservationEntity) => [row.clinicalSourceNodeKey!, row]))
      const members: ObservationEntity[] = []
      const visited = new Set<string>()
      const walk = (origin: string, kind: 'result' | 'hasMember') => {
        for (const edge of graphEdges.get(origin) ?? []) {
          if (edge.status !== 'resolved' || !(kind === 'result' ? /^result\[\d+\]$/ : /^hasMember\[\d+\]$/).test(edge.path)) continue
          const member = edge.targetKeys.map((key: string) => byNodeKey.get(key)).find(Boolean)
            ?? edge.targetKeys.map((key: string) => existingByKey.get(key)).find(Boolean)
          if (!member || visited.has(member.clinicalSourceNodeKey!)) continue
          visited.add(member.clinicalSourceNodeKey!)
          members.push(member)
          walk(member.clinicalSourceNodeKey!, 'hasMember')
        }
      }
      walk(report.clinicalSourceNodeKey, 'result')
      if (Array.isArray(existing) && existing.length === members.length && members.every((member, index) => member === existing[index])) return report
      enrichedAny = true
      return { ...report, _observations: members }
    }
    if (Array.isArray(existing) && existing.length > 0) return report
    if (!Array.isArray(report.result) || report.result.length === 0) return report

    const members = (report.result as any[])
      .map((reference: any) => {
        const matches = byId.get(reference.reference)
        return matches?.length === 1 ? matches[0] : undefined
      })
      .filter((observation): observation is ObservationEntity => observation !== undefined)

    if (members.length === 0) return report
    enrichedAny = true
    return { ...report, _observations: members }
  })

  return enrichedAny ? next : reports
}
