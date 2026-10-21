import type { CalcInput, CalculatorDef, L } from '../types'
import { AGE_INPUT, SEX_INPUT, WEIGHT_LOINC } from './_shared'
import { DOAC_REGIMEN_OPTIONS, type DoacSelectKey } from '../doac-clinical-autofill'
import { DOAC_RULES_VERSION, calculateDoacDoses, checkRegimen, crclLabel } from '../doac-dose-model'

const YES_NO = [
  { value: 'no', label: { en: 'No', zh: '無' } },
  { value: 'yes', label: { en: 'Yes', zh: '有' } },
]

const ddi = (key: DoacSelectKey, label: L): CalcInput => ({
  key,
  type: 'select',
  label,
  options: YES_NO,
  source: { kind: 'hfpefClinical', key: key as DoacSelectKey },
  defaultValue: '',
})

const regimenLabel = (value: string): L => {
  const [agent, mg, perDay] = value.split(':')
  const text = `${agent} ${mg} mg ${perDay === '2' ? 'bid' : 'qd'}`
  return { en: text, zh: text }
}

/**
 * NVAF DOAC dose by each agent's label (EU SmPC). Opened from the AF dose
 * point; its result is a check beside the guideline card, never a change to
 * it. The four agents are shown side by side in `DoacDoseResults`.
 */
