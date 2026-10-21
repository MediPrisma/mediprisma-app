import { currentMedicationRecords, medicationDisplayName } from '@voho0000/personalized-care-fhir'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalSelectValue } from './hfpef-clinical-autofill'

/**
 * What the DOAC dose calculator reads off the current prescriptions: the
 * DOAC regimen and each interacting drug its label rules name. 「Current」 is
 * the CDSS's own reading (`currentMedicationRecords`: supply end plus the
 * 30-day grace), so the calculator and the AF dose point see the same list.
 * Ingredient names only, systemic forms only.
 */
export type DoacSelectKey =
  | 'doacRegimen'
  | 'ddi_ketoconazole' | 'ddi_itraconazole' | 'ddi_vori_posaconazole' | 'ddi_hiv_pi' | 'ddi_ciclosporin' | 'ddi_tacrolimus'
  | 'ddi_dronedarone' | 'ddi_verapamil' | 'ddi_amiodarone' | 'ddi_quinidine' | 'ddi_erythromycin' | 'ddi_clarithromycin' | 'ddi_glecaprevir' | 'ddi_inducer' | 'ddi_anticoagulant'

/**
 * The regimens the calculator's select offers, as `agent:mg:timesPerDay`.
 * The VTE loading doses (apixaban 10 mg bid, rivaroxaban 15 mg bid) and the
 * once-daily dabigatran of hip/knee prophylaxis are among them.
 */
export const DOAC_REGIMEN_OPTIONS = [
  'apixaban:10:2', 'apixaban:5:2', 'apixaban:2.5:2',
  'rivaroxaban:20:1', 'rivaroxaban:15:2', 'rivaroxaban:15:1', 'rivaroxaban:10:1',
  'edoxaban:60:1', 'edoxaban:30:1', 'edoxaban:15:1',
  'dabigatran:150:2', 'dabigatran:110:2', 'dabigatran:75:2', 'dabigatran:220:1', 'dabigatran:150:1', 'dabigatran:110:1', 'dabigatran:75:1',
] as const

const DOACS = ['apixaban', 'rivaroxaban', 'edoxaban', 'dabigatran'] as const

const DDI_INGREDIENTS: Record<Exclude<DoacSelectKey, 'doacRegimen'>, readonly string[]> = {
  ddi_ketoconazole: ['ketoconazole'],
  ddi_itraconazole: ['itraconazole'],
  ddi_vori_posaconazole: ['voriconazole', 'posaconazole'],
  ddi_hiv_pi: ['ritonavir', 'lopinavir', 'darunavir', 'atazanavir', 'nirmatrelvir', 'cobicistat'],
  ddi_ciclosporin: ['ciclosporin', 'cyclosporine', 'cyclosporin'],
  ddi_tacrolimus: ['tacrolimus'],
  ddi_dronedarone: ['dronedarone'],
  ddi_verapamil: ['verapamil'],
  ddi_amiodarone: ['amiodarone'],
  ddi_quinidine: ['quinidine'],
  ddi_erythromycin: ['erythromycin'],
  ddi_clarithromycin: ['clarithromycin'],
  ddi_glecaprevir: ['glecaprevir'],
  ddi_inducer: ['rifampicin', 'rifampin', 'phenytoin', 'carbamazepine', 'phenobarbital', 'hypericum'],
  ddi_anticoagulant: ['warfarin', 'enoxaparin', 'dalteparin', 'tinzaparin', 'nadroparin', 'fondaparinux', 'heparin'],
}

// Skin, eye, ear and other local preparations do not establish a systemic
// interaction. 「gel」 as a word only: a hard gelatin capsule is oral.
const LOCAL = /cream|ointment|\bgel\b|shampoo|topical|ophthalmic|eye\s*drop|otic|乳膏|軟膏|凝膠|洗髮|外用|眼藥|耳滴/i

function names(med: MedicationEntity): string {
  return [med.drugTerminology?.ingredientText, med.drugTerminology?.officialNameEn, medicationDisplayName(med)].filter(Boolean).join(' ')
}

/**
 * The record's own wording — product name, codings, dose form and route — for
 * the form and route checks. The display name puts the ingredient first, so
 * 「ketoconazole cream」 would read as plain ketoconazole there.
 */
function formText(med: MedicationEntity): string {
  return [
    med.medicationCodeableConcept?.text,
    ...(med.medicationCodeableConcept?.coding ?? []).map((coding) => coding.display),
    med.drugTerminology?.officialNameEn,
    med.drugTerminology?.doseForm,
    ...(med.dosageInstruction ?? []).flatMap((dosage) => [dosage.route?.text, dosage.text]),
    medicationDisplayName(med),
  ].filter(Boolean).join(' ')
}

