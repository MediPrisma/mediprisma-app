// Custom Hook: Medication Rows Processing
import { stripLeadingIcdCode } from '@/src/shared/utils/icd-lookup'
import { useMemo } from 'react'
import { hospitalMedicationDisplayName, resolveHospitalMedicationName } from '@/src/shared/utils/hospital-medication-names'
import type { MedicationRow } from '../types'
import {
  formatDate,
  isChronicPrescription,
  medicationClinicalIdentityKey,
  pickLocalizedText,
  pickByLocale,
} from '../utils/fhir-helpers'
import { humanDoseAmount, displayDosageInstruction, buildDetail } from '../utils/dose-helpers'
import { routeDisplayText } from '../utils/route-display'
import { computeDurationDays } from '../utils/duration-helpers'
import { dateSearchTokens } from '@/src/shared/utils/date.utils'
import { useNow } from '@/src/shared/hooks/use-now.hook'
import { formatOrganizationContextDisplay } from '@/src/shared/utils/organization-display'
import {
  resolveSinglePrescriptionRemainingDisplay,
} from '../utils/remaining-supply'
import {
  MEDCLOUD_ATC_LEVEL_3_URL,
  MEDCLOUD_SOURCE_DRUG_CLASS_URL,
  MEDCLOUD_SOURCE_SETTING_URL,
} from '@/src/shared/constants/medcloud.constants'

/** Leading YYYY-MM-DD of a FHIR date/dateTime, as the source wrote it (no
 *  timezone conversion — same contract as formatDate). */
function isoCalendarDay(value?: string): string | undefined {
  return value?.trim().match(/^(\d{4}-\d{2}-\d{2})(?=$|T)/)?.[1]
}

/** Local calendar day of a Date as YYYY-MM-DD. */
function localIsoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Keep descriptive drug classes aligned with the UI language. Some bridge
 *  payloads carry a bilingual zh label such as
 *  "痰液溶解劑 (MUCOLYTIC AGENTS)" in `text`; the compact row should not
 *  spend space repeating the English translation on a Chinese UI. */
function localizedMedicationCategory(concept: any, locale: string): string {
  const raw = pickByLocale(concept, locale).replace(/\s+/g, ' ').trim()
  if (!raw) return ''

  const trailingParenthetical = raw.match(/\s*[（(]([^()（）]*[A-Za-z][^()（）]*)[)）]\s*$/)
  if (locale === 'en') {
    if (trailingParenthetical) {
      const prefix = raw.slice(0, trailingParenthetical.index).trim()
      if (/[\u3400-\u9fff]/.test(prefix)) {
        return trailingParenthetical[1].trim()
      }
    }
    return raw
  }

  return raw
    .replace(/\s*[（(][^()（）]*[A-Za-z][^()（）]*[)）]\s*$/, '')
    .trim() || raw
}

/** MediCloud calls the three-character ATC group "ATC3". In the governed WHO
 * hierarchy used by the App that same group is level 2 (for example N06).
 * Requiring the source extension keeps Health Bank rows on their existing
 * category path while allowing cloud prescriptions to reuse the same UI slot. */
function localizedMedcloudAtc3Category(medication: any, locale: string): string {
  const extensions = Array.isArray(medication?.extension)
    ? medication.extension
    : []

  // Real IMUE0008 payloads may put the display itself (for example
  // "甲狀腺治療（Thyroid therapy）") in the field named drug_atc3_code.
  // The bridge correctly retains that non-code value as a source class
  // extension, so it is the most faithful category label available.
  const sourceClass = extensions.find(
    (extension: any) =>
      extension?.url === MEDCLOUD_SOURCE_DRUG_CLASS_URL
      && typeof extension?.valueString === 'string'
      && extension.valueString.trim(),
  )
  if (sourceClass) {
    return localizedMedicationCategory({ text: sourceClass.valueString }, locale)
  }

  const sourceAtc3 = extensions.find(
    (extension: any) => extension?.url === MEDCLOUD_ATC_LEVEL_3_URL,
  )
  if (!sourceAtc3) return ''

  const sourceDisplay = sourceAtc3.valueCoding?.display?.trim()
  if (sourceDisplay) {
    return localizedMedicationCategory({ text: sourceDisplay }, locale)
  }

  const sourceCode = sourceAtc3.valueCoding?.code?.trim().toUpperCase()
  const terminology = medication.drugTerminology ?? medication.atcClassification
  const resolvedCode = terminology?.atcLevel2Code?.trim().toUpperCase()
  if (sourceCode && resolvedCode && sourceCode !== resolvedCode) return ''

  const resolvedName = locale === 'en'
    ? terminology?.atcLevel2NameEn || terminology?.atcLevel2NameZh
    : terminology?.atcLevel2NameZh || terminology?.atcLevel2NameEn
  return typeof resolvedName === 'string'
    ? localizedMedicationCategory({ text: resolvedName }, locale)
    : ''
}

