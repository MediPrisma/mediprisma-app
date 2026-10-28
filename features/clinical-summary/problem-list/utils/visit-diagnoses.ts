// 就診診斷 — the problem list's visit codes, merged across sources into one row
// per diagnosis. Two inputs feed it:
//
//   - Encounter.reasonCode[0] — the claim's PRIMARY diagnosis. Both Taiwan
//     bridges put 主診斷 first; 雲端病歷 assembles its Encounters from order
//     rows that each carry the one code they were billed under, so secondary
//     codes (often added to justify a drug or a test) stay out.
//   - Hospital visit Conditions (North VGH qemr): category encounter-diagnosis
//     with no clinicalStatus / verificationStatus / stage. These are the same
//     kind of record as a claim code, only from the hospital, so they merge
//     here instead of standing as a second list. Encounter.diagnosis[].rank
//     says whether each was the visit's primary or a secondary diagnosis.
//
// A visit seen by both sources (same day, same institution, same code) counts
// once. Codes on any other Condition (重大傷病, statused problem-list items) are
// left to the Condition list above. Diabetes codes fold into one row per
// category; every other code keeps its own row so stage, side and site stay
// visible (N18.3 → N18.5, C50.911 vs C50.912).

import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { buildIcdDictionary, extractEncounterIcds, localizedIcdDescription } from '@/src/shared/utils/icd-lookup'
import { icdChronicity, type IcdChronicity } from '@/src/shared/utils/icd-chronicity'
import { isMedcloudSource, isVghtpeSource } from '@/src/shared/utils/clinical-source-identity'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { medicationClinicalDay } from '@/src/shared/utils/medication-calendar'

export type VisitSource = 'hospital' | 'cloud'

export interface VisitDiagnosisVisit {
  key: string
  /** Clinical day (Asia/Taipei), YYYY-MM-DD. */
  day?: string
  /** Last day of an admission. */
  endDay?: string
  code: string
  institution?: string
  department?: string
  primary: boolean
  inpatient: boolean
  sources: VisitSource[]
  /** The hospital's own wording when it differs from the row's name. */
  originalText?: string
}

export interface VisitDiagnosisVariant {
  code: string
  description?: string
  visitCount: number
}

export interface VisitDiagnosis {
  /** Upper-case, dot-free code (or the category for a folded row) — the row key. */
  key: string
  /** The code as the latest visit wrote it. */
  code: string
  description?: string
  /** Set on a folded category row: each code it holds, most visits first. */
  variants?: VisitDiagnosisVariant[]
  visitCount: number
  /** Earliest visit day — bounded by the source's window, not an onset date. */
  firstDate?: string
  lastDate?: string
  /** At least one of the visits was an admission. */
  inpatient: boolean
  /** Every visit listed the code as a secondary diagnosis. */
  secondaryOnly: boolean
  /** At least one visit came from a hospital import. */
  hospital: boolean
  institutions: string[]
  /** CCIR class of the code — drives the 全部／慢性／非慢性 filter. */
  chronicity: IcdChronicity
  /** Conditions behind the row, for resource navigation from the summary. */
  conditionIds: string[]
  /** Newest first. */
  visits: VisitDiagnosisVisit[]
}

// ICD-10(-CM) shape: letter, digit, alphanumeric (C4A, M1A), then up to four
// more characters with or without the dot.
const ICD10_CODE = /^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/
const ICD10_SYSTEM = /icd-?10/i
const UNUSABLE_ENCOUNTER_STATUSES = new Set(['entered-in-error', 'cancelled'])
const INPATIENT_CLASS_CODES = new Set(['IMP', 'ACUTE', 'NONAC'])
const ENCOUNTER_DIAGNOSIS = 'encounter-diagnosis'

// Categories whose 4th+ characters grade complications of one disease rather
// than a site, side or stage a reader must see as its own row.
const FOLDED_CATEGORIES: Record<string, { zh: string; en: string }> = {
  E08: { zh: '其他原因所致糖尿病', en: 'Diabetes due to underlying condition' },
  E09: { zh: '藥物或化學物質引起的糖尿病', en: 'Drug or chemical induced diabetes' },
  E10: { zh: '第一型糖尿病', en: 'Type 1 diabetes mellitus' },
  E11: { zh: '第二型糖尿病', en: 'Type 2 diabetes mellitus' },
  E13: { zh: '其他特定糖尿病', en: 'Other specified diabetes mellitus' },
}

function icdKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function lastSegment(reference?: string): string | undefined {
  return reference?.split('/').pop() || undefined
}

function sourcesOf(resource: { meta?: ConditionEntity['meta'] }): VisitSource[] {
  if (isVghtpeSource(resource)) return ['hospital']
  if (isMedcloudSource(resource)) return ['cloud']
  return []
}

function encounterSources(encounter: EncounterEntity | undefined): VisitSource[] {
  if (!encounter) return []
  const records = encounter._sourceEncounterRecords?.length ? encounter._sourceEncounterRecords : [encounter]
  return [...new Set(records.flatMap((record) => sourcesOf(record)))]
}

