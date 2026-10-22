import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
import { parseSimpleReferenceRangeText } from '@voho0000/clinical-lab-normalization/interpretation'
import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { diagnosisSelect, type ClinicalSelectValue } from './hfpef-clinical-autofill'

/**
 * The DOAC calculators' patient questions the record can answer: liver
 * enzymes and bilirubin against the reporting lab's own upper limit, dialysis
 * and a recent GI lesion for dabigatran from a code that names them, and
 * pregnancy for a man. A missing code is never read as 「no」: the liver
 * class (Child-Pugh) and dialysis stay blank without positive evidence, as
 * pregnancy does for any woman. Every answer says where it came from.
 */
export type DoacPatientKey = 'doac_liver_enzymes' | 'doac_bilirubin_high' | 'doac_dialysis' | 'doac_pregnancy' | 'doac_gi_risk'

/** The fields of an Observation read here; the record's own entity is wider. */
export interface LabObservation {
  id?: string
  status?: string
  effectiveDateTime?: string
  code?: { text?: string; coding?: Array<{ code?: string; display?: string; system?: string }> }
  valueQuantity?: { value?: number; unit?: string }
  specimen?: { display?: string }
  performer?: Array<{ display?: string }>
  referenceRange?: Array<{ high?: { value?: number; unit?: string }; text?: string }>
}

interface LabReading { value: number; unit: string; uln?: number; date: string; obsId?: string; facility?: string }

const unitKey = (unit: string | undefined) => (unit ?? '').toLowerCase().replace(/\s/g, '').replace('iu', 'u')

/**
 * The upper limit a report's own range text gives, for the patient's sex.
 * The bridge keeps ranges as text only (it never derives low/high), so the
 * shapes found in real reports are read here — 「[0][40]」「0~40」「＜1.2 mg/dL」
 * 「M:＜40; F:＜32」「Men:＜40, Women:＜32」 — each through the lab package's
 * audited parser. Anything else, including a sex-split range for a patient
 * whose sex is unknown, gives no limit.
 */
export function upperLimitFromText(text: string | undefined, unit: string, sex: string | undefined): number | undefined {
  let s = (text ?? '').normalize('NFKC').replace(/≦/g, '<=').replace(/≧/g, '>=').trim()
  if (!s) return undefined
  // Every unit written anywhere in the range must be the result's own — checked
  // on the whole text before a sex is chosen, since 「M:＜21; F:＜18 umol/L」
  // writes one unit for both (#360 review). Then they are removed.
  const own = unitKey(unit)
  const UNIT = /([a-zµμ%]+\/[a-z0-9.]+)/gi
  if ([...s.matchAll(UNIT)].some((match) => unitKey(match[1]) !== own)) return undefined
  s = s.replace(UNIT, '').replace(/\s+(?=\]|$)/g, '').trim()
  // Longer labels first, so 「Female」 is not read as 「F」 and 「emale」.
  const split = /^(?:Male|Men|M)\s*:\s*(.+?)\s*[;,，；]\s*(?:Female|Women|F)\s*:?\s*(.+)$/i.exec(s)
  if (split) {
    if (sex !== 'male' && sex !== 'female') return undefined
    s = (sex === 'male' ? split[1] : split[2])!.trim()
  }
  // One bracket filled and the other empty: the filled one is the range.
  const one = /^\[([^\]]*)\]\s*\[\s*\]$/.exec(s) ?? /^\[\s*\]\s*\[([^\]]*)\]$/.exec(s)
  if (one && /[<>~-]|to/i.test(one[1]!)) s = one[1]!.trim()
  return parseSimpleReferenceRangeText(s)?.high
}

/**
 * The latest blood result for the analyte, with the upper limit of the same
 * report. A newest result without a usable limit leaves the limit unknown: an
 * older one is not used in its place.
 */
function latest(observations: LabObservation[], key: string, now: Date, sex: string | undefined): LabReading | undefined {
  let best: LabReading | undefined
  for (const obs of observations) {
    if (['entered-in-error', 'cancelled', 'registered', 'preliminary'].includes(obs.status ?? '')) continue
    if (/urin|尿/i.test(obs.specimen?.display ?? '')) continue
    const value = obs.valueQuantity?.value
    const date = obs.effectiveDateTime ?? ''
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime()) continue
    if (getAnalyteCanonicalKey(obs) !== key) continue
    if (best && Date.parse(best.date) >= Date.parse(date)) continue
    const unit = obs.valueQuantity?.unit ?? ''
    // One range only: several are age, sex or specimen bands, and choosing one is not ours to do.
    const range = obs.referenceRange?.length === 1 ? obs.referenceRange[0] : undefined
    const high = range?.high
    // A structured limit in another unit makes the whole range unusable: its text
    // is not read in its place (#360 review).
    const foreign = typeof high?.value === 'number' && !!high.unit && unitKey(high.unit) !== unitKey(unit)
    const structured = !foreign && typeof high?.value === 'number' && high.value > 0 ? high.value : undefined
    const fromText = foreign ? undefined : upperLimitFromText(range?.text, unit, sex)
    const uln = structured ?? (fromText !== undefined && fromText > 0 ? fromText : undefined)
    best = { value, unit, uln, date, obsId: obs.id, facility: obs.performer?.find((p) => p.display)?.display }
  }
  return best
}

