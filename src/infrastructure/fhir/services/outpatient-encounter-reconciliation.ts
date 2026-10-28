// Operates on the canonicalised import graph, never on the stored source Bundle.
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { sharedEncounterIdentifier, conflictingSourceIdentifier, SOURCE_EVIDENCE_FIELDS } from '@/src/shared/utils/source-record-comparison'
import { medicationClinicalDay } from '@/src/shared/utils/medication-calendar'
import { isNhiDrugCodeSystem } from './nhi-drug-terminology-enrichment.service'
import { hospitalProductMayMatchConcept, hospitalProductMayMatchKnowledge } from './hospital-medication-product-match'
type Resource = Record<string, any>

function isVghFacility(reference: Resource | undefined): boolean {
  const display = String(reference?.display ?? '').replace(/台/g, '臺').replace(/\s/g, '')
  return /^(臺北榮總|臺北榮民總醫院)(?:[;；]|$)/.test(display)
    || reference?.identifier?.value === '0601160016'
}

function eligible(encounter: Resource): boolean {
  return encounter.resourceType === 'Encounter' && encounter.class?.code === 'AMB'
    && ['finished', 'in-progress', 'arrived', 'unknown'].includes(encounter.status)
    && !!encounter.subject?.reference && typeof encounter.period?.start === 'string' && !!medicationClinicalDay(encounter.period.start)
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

function nhiCodes(concept: Resource | undefined): string[] {
  return [...new Set<string>((concept?.coding ?? []).filter((coding: Resource) => isNhiDrugCodeSystem(coding.system) && coding.code)
    .map((coding: Resource) => String(coding.code).trim().toUpperCase()))]
}

/** Leading brand word and every strength number of a recorded product label:
 *  'Aromasin SC tab 25 mg' and 'AROMASIN SUGAR COATED TABLETS 25MG' agree. */
function brandAndStrength(concept: Resource | undefined): string | undefined {
  const label = (concept?.coding ?? []).map((coding: Resource) => coding.display || coding.code)
    .concat(concept?.text).find((value: unknown) => typeof value === 'string' && /[a-z]{4}/i.test(value))
  const normalized = String(label ?? '').normalize('NFKC').toLowerCase()
  const brand = normalized.match(/^[^a-z]*([a-z]{4,})/)?.[1]
  const strengths = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:mg|mcg|g|ml|iu|%)/g)].map((match) => Number(match[1]))
  return brand && strengths.length ? `${brand}|${strengths.join('/')}` : undefined
}

/** How many of the hospital visit's orders have a like order on the cloud
 *  visit: one shared NHI code, the product match the medication reconciler
 *  accepts, or the same brand word and strength. A tie-breaker between same-day
 *  candidates only; it never confirms a visit or an order. */
function prescriptionOverlap(hospital: Resource[], cloud: Resource[], resources: Map<string, Resource>): number {
  const concept = (order: Resource) => order.medicationCodeableConcept ?? resources.get(order.medicationReference?.reference)?.code
  return hospital.filter((order) => cloud.some((other) => {
    const left = nhiCodes(concept(order)), right = nhiCodes(concept(other))
    if (right.length !== 1) return false
    if (left.length) return left.length === 1 && left[0] === right[0]
    const linked = (other.supportingInformation ?? []).map((reference: Resource) => resources.get(reference.reference))
      .filter((item: Resource | undefined) => item?.resourceType === 'MedicationKnowledge')
    if (linked.length === 1 && hospitalProductMayMatchKnowledge(concept(order), right[0], linked[0])) return true
    if (!linked.length && hospitalProductMayMatchConcept(concept(order), concept(other))) return true
    const recorded = brandAndStrength(concept(order))
    return !!recorded && recorded === brandAndStrength(concept(other))
  })).length
}

/** Pair same-day candidates whose prescriptions point to one another and to
 *  nobody else: each side's overlap must be strictly higher than with any other
 *  candidate still open. Ties and zero overlap stay unpaired. */
