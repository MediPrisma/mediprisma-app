import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { isNhiDrugCodeSystem } from './nhi-drug-terminology-enrichment.service'
import { sourceSelfPurchase, hasExplicitChronicNote, hasCloudCoverageDerivedStatus } from '@/src/shared/utils/medication-source-markers'
import { hospitalProductMatchesKnowledge, hospitalProductMayMatchKnowledge } from './hospital-medication-product-match'
import { sharedPrescriptionIdentifier, conflictingSourceIdentifier, SOURCE_EVIDENCE_FIELDS } from '@/src/shared/utils/source-record-comparison'
import { extractFrequencyFromText } from '@/src/shared/utils/fhir-display-helpers'

type Resource = Record<string, any>
const SOURCE_MODULE = 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module'
const cloneSource = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

function conceptKey(concept: any): string | undefined {
  const codes = concept?.coding?.filter((coding: any) => coding?.code)
    .map((coding: any) => [coding.system ?? '', coding.code])
  return codes?.length ? JSON.stringify(codes) : concept?.text?.trim() || undefined
}

function quantityConflicts(left: any, right: any): boolean {
  if (!left || !right) return false
  if (left.value !== undefined && right.value !== undefined && left.value !== right.value) return true
  const leftUnit = left.code || left.unit
  const rightUnit = right.code || right.unit
  return !!leftUnit && !!rightUnit && leftUnit !== rightUnit
}

function frequencyConflicts(left: string, right: string): boolean {
  const parts = (value: string) => {
    const meal = value.match(/^(QD|BID|TID|QID)(AC|PC|CC)$/)
    return meal ? [meal[1], meal[2]] : [value, undefined]
  }
  const a = parts(left), b = parts(right)
  return a[0] !== b[0] || !!a[1] && !!b[1] && a[1] !== b[1]
}

function frequencyKey(dosage: any): string | undefined {
  const knownFrequency = (value: unknown) => typeof value === 'string'
    && /^(?:QD|BID|TID|QID)(?:AC|PC|CC)?$|^(?:Q\d+H|QOD|QW|QHS|HS|PRN|STAT|ASORDER)$/i.test(value.trim())
    ? value.trim().toUpperCase() : undefined
  const codes = [...new Set((dosage?.timing?.code?.coding ?? [])
    .map((coding: any) => knownFrequency(coding.code)).filter(Boolean))]
  const repeat = dosage?.timing?.repeat
  let repeatCode: string | undefined
  if (repeat?.period === 1 && repeat.periodUnit === 'd') repeatCode = ({ 1: 'QD', 2: 'BID', 3: 'TID', 4: 'QID' } as Record<number, string>)[repeat.frequency]
  if (repeat?.frequency === 1 && repeat.periodUnit === 'h' && repeat.period > 0) repeatCode = `Q${repeat.period}H`
  if (!repeatCode && repeat?.frequency > 0 && repeat?.period > 0 && repeat.periodUnit) repeatCode = `repeat:${repeat.frequency}/${repeat.period}${repeat.periodUnit}`
  if (repeatCode && repeat.when?.length === 1 && ['AC', 'PC'].includes(repeat.when[0])) repeatCode += repeat.when[0]
  const values = [...new Set([...codes, repeatCode, knownFrequency(dosage?.timing?.code?.text),
    knownFrequency(dosage?.text), knownFrequency(extractFrequencyFromText(dosage?.text))].filter(Boolean))] as string[]
  return values.some(left => values.some(right => frequencyConflicts(left, right)))
    ? '!conflicting-source-frequency!' : values.find(value => /(?:AC|PC|CC)$/.test(value)) ?? values[0]
}