const fmt = (n: number) => String(Math.round(n * 10) / 10)
const reading = (name: string, lab: LabReading) => `${name} ${fmt(lab.value)}${lab.uln !== undefined ? `（ULN ${fmt(lab.uln)}）` : ''}`
const older = (...dates: string[]) => dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0]!

/** ICD-10 Z99.2, Z49, Z91.15; ICD-9 V45.1, V56. */
const isDialysisCode = (code: string) => /^(?:Z992|Z49|Z9115|V451|V56)/.test(code)
/** ICD-10 K20, K21, K25–K29, K92.0–K92.2; ICD-9 530.1, 530.81, 531–535, 578. */
const isGiLesionCode = (code: string) => /^(?:K2[015-9]|K92[012]|5301|53081|53[1-5]|578)/.test(code)

/** A GI lesion this recent counts toward dabigatran's bleeding-risk question. */
const GI_WINDOW_DAYS = 365

export function doacPatientSelects(input: {
  observations: LabObservation[]
  conditions: ConditionEntity[]
  encounters: EncounterEntity[]
  demographics: { age?: number; gender?: string }
  now: Date
}): Partial<Record<DoacPatientKey, ClinicalSelectValue>> {
  const { observations, conditions, encounters, demographics, now } = input
  const today = now.toISOString().slice(0, 10)
  const out: Partial<Record<DoacPatientKey, ClinicalSelectValue>> = {}

  // ALT/AST: 「>2×ULN」 when either is; 「no」 only when both are known and neither is.
  const alt = latest(observations, 'ALT', now, demographics.gender)
  const ast = latest(observations, 'AST', now, demographics.gender)
  const high = [alt && ['ALT', alt] as const, ast && ['AST', ast] as const]
    .filter((item): item is readonly ['ALT' | 'AST', LabReading] => !!item && item[1].uln !== undefined && item[1].value > 2 * item[1].uln!)
  if (high.length) {
    const [name, lab] = high[0]!
    out.doac_liver_enzymes = { value: 'yes', date: lab.date, testName: `${reading(name, lab)}，>2×ULN（請核對）`, obsId: lab.obsId, facility: lab.facility, resourceType: 'Observation' }
  } else if (alt?.uln !== undefined && ast?.uln !== undefined) {
    out.doac_liver_enzymes = { value: 'no', date: older(alt.date, ast.date), testName: `${reading('ALT', alt)}、${reading('AST', ast)}，均 ≤2×ULN`, obsId: alt.obsId, facility: alt.facility, resourceType: 'Observation' }
  }
  const bili = latest(observations, 'T.BILI', now, demographics.gender)
  if (bili?.uln !== undefined) {
    const raised = bili.value >= 1.5 * bili.uln
    out.doac_bilirubin_high = { value: raised ? 'yes' : 'no', date: bili.date, testName: `${reading('總膽紅素', bili)}，${raised ? '≥' : '<'}1.5×ULN`, obsId: bili.obsId, facility: bili.facility, resourceType: 'Observation' }
  }

  // Dialysis: a code that names it says yes. No code says nothing — an ESRD
  // code alone, or a post-dialysis creatinine, would otherwise read as 「no」
  // (#355 review).
  const dialysis = diagnosisSelect(conditions, encounters, now, isDialysisCode, '透析')
  if (dialysis) out.doac_dialysis = dialysis
  // Dabigatran's 「gastritis, oesophagitis, GERD」: a recent code says yes; no
  // code says nothing, since 「other bleeding risk」 is the clinician's call.
  const gi = diagnosisSelect(conditions, encounters, now, isGiLesionCode, '胃食道病灶', GI_WINDOW_DAYS)
  if (gi) out.doac_gi_risk = gi

  // Age does not rule out pregnancy or breast-feeding (#355 review): a woman is asked.
  if (demographics.gender === 'male') out.doac_pregnancy = { value: 'no', date: today, testName: '男性' }
  return out
}
