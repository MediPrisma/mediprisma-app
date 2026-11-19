import { classifyReport, reportNarrative } from '@voho0000/personalized-care-fhir'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'
import { upperLimitFromText, type LabObservation } from './doac-patient-autofill'
import type { ClinicalSelectValue } from './hfpef-clinical-autofill'

export type TimiSelectKey = 'timiMarker' | 'timiSt'

/** TIMI asks about this presentation: only results from the last 72 hours are read. */
const WINDOW_MS = 72 * 3_600_000
/** Troponin I or T, conventional or high-sensitivity, by LOINC or by name. */
const TROPONIN_LOINC = new Set(['10839-9', '89579-7', '6598-7', '67151-1', '49563-0', '42757-5', '48425-3'])
const isTroponin = (obs: LabObservation) =>
  obs.code?.coding?.some((coding) => TROPONIN_LOINC.has(coding.code ?? '')) || /troponin|\bhs-?Tn[IT]\b|旋轉素/i.test(`${obs.code?.text ?? ''} ${obs.code?.coding?.map((c) => c.display).join(' ') ?? ''}`)
const recent = (date: string, now: Date) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= now.getTime() && now.getTime() - Date.parse(date) <= WINDOW_MS
const day = (date: string) => date.slice(0, 10)

/**
 * TIMI UA/NSTEMI's 「positive cardiac marker」 and 「ST deviation ≥0.5 mm」,
 * read from this presentation's record (owner rule 2026-11-19: prefill
 * whatever the record can answer). A troponin above its report's own upper
 * limit is 「是」, at or below it 「否」; a limit the report does not give is
 * left to the clinician. An ECG within 72 hours that names ST elevation or
 * depression is 「是」, one that does not is 「否」 (read for ≥0.5 mm).
 */
export function timiSelects(input: { observations: LabObservation[]; reports: DiagnosticReportEntity[]; now: Date; sex?: string }): Partial<Record<TimiSelectKey, ClinicalSelectValue>> {
  const { observations, reports, now, sex } = input
  const out: Partial<Record<TimiSelectKey, ClinicalSelectValue>> = {}

  const troponins = observations.filter((obs) => isTroponin(obs) && typeof obs.valueQuantity?.value === 'number' && recent(obs.effectiveDateTime ?? '', now)
    && !['entered-in-error', 'cancelled', 'registered', 'preliminary'].includes(obs.status ?? ''))
  const readings = troponins.map((obs) => {
    const unit = obs.valueQuantity?.unit ?? ''
    const range = obs.referenceRange?.length === 1 ? obs.referenceRange[0] : undefined
    const uln = typeof range?.high?.value === 'number' && range.high.value > 0 && (!range.high.unit || range.high.unit === unit) ? range.high.value : upperLimitFromText(range?.text, unit, sex)
    return { obs, value: obs.valueQuantity!.value!, unit, uln }
  })
  // Any result above its limit marks the presentation; otherwise every one must have a limit to say 「否」.
  const high = readings.find((r) => r.uln !== undefined && r.value > r.uln)
  const latest = [...readings].sort((a, b) => (b.obs.effectiveDateTime ?? '').localeCompare(a.obs.effectiveDateTime ?? ''))[0]
  const shown = high ?? latest
  // A recent result whose report gives no limit cannot be read either way: 「unknown」 keeps the
  // field blank for the clinician rather than letting it fall back to the presumed 「無」.
  const unread = !high ? readings.find((r) => r.uln === undefined) : undefined
  if (unread) {
    out.timiMarker = { value: 'unknown', date: day(unread.obs.effectiveDateTime ?? ''), testName: `72 小時內 troponin ${unread.value} ${unread.unit}，報告未附上限，請依該檢驗判讀`, obsId: unread.obs.id, resourceType: 'Observation' }
  } else if (shown) {
    out.timiMarker = {
      value: high ? 'yes' : 'no',
      date: day(shown.obs.effectiveDateTime ?? ''),
      testName: `72 小時內 troponin ${shown.value} ${shown.unit}（上限 ${shown.uln}）${high ? '高於上限' : '未超過上限'}（請核對）`,
      obsId: shown.obs.id,
      resourceType: 'Observation',
      ...(shown.obs.performer?.[0]?.display ? { facility: shown.obs.performer[0].display } : {}),
    }
  }

  const ecgs = reports.flatMap((report) => {
    if (['entered-in-error', 'cancelled', 'registered', 'partial', 'preliminary'].includes(report.status ?? '')) return []
    const date = report.effectiveDateTime ?? report.effectivePeriod?.start ?? report.issued ?? ''
    const text = reportNarrative(report)
    if (!text.trim() || classifyReport(report, text) !== 'ecg' || !recent(date, now)) return []
    return [{ report, text, date }]
  }).sort((a, b) => b.date.localeCompare(a.date))
  const ecgReadings = ecgs.map((item) => ({ ...item, st: readSt(item.text) }))
  const ecg = ecgReadings.find((item) => item.st === 'yes') ?? ecgReadings.find((item) => item.st === 'unsure') ?? ecgReadings[0]
  if (ecg) {
    out.timiSt = ecg.st === 'yes'
      ? { value: 'yes', date: day(ecg.date), testName: '72 小時內 EKG 記載 ST 偏移（未載幅度者請核對 ≥0.5 mm）', obsId: ecg.report.id, resourceType: 'DiagnosticReport' }
      : ecg.st === 'unsure'
        ? { value: 'unknown', date: day(ecg.date), testName: '72 小時內 EKG 的 ST 描述不確定（疑似／待排除），請依原文判讀', obsId: ecg.report.id, resourceType: 'DiagnosticReport' }
        : { value: 'no', date: day(ecg.date), testName: '72 小時內 EKG 未記載 ≥0.5 mm 的 ST 偏移（請核對）', obsId: ecg.report.id, resourceType: 'DiagnosticReport' }
  }
  return out
}