export const DOAC_DOSE: CalculatorDef[] = [{
  id: 'doac-dose-nvaf',
  version: DOAC_RULES_VERSION,
  name: { en: 'DOAC dose calculator · NVAF by label', zh: 'DOAC 劑量計算機 · NVAF 依仿單' },
  category: 'cardiac',
  blurb: { en: 'Apixaban, rivaroxaban, edoxaban and dabigatran by their labels.', zh: '依各藥仿單比對四種 DOAC 劑量、腎肝功能與交互作用。' },
  inputs: [
    AGE_INPUT,
    SEX_INPUT,
    { key: 'weight', type: 'number', label: { en: 'Weight (actual)', zh: '體重（實際）' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
    { key: 'scr', type: 'number', label: { en: 'Creatinine', zh: '肌酸酐' }, unit: 'mg/dL', dimension: 'creatinine', normalRange: { low: 0.6, high: 1.2 }, source: { kind: 'lab', keys: ['CREA'] } },
    { key: 'crcl_manual', type: 'number', label: { en: 'CrCl override (optional)', zh: 'CrCl 手動覆寫（選填）' }, unit: 'mL/min', optional: true },
    { key: 'dialysis', type: 'select', label: { en: 'On dialysis', zh: '透析中' }, options: YES_NO, defaultValue: '' },
    {
      key: 'liver', type: 'select', label: { en: 'Liver', zh: '肝功能' }, defaultValue: '',
      options: [
        { value: 'none', label: { en: 'No liver disease', zh: '無肝病' } },
        { value: 'A', label: { en: 'Child-Pugh A', zh: 'Child-Pugh A' } },
        { value: 'B', label: { en: 'Child-Pugh B', zh: 'Child-Pugh B' } },
        { value: 'C', label: { en: 'Child-Pugh C', zh: 'Child-Pugh C' } },
        { value: 'coag', label: { en: 'Liver disease with coagulopathy and bleeding risk', zh: '肝病合併凝血異常與出血風險' } },
      ],
    },
    { key: 'liver_enzymes', type: 'select', label: { en: 'ALT/AST >2×ULN', zh: 'ALT/AST >2×ULN' }, options: YES_NO, defaultValue: '' },
    { key: 'bilirubin_high', type: 'select', label: { en: 'Total bilirubin ≥1.5×ULN', zh: '總膽紅素 ≥1.5×ULN' }, options: YES_NO, defaultValue: '' },
    { key: 'pregnancy', type: 'select', label: { en: 'Pregnant or breast-feeding', zh: '懷孕或哺乳' }, options: YES_NO, defaultValue: '' },
    { key: 'gi_risk', type: 'select', label: { en: 'Gastritis, oesophagitis, GERD or other bleeding risk (dabigatran)', zh: '胃炎／食道炎／GERD 或其他出血風險（dabigatran 用）' }, options: YES_NO, defaultValue: '' },
    {
      key: 'regimen', type: 'select', label: { en: 'Current DOAC', zh: '目前 DOAC 處方' }, defaultValue: '',
      source: { kind: 'hfpefClinical', key: 'doacRegimen' },
      options: [
        { value: 'none', label: { en: 'None', zh: '無' } },
        ...DOAC_REGIMEN_OPTIONS.map((value) => ({ value, label: regimenLabel(value) })),
      ],
    },
    ddi('ddi_ketoconazole', { en: 'Ketoconazole (systemic)', zh: 'Ketoconazole（全身性）' }),
    ddi('ddi_itraconazole', { en: 'Itraconazole', zh: 'Itraconazole' }),
    ddi('ddi_vori_posaconazole', { en: 'Voriconazole / posaconazole', zh: 'Voriconazole／posaconazole' }),
    ddi('ddi_hiv_pi', { en: 'HIV protease inhibitor (ritonavir…)', zh: 'HIV protease inhibitor（ritonavir 等）' }),
    ddi('ddi_ciclosporin', { en: 'Ciclosporin', zh: 'Ciclosporin' }),
    ddi('ddi_tacrolimus', { en: 'Tacrolimus', zh: 'Tacrolimus' }),
    ddi('ddi_dronedarone', { en: 'Dronedarone', zh: 'Dronedarone' }),
    ddi('ddi_verapamil', { en: 'Verapamil', zh: 'Verapamil' }),
    ddi('ddi_erythromycin', { en: 'Erythromycin', zh: 'Erythromycin' }),
    ddi('ddi_clarithromycin', { en: 'Clarithromycin', zh: 'Clarithromycin' }),
    ddi('ddi_glecaprevir', { en: 'Glecaprevir/pibrentasvir', zh: 'Glecaprevir/pibrentasvir' }),
    ddi('ddi_inducer', { en: 'Strong inducer (rifampicin, phenytoin, carbamazepine, phenobarbital, St John’s wort)', zh: '強效誘導劑（rifampicin、phenytoin、carbamazepine、phenobarbital、St John’s wort）' }),
    ddi('ddi_anticoagulant', { en: 'Another anticoagulant (warfarin, heparin, another DOAC)', zh: '其他抗凝血劑（warfarin、heparin、另一種 DOAC）' }),
  ],
  inputGroups: [
    { key: 'renal', title: { zh: '腎功能（Cockcroft–Gault，實際體重）', en: 'Renal function (Cockcroft–Gault, actual weight)' }, keys: ['age', 'sex', 'weight', 'scr', 'crcl_manual', 'dialysis'] },
    { key: 'patient', title: { zh: '肝功能與其他', en: 'Liver and other' }, hint: { zh: 'Child-Pugh 可用 Child-Pugh 計算機；未填視為未知，不當作「無」。', en: 'Use the Child-Pugh calculator if needed; a blank is unknown, not 「no」.' }, keys: ['liver', 'liver_enzymes', 'bilirubin_high', 'pregnancy', 'gi_risk'] },
    { key: 'regimen', title: { zh: '目前處方', en: 'Current prescription' }, keys: ['regimen'] },
    { key: 'ddi', title: { zh: '併用藥', en: 'Co-medications' }, hint: { zh: '依目前有效處方帶入，請核對實際服用與給藥途徑（僅全身性用藥）。', en: 'Filled from current prescriptions; check what is actually taken and the route (systemic only).' }, keys: ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant'] },
  ],
  // The headline the list and a note carry: the prescription against its
  // label, or the CrCl the four doses were read at. The four agents
  // themselves are `DoacDoseResults`.
  compute: (values) => {
    const { crcl, results } = calculateDoacDoses(values)
    if (!crcl) return null
    const check = checkRegimen(values.regimen, results)
    const crclText = `CrCl ${crclLabel(crcl.value)}${crcl.source === 'manual' ? '（手動）' : ''}`
    return {
      value: crclLabel(crcl.value),
      unit: 'mL/min',
      numericValue: crcl.value,
      severity: check?.state === 'matches' ? 'normal' : check ? 'moderate' : undefined,
      interpretation: check?.text ?? { zh: `${crclText}：四藥劑量見下表`, en: `${crclText}: four agents below` },
    }
  },
  reference: 'EU SmPC (EMA product information) of Eliquis, Xarelto, Lixiana and Pradaxa — NVAF posology, sections 4.2–4.6. Taiwan labels pending pharmacy review; see the notes under the result.',
}]
