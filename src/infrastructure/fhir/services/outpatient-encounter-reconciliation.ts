// Operates on the canonicalised import graph, never on the stored source Bundle.
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { sharedEncounterIdentifier, conflictingSourceIdentifier } from '@/src/shared/utils/source-record-comparison'
type Resource = Record<string, any>

function isVghFacility(reference: Resource | undefined): boolean {
  const display = String(reference?.display ?? '').replace(/台/g, '臺').replace(/\s/g, '')
  return /^(臺北榮總|臺北榮民總醫院)(?:[;；]|$)/.test(display)
    || reference?.identifier?.value === '0601160016'
}

function eligible(encounter: Resource): boolean {
  return encounter.resourceType === 'Encounter' && encounter.class?.code === 'AMB'
    && ['finished', 'in-progress', 'arrived', 'unknown'].includes(encounter.status)
    && !!encounter.subject?.reference && !!encounter.period?.start?.match(/^\d{4}-\d{2}-\d{2}/)
}

function primaryDiagnosis(encounter: Resource, conditions: Map<string, Resource>): Resource | undefined {
  const ranked = encounter.diagnosis?.find((diagnosis: Resource) => diagnosis.rank === 1)
  return conditions.get(ranked?.condition?.reference)?.code ?? encounter.reasonCode?.[0]
}

function icdKey(concept: Resource | undefined): string | undefined {
  const coding = concept?.coding?.find((item: Resource) => /(?:^|\/)icd-?10(?:-?cm)?\/?$/i.test(item.system ?? '') && item.code)
  if (!coding) return undefined
  const family = /icd-?10-?cm\/?$/i.test(coding.system) ? 'icd-10-cm' : 'icd-10'
  return `${family}|${String(coding.code).trim().toUpperCase().replace(/\./g, '')}`
}

function department(encounter: Resource): string | undefined {
  const concept = encounter.serviceType?.concept ?? encounter.serviceType
  return concept?.coding?.filter((coding: Resource) => coding.system && coding.code)
    .map((coding: Resource) => `${coding.system.toLowerCase().replace(/\/$/, '')}|${coding.code}`).sort().join(';')
    || concept?.text?.trim()
}