export function useMedicationRows(
  medications: any[],
  audience: 'medical' | 'patient' = 'medical',
  locale: string = 'zh-TW',
  /** Every prescription on the chart, when `medications` is only a subset
   *  (the overview builds rows for its window alone). 慢箋 is decided per
   *  drug across ALL its refills, so a subset must not decide it: a window
   *  that happens to hold only the non-chronic refills would otherwise
   *  un-mark a drug the 用藥 tab shows as 慢箋. */
  chronicHistory?: readonly any[],
) {
  // Re-run when the calendar day rolls over (tab left open) so "days left" /
  // active-vs-inactive don't freeze on the mount-time snapshot.
  const nowMs = useNow()
  return useMemo<MedicationRow[]>(() => {
    if (!Array.isArray(medications)) return []

    // NOTE: vaccine-categorized MedicationRequests (e.g. a tetanus shot
    // ordered as treatment for a wound) STAY in the medication list. Only
    // FHIR R4 Immunization resources — from 疾病管制署 preventive-care
    // records — go to the dedicated 疫苗 sub-tab. The earlier MR-based
    // filter was wrong because therapeutic vaccine prescriptions ARE
    // medications and belong with the rest of the patient's drug list.

    const inactiveStatuses = new Set(["stopped", "completed"])

    // The bridge emits one MedicationRequest per refill. The chronic
    // (courseOfTherapyType.continuous) flag is set per refill, so a single
    // drug may appear as a mix of "chronic" and "acute" refills depending on
    // which NHI billing code each pharmacy used that month. Aggregate to the
    // drug level — if ANY refill of this medication was chronic, treat every
    // row of that drug as chronic. This matches the bridge's recommended
    // detection logic ("若想顯示哪些是慢性用藥…group by 藥品名").
    const chronicDrugKeys = new Set<string>()
    for (const m of chronicHistory ?? medications) {
      if (!m) continue
      if (!isChronicPrescription(m)) continue
      const key = medicationClinicalIdentityKey(m)
      if (key) chronicDrugKeys.add(key)
    }

    // Refill-history aggregates (per drug). Used to surface "Refills: 11 次
    // since 2023-12" on each row without forcing the user to expand the
    // per-drug accordion in the Medication History section.
    const refillsByDrug = new Map<string, { count: number; firstDate?: string }>()
    for (const m of medications) {
      if (!m) continue
      const key = medicationClinicalIdentityKey(m)
      if (!key) continue
      const date = m.authoredOn || m.effectiveDateTime
      const entry = refillsByDrug.get(key)
      if (!entry) {
        refillsByDrug.set(key, { count: 1, firstDate: date })
      } else {
        entry.count++
        if (date && (!entry.firstDate || date < entry.firstDate)) {
          entry.firstDate = date
        }
      }
    }

    const enriched = medications.map((med: any, idx: number) => {
      const dosage = med.dosageInstruction?.[0] || med.dosage?.[0]
      const drugTerminology = med.drugTerminology
      const hospitalMedicationName = !drugTerminology
        ? resolveHospitalMedicationName(med.medicationCodeableConcept || med.code)
        : undefined

      // Audience-aware drug-name resolution. Bridge v0.6.10+ puts the
      // localized (zh-TW) name in `.text` and the English name in
      // `.coding[].display`; medical users get English (pharmacology
      // familiarity), patient users get Chinese. Older bundles with only
      // English `.text` fall through gracefully.
      let sourceMedicationName: string
      if (med.medicationCodeableConcept) {
        sourceMedicationName = pickLocalizedText(med.medicationCodeableConcept, audience, locale)
      } else if (med.medicationReference?.display) {
        sourceMedicationName = med.medicationReference.display
      } else if (med.code) {
        sourceMedicationName = pickLocalizedText(med.code, audience, locale)
      } else if (med.medication?.text) {
        sourceMedicationName = med.medication.text
      } else if (med.resource?.code) {
        sourceMedicationName = pickLocalizedText(med.resource.code, audience, locale)
      } else {
        sourceMedicationName = ''
      }
      const officialProductName = audience === 'medical'
        ? drugTerminology?.officialNameEn || drugTerminology?.officialNameZh
          || (hospitalMedicationName?.status === 'normalized' ? hospitalMedicationName.productName : undefined)
        : locale === 'en'
          ? drugTerminology?.officialNameEn || drugTerminology?.officialNameZh
          : drugTerminology?.officialNameZh
      const ingredientName = audience === 'medical'
        ? drugTerminology?.ingredientText?.trim() || hospitalMedicationDisplayName(hospitalMedicationName)
        : undefined
      let medicationName = ingredientName || officialProductName || sourceMedicationName
      if (!medicationName) medicationName = 'Unknown Medication'
      const secondaryTitle =
        audience === 'medical' &&
        ingredientName &&
        officialProductName &&
        ingredientName.localeCompare(officialProductName, undefined, { sensitivity: 'accent' }) !== 0
          ? officialProductName
          : undefined

      const status = med.status?.toLowerCase() || "unknown"
      const statusInactive = inactiveStatuses.has(status)

      const doseSummary = humanDoseAmount(dosage?.doseAndRate, dosage?.text)
      // Route goes through the SNOMED route map (route-display.ts) so a bare
      // coding without display/text renders per audience — PO for medical
      // staff, 口服 for patients — instead of the raw 26643006.
      const routeSummary = routeDisplayText(dosage?.route, { audience, locale })
      const frequencySummary = displayDosageInstruction(dosage)
      const sourceQuantityValue = med.dispenseRequest?.quantity?.value
      const totalQuantity =
        typeof sourceQuantityValue === 'number' && Number.isFinite(sourceQuantityValue)
          ? sourceQuantityValue
          : undefined

      const detail = buildDetail({
        doseAndRate: dosage?.doseAndRate,
        doseText: dosage?.text,
        route: dosage?.route,
        repeat: dosage?.timing?.repeat,
        timingCode: dosage?.timing?.code,
        additionalInstruction: dosage?.additionalInstruction,
        audience,
        locale,
      })

      const startDateRaw = med.authoredOn || med.effectiveDateTime || med.dispenseRequest?.validityPeriod?.start
      const stopDateRaw = statusInactive
        ? med.dispenseRequest?.validityPeriod?.end || med.effectiveDateTime || med.authoredOn
        : undefined

      const durationDays = computeDurationDays({
        start: startDateRaw,
        stop: stopDateRaw,
        expectedDuration: med.dispenseRequest?.expectedSupplyDuration,
        boundsDuration: dosage?.timing?.repeat?.boundsDuration,
        boundsPeriod: dosage?.timing?.repeat?.boundsPeriod,
        validityPeriod: med.dispenseRequest?.validityPeriod,
      })

      // A source Period already contains the exact final calendar date. Do not
      // reconstruct it from the inclusive day count: start 5/20, end 5/21 is
      // two source days, but start + 2 would incorrectly display 5/22.
      const explicitEndDateRaw =
        med.dispenseRequest?.validityPeriod?.end ||
        dosage?.timing?.repeat?.boundsPeriod?.end
      const hasDurationEvidence =
        !!med.dispenseRequest?.expectedSupplyDuration ||
        !!dosage?.timing?.repeat?.boundsDuration
      let endDate: string | undefined
      let endDateIso: string | undefined
      let daysRemaining: number | undefined
      if (explicitEndDateRaw) {
        const end = new Date(explicitEndDateRaw)
        if (!Number.isNaN(end.getTime())) {
          endDate = explicitEndDateRaw
          endDateIso = isoCalendarDay(explicitEndDateRaw)
          daysRemaining = Math.ceil((end.getTime() - nowMs) / (1000 * 60 * 60 * 24))
        }
      } else if (startDateRaw && durationDays && hasDurationEvidence) {
        const start = new Date(startDateRaw)
        if (!Number.isNaN(start.getTime())) {
          const end = new Date(start)
          end.setDate(end.getDate() + durationDays)
          endDate = end.toISOString()
          endDateIso = localIsoDay(end)
          daysRemaining = Math.ceil((end.getTime() - nowMs) / (1000 * 60 * 60 * 24))
        }
      } else if (stopDateRaw) {
        const end = new Date(stopDateRaw)
        if (!Number.isNaN(end.getTime())) {
          endDate = stopDateRaw
          endDateIso = isoCalendarDay(stopDateRaw)
          daysRemaining = Math.ceil((end.getTime() - nowMs) / (1000 * 60 * 60 * 24))
        }
      }

      // Inactive = explicitly stopped/completed OR computed endDate has passed
      const isInactive = statusInactive || (daysRemaining !== undefined && daysRemaining < 0)
      const remainingDisplay = resolveSinglePrescriptionRemainingDisplay(
        med,
        daysRemaining,
        nowMs,
      )
      // Drug-level chronic: true if any refill of this drug was chronic
      const drugKey = medicationClinicalIdentityKey(med)
      const isChronic = !!drugKey && chronicDrugKeys.has(drugKey)

      const refillAgg = drugKey ? refillsByDrug.get(drugKey) : undefined
      const refillCount = refillAgg?.count ?? 1
      const firstRefillDate = refillAgg?.firstDate ? formatDate(refillAgg.firstDate) : undefined

      // Per-refill metadata that downstream UI surfaces inline.
      const requesterDisplay = med?.requester?.display?.trim()
      const sourceSetting = Array.isArray(med?.extension)
        ? med.extension.find(
          (extension: any) => extension?.url === MEDCLOUD_SOURCE_SETTING_URL,
        )?.valueString
        : undefined
      const formattedRequesterDisplay = requesterDisplay
        ? formatOrganizationContextDisplay(requesterDisplay, sourceSetting, locale)
        : ''
      const pharmacy = formattedRequesterDisplay || undefined
      // Drug category (e.g. "降血壓藥" / "HYPOTENSIVE AGENTS"). Bridge
      // v0.6.10+ sends both Chinese (text) and English (coding[].display).
      // Follow UI locale, NOT audience — medical professionals on a zh-TW
      // UI still expect 降血壓藥 because category is a descriptor (not a
      // technical pharmacology name like the drug itself).
      const sourceCategory = localizedMedicationCategory(med?.category?.[0], locale)
      const cloudAtc3Category = localizedMedcloudAtc3Category(med, locale)
      const category = cloudAtc3Category || sourceCategory || undefined
      const icdCoding = med?.reasonCode?.[0]?.coding?.[0]
      const icdCode = icdCoding?.code || undefined
      // ICD descriptions follow UI locale, NOT audience: medical users on a
      // zh-TW UI still want 中文 ("良性攝護腺增生") because the description
      // is a clinical concept, not a technical pharmacology identifier.
      // The leading code prefix ("N400 ...") is stripped below.
      const rawIcdText = pickByLocale(med?.reasonCode?.[0], locale)
      const icdText = stripLeadingIcdCode(rawIcdText, icdCode ?? '')

      // Bilingual search blob — collects BOTH languages of every field so the
      // 用藥 search matches whether the user types 中文 or English, regardless
      // of the active UI locale. Mirrors the visit/report search design.
      // The indication (reasonCode = the visit's billing ICD) IS searched so a
      // diagnosis code / name finds its meds — but the placeholder deliberately
      // omits "適應症" so users don't assume every disease name resolves (it
      // only matches when a med actually carries that billing diagnosis).
      const cc = med.medicationCodeableConcept
      const searchHaystack = [
        cc?.text,                                    // 藥名 中文
        cc?.coding?.[0]?.display,                    // 藥名 英文
        cc?.coding?.[0]?.code,                       // NHI 藥碼
        med.medicationReference?.display,            // fallback name
        category,                                    // 畫面使用的來源優先分類
        med?.category?.[0]?.text,                    // 健康存摺分類 中文
        med?.category?.[0]?.coding?.[0]?.display,    // 健康存摺分類 英文
        drugTerminology?.officialNameZh,             // 官方藥名 中文
        drugTerminology?.officialNameEn,             // 官方藥名 英文
        drugTerminology?.ingredientText,              // 成分
        hospitalMedicationName?.ingredientName,
        hospitalMedicationName?.recordedGenericName,
        hospitalMedicationName?.recordedProductName,
        drugTerminology?.doseForm,                    // 劑型
        drugTerminology?.atcCode,                     // ATC 碼
        drugTerminology?.atcNameZh,                   // ATC 分類 中文
        drugTerminology?.atcNameEn,                   // ATC 分類 英文
        drugTerminology?.atcLevel2Code,               // ATC 第二層代碼
        drugTerminology?.atcLevel2NameZh,             // ATC 第二層 中文
        drugTerminology?.atcLevel2NameEn,             // ATC 第二層 英文
        med?.reasonCode?.[0]?.text,                  // 適應症 中文
        med?.reasonCode?.[0]?.coding?.[0]?.display,  // 適應症 英文
        icdCode,                                     // 診斷 ICD 碼
        pharmacy,                                    // 機構 / 藥局
        frequencySummary,                            // 用法頻次（QD／BID／QDPC…）
        totalQuantity,                               // 藥品總量
        remainingDisplay.sourceDays,
        ...dateSearchTokens(startDateRaw),           // 日期 西元 + 民國
        ...dateSearchTokens(refillAgg?.firstDate),
      ].filter(Boolean).join(' ').toLowerCase()

      return {
        // Deterministic fallback (was Math.random()) so the row key stays
        // stable across the now-more-frequent memo recomputes — a random id
        // would remount id-less rows on every focus/day tick.
        id: med.id || `med-${idx}`,
        drugKey,
        title: medicationName,
        secondaryTitle,
        status,
        detail: detail || undefined,
        dose: doseSummary || undefined,
        route: routeSummary && routeSummary !== "—" ? routeSummary : undefined,
        frequency: frequencySummary || undefined,
        totalQuantity,
        startedOn: formatDate(startDateRaw),
        stoppedOn: stopDateRaw ? formatDate(stopDateRaw) : undefined,
        durationDays,
        endDate: endDate ? formatDate(endDate) : undefined,
        startedOnIso: isoCalendarDay(startDateRaw),
        endDateIso,
        daysRemaining,
        displayRemainingDays: remainingDisplay.displayDays,
        displayRemainingSource: remainingDisplay.displaySource,
        singlePrescriptionRemainingDays: remainingDisplay.sourceDays,
        singlePrescriptionRemainingCapturedAt: remainingDisplay.capturedAt,
        singlePrescriptionRemainingIsCurrent: remainingDisplay.isCurrent,
        isInactive,
        isChronic,
        category,
        drugTerminology,
        hospitalMedicationName,
        pharmacy,
        icdCode,
        icdText,
        refillCount,
        firstRefillDate,
        sourceResourceType: med._sourceResourceType,
        searchHaystack,
        _startSortValue: startDateRaw ? new Date(startDateRaw).getTime() : 0
      }
    })

    return enriched
      .sort((a: any, b: any) => {
        if (a.isInactive !== b.isInactive) {
          return a.isInactive ? 1 : -1
        }
        return (b._startSortValue ?? 0) - (a._startSortValue ?? 0)
      })
      .map(({ _startSortValue, ...row }: any) => row)
    // `audience` controls drug-name and ICD localisation; `locale` drives
    // category labels. Both must be in deps so flipping either updates the
    // list immediately instead of requiring a page reload.
  }, [medications, audience, locale, nowMs, chronicHistory])
}
