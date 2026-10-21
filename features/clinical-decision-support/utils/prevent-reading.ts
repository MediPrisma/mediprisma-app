import { PREVENT_INPUTS, PREVENT_VERSION, calculatePrevent } from '@/features/medical-calculator/calculators/prevent'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitals } from '../stores/clinic-vitals.store'
import { convertToBase } from '@/features/medical-calculator/units'

// A diabetes diagnosis code locks PREVENT's 糖尿病 input, as E11 always did.
// Current glucose-lowering therapy alone (the pack excludes an SGLT2 inhibitor
// on its own) prefills it from the record but stays editable, the way 表一
// marks the same evidence ◐ 須臨床確認.
const DIABETES_CODE_FACT_KEYS = ['type1DiabetesDiagnosis', 'type2DiabetesDiagnosis', 'otherDiabetesDiagnosis'] as const

export function buildPreventReading(profile: CdssPatientProfile, autofill: Autofill, inputs: CalcValues, vitals?: ClinicVitals) {
  const values: CalcValues = {}
  const fields = PREVENT_INPUTS.map(input => {
    const resolved = resolveInput(input, autofill)
    const manual = Object.hasOwn(inputs, input.key)
    let value = manual ? inputs[input.key] : resolved.unconvertible ? '' : resolved.value
    let unitError = resolved.unconvertible && !manual
    let date = manual ? profile.evaluatedAt?.slice(0, 10) : resolved.date
    let source = manual ? 'physician' : resolved.filled ? 'record' : 'none'
    const key = input.key
    const positive = key === 'cvd' ? !!(profile.facts.ascvdDiagnosis || profile.facts.heartFailureDiagnosis)
      : key === 'dm' ? DIABETES_CODE_FACT_KEYS.some(factKey => profile.facts[factKey])
      : key === 'eskd' ? profile.kidneyReplacementTherapy?.state === 'confirmed'
      : key === 'subclinical' ? (profile.facts.LVEF?.numericValue ?? 100) < 40 : false
    // Known positive exclusions cannot be accidentally cleared in this form.
    if (positive) { value = 'yes'; source = 'record' }
    const diabetesTherapy = profile.facts.diabetesGlucoseLoweringTherapy
    if (!manual && !positive && key === 'dm' && diabetesTherapy) {
      value = 'yes'; source = 'record'; date = diabetesTherapy.date
    }
    if (!manual && key === 'statin' && profile.medicationClassContexts?.statin) {
      value = profile.medicationClassContexts.statin.state === 'confirmed-current' ? 'yes' : profile.medicationClassContexts.statin.state === 'not-found' ? 'no' : ''
      source = 'record'
      date = profile.medicationClassContexts.statin.lastPrescriptionDate
    }
    if (!manual && key === 'bptreat' && autofill.clinicalSelects?.antihypertensives?.value === 'yes') {
      value = 'yes'; source = 'record'; date = autofill.clinicalSelects.antihypertensives.date
    }
    const clinicKey = key === 'bmi' ? 'bodyMassIndex' : key === 'egfr' ? 'eGFR' : undefined
    const clinic = clinicKey ? profile.facts[clinicKey] : undefined
    if (!manual && clinic?.numericValue !== undefined && (key !== 'egfr' || convertToBase(clinic.numericValue, clinic.unit, 'egfr'))) { value = String(clinic.numericValue); date = clinic.date; source = 'record'; unitError = false }
    if (!manual && key === 'sbp' && vitals?.entries?.systolic) {
      value = String(vitals.entries.systolic.value); date = vitals.entries.systolic.measuredOn; source = 'record'
    }
    values[key] = value
    const days = date && profile.evaluatedAt ? Math.floor((Date.parse(profile.evaluatedAt)-Date.parse(date))/86400000) : undefined
    return { input, value, date, source, ageDays: days !== undefined && Number.isFinite(days) ? days : undefined, locked: positive, unitError }
  })
  return { values, fields, result: calculatePrevent(values) }
}
export type PreventReading = ReturnType<typeof buildPreventReading>
export function applyPreventReading(profile: CdssPatientProfile, reading?: PreventReading): CdssPatientProfile {
  const facts = { ...profile.facts }
  for (const key of ['preventAscvd10YearRisk','preventAscvd30YearRisk','preventAssessment','preventDiabetes','preventDiabetesDenied','preventAge']) delete facts[key]
  if (!reading) return { ...profile, facts }
  const { result, values } = reading
  facts.preventAssessment = { zh: result.status, en: result.status, textEvidence: { direction: 'supports', matchedTerms: [result.status, ...result.issues] } }
  if (values.dm === 'yes') facts.preventDiabetes = { zh: '糖尿病：已核對', en: 'Diabetes confirmed' }
  // Only the clinician's own 「否」 is an answer. A blank input is not, and the
  // pack must be able to tell them apart: without a code, this answer outranks
  // a glucose-lowering drug or an HbA1c on every card (pack `hasDiabetes`).
  const dmField = reading.fields.find(field => field.input.key === 'dm')
  if (values.dm === 'no' && dmField?.source === 'physician') {
    facts.preventDiabetesDenied = { zh: '糖尿病：醫師於 PREVENT 回答否', en: 'Diabetes: clinician answered no in PREVENT', date: dmField.date }
  }
  if (result.status === 'ready') {
    facts.preventAge = { zh: values.age, en: values.age, numericValue: Number(values.age) }
    for (const [key, value] of [['preventAscvd10YearRisk', result.risk10], ['preventAscvd30YearRisk', result.risk30]] as const) {
      if (value === undefined) continue
      facts[key] = { zh: `${value.toFixed(2)}%`, en: `${value.toFixed(2)}%`, numericValue: value, unit: '%', date: profile.evaluatedAt,
        textEvidence: { direction: 'supports', matchedTerms: [`calculator:prevent-ascvd@${PREVENT_VERSION}`, 'endpoint:ascvd', 'eligibility:confirmed'], fragments: reading.fields.map(f => `${f.input.key}=${f.value}; ${f.source}; ${f.date || 'date unavailable'}`) } }
    }
  }
  return { ...profile, facts }
}
