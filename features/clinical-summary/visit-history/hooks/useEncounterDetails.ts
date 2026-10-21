import { useMemo } from "react"
import { getReferenceId, getCodeText, getMedicationNameLocalized, formatDateTime, valueWithUnit, refRangeText, getInterpTag } from "../utils/formatters"
import { checkReferenceRangeAbnormal, isAbnormalInterpretationLabel, isReferenceRangeAssessmentUnavailable } from "@voho0000/clinical-lab-normalization/interpretation"
import { isChronicPrescription } from "@/features/clinical-summary/medications/utils/fhir-helpers"
import { getAnalyteLabel, getAnalyteCanonicalKey } from "@voho0000/clinical-lab-normalization/canonical"
import { getAnalyteDisplayForObs, type DisplayLang } from "@voho0000/clinical-lab-normalization/display"
import {
  LAB_CATEGORIES,
  CANONICAL_TO_CATEGORY,
  categorizeObservation,
  compareTestsByPreferred,
} from "@/src/shared/utils/lab-categories"
import type { Row } from "@/features/clinical-summary/reports/types"
import { buildReportsData } from "@/features/clinical-summary/reports/hooks/useReportsData"
import { reportDisplayGroupingKeys } from "@/src/shared/utils/report-copy-grouping"
import type { EncounterObservation } from "../components/EncounterObservationCard"
import type { EncounterProcedure } from "../components/EncounterCards"
import type { ClinicalNote } from "./useClinicalNotes"
import type {
  MedicationExecutionPeriod,
  MedicationRow,
} from "@/features/clinical-summary/medications/types"

// Clinical reading order across categories (blood count → coag → biochem → …
// → urine). Lab tests within a single visit arrive interleaved from multiple
// DiagnosticReports / standalone Observations; grouping by category and
// ordering by this rank stops 血液/生化 etc. from mixing together.
const CATEGORY_RANK: Map<string, number> = new Map(
  LAB_CATEGORIES.map((c, i) => [c.id, i]),
)
const CATEGORY_BY_ID: Map<string, (typeof LAB_CATEGORIES)[number]> = new Map(
  LAB_CATEGORIES.map((c) => [c.id, c]),
)

// Inpatient claims expose 給藥總量 (total quantity) but no per-drug 給藥日數, so
// the bridge ships those meds with a structured dispenseRequest.quantity but NO
// pre-formatted dosageInstruction.text — and the row then showed no dose at all.
// When the text is missing, fall back to the quantity NHI did report (健保存摺
// shows it). 給藥日數 is only appended when the bridge actually provided a
// supply duration — never fabricated.
function medicationQuantityDetail(med: any): string | undefined {
  const qty = med?.dispenseRequest?.quantity?.value
  if (qty == null) return undefined
  const days = med?.dispenseRequest?.expectedSupplyDuration?.value
  return days != null ? `給藥總量 ${qty}，給藥日數 ${days} 天` : `給藥總量 ${qty}`
}

// The NHI bridge commonly places this fixed dispensing-arithmetic sentence in
// dosageInstruction.text. It is source data rather than a UI translation key,
// so localize the known labels at the view-model boundary and leave the FHIR
// resource untouched. This is display-only arithmetic, not a verified SIG.
function localizeMedicationQuantityDetail(
  detail: string | undefined,
  locale: string,
): string | undefined {
  if (!detail || locale === 'zh-TW') return detail
  const number = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))'
  return detail
    .replace(
      new RegExp(`[（(]\\s*平均每日\\s*${number}\\s*[）)]`, 'g'),
      ' (avg. $1/day)',
    )
    .replace(
      new RegExp(`[，,；;]\\s*給藥日數\\s*${number}\\s*天`, 'g'),
      ' · Days supplied $1',
    )
    .replace(
      new RegExp(`給藥日數\\s*${number}\\s*天`, 'g'),
      'Days supplied $1',
    )
    .replace(/給藥總量/g, 'Total quantity')
}

export type EncounterDiagnosis = {
  id: string
  title: string
  code?: string
  clinicalStatus?: string
  verificationStatus?: string
  recordedDate?: string
}