function hasConflict(hospital: Resource, cloud: Resource): boolean {
  // A self-pay addition and an insured claim may legitimately share a product
  // and visit. Never erase that distinction as a presumed source duplicate.
  if (sourceSelfPurchase(hospital) === true) return true
  for (const identifier of hospital.identifier ?? []) {
    if (!identifier.system || !identifier.value) continue
    const sameIssuer = (cloud.identifier ?? []).filter((other: any) => other.system === identifier.system && other.value)
    if (sameIssuer.length && !sameIssuer.some((other: any) => other.value === identifier.value)) return true
  }
  const known = (status: string | undefined) => !!status && status !== 'unknown'
  // IMUE0008's mapper computes active/completed from date + supply days; it
  // is not a source-reported stop/cancellation. Preserve hospital workflow
  // status while allowing two snapshots of the same order to be paired.
  const cloudCoverageStatus = [hospital.status, cloud.status].every((status) => ['active', 'completed'].includes(status))
    && cloud.meta?.tag?.some((tag: any) => tag.system === SOURCE_MODULE && String(tag.code).toUpperCase() === 'IMUE0008')
  if (hospital.status !== cloud.status && !cloudCoverageStatus
    && [hospital.status, cloud.status].some(status => ['stopped', 'cancelled', 'entered-in-error', 'on-hold', 'draft', 'completed'].includes(status))
    && (known(hospital.status) && known(cloud.status) || !sharedPrescriptionIdentifier(hospital, cloud))) return true
  if (known(hospital.status) && known(cloud.status) && hospital.status !== cloud.status && !cloudCoverageStatus) return true
  if (hospital.intent && cloud.intent && hospital.intent !== cloud.intent) return true
  for (const field of ['quantity', 'expectedSupplyDuration']) {
    if (quantityConflicts(hospital.dispenseRequest?.[field], cloud.dispenseRequest?.[field])) return true
  }
  for (const edge of ['start', 'end']) {
    const left = hospital.dispenseRequest?.validityPeriod?.[edge]
    const right = cloud.dispenseRequest?.validityPeriod?.[edge]
    if (left && right && left !== right
      && !(left.length === 10 || right.length === 10 ? left.slice(0, 10) === right.slice(0, 10) : Date.parse(left) === Date.parse(right))) return true
  }
  const hospitalTherapy = conceptKey(hospital.courseOfTherapyType)
  const cloudTherapy = conceptKey(cloud.courseOfTherapyType)
  if (hospitalTherapy && cloudTherapy && hospitalTherapy !== cloudTherapy) return true
  const hospitalDoses = hospital.dosageInstruction ?? []
  const cloudDoses = cloud.dosageInstruction ?? []
  // Multiple SIG lines cannot be paired by position across sources.
  if (hospitalDoses.length && cloudDoses.length && (hospitalDoses.length > 1 || cloudDoses.length > 1)) return true
  const left = hospitalDoses[0]
  const right = cloudDoses[0]
  if (left && right) {
    if (left.doseAndRate?.length && right.doseAndRate?.length
      && (left.doseAndRate.length > 1 || right.doseAndRate.length > 1)) return true
    if (quantityConflicts(left.doseAndRate?.[0]?.doseQuantity, right.doseAndRate?.[0]?.doseQuantity)) return true
    const aDose = left.doseAndRate?.[0], bDose = right.doseAndRate?.[0]
    if ((aDose?.doseRange && bDose?.doseQuantity) || (aDose?.doseQuantity && bDose?.doseRange)) return true
    for (const edge of ['low', 'high']) {
      if (quantityConflicts(aDose?.doseRange?.[edge], bDose?.doseRange?.[edge])) return true
    }
    const leftFrequency = frequencyKey(left)
    const rightFrequency = frequencyKey(right)
    if ([leftFrequency, rightFrequency].includes('!conflicting-source-frequency!')) return true
    if (leftFrequency && rightFrequency && frequencyConflicts(leftFrequency, rightFrequency)) return true
    if (left.asNeededBoolean !== undefined && right.asNeededBoolean !== undefined && left.asNeededBoolean !== right.asNeededBoolean) return true
    for (const field of ['asNeededCodeableConcept', 'site', 'method']) {
      const a = conceptKey(left[field]), b = conceptKey(right[field])
      if (a && b && a !== b) return true
    }
    for (const [a, b] of [[conceptKey(left.route), conceptKey(right.route)],
      [leftFrequency && rightFrequency ? undefined : conceptKey(left.timing?.code), leftFrequency && rightFrequency ? undefined : conceptKey(right.timing?.code)],
      [left.timing?.repeat && JSON.stringify(left.timing.repeat), right.timing?.repeat && JSON.stringify(right.timing.repeat)]]) {
      if (a && b && a !== b) return true
    }
    // MediCloud may record only "QDPC" where the hospital records
    // "1 TAB PO QDPC". Compare that frequency with the structured frequency,
    // rather than treating the short frequency as a contradictory full SIG.
    const sig = (dose: any) => typeof dose.text === 'string' && !/^(?:QD|BID|TID|QID)(?:AC|PC|CC)?$|^(?:Q\d+H|QOD|QW|QHS|HS|PRN|STAT|ASORDER)$/i.test(dose.text.trim())
      && !/^\s*(?:給藥總量|給藥日數|平均每日)/.test(dose.text)
      ? dose.text.trim() : undefined
    if (sig(left) && sig(right) && sig(left) !== sig(right)) return true
    if ((sig(left) && rightFrequency && !leftFrequency) || (sig(right) && leftFrequency && !rightFrequency)) return true
    // A full text SIG cannot be proven compatible with an unpaired structured
    // dose. Keep both sources instead of adding e.g. "2 TAB" to "1 TAB PO QD".
    if (sig(left) && !aDose && (bDose?.doseQuantity || bDose?.doseRange)
      || sig(right) && !bDose && (aDose?.doseQuantity || aDose?.doseRange)) return true
    for (const field of ['route', 'asNeededBoolean', 'asNeededCodeableConcept', 'site', 'method']) {
      if (sig(left) && left[field] === undefined && right[field] !== undefined
        || sig(right) && right[field] === undefined && left[field] !== undefined) return true
    }
  }
  return false
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

/** Same canonical visit, prescription day and patient, with an exact NHI
 * product code or a verified complete product-name match to cloud knowledge.
 * Requires a unique cross-source match and no conflicting order facts.
 * Ingredient/name similarity alone never establishes that orders are copies.
 * Raw source Bundles are retained by LocalBundleService; only its cloned graph
 * is reconciled, with source references recorded on the representative order.
 */
export function reconcileMedicationRequests(resources: Resource[]): Resource[] {
  for (const order of resources) {
    if (order.resourceType === 'MedicationRequest' && isVghtpeSource(order)
      && !order.courseOfTherapyType && hasExplicitChronicNote(order)) {
      order.courseOfTherapyType = { coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/medicationrequest-course-of-therapy', code: 'continuous',
      }] }
    }
  }
  const medications = new Map(resources.filter((resource) => resource.resourceType === 'Medication')
    .map((resource) => [`Medication/${resource.id}`, resource]))
  const knowledge = new Map(resources.filter((resource) => resource.resourceType === 'MedicationKnowledge')
    .map((resource) => [`MedicationKnowledge/${resource.id}`, resource]))
  const encounters = new Map(resources.filter((resource) => resource.resourceType === 'Encounter')
    .map((resource) => [`Encounter/${resource.id}`, resource]))
  const vghDisplay = (display: unknown) => /^(?:臺|台)北榮(?:總|民總醫院)(?:[;；\s]|$)/.test(String(display ?? '').trim())
  const visitKey = (visit: Resource) => visit._sourceRecordComparison?.references?.join('|') ?? `Encounter/${visit.id}`
  const identity = (order: Resource) => {
    if (order.resourceType !== 'MedicationRequest' || !order.subject?.reference) return undefined
    if (order.meta?.tag?.some((tag: any) => tag.system === SOURCE_MODULE && String(tag.code).toUpperCase() === 'IMUE0120')) return undefined
    const day = order.authoredOn?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
    const reference = order.medicationReference?.reference
    const concept = order.medicationCodeableConcept ?? (reference?.startsWith('#')
      ? order.contained?.find((resource: Resource) => resource.resourceType === 'Medication' && resource.id === reference.slice(1))?.code
      : medications.get(reference)?.code)
    const codes = [...new Set((concept?.coding ?? []).filter((coding: any) => isNhiDrugCodeSystem(coding.system) && coding.code)
      .map((coding: any) => String(coding.code).trim().toUpperCase()))]
    const visit = encounters.get(order.encounter?.reference)
    if (visit?.class?.code && visit.class.code !== 'AMB') return undefined
    let contextVisit = visit ? visitKey(visit) : order.encounter?.reference
    const inferred = !order.encounter?.reference || !!order._encounterInferred
    if (inferred) {
      // A unique day/facility context may suggest comparison, but is never
      // written as a source Encounter reference or used for confirmed removal.
      if (!vghDisplay(order.requester?.display) && !(isVghtpeSource(order) && !order.requester?.display)) return undefined
      const possible = new Set([...encounters.values()].filter(candidate => candidate.class?.code === 'AMB'
        && candidate.subject?.reference === order.subject.reference
        && candidate.period?.start?.slice(0, 10) === day
        && vghDisplay(candidate.serviceProvider?.display)
        && !['cancelled', 'entered-in-error', 'planned'].includes(candidate.status)).map(visitKey))
      if (possible.size !== 1) return undefined
      contextVisit = [...possible][0]
    }
    return day && contextVisit ? { context: JSON.stringify([order.subject.reference, contextVisit, day]), codes, concept, inferred,
      visitUnconfirmed: !!visit?._sourceRecordComparison && visit._sourceRecordComparison.status !== 'confirmed',
      visitCodingConflict: visit?._sourceRecordComparison?.warnings?.includes('diagnosis-coding-systems-differ') } : undefined
  }
  const keyed = resources.map((order) => ({ order, key: identity(order) })).filter((entry) => entry.key)
  const hospital = keyed.filter(({ order }) => isVghtpeSource(order))
  const cloud = keyed.filter(({ order }) => isMedcloudSource(order) && !isVghtpeSource(order))
  const candidates = new Map<Resource, Resource[]>()
  const verifiedPairs = new Map<Resource, Set<Resource>>()
  const conflictingPairs = new Map<Resource, Set<Resource>>()
  for (const { order, key } of hospital) {
    const matches = cloud.filter((other) => {
      if (!key || !other.key || other.key.context !== key.context
        || sourceSelfPurchase(order) === true || conflictingSourceIdentifier(order, other.order)) return false
      if (hasConflict(order, other.order)) {
        const conflicts = conflictingPairs.get(order) ?? new Set<Resource>()
        conflicts.add(other.order); conflictingPairs.set(order, conflicts)
      }
      if (key.codes.length === 1 && other.key.codes.length === 1) {
        if (key.codes[0] !== other.key.codes[0]) return false
        const verified = verifiedPairs.get(order) ?? new Set<Resource>()
        verified.add(other.order); verifiedPairs.set(order, verified)
        return true
      }
      // Only a genuinely uncoded hospital product may use the name path. A
      // conflicting/ambiguous source code must never be bypassed by its name.
      if (key.codes.length || other.key.codes.length !== 1) return false
      const linked = (other.order.supportingInformation ?? []).map((reference: any) => knowledge.get(reference.reference))
        .filter(Boolean) as Resource[]
      if (linked.length !== 1) return false
      if (hospitalProductMatchesKnowledge(key.concept, String(other.key.codes[0]), linked[0])) {
        const verified = verifiedPairs.get(order) ?? new Set<Resource>()
        verified.add(other.order); verifiedPairs.set(order, verified)
        return true
      }
      return hospitalProductMayMatchKnowledge(key.concept, String(other.key.codes[0]), linked[0])
    }).map((other) => other.order)
    candidates.set(order, matches)
  }
  const aliases = new Map<string, string>()
  const removed = new Set<Resource>()
  const handled = new Set<Resource>()
  for (const [order, matches] of candidates) {
    if (!matches.length || handled.has(order)) continue
    const hospitalGroup = new Set<Resource>([order]), cloudGroup = new Set<Resource>()
    const queue = [order]
    for (let index = 0; index < queue.length; index++) {
      for (const possible of candidates.get(queue[index]) ?? []) {
        cloudGroup.add(possible)
        for (const [otherHospital, otherMatches] of candidates) {
          if (!hospitalGroup.has(otherHospital) && otherMatches.includes(possible)) {
            hospitalGroup.add(otherHospital); queue.push(otherHospital)
          }
        }
      }
    }
    const group = [...hospitalGroup, ...cloudGroup]
    group.forEach(member => handled.add(member))
    const other = matches[0]
    const unique = hospitalGroup.size === 1 && cloudGroup.size === 1
    const contextInferred = group.some(member => identity(member)?.inferred || identity(member)?.visitUnconfirmed)
    const visitCodingConflict = group.some(member => identity(member)?.visitCodingConflict)
    const factsConflict = [...hospitalGroup].some(member => [...cloudGroup].some(partner => conflictingPairs.get(member)?.has(partner)))
    const confirmed = unique && verifiedPairs.get(order)?.has(other) && sharedPrescriptionIdentifier(order, other) && !contextInferred && !visitCodingConflict && !factsConflict
    const statusConflict = !confirmed && [...hospitalGroup].some(member => ['cancelled', 'stopped', 'entered-in-error', 'on-hold'].includes(member.status))
      && [...cloudGroup].some(member => ['active', 'unknown'].includes(member.status || 'unknown'))
    const warnings = [...(contextInferred ? ['encounter-link-unconfirmed'] : []), ...(factsConflict ? ['source-facts-differ'] : []), ...(statusConflict ? ['source-status-conflict'] : [])]
    const comparison = { status: confirmed ? 'confirmed' : unique ? 'candidate' : 'ambiguous',
      references: group.map(member => `MedicationRequest/${member.id}`),
      sourceStatuses: group.map(member => ({ reference: `MedicationRequest/${member.id}`, origin: isVghtpeSource(member) ? 'hospital' : 'medcloud',
        status: member.status || 'unknown', basis: hasCloudCoverageDerivedStatus(member) ? 'coverage-estimate' : 'source-status' })),
      ...(warnings.length ? { warnings } : {}),
    }
    group.forEach(member => { member._sourceRecordComparison = comparison })
    if (!confirmed) continue
    // Retain both original regimens for source inspection even when fields
    // are filled from the complementary source on the canonical order.
    order._sourcePrescriptionRecords = [order, other].map((source) => {
      const { _sourceRecordComparison, _sourcePrescriptionRecords, ...record } = source
      return cloneSource({ ...record, _resolvedMedicationCodeableConcept: identity(source)?.concept })
    })
    if ((!order.status || order.status === 'unknown') && other.status && other.status !== 'unknown') order.status = other.status
    if (!order.intent && other.intent) order.intent = other.intent
    // A confirmed source pair can carry the cloud's actually recorded drug
    // code. This is source union, never a code inferred from a hospital name.
    const hospitalConcept = identity(order)?.concept
    const cloudConcept = identity(other)?.concept
    if (hospitalConcept && cloudConcept) {
      order.medicationCodeableConcept = { ...hospitalConcept, coding: union(hospitalConcept.coding, cloudConcept.coding) }
      delete order.medicationReference
    }
    aliases.set(`MedicationRequest/${other.id}`, `MedicationRequest/${order.id}`)
    removed.add(other)
    order._reconciledSourceReferences = union(order._reconciledSourceReferences,
      [`MedicationRequest/${order.id}`, `MedicationRequest/${other.id}`])
    for (const field of ['extension', 'note', 'identifier', 'supportingInformation', 'reasonCode']) {
      if (other[field]?.length) order[field] = union(order[field], other[field])
    }
    if (!order.requester && other.requester) order.requester = other.requester
    if (other.dispenseRequest) {
      const preferred = order.dispenseRequest
      order.dispenseRequest = { ...other.dispenseRequest, ...preferred }
      for (const field of ['quantity', 'expectedSupplyDuration', 'validityPeriod']) {
        if (other.dispenseRequest[field] && preferred?.[field]) {
          order.dispenseRequest[field] = { ...other.dispenseRequest[field], ...preferred[field] }
        }
      }
    }
    if (!order.courseOfTherapyType && other.courseOfTherapyType) order.courseOfTherapyType = other.courseOfTherapyType
    if (!order.dosageInstruction?.length && other.dosageInstruction?.length) {
      order.dosageInstruction = cloneSource(other.dosageInstruction)
    } else if (order.dosageInstruction?.length === 1 && other.dosageInstruction?.length === 1) {
      const preferred = order.dosageInstruction[0], supplement = other.dosageInstruction[0]
      for (const field of ['route', 'timing', 'doseAndRate', 'asNeededBoolean', 'asNeededCodeableConcept', 'site', 'method']) {
        if (preferred[field] === undefined && supplement[field] !== undefined) preferred[field] = cloneSource(supplement[field])
      }
    }
  }
  if (!removed.size) return resources
  const rewrite = (value: any): void => {
    if (!value || typeof value !== 'object') return
    if (typeof value.reference === 'string' && aliases.has(value.reference)) value.reference = aliases.get(value.reference)
    for (const [key, child] of Object.entries(value)) if (!SOURCE_EVIDENCE_FIELDS.has(key)) rewrite(child)
  }
  const result = resources.filter((resource) => !removed.has(resource))
  result.filter(resource => resource.resourceType !== 'Provenance').forEach(rewrite)
  return result
}
