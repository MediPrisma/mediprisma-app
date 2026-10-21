import type { ProcedureEntity } from '@/src/core/entities/clinical-data.entity'
import type { ResourceNavTarget } from '@/src/application/stores/resource-navigation.store'
import { referenceId } from '@/src/core/utils/observation-selectors'

export function navigationEncounterId(
  target: ResourceNavTarget | null,
  procedures: ProcedureEntity[],
): string | undefined {
  if (!target) return undefined
  if (target.resourceType === 'Encounter') return target.resourceId
  if (target.resourceType !== 'Procedure') return undefined

  const procedure = procedures.find((item) => item.id === target.resourceId)
  return referenceId(procedure?.encounter?.reference)
}

export function visibleCountForNavigation(
  visits: Array<{ id: string; date: string; sourceIds?: string[] }>,
  encounterId: string,
  pageSize: number,
): number | undefined {
  const orderedVisits = [...visits].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )
  const visitIndex = orderedVisits.findIndex((visit) => visit.id === encounterId || visit.sourceIds?.includes(encounterId))
  return visitIndex < 0 ? undefined : Math.max(pageSize, visitIndex + 1)
}