/** North VGH writes the clinic as "146(乳醫中心門診 )"; keep the name. */
function departmentOf(encounter: EncounterEntity | undefined): string | undefined {
  const text = encounter?.serviceType?.text?.trim()
  if (!text) return undefined
  return text.match(/^\d+\s*\((.+)\)$/)?.[1]?.trim() || text
}

function institutionOf(encounter: EncounterEntity | undefined, locale: string): string | undefined {
  const display = encounter?.serviceProvider?.display
  return display ? formatOrganizationDisplay(display, locale) || undefined : undefined
}

function hasCategory(condition: ConditionEntity, code: string): boolean {
  return (condition.category ?? []).some((category) => category.coding?.some((coding) => coding.code === code))
}

function primaryIcdCoding(condition: ConditionEntity) {
  return condition.code?.coding?.find((coding) => coding.code && ICD10_SYSTEM.test(coding.system ?? ''))
}

/**
 * A Condition that records only "this code was given at this visit": an
 * ICD-10 encounter-diagnosis with no status, verification or stage. It joins
 * the visit codes; any other Condition stays on the recorded list.
 */
export function isVisitCodeCondition(condition: ConditionEntity): boolean {
  const statusless = !condition.clinicalStatus && !condition.verificationStatus
    && !(condition as { _cancerStage?: string })._cancerStage
  const categories = (condition.category ?? []).flatMap((category) => category.coding ?? [])
  return statusless && categories.length > 0 && categories.every((coding) => coding.code === ENCOUNTER_DIAGNOSIS)
    && hasCategory(condition, ENCOUNTER_DIAGNOSIS) && !!primaryIcdCoding(condition)
}

function hasNonIcdSystem(reason: NonNullable<EncounterEntity['reasonCode']>[number]): boolean {
  const coding = Array.isArray(reason?.coding) ? reason.coding : []
  const primary = coding.find((c) => c?.code) ?? coding[0]
  const system = primary?.system?.toLowerCase()
  return !!system && !system.includes('icd-10')
}

interface Candidate extends VisitDiagnosisVisit {
  description?: string
  conditionId?: string
  /** The source's own wording, kept when it differs from the row's name. */
  sourceText?: string
}

/** Same day and institution (or one side unnamed): one visit seen twice. */
function sameVisit(a: Candidate, b: Candidate): boolean {
  return !!a.day && a.day === b.day && (!a.institution || !b.institution || a.institution === b.institution)
}

function hasHan(value?: string): boolean {
  return /\p{Script=Han}/u.test(value ?? '')
}

