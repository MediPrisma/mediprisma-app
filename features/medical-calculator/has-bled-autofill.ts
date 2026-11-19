import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { diagnosisSelect, type ClinicalSelectValue } from './hfpef-clinical-autofill'
import { convertToBase } from './units'
import type { AutofillSource } from './types'
import type { AutofillValue } from './hooks/use-lab-autofill.hook'

/** HAS-BLED's H and A answers the record can give; the rest stays presumed 「無」. */
export type HasBledKey = 'sbpOver160' | 'hasBledRenal'

const day = (date: string) => date.slice(0, 10)

/**
 * H: the latest systolic pressure >160 mmHg. A: dialysis, a kidney transplant
 * (Z94.0) or the latest serum creatinine >2.26 mg/dL. Each answer names the
 * reading it rests on; without one, the presumed 「無」 applies.
 */
export function hasBledSelects(input: {
  resolve: (source: AutofillSource) => AutofillValue | undefined
  dialysis?: ClinicalSelectValue
  conditions: ConditionEntity[]
  encounters: EncounterEntity[]
  now: Date
}): Partial<Record<HasBledKey, ClinicalSelectValue>> {
  const { resolve, dialysis, conditions, encounters, now } = input
  const out: Partial<Record<HasBledKey, ClinicalSelectValue>> = {}

  const sbp = resolve({ kind: 'vital', loinc: ['8480-6'], vital: 'sbp' })
  // Compared in mmHg (a kPa reading converted, no unit read as mmHg); an unreadable unit is left to the clinician.
  const mmHg = sbp ? (sbp.unit.trim() ? convertToBase(sbp.value, sbp.unit, 'pressure')?.value : sbp.value) : undefined
  if (sbp) out.sbpOver160 = mmHg === undefined
    ? { value: 'unknown', date: day(sbp.date), testName: `最近收縮壓 ${sbp.value} ${sbp.unit}（單位無法判讀，請核對）` }
    : { value: mmHg > 160 ? 'yes' : 'no', date: day(sbp.date), testName: `最近收縮壓 ${Math.round(mmHg)} mmHg（請核對未控制高血壓）`, obsId: sbp.obsId, resourceType: 'Observation' }

  const transplant = diagnosisSelect(conditions, encounters, now, (code) => /^Z940/.test(code), '腎臟移植', undefined, true)
  const creatinine = resolve({ kind: 'lab', keys: ['CREA', 'CREATININE'] })
  const mgdl = creatinine ? convertToBase(creatinine.value, creatinine.unit, 'creatinine')?.value : undefined
  if (dialysis?.value === 'yes') out.hasBledRenal = dialysis
  else if (transplant) out.hasBledRenal = transplant
  else if (creatinine && mgdl !== undefined) {
    out.hasBledRenal = { value: mgdl > 2.26 ? 'yes' : 'no', date: day(creatinine.date), testName: `最近肌酸酐 ${Math.round(mgdl * 100) / 100} mg/dL${mgdl > 2.26 ? ' >2.26' : ''}，未見透析或腎移植（請核對）`, obsId: creatinine.obsId, facility: creatinine.facility, resourceType: 'Observation' }
  }
  return out
}
