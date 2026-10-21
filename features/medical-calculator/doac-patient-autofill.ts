import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
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
  referenceRange?: Array<{ high?: { value?: number; unit?: string } }>
}

interface LabReading { value: number; unit: string; uln?: number; date: string; obsId?: string; facility?: string }

const unitKey = (unit: string | undefined) => (unit ?? '').toLowerCase().replace(/\s/g, '').replace('iu', 'u')

/**
 * The latest blood result for the analyte, with the upper limit of the same
 * report. A newest result without a usable limit leaves the limit unknown: an
 * older one is not used in its place.
 */
function latest(observations: LabObservation[], key: string, now: Date): LabReading | undefined {
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
    const high = obs.referenceRange?.find((range) => typeof range.high?.value === 'number' && range.high.value > 0)?.high
    const uln = high && (!high.unit || unitKey(high.unit) === unitKey(unit)) ? high.value : undefined
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
  const alt = latest(observations, 'ALT', now)
  const ast = latest(observations, 'AST', now)
  const high = [alt && ['ALT', alt] as const, ast && ['AST', ast] as const]
    .filter((item): item is readonly ['ALT' | 'AST', LabReading] => !!item && item[1].uln !== undefined && item[1].value > 2 * item[1].uln!)
  if (high.length) {
    const [name, lab] = high[0]!
    out.doac_liver_enzymes = { value: 'yes', date: lab.date, testName: `${reading(name, lab)}，>2×ULN（請核對）`, obsId: lab.obsId, facility: lab.facility, resourceType: 'Observation' }
  } else if (alt?.uln !== undefined && ast?.uln !== undefined) {
    out.doac_liver_enzymes = { value: 'no', date: older(alt.date, ast.date), testName: `${reading('ALT', alt)}、${reading('AST', ast)}，均 ≤2×ULN`, obsId: alt.obsId, facility: alt.facility, resourceType: 'Observation' }
  }
  const bili = latest(observations, 'T.BILI', now)
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