function pairByPrescriptions(edges: Array<[Resource, Resource, number]>): Array<[Resource, Resource]> {
  const pairs: Array<[Resource, Resource]> = []
  let open = edges.filter(([, , score]) => score > 0)
  for (;;) {
    const decisive = open.filter(([hospital, cloud, score]) => open.every(([otherHospital, otherCloud, otherScore]) =>
      (otherHospital === hospital && otherCloud === cloud) || (otherHospital !== hospital && otherCloud !== cloud) || otherScore < score))
    if (!decisive.length) return pairs
    for (const [hospital, cloud] of decisive) pairs.push([hospital, cloud])
    open = open.filter(([hospital, cloud]) => !decisive.some(([h, c]) => h === hospital || c === cloud))
  }
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
        && medicationClinicalDay(visit.period.start) === medicationClinicalDay(other.period.start)
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
  const resourcesByReference = new Map(resources.filter((resource) => resource.id)
    .map((resource) => [`${resource.resourceType}/${resource.id}`, resource]))
  const ordersByVisit = new Map<string, Resource[]>()
  for (const resource of resources) {
    const reference = resource.resourceType === 'MedicationRequest' ? resource.encounter?.reference : undefined
    if (reference) ordersByVisit.set(reference, [...(ordersByVisit.get(reference) ?? []), resource])
  }
  const pair = (visit: Resource, target: Resource, warnings: string[] = []) => {
    const codingSystemsDiffer = icdKey(primaryDiagnosis(visit, conditions)) !== icdKey(primaryDiagnosis(target, conditions))
    const allWarnings = [...warnings, ...(codingSystemsDiffer ? ['diagnosis-coding-systems-differ'] : [])]
    const comparison = { status: codingSystemsDiffer ? 'ambiguous' : sharedEncounterIdentifier(visit, target) ? 'confirmed' : 'candidate',
      references: [`Encounter/${visit.id}`, `Encounter/${target.id}`],
      ...(allWarnings.length ? { warnings: allWarnings } : {}),
    }
    visit._sourceRecordComparison = comparison
    target._sourceRecordComparison = comparison
    // Same-day facility/diagnosis agreement is useful for a comparison card,
    // but cannot establish that two source visits are one clinical event.
    if (comparison.status !== 'confirmed') return
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
      ;[...hospitals, ...clouds].forEach(source => ambiguousHandled.add(source))
      // Two same-day clinics with one primary code: the prescriptions decide
      // which cloud claim belongs to which hospital visit, when they can.
      const paired = pairByPrescriptions([...hospitals].flatMap((hospital) => (candidates.get(hospital) ?? [])
        .map((cloud): [Resource, Resource, number] => [hospital, cloud, prescriptionOverlap(
          ordersByVisit.get(`Encounter/${hospital.id}`) ?? [], ordersByVisit.get(`Encounter/${cloud.id}`) ?? [], resourcesByReference)])))
      for (const [hospital, cloud] of paired) {
        pair(hospital, cloud, ['paired-by-prescriptions'])
        hospitals.delete(hospital); clouds.delete(cloud)
      }
      // Whatever the prescriptions could not separate stays one comparison.
      const linked = (hospital: Resource) => (candidates.get(hospital) ?? []).some((cloud) => clouds.has(cloud))
      const sources = [...[...hospitals].filter(linked), ...[...clouds].filter((cloud) => [...hospitals].some((hospital) =>
        candidates.get(hospital)?.includes(cloud)))]
      if (sources.length < 2) continue
      // Once the prescriptions separated one pair, a single pair left over
      // has no rival either.
      if (paired.length && sources.length === 2) {
        pair(sources[0], sources[1], ['paired-by-prescriptions'])
        continue
      }
      const comparison = { status: 'ambiguous', references: sources.map(source => `Encounter/${source.id}`) }
      sources.forEach(source => { source._sourceRecordComparison = comparison })
      continue
    }
    pair(visit, matches[0])
  }
  if (!removed.size) return resources
  const rewrite = (value: any): void => {
    if (!value || typeof value !== 'object') return
    if (typeof value.reference === 'string' && aliases.has(value.reference)) {
      value.reference = aliases.get(value.reference)
    }
    for (const [key, child] of Object.entries(value)) if (!SOURCE_EVIDENCE_FIELDS.has(key)) rewrite(child)
  }
  const result = resources.filter((resource) => !removed.has(resource))
  result.filter(resource => resource.resourceType !== 'Provenance').forEach(rewrite)
  return result
}