export function buildVisitDiagnoses(
  encounters: EncounterEntity[],
  conditions: ConditionEntity[],
  locale: string,
): VisitDiagnosis[] {
  const visitConditions = conditions.filter(isVisitCodeCondition)
  const onConditionList = new Set<string>()
  for (const condition of conditions) {
    if (visitConditions.includes(condition)) continue
    for (const coding of condition.code?.coding ?? []) {
      if (coding?.code) onConditionList.add(icdKey(coding.code))
    }
  }

  const dict = buildIcdDictionary(conditions, locale, encounters)
  const encounterById = new Map(encounters.map((encounter) => [encounter.id, encounter]))
  const conditionIds = new Set(visitConditions.map((condition) => condition.id))
  const candidates: Candidate[] = []

  // Hospital Conditions first: they carry rank and the hospital's wording.
  const coveredEncounters = new Set<string>()
  for (const condition of visitConditions) {
    const coding = primaryIcdCoding(condition)!
    const code = coding.code!.trim()
    const encounterId = lastSegment(condition.encounter?.reference)
    const encounter = encounterId ? encounterById.get(encounterId) : undefined
    if (UNUSABLE_ENCOUNTER_STATUSES.has(encounter?.status?.toLowerCase() ?? '')) continue
    if (encounterId) coveredEncounters.add(encounterId)
    const rank = encounter?.diagnosis?.find((diagnosis) => lastSegment(diagnosis.condition?.reference) === condition.id)?.rank
    const description = localizedIcdDescription(code, condition.code?.text, coding.display, dict, locale, coding.system)
    candidates.push({
      key: condition.id,
      conditionId: condition.id,
      day: medicationClinicalDay(condition.recordedDate || condition.onsetDateTime || encounter?.period?.start) || undefined,
      code,
      description,
      institution: institutionOf(encounter, locale),
      department: departmentOf(encounter),
      // No rank means the source did not say; do not call it secondary.
      primary: rank === undefined || rank === 1,
      inpatient: INPATIENT_CLASS_CODES.has(encounter?.class?.code?.toUpperCase() ?? ''),
      sources: [...new Set([...sourcesOf(condition), ...encounterSources(encounter)])],
      sourceText: condition.code?.text || coding.display,
    })
  }

  for (const encounter of encounters) {
    if (UNUSABLE_ENCOUNTER_STATUSES.has(encounter.status?.toLowerCase() ?? '')) continue
    // Its diagnoses already arrived, ranked, through the Conditions above.
    if (coveredEncounters.has(encounter.id) || encounter.diagnosis?.some((diagnosis) =>
      conditionIds.has(lastSegment(diagnosis.condition?.reference) ?? ''))) continue
    const primaryReason = encounter.reasonCode?.[0]
    if (!primaryReason || hasNonIcdSystem(primaryReason)) continue
    const primary = extractEncounterIcds({ reasonCode: [primaryReason] }, dict, locale)[0]
    if (!primary || !ICD10_CODE.test(primary.code.toUpperCase())) continue
    const inpatient = INPATIENT_CLASS_CODES.has(encounter.class?.code?.toUpperCase() ?? '')
    candidates.push({
      key: encounter.id,
      day: medicationClinicalDay(encounter.period?.start) || undefined,
      endDay: inpatient ? medicationClinicalDay(encounter.period?.end) || undefined : undefined,
      code: primary.code,
      description: primary.description,
      institution: institutionOf(encounter, locale),
      department: departmentOf(encounter),
      primary: true,
      inpatient,
      sources: encounterSources(encounter),
    })
  }

  const byKey = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const codeKey = icdKey(candidate.code)
    if (onConditionList.has(codeKey)) continue
    const category = codeKey.slice(0, 3)
    const key = FOLDED_CATEGORIES[category] ? category : codeKey
    byKey.set(key, [...(byKey.get(key) ?? []), candidate])
  }

  const rows: VisitDiagnosis[] = []
  for (const [key, group] of byKey) {
    // Newest first, so the merged visit keeps the latest wording.
    group.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
    const visits: Candidate[] = []
    for (const candidate of group) {
      const same = visits.find((visit) => icdKey(visit.code) === icdKey(candidate.code) && sameVisit(visit, candidate))
      if (!same) { visits.push({ ...candidate, sources: [...candidate.sources] }); continue }
      same.sources = [...new Set([...same.sources, ...candidate.sources])]
      same.primary ||= candidate.primary
      same.inpatient ||= candidate.inpatient
      same.institution ??= candidate.institution
      same.department ??= candidate.department
      same.endDay ??= candidate.endDay
      same.sourceText ??= candidate.sourceText
      same.conditionId ??= candidate.conditionId
      if (locale !== 'en' && !hasHan(same.description) && hasHan(candidate.description)) same.description = candidate.description
      else same.description ??= candidate.description
    }

    // A folded row counts a visit once even when it billed two of its codes.
    const visitCount = new Set(visits.map((visit, index) => {
      const twin = visits.findIndex((other) => sameVisit(other, visit))
      return twin === -1 ? index : twin
    })).size
    const days = visits.map((visit) => visit.day).filter((day): day is string => !!day).sort()
    const latest = visits[0]
    // Chinese wording first outside English; otherwise the newest visit's.
    const describe = (codeVisits: Candidate[]) => (locale !== 'en' ? codeVisits.find((visit) => hasHan(visit.description)) : undefined)?.description
      ?? codeVisits.find((visit) => visit.description)?.description
    const byCode = new Map<string, Candidate[]>()
    for (const visit of visits) byCode.set(icdKey(visit.code), [...(byCode.get(icdKey(visit.code)) ?? []), visit])
    // A category holding a single code is just that code's row.
    const folded = byCode.size > 1 ? FOLDED_CATEGORIES[key] : undefined
    const variants: VisitDiagnosisVariant[] | undefined = folded ? [...byCode.values()]
      .map((codeVisits) => ({ code: codeVisits[0].code, description: describe(codeVisits), visitCount: codeVisits.length }))
      .sort((a, b) => b.visitCount - a.visitCount || a.code.localeCompare(b.code)) : undefined

    rows.push({
      key: folded ? key : icdKey(latest.code),
      code: latest.code,
      description: folded ? (locale === 'en' ? folded.en : folded.zh) : describe(visits),
      ...(variants ? { variants } : {}),
      visitCount,
      firstDate: days[0],
      lastDate: days[days.length - 1],
      inpatient: visits.some((visit) => visit.inpatient),
      secondaryOnly: visits.every((visit) => !visit.primary),
      hospital: visits.some((visit) => visit.sources.includes('hospital')),
      institutions: [...new Set(visits.map((visit) => visit.institution).filter((name): name is string => !!name))],
      chronicity: icdChronicity(latest.code),
      conditionIds: visits.map((visit) => visit.conditionId).filter((id): id is string => !!id),
      visits: visits.map((visit) => {
        const { description: _description, conditionId: _conditionId, sourceText, ...shown } = visit
        return sourceText && sourceText !== describe(byCode.get(icdKey(visit.code))!) ? { ...shown, originalText: sourceText } : shown
      }),
    })
  }

  return rows.sort(
    (a, b) =>
      b.visitCount - a.visitCount ||
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
      a.key.localeCompare(b.key),
  )
}
