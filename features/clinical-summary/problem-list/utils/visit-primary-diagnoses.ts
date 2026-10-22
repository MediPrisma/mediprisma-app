// 就醫主診斷 — the problem list's second section: one row per ICD-10 code taken
// from each visit's PRIMARY diagnosis (Encounter.reasonCode[0]). These are
// claim codes, not confirmed diagnoses, and the card labels them so.
//
// Why reasonCode[0] only: both Taiwan bridges put the claim's 主診斷 first.
// 健康存摺 appends up to four 次診斷 after it; 雲端病歷 has no visit record at
// all, so its Encounters are assembled from order rows that each carry the one
// code they were billed under. Secondary codes are the ones most often added to
// justify a drug or a test, so they stay out.
//
// Codes already present on a Condition are left to the Condition list above.

import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { buildIcdDictionary, extractEncounterIcds } from '@/src/shared/utils/icd-lookup'
import { icdChronicity, type IcdChronicity } from '@/src/shared/utils/icd-chronicity'

export interface VisitPrimaryDiagnosis {
  /** Upper-case, dot-free code — merges "E11.9" and "E119". Also the row key. */
  key: string
  /** The code as the latest visit wrote it. */
  code: string
  description?: string
  visitCount: number
  /** Earliest visit date — bounded by the source's window, not an onset date. */
  firstDate?: string
  lastDate?: string
  /** At least one of the visits was an admission. */
  inpatient: boolean
  /** CCIR class of the code — drives the 全部／慢性／非慢性 filter. */
  chronicity: IcdChronicity
}

// ICD-10(-CM) shape: letter, digit, alphanumeric (C4A, M1A), then up to four
// more characters with or without the dot.
const ICD10_CODE = /^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/
const UNUSABLE_ENCOUNTER_STATUSES = new Set(['entered-in-error', 'cancelled'])
const INPATIENT_CLASS_CODES = new Set(['IMP', 'ACUTE', 'NONAC'])

function icdKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** A coded primary diagnosis under a non-ICD system (SNOMED on SMART sandboxes) is not ours to list. */
function hasNonIcdSystem(reason: NonNullable<EncounterEntity['reasonCode']>[number]): boolean {
  const coding = Array.isArray(reason?.coding) ? reason.coding : []
  const primary = coding.find((c) => c?.code) ?? coding[0]
  const system = primary?.system?.toLowerCase()
  return !!system && !system.includes('icd-10')
}

export function buildVisitPrimaryDiagnoses(
  encounters: EncounterEntity[],
  conditions: ConditionEntity[],
  locale: string,
): VisitPrimaryDiagnosis[] {
  const onConditionList = new Set<string>()
  for (const condition of conditions) {
    for (const coding of condition.code?.coding ?? []) {
      if (coding?.code) onConditionList.add(icdKey(coding.code))
    }
  }

  const dict = buildIcdDictionary(conditions, locale, encounters)
  const byKey = new Map<string, VisitPrimaryDiagnosis>()

  for (const encounter of encounters) {
    if (UNUSABLE_ENCOUNTER_STATUSES.has(encounter.status?.toLowerCase() ?? '')) continue
    const primaryReason = encounter.reasonCode?.[0]
    if (!primaryReason || hasNonIcdSystem(primaryReason)) continue

    const primary = extractEncounterIcds({ reasonCode: [primaryReason] }, dict, locale)[0]
    if (!primary) continue
    const key = icdKey(primary.code)
    if (!ICD10_CODE.test(primary.code.toUpperCase()) || onConditionList.has(key)) continue

    const date = encounter.period?.start?.trim() || undefined
    const inpatient = INPATIENT_CLASS_CODES.has(encounter.class?.code?.toUpperCase() ?? '')
    const row = byKey.get(key)
    if (!row) {
      byKey.set(key, {
        key,
        code: primary.code,
        description: primary.description,
        visitCount: 1,
        firstDate: date,
        lastDate: date,
        inpatient,
        chronicity: icdChronicity(key),
      })
      continue
    }

    row.visitCount += 1
    row.inpatient ||= inpatient
    if (date && (!row.firstDate || date < row.firstDate)) row.firstDate = date
    if (date && (!row.lastDate || date >= row.lastDate)) {
      // Latest visit's wording wins; keep an older description if it has none.
      row.lastDate = date
      row.code = primary.code
      row.description = primary.description ?? row.description
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.visitCount - a.visitCount ||
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
      a.key.localeCompare(b.key),
  )
}
