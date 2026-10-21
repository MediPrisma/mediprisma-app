import type { CdssPatientProfile, CdssResult } from '@voho0000/personalized-care'
import type { DiagnosticReportEntity, ObservationEntity } from '@/src/core/entities/clinical-data.entity'
import type { CdssSource } from '@/src/shared/contracts/cdss-gateway-event'
import { isNhiAuthorityDisplay } from '@/src/shared/utils/observation-provenance.utils'

type SourceRef = { resourceType?: string; resourceId?: string; sourceSystem?: string; facility?: string }

function originalInstitution(performers: readonly { display?: string }[] | undefined): string | null {
  const names = performers?.map((item) => item.display?.trim()).filter((name): name is string =>
    Boolean(name) && !isNhiAuthorityDisplay(name!)) ?? []
  return names.length ? [...new Set(names)].join(' / ').slice(0, 200) : null
}

/** Lists the resources referenced by the evaluated profile/result, including outside hospitals. */
export function cdssSourceRecords(
  profile: CdssPatientProfile,
  result: CdssResult,
  observations: readonly ObservationEntity[],
  reports: readonly DiagnosticReportEntity[],
): CdssSource[] {
  const origins = new Map<string, { institution: string | null; system: string | null }>()
  for (const item of observations) {
    if (!item.id) continue
    origins.set(`Observation/${item.id}`, {
      institution: originalInstitution(item.performer),
      system: item.meta?.source ?? null,
    })
  }
  for (const item of reports) {
    if (!item.id) continue
    origins.set(`DiagnosticReport/${item.id}`, {
      institution: originalInstitution(item.performer),
      system: item.meta?.source ?? null,
    })
  }

  const found = new Map<string, CdssSource>()
  const seen = new WeakSet<object>()
  let visited = 0
  function visit(value: unknown, depth: number): void {
    if (!value || typeof value !== 'object') return
    if (depth > 30 || ++visited > 100000) throw new Error('cdss_source_walk_limit')
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const source = value as SourceRef
    if (typeof source.resourceType === 'string' && typeof source.resourceId === 'string'
      && source.resourceType !== 'Patient'
      && source.resourceType.length <= 40 && source.resourceId.length <= 200) {
      const key = `${source.resourceType}/${source.resourceId}`
      const original = origins.get(key)
      found.set(key, {
        resource_type: source.resourceType,
        resource_id: source.resourceId,
        source_institution: original?.institution
          ?? (source.facility && !isNhiAuthorityDisplay(source.facility) ? source.facility.slice(0, 200) : null),
        source_system: original?.system ?? source.sourceSystem?.slice(0, 200) ?? null,
      })
      if (found.size > 2000) throw new Error('cdss_too_many_sources')
    }
    for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(profile, 0)
  visit(result, 0)
  return [...found.values()]
}