function source(med: MedicationEntity, testName: string): ClinicalSelectValue {
  return {
    value: '',
    date: med.authoredOn?.slice(0, 10) ?? '',
    testName,
    obsId: med.id,
    resourceType: med._sourceResourceType ?? 'MedicationRequest',
    facility: med.requester?.display ?? med.informationSource?.display,
  }
}

/** mg per administration and administrations per day, only where the record states both plainly. */
function regimenOf(med: MedicationEntity): { mg: number; perDay: number } | undefined {
  const dosage = med.dosageInstruction?.length === 1 ? med.dosageInstruction[0] : undefined
  const quantity = dosage?.doseAndRate?.length === 1 ? dosage.doseAndRate[0]?.doseQuantity : undefined
  const mg = quantity?.unit?.toLowerCase() === 'mg' && Number.isFinite(quantity.value) && quantity.value! > 0 ? quantity.value! : undefined
  const repeat = dosage?.timing?.repeat
  const days = repeat?.periodUnit === 'd' ? repeat.period : repeat?.periodUnit === 'h' && repeat.period ? repeat.period / 24 : undefined
  const perDay = days && days > 0 && repeat?.frequency && repeat.frequency > 0 ? repeat.frequency / days : undefined
  return mg !== undefined && perDay !== undefined ? { mg, perDay } : undefined
}

/**
 * The DOAC regimen and the interacting drugs. A regimen only when one DOAC is
 * current at one plain dose the select offers; anything else (two DOACs, a
 * dose in tablets, an unusual dose) is left for the clinician to choose. A
 * drug is 「是」 when a current prescription names it and 「否」 when the
 * record lists current prescriptions and none does; with no current
 * prescriptions nothing is said.
 */
export function doacSelects(medications: MedicationEntity[], now: Date): Partial<Record<DoacSelectKey, ClinicalSelectValue>> {
  const taken = new Set(currentMedicationRecords(medications, now))
  const current = medications.filter((med) => taken.has(med) && !LOCAL.test(formText(med)))
  if (!current.length) return {}
  const out: Partial<Record<DoacSelectKey, ClinicalSelectValue>> = {}
  const doacs = current.flatMap((med) => {
    const agent = DOACS.find((name) => new RegExp(`\\b${name}\\b`, 'i').test(names(med)))
    return agent ? [{ med, agent }] : []
  })
  const agents = new Set(doacs.map((item) => item.agent))
  if (agents.size === 1) {
    const regimens = doacs.map((item) => regimenOf(item.med))
    const first = regimens[0]
    const same = first && regimens.every((r) => r && r.mg === first.mg && r.perDay === first.perDay)
    const value = same ? `${doacs[0]!.agent}:${first.mg}:${first.perDay}` : undefined
    if (value && (DOAC_REGIMEN_OPTIONS as readonly string[]).includes(value)) {
      out.doacRegimen = { ...source(doacs[0]!.med, `目前處方：${medicationDisplayName(doacs[0]!.med)}（依處方推算，請核對實際服用）`), value }
    }
  } else if (agents.size === 0) {
    out.doacRegimen = { ...source(current[0]!, '目前有效處方未見 DOAC（依處方推算）'), value: 'none' }
  }
  for (const [key, ingredients] of Object.entries(DDI_INGREDIENTS) as Array<[Exclude<DoacSelectKey, 'doacRegimen'>, readonly string[]]>) {
    // Heparin flushes and catheter locks are not anticoagulation.
    const match = current.find((med) => ingredients.some((name) => new RegExp(`\\b${name}\\b`, 'i').test(names(med)))
      && !(key === 'ddi_anticoagulant' && /flush|lock|沖洗|封管/i.test(formText(med))))
    out[key] = match
      ? { ...source(match, `目前處方：${medicationDisplayName(match)}（依處方推算，請核對實際服用）`), value: 'yes' }
      : { value: 'no', date: now.toISOString().slice(0, 10), testName: '目前有效處方未見（依處方推算，請核對）' }
  }
  // A DOAC beside another DOAC is also another anticoagulant.
  if (agents.size > 1 && out.ddi_anticoagulant?.value !== 'yes') {
    out.ddi_anticoagulant = { ...source(doacs[0]!.med, `目前處方有 ${[...agents].join('、')} 兩種 DOAC（請核對）`), value: 'yes' }
  }
  return out
}