/** A narrative diagnostic report linked to a visit — EKG, imaging (CXR/CT/
 *  ultrasound), endoscopy, pathology. Its finding lives in `conclusion`, with
 *  no member Observations, so without surfacing it here it stays invisible
 *  under the visit even though the FHIR `encounter` link is present. */
export type EncounterReport = {
  id: string
  title: string
  conclusion: string
  effectiveDateTime?: string
  status?: string
  row: Row
}

export type EncounterTestGroup = {
  /** Lab-category id (cbc / chem / urine / …) or null for uncategorized tests.
   *  Resolve the display label via t.reports.cumulativeCategories[categoryId]. */
  categoryId: string | null
  tests: EncounterObservation[]
  /** When the visit is multi-day, tests within each category are also
   *  re-grouped by analyte so callers can show "WBC ▼ 4 筆" trend rows
   *  instead of 4 identical-looking standalone rows. Empty when not multi-day
   *  or when no analyte has 2+ values in this category. */
  testSeries: EncounterTestSeries[]
}

/**
 * Multiple values of the same analyte across days within one encounter —
 * the core view-model behind the multi-day discharge / inpatient list.
 * The renderer collapses these into a single trend row; the consumer
 * expands to see the per-day values.
 */
export type EncounterTestSeries = {
  /** Stable id (canonical key when present, else display title). */
  id: string
  /** Audience-aware display title for the analyte (e.g. WBC / 白血球). */
  title: string
  /** Within-category sort key (canonical short code or fallback title). */
  sortKey: string
  /** Each measurement, sorted oldest-first by effectiveDateTime. */
  values: EncounterObservation[]
  /** Count of abnormal values (refRangeAbnormal or interpretation H/L/…). */
  abnormalCount: number
}

/** Same idea for medications: when an inpatient stay carries several days of
 *  one drug (typical for daily prophylaxis / chronic meds), the consumer can
 *  collapse them into a single drug row with the date range, leaving the
 *  per-refill detail behind a click. */
export type EncounterMedSeries = {
  id: string
  name: string
  isChronic: boolean
  /** First → last refill date for the date-range header. */
  firstDate?: string
  lastDate?: string
  /** Each refill, sorted oldest-first by authoredOn. */
  refills: EncounterMedication[]
}

/** The visit view uses the exact same presentation model as the dedicated
 *  medication tab. `when` is encounter-only metadata used to sort refills;
 *  it does not create a second medication-row UI contract. */
export type EncounterMedication = MedicationRow & {
  when?: string
  /** Source-reported inpatient execution start/end (SDK r2_1 or FHIR Period). */
  executionPeriod?: MedicationExecutionPeriod
}

export type EncounterDetails = {
  diagnoses: EncounterDiagnosis[]
  medications: EncounterMedication[]
  /** Per-drug grouping for multi-day visits. Empty when not multi-day or
   *  when every drug has only one refill. */
  medSeries: EncounterMedSeries[]
  tests: EncounterObservation[]
  /** tests grouped by lab category in clinical reading order; flat `tests`
   *  is kept for stats/search. Each group additionally carries `testSeries`
   *  for the multi-day collapsed view. */
  testGroups: EncounterTestGroup[]
  /** Narrative reports (EKG / imaging / endoscopy / pathology) linked to this
   *  visit — finding text only, no numeric member observations. */
  reports: EncounterReport[]
  procedures: EncounterProcedure[]
  clinicalNotes: ClinicalNote[]
  /** True when this encounter's tests / meds span 2+ distinct calendar days
   *  (typical inpatient stays / emergency observation). Drives the per-row
   *  date column and the analyte-series collapse in VisitItem. */
  isMultiDay: boolean
}

