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
  const ecg = ecgs.find((item) => affirmedSt(item.text)) ?? ecgs[0]
  if (ecg) {
    const st = affirmedSt(ecg.text)
    out.timiSt = { value: st ? 'yes' : 'no', date: day(ecg.date), testName: st ? `72 小時內 EKG 記載 ST 偏移（請核對 ≥0.5 mm）` : '72 小時內 EKG 未記載 ST 偏移（請核對）', obsId: ecg.report.id, resourceType: 'DiagnosticReport' }
  }
  return out
}

/**
 * ST elevation or depression affirmed somewhere in the report: each mention is
 * read within its own clause, negated by a word before it (「No ST elevation」)
 * or after it (「ST elevation is no longer present」), so one negated finding
 * does not hide another affirmed one.
 */
function affirmedSt(text: string): boolean {
  const mention = /\bST(?:[- ]segment)?[- ]?(?:elevation|depression)|\bST[- ]?[↑↓]|ST\s*段\s*(?:上升|抬高|下降|壓低)/gi
  return text.split(/[\n\r.;。；,，]|\bbut\b|但|而/i).some((clause) => [...clause.matchAll(mention)].some((match) => {
    const before = clause.slice(0, match.index)
    const after = clause.slice(match.index! + match[0].length)
    return !/(?:\bno\b|\bnot\b|without|absence|rule\s*out|possible|suspect|\br\/o\b|疑|未見|沒有|無)[^,，:：]*$/i.test(before)
      && !/^[^,，]*?(?:no\s+longer|not\s+(?:seen|present)|\babsent\b|\bresolved\b|已消失|消失|未見)/i.test(after)
  }))
}
