import { PREVENT_INPUTS, PREVENT_VERSION, calculatePrevent } from '@/features/medical-calculator/calculators/prevent'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitals } from '../stores/clinic-vitals.store'
import { buildRiskInputs, type RiskField, type RiskInputs, type RiskVisitAnswers } from './risk-inputs'

/** Today's every-visit answers PREVENT can read: HTN DP-08's 目前吸菸. */
export type PreventVisitAnswers = RiskVisitAnswers

/**
 * PREVENT read off the shared risk inputs (`buildRiskInputs`: record, ICD
 * codes, the host's rules, today's answers, the clinician's own entries).
 * `fields` are PREVENT's own inputs in the shared field's shape; `shared` is
 * the whole set, which the PCE and HPA readings and the 共用輸入 panel use.
 */
export function buildPreventReading(profile: CdssPatientProfile, autofill: Autofill, inputs: CalcValues, vitals?: ClinicVitals, visit: PreventVisitAnswers = {}) {
  const shared = buildRiskInputs(profile, autofill, inputs, vitals, visit)
  const fields: RiskField[] = PREVENT_INPUTS.map((input) => shared.fields.find((field) => field.input.key === input.key)!)
  const values: CalcValues = Object.fromEntries(fields.map((field) => [field.input.key, field.value]))
  return { values, fields, result: calculatePrevent(values), shared: shared as RiskInputs }
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