const toEncounterObservation = (
  observation: any,
  source: "diagnosticReport" | "observation",
  audience: 'medical' | 'patient',
  displayLang: DisplayLang,
): EncounterObservation => {
  // Audience-aware analyte label: medical → canonical short code (WBC / Na),
  // patient → long-form translation in the active UI language. Non-canonical
  // rows (cultures, panels, free-text) keep their bridge-sent label.
  const title = getCodeText(observation?.code)
    ? getAnalyteDisplayForObs(observation, audience, displayLang)
    : "Observation"
  // Canonical analyte key (audience-independent) drives both the category
  // lookup and the within-category sort. categorizeObservation handles
  // LOINC/short-code obs; CANONICAL_TO_CATEGORY catches Chinese-text bridge
  // data (no LOINC) the same way useReportsData does for its panel sort.
  // Use getAnalyteCanonicalKey (the raw UPPERCASE key) for the exact-match
  // category lookup — getAnalyteLabel returns the mixed-case DISPLAY form
  // ('HbA1c'), which would only match after a defensive .toUpperCase(). For
  // non-canonical rows the key is null, so fall back to the medical label as
  // the sort key (compareTestsByPreferred normalises both sides anyway).
  const canonicalKey = getAnalyteCanonicalKey(observation)
  const sortKey = canonicalKey ?? getAnalyteLabel(observation)
  const category =
    categorizeObservation(observation) ||
    (canonicalKey ? CANONICAL_TO_CATEGORY.get(canonicalKey) : null) ||
    null
  const interpretation = getInterpTag(observation?.interpretation)
  const referenceText = refRangeText(observation?.referenceRange)
  const components = Array.isArray(observation?.component)
    ? observation.component.map((component: any, index: number) => {
        const componentInterpretation = getInterpTag(component?.interpretation)
        return {
          id: component?.id || `${observation?.id || "component"}-${index}`,
          title: getCodeText(component?.code)
            ? getAnalyteDisplayForObs(component, audience, displayLang)
            : "Component",
          value: component?.valueQuantity
            ? valueWithUnit(component.valueQuantity)
            : component?.valueString || "—",
          interpretationLabel: componentInterpretation?.label,
          interpretationStyle: componentInterpretation?.style,
          referenceText: refRangeText(component?.referenceRange),
          refRangeAbnormal: checkReferenceRangeAbnormal(component),
          refRangeUnassessed: isReferenceRangeAssessmentUnavailable(component),
        }
      })
    : []

  return {
    id: observation?.id || `${source}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    value: observation?.valueQuantity
      ? valueWithUnit(observation.valueQuantity)
      : observation?.valueString || "—",
    interpretationLabel: interpretation?.label,
    interpretationStyle: interpretation?.style,
    referenceText,
    refRangeAbnormal: checkReferenceRangeAbnormal(observation),
    refRangeUnassessed: isReferenceRangeAssessmentUnavailable(observation),
    effectiveDateTime: observation?.effectiveDateTime,
    status: observation?.status,
    source,
    components,
    categoryId: category?.id,
    sortKey,
  }
}

// Cluster a visit's flat test list into category groups in clinical reading
// order, sorting within each group by the category's preferredOrder.
// When `multiDay` is true, the function additionally rolls up same-analyte
// observations within each category into a series, so the renderer can
// collapse "HB ×4" into a single trend row.
function buildTestGroups(
  tests: EncounterObservation[],
  multiDay: boolean,
): EncounterTestGroup[] {
  if (tests.length === 0) return []
  const sorted = [...tests].sort((a, b) => {
    const ra = a.categoryId ? CATEGORY_RANK.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const rb = b.categoryId ? CATEGORY_RANK.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    const cat = a.categoryId ? CATEGORY_BY_ID.get(a.categoryId) : undefined
    if (cat) {
      const cmp = compareTestsByPreferred(cat)(a.sortKey || a.title, b.sortKey || b.title)
      if (cmp !== 0) return cmp
    }
    return (a.sortKey || a.title).localeCompare(b.sortKey || b.title)
  })

  const groups: EncounterTestGroup[] = []
  for (const test of sorted) {
    const id = test.categoryId ?? null
    const last = groups[groups.length - 1]
    if (last && last.categoryId === id) last.tests.push(test)
    else groups.push({ categoryId: id, tests: [test], testSeries: [] })
  }
  if (multiDay) {
    for (const group of groups) {
      group.testSeries = buildTestSeries(group.tests)
    }
  }
  return groups
}

/** Roll up a single category's tests into per-analyte series sorted oldest-
 *  first by effectiveDateTime. Preserves the input order between analytes —
 *  the caller already sorted by category preferredOrder. */
function buildTestSeries(tests: EncounterObservation[]): EncounterTestSeries[] {
  const seriesByKey = new Map<string, EncounterTestSeries>()
  const keyOrder: string[] = []
  for (const t of tests) {
    // Group key: prefer canonical sortKey (WBC/NA), fall back to display title.
    // Bridge sometimes ships the same analyte with slightly different display
    // strings; the canonical key absorbs that.
    const key = t.sortKey || t.title
    let s = seriesByKey.get(key)
    if (!s) {
      s = { id: key, title: t.title, sortKey: t.sortKey || t.title, values: [], abnormalCount: 0 }
      seriesByKey.set(key, s)
      keyOrder.push(key)
    }
    s.values.push(t)
    // Interpretation wins when present; range flag is only a no-interpretation
    // fallback (2026-07-08 policy).
    const abnormal = t.interpretationLabel
      ? isAbnormalInterpretationLabel(t.interpretationLabel)
      : !!t.refRangeAbnormal
    if (abnormal) {
      s.abnormalCount++
    }
  }
  // Sort each series' values by effectiveDateTime ascending; undated rows
  // sink to the bottom so the timeline still reads left-to-right.
  for (const s of seriesByKey.values()) {
    s.values.sort((a, b) => {
      const ad = a.effectiveDateTime ?? ''
      const bd = b.effectiveDateTime ?? ''
      if (ad && !bd) return -1
      if (!ad && bd) return 1
      return ad.localeCompare(bd)
    })
  }
  return keyOrder.map((k) => seriesByKey.get(k)!)
}

/** Returns true when `tests` carries 2+ distinct calendar dates (YYYY-MM-DD).
 *  Hour/minute differences within the same day do NOT count — a 08:00 and
 *  14:00 draw on 2025-05-18 is one day. Tests with no effectiveDateTime are
 *  ignored for this signal. */
function detectMultiDay(tests: EncounterObservation[]): boolean {
  const days = new Set<string>()
  for (const t of tests) {
    const d = t.effectiveDateTime?.slice(0, 10)
    if (d) days.add(d)
    if (days.size >= 2) return true
  }
  return false
}

/** Group medications by drug name. Only invoked when the visit is multi-day
 *  AND the drug appears multiple times — single-refill drugs stay in the flat
 *  `medications` list (the renderer falls back to those for the non-grouped
 *  display path). */
function buildMedSeries(medications: EncounterMedication[]): EncounterMedSeries[] {
  const byIdentity = new Map<string, EncounterMedication[]>()
  const identityOrder: string[] = []
  for (const m of medications) {
    const key = m.drugKey || m.title
    if (!byIdentity.has(key)) {
      byIdentity.set(key, [])
      identityOrder.push(key)
    }
    byIdentity.get(key)!.push(m)
  }
  // Helper: pull a sortable ISO-ish prefix out of "when" (which is a
  // locale-formatted string like "2025/05/18 08:00"). Falls back to '' so
  // undated refills sink to the end.
  const sortKey = (m: EncounterMedication): string => {
    if (!m.when) return ''
    // Replace separators so a lexicographic compare works on YYYY?MM?DD prefix.
    return m.when.replace(/[/.]/g, '-')
  }
  return identityOrder.map((identity) => {
    const refills = byIdentity.get(identity)!
    refills.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    const dated = refills.map(sortKey).filter(Boolean)
    const name = refills[refills.length - 1]?.title || identity
    return {
      id: identity,
      name,
      isChronic: refills.some((r) => r.isChronic),
      firstDate: dated[0]?.slice(0, 10),
      lastDate: dated[dated.length - 1]?.slice(0, 10),
      refills,
    }
  })
}

export function useEncounterDetails(
  medications: any[],
  diagnosticReports: any[],
  observations: any[],
  procedures: any[],
  clinicalNotes: ClinicalNote[],
  conditions: any[],
  locale: string = "en-US",
  audience: 'medical' | 'patient' = 'medical',
  standardMedicationRows: MedicationRow[] = [],
) {
  return useMemo(() => {
    const map = new Map<string, EncounterDetails>()
    const standardMedicationRowsById = new Map(
      standardMedicationRows.map((row) => [row.id, row]),
    )
    // getAnalyteDisplayForObs only branches on zh-TW vs en; collapse the
    // incoming locale string to the DisplayLang the helper expects.
    const displayLang: DisplayLang = locale === 'zh-TW' ? 'zh-TW' : 'en'

    const ensureEntry = (encounterId: string) => {
      if (!map.has(encounterId)) {
        map.set(encounterId, {
          diagnoses: [], medications: [], medSeries: [],
          tests: [], testGroups: [], reports: [],
          procedures: [], clinicalNotes: [],
          isMultiDay: false,
        })
      }
      return map.get(encounterId)!
    }

    if (Array.isArray(medications)) {
      // Drug-level chronic aggregation: the bridge tags each refill individually,
      // and a chronic drug may have occasional acute refills. Treat a drug as
      // chronic for this patient if ANY refill in the whole dataset was tagged.
      // Mirrors the same aggregation used in features/clinical-summary/medications/
      // hooks/useMedicationRows.ts so the badge appears consistently across views.
      const chronicDrugKeys = new Set<string>()
      for (const m of medications) {
        if (!m) continue
        if (!isChronicPrescription(m)) continue
        const key =
          m.medicationCodeableConcept?.coding?.[0]?.code ||
          m.medicationCodeableConcept?.text ||
          m.medicationReference?.display ||
          m.code?.text ||
          ''
        if (key) chronicDrugKeys.add(key)
      }

      medications.forEach((med: any, medicationIndex: number) => {
        const encounterId = getReferenceId(med?.encounter)
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        const standardRowByPosition = standardMedicationRows[medicationIndex]
        const medId =
          med?.id ||
          standardRowByPosition?.id ||
          `${encounterId}-med-${entry.medications.length}`
        if (entry.medications.some((item) => item.id === medId)) return

        const drugKey =
          med?.medicationCodeableConcept?.coding?.[0]?.code ||
          med?.medicationCodeableConcept?.text ||
          med?.medicationReference?.display ||
          med?.code?.text ||
          ''
        const isChronic = !!drugKey && chronicDrugKeys.has(drugKey)
        const rawDetail =
          med?.dosageInstruction?.[0]?.text || medicationQuantityDetail(med)
        const standardRow =
          standardMedicationRowsById.get(medId) ||
          (!med?.id ? standardRowByPosition : undefined)
        const executionStart =
          med?.dispenseRequest?.validityPeriod?.start ||
          med?.authoredOn ||
          med?.effectiveDateTime
        const executionEnd =
          med?.dispenseRequest?.validityPeriod?.end ||
          executionStart
        const status = String(med?.status || 'unknown').toLowerCase()
        const detail = localizeMedicationQuantityDetail(rawDetail, locale)
        const localizedName = getMedicationNameLocalized(med, audience, locale)
        const fallbackRow: MedicationRow = {
          id: medId,
          drugKey: drugKey || undefined,
          title: localizedName,
          status,
          detail,
          isInactive: status === 'stopped' || status === 'completed',
          isChronic,
          refillCount: 1,
          searchHaystack: [localizedName, drugKey, detail]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        }

        entry.medications.push({
          ...(standardRow || fallbackRow),
          when: formatDateTime(med?.authoredOn, locale),
          ...(executionStart
            ? {
                executionPeriod: {
                  start: executionStart,
                  end: executionEnd,
                },
              }
            : {}),
        })
      })
    }

    if (Array.isArray(diagnosticReports)) {
      const groupingKeys = reportDisplayGroupingKeys(diagnosticReports)
      const reportsByEncounter = new Map<string, any[]>()
      diagnosticReports.forEach((report: any) => {
        const encounterId = getReferenceId(report?.encounter)
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        const encounterReports = reportsByEncounter.get(encounterId) || []
        encounterReports.push(report)
        reportsByEncounter.set(encounterId, encounterReports)
        const observations = Array.isArray(report?._observations)
          ? report._observations
          : []

        observations.forEach((obs: any) => {
          const normalized = toEncounterObservation(obs, "diagnosticReport", audience, displayLang)
          if (entry.tests.some((item) => item.id === normalized.id)) return
          entry.tests.push(normalized)
        })

      })

      for (const [encounterId, reports] of reportsByEncounter) {
        const entry = ensureEntry(encounterId)
        const rows = buildReportsData(
          reports,
          [],
          'standardized',
          audience,
          locale === 'zh-TW' ? 'zh-TW' : 'en',
          groupingKeys,
        ).reportRows

        // Numeric/member-observation DiagnosticReports already appear in the
        // visit's laboratory section. The report section retains its existing
        // narrative/image scope while consuming the exact same grouped Row
        // model as Reports > Imaging.
        for (const row of rows) {
          const summary = row.obs.find((obs) => obs?.code?.text === 'Report Summary')
          if (!summary) continue
          const sourceReport = reports.find((report) =>
            row.diagnosticReportIds?.includes(report?.id),
          ) || reports[0]
          entry.reports.push({
            id: row.id,
            title: row.title,
            conclusion: summary.valueString || '',
            effectiveDateTime: row.effectiveDate,
            status: sourceReport?.status,
            row,
          })
        }
      }
    }

    if (Array.isArray(observations)) {
      observations.forEach((obs: any) => {
        const encounterId = getReferenceId(obs?.encounter)
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        const normalized = toEncounterObservation(obs, "observation", audience, displayLang)
        if (entry.tests.some((item) => item.id === normalized.id)) return
        entry.tests.push(normalized)
      })
    }

    if (Array.isArray(procedures)) {
      procedures.forEach((procedure: any) => {
        const encounterId = getReferenceId(procedure?.encounter)
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        const id = procedure?.id || `${encounterId}-procedure-${entry.procedures.length}`
        if (entry.procedures.some((existing) => existing.id === id)) return

        entry.procedures.push({
          id,
          title: getCodeText(procedure?.code) || "Procedure",
          status: procedure?.status,
          performer: procedure?.performer?.[0]?.actor?.display,
          performed: procedure?.performedDateTime || procedure?.performedPeriod?.start,
          category: getCodeText(procedure?.category),
          outcome: getCodeText(procedure?.outcome),
          report: Array.isArray(procedure?.report)
            ? procedure.report.map((ref: any) => ref?.display || ref?.reference).filter(Boolean)
            : [],
        })
      })
    }

    // Associate clinical notes with encounters
    if (Array.isArray(clinicalNotes)) {
      clinicalNotes.forEach((note: ClinicalNote) => {
        const encounterId = getReferenceId({ reference: note.encounterRef })
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        if (entry.clinicalNotes.some((existing) => existing.id === note.id)) return
        entry.clinicalNotes.push(note)
      })
    }

    // Group conditions by encounter reference
    if (Array.isArray(conditions)) {
      conditions.forEach((condition: any) => {
        const encounterId = getReferenceId(condition?.encounter)
        if (!encounterId) return
        const entry = ensureEntry(encounterId)
        const id = condition?.id || `${encounterId}-dx-${entry.diagnoses.length}`
        if (entry.diagnoses.some((d) => d.id === id)) return

        const coding = condition?.code?.coding
        const icdCode = coding?.find((c: any) =>
          c.system?.toLowerCase().includes('icd')
        )?.code || coding?.[0]?.code

        entry.diagnoses.push({
          id,
          title: condition?.code?.text
            || coding?.[0]?.display
            || coding?.[0]?.code
            || 'Unknown diagnosis',
          code: icdCode,
          clinicalStatus: condition?.clinicalStatus?.coding?.[0]?.code
            || (typeof condition?.clinicalStatus === 'string' ? condition.clinicalStatus : undefined),
          verificationStatus: condition?.verificationStatus?.coding?.[0]?.code
            || (typeof condition?.verificationStatus === 'string' ? condition.verificationStatus : undefined),
          recordedDate: condition?.recordedDate || condition?.dateRecorded,
        })
      })
    }

    // Detect multi-day stays (≥2 distinct test dates), then build the
    // collapsed-by-analyte test groups and the per-drug medication series.
    // Single-day visits skip both rollups; the renderer just iterates the
    // flat lists in that case (preserves existing outpatient UX).
    map.forEach((entry) => {
      entry.isMultiDay = detectMultiDay(entry.tests)
      entry.testGroups = buildTestGroups(entry.tests, entry.isMultiDay)
      entry.medSeries = entry.isMultiDay ? buildMedSeries(entry.medications) : []
    })

    return map
  }, [
    medications,
    diagnosticReports,
    observations,
    procedures,
    clinicalNotes,
    conditions,
    locale,
    audience,
    standardMedicationRows,
  ])
}