function union(left: any[] = [], right: any[] = []): any[] {
  const seen = new Set<string>()
  return [...left, ...right].filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function physician(encounter: Resource): string | undefined {
  const names = (encounter.participant ?? []).map((participant: Resource) =>
    participant.individual?.reference || participant.individual?.display || participant.actor?.display,
  ).filter(Boolean).sort()
  return names.length ? names.join('|') : undefined
}

/** Reconcile only unique cross-source pairs: same patient, VGH facility,
 * outpatient day and coded primary ICD-10 diagnosis. Language is irrelevant.
 * Multiple same-day physicians/candidates remain separate rather than guessed.
 * The cloud id and bilingual label survive; every supplement link is retargeted.
 */
export function reconcileOutpatientEncounters(resources: Resource[]): Resource[] {
  // Both paired supplements and standalone North VGH downloads identify their
  // source explicitly, even when qemr omitted Encounter.serviceProvider.
  for (const resource of resources) {
    if (resource.resourceType === 'Encounter' && resource.class?.code === 'AMB'
      && isVghtpeSource(resource) && !resource.serviceProvider?.display?.trim()) {
      resource.serviceProvider = { ...resource.serviceProvider, display: '臺北榮總' }
    }
  }
  const conditions = new Map(resources.filter((resource) => resource.resourceType === 'Condition')
    .map((resource) => [`Condition/${resource.id}`, resource]))
  const visits = resources.filter(eligible)
  const hospital = visits.filter(isVghtpeSource)
  for (const visit of hospital) {
    if (!visit.reasonCode?.length) visit.reasonCode = (visit.diagnosis ?? [])
      .map((diagnosis: Resource) => conditions.get(diagnosis.condition?.reference)?.code).filter(Boolean)
  }
  const cloud = visits.filter((visit) => !isVghtpeSource(visit)
    && isMedcloudSource(visit)
    && isVghFacility(visit.serviceProvider))
  const candidates = new Map<Resource, Resource[]>()
  const reverse = new Map<Resource, number>()
  for (const visit of hospital) {
    // The explicit supplement tag proves this otherwise unnamed facility.
    // Do not override a contradictory, explicitly supplied facility.
    if (visit.serviceProvider && !isVghFacility(visit.serviceProvider)) continue
    const key = icdKey(primaryDiagnosis(visit, conditions))
    if (!key) continue
    const matches = cloud.filter((other) => {
      const leftPhysician = physician(visit)
      const rightPhysician = physician(other)
      const leftDepartment = department(visit), rightDepartment = department(other)
      return visit.subject.reference === other.subject.reference
        && visit.period.start.slice(0, 10) === other.period.start.slice(0, 10)
        // An exact token in WHO/CM can suggest a source comparison only.
        // It is never evidence that the two coding systems mean the same thing.
        && key.split('|')[1] === icdKey(primaryDiagnosis(other, conditions))?.split('|')[1]
        && !(leftPhysician && rightPhysician && leftPhysician !== rightPhysician)
        && !(leftDepartment && rightDepartment && leftDepartment !== rightDepartment)
        && !conflictingSourceIdentifier(visit, other)
    })
    candidates.set(visit, matches)
    for (const match of matches) reverse.set(match, (reverse.get(match) ?? 0) + 1)
  }

  const aliases = new Map<string, string>()
  const removed = new Set<Resource>()
  const ambiguousHandled = new Set<Resource>()
  for (const [visit, matches] of candidates) {
    if (matches.length !== 1 || reverse.get(matches[0]) !== 1) {
      if (!matches.length || ambiguousHandled.has(visit)) continue
      const hospitals = new Set<Resource>([visit]), clouds = new Set<Resource>(), queue = [visit]
      for (let index = 0; index < queue.length; index++) for (const possible of candidates.get(queue[index]) ?? []) {
        clouds.add(possible)
        for (const [other, otherMatches] of candidates) if (!hospitals.has(other) && otherMatches.includes(possible)) {
          hospitals.add(other); queue.push(other)
        }
      }
      const sources = [...hospitals, ...clouds]
      const comparison = { status: 'ambiguous', references: sources.map(source => `Encounter/${source.id}`) }
      sources.forEach(source => { source._sourceRecordComparison = comparison; ambiguousHandled.add(source) })
      continue
    }
    const target = matches[0]
    const codingSystemsDiffer = icdKey(primaryDiagnosis(visit, conditions)) !== icdKey(primaryDiagnosis(target, conditions))
    const comparison = { status: codingSystemsDiffer ? 'ambiguous' : sharedEncounterIdentifier(visit, target) ? 'confirmed' : 'candidate',
      references: [`Encounter/${visit.id}`, `Encounter/${target.id}`],
      ...(codingSystemsDiffer ? { warnings: ['diagnosis-coding-systems-differ'] } : {}),
    }
    visit._sourceRecordComparison = comparison
    target._sourceRecordComparison = comparison
    // Same-day facility/diagnosis agreement is useful for a comparison card,
    // but cannot establish that two source visits are one clinical event.
    if (comparison.status !== 'confirmed') continue
    target._sourceEncounterRecords = [visit, target].map((source) => {
      const { _sourceRecordComparison, _sourceEncounterRecords, ...record } = source
      return JSON.parse(JSON.stringify(record))
    })
    aliases.set(`Encounter/${visit.id}`, `Encounter/${target.id}`)
    removed.add(visit)
    for (const field of ['diagnosis', 'participant', 'location', 'identifier', 'extension', 'reasonReference']) {
      if (visit[field]?.length) target[field] = union(target[field], visit[field])
    }
    if (visit.serviceType) target.serviceType = visit.serviceType
    const reasons = [...(visit.reasonCode ?? []), ...(visit.diagnosis ?? []).map((diagnosis: Resource) =>
      conditions.get(diagnosis.condition?.reference)?.code,
    ).filter(Boolean)]
    // Keep cloud Chinese text and English coding displays for shared codes.
    // Add all remaining SOAP diagnoses without comparing their descriptions.
    target.reasonCode = [...(target.reasonCode ?? [])]
    const codes = new Set(target.reasonCode.map((reason: Resource) => icdKey(reason)).filter(Boolean))
    for (const reason of reasons) {
      const key = icdKey(reason)
      if (!key) continue
      if (codes.has(key)) {
        const existing = target.reasonCode.find((item: Resource) => icdKey(item) === key)
        const display = reason.coding?.find((coding: Resource) => coding.display)?.display
        if (display) for (const coding of existing?.coding ?? []) {
          if (!coding.display && icdKey({ coding: [coding] }) === key) coding.display = display
        }
        continue
      }
      codes.add(key)
      target.reasonCode.push(reason)
    }
    target.meta = { ...target.meta, tag: union(target.meta?.tag, [{
      system: 'urn:wildcatch:reconciliation', code: 'cloud-vghtpe-outpatient',
    }]) }
  }
  if (!removed.size) return resources
  const rewrite = (value: any): void => {
    if (!value || typeof value !== 'object') return
    if (typeof value.reference === 'string' && aliases.has(value.reference)) {
      value.reference = aliases.get(value.reference)
    }
    for (const [key, child] of Object.entries(value)) if (!key.startsWith('_')) rewrite(child)
  }
  const result = resources.filter((resource) => !removed.has(resource))
  result.filter(resource => resource.resourceType !== 'Provenance').forEach(rewrite)
  return result
}