/**
 * TIMI's ST deviation as the ECG states it. Each mention is read in its own
 * clause. A negation counts only where it governs the finding itself: right
 * before it (「No ST elevation」, 「無明顯 ST 段上升」) or as its own predicate
 * right after it (「ST elevation is no longer present」); 「no change in ST
 * depression」 or 「ST depression with absent P waves」 still affirm it. A stated
 * size under 0.5 mm (or 「<0.5 mm」) is below TIMI's threshold. A negation also
 * covers ST mentions coordinated with it (「No ST elevation or ST depression」).
 * 「Possible」, 「suspect」 or a limit that cannot settle it is left for the clinician.
 */
function readSt(text: string): 'yes' | 'unsure' | 'no' {
  const mention = /\bST(?:[- ]segment)?[- ]?(?:elevation|depression)|\bST[- ]?[↑↓]|ST\s*段\s*(?:上升|抬高|下降|壓低)/gi
  let unsure = false
  for (const clause of text.split(/[\n\r;。；,，]|\.(?!\d)|\bbut\b|但|而/i)) {
    // A negation also governs the ST mentions coordinated with the one it heads: 「No ST elevation or ST depression」.
    let negatedUntil = -1
    for (const match of clause.matchAll(mention)) {
      const before = clause.slice(0, match.index)
      const after = clause.slice(match.index! + match[0].length)
      const coordinated = negatedUntil >= 0 && /^\s*(?:or|and|nor|\/|、|或|及|與)\s*(?:significant|obvious|definite|acute|new|明顯|顯著)?\s*$/i.test(clause.slice(negatedUntil, match.index))
      if (coordinated || /(?:\bno\b|\bnot\b|without|absence\s+of|未見|沒有|無)\s*(?:significant|obvious|definite|acute|new|明顯|顯著)?\s*$/i.test(before)) { negatedUntil = match.index! + match[0].length; continue }
      negatedUntil = -1
      if (/^\s*(?:(?:is|are|was|were|has|have)\s+)?(?:no\s+longer|not\s+(?:seen|present)|absent|resolved|已消失|消失)/i.test(after)) continue
      if (/(?:possible|suspect(?:ed)?|rule\s*out|\br\/o\b|equivocal|疑似?|待排除)\s*(?:\S+\s*){0,2}$/i.test(before)) { unsure = true; continue }
      // A stated size keeps its comparator: 「<0.5 mm」 is under the threshold, 「<1 mm」 cannot say.
      const size = /(<|≤|≦|＜|less\s+than|under|小於|未達)?\s*(\d+(?:\.\d+)?)\s*mm/i.exec(after) ?? /(<|≤|≦|＜|less\s+than|under|小於|未達)?\s*(\d+(?:\.\d+)?)\s*mm/i.exec(clause)
      if (size) {
        const value = Number(size[2])
        if (size[1] ? value <= 0.5 : value < 0.5) continue
        if (size[1]) { unsure = true; continue }
      }
      return 'yes'
    }
  }
  return unsure ? 'unsure' : 'no'
}
