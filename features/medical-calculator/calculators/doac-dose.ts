import type { CalcInput, CalculatorDef, L } from '../types'
import { AGE_INPUT, SEX_INPUT, WEIGHT_LOINC } from './_shared'
import { DOAC_REGIMEN_OPTIONS, type DoacSelectKey } from '../doac-clinical-autofill'
import { DOAC_RULES_VERSION, calculateDoacDoses, checkRegimen, crclLabel, regimenDay } from '../doac-dose-model'
import { calculatePeriop, formatLocal } from '../doac-periop-model'

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

/** The renal inputs both calculators read, under the same keys so one patient fills both alike. */
const RENAL_INPUTS: CalcInput[] = [
  AGE_INPUT,
  SEX_INPUT,
  { key: 'weight', type: 'number', label: { en: 'Weight (actual)', zh: '體重（實際）' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
  { key: 'scr', type: 'number', label: { en: 'Creatinine', zh: '肌酸酐' }, unit: 'mg/dL', dimension: 'creatinine', normalRange: { low: 0.6, high: 1.2 }, source: { kind: 'lab', keys: ['CREA'] } },
  { key: 'crcl_manual', type: 'number', label: { en: 'CrCl override (optional)', zh: 'CrCl 手動覆寫（選填）' }, unit: 'mL/min', optional: true },
  { key: 'dialysis', type: 'select', label: { en: 'On dialysis', zh: '透析中' }, options: YES_NO, defaultValue: '' },
]

const REGIMEN_INPUT: CalcInput = {
  key: 'regimen', type: 'select', label: { en: 'Current DOAC', zh: '目前 DOAC 處方' }, defaultValue: '',
  source: { kind: 'hfpefClinical', key: 'doacRegimen' },
  options: [
    { value: 'none', label: { en: 'None', zh: '無' } },
    ...DOAC_REGIMEN_OPTIONS.map((value) => ({ value, label: regimenLabel(value) })),
  ],
}

/**
 * DOAC dose by each agent's label (EU SmPC), for the chosen indication. The id
 * stays `doac-dose-nvaf` because the AF dose point opens it, and NVAF is its
 * default. Its result is a check beside the guideline card, never a change to
 * it. The four agents are shown side by side in `DoacDoseResults`.
 */
export const DOAC_DOSE: CalculatorDef[] = [{
  id: 'doac-dose-nvaf',
  version: DOAC_RULES_VERSION,
  // No closing 「（…）」: the visit page's list reads one as the name's acronym.
  name: { en: 'DOAC dose calculator · NVAF / VTE by label', zh: 'DOAC 劑量計算機 · NVAF／VTE 依仿單' },
  category: 'cardiac',
  blurb: { en: 'Apixaban, rivaroxaban, edoxaban and dabigatran by their labels, for NVAF, VTE treatment and hip/knee prophylaxis.', zh: '依各藥仿單比對四種 DOAC 劑量：NVAF、VTE 治療與延長治療、髖膝置換後預防。' },
  inputs: [
    {
      key: 'indication', type: 'select', label: { en: 'Indication', zh: '適應症' }, defaultValue: 'nvaf',
      options: [
        { value: 'nvaf', label: { en: 'Non-valvular AF', zh: '非瓣膜性心房顫動（NVAF）' } },
        { value: 'vte-acute', label: { en: 'Acute DVT/PE treatment', zh: '急性 DVT／PE 治療' } },
        { value: 'vte-extended', label: { en: 'Extended prevention of recurrent VTE (after ≥6 months)', zh: 'VTE 延長治療（完成 ≥6 個月後）' } },
        { value: 'vtep-hip', label: { en: 'Prophylaxis after hip replacement', zh: '髖關節置換術後預防' } },
        { value: 'vtep-knee', label: { en: 'Prophylaxis after knee replacement', zh: '膝關節置換術後預防' } },
      ],
    },
    {
      key: 'parenteral_lead_in', type: 'select', label: { en: 'Parenteral anticoagulation (acute VTE)', zh: '注射抗凝（急性 VTE）' }, defaultValue: '', optional: true,
      options: [
        { value: 'done', label: { en: '≥5 days completed', zh: '已完成 ≥5 天' } },
        { value: 'ongoing', label: { en: 'Under way, <5 days', zh: '進行中，未滿 5 天' } },
        { value: 'none', label: { en: 'None given', zh: '未使用' } },
      ],
    },
    {
      key: 'anticoagulant_switch', type: 'select', label: { en: 'The other anticoagulant is only the acute-VTE parenteral agent, stopped as the oral one starts', zh: '其他抗凝血劑只有急性 VTE 的注射劑，開始口服時停用' }, defaultValue: '', optional: true,
      options: [{ value: 'no', label: { en: 'No (warfarin, another DOAC, or kept on)', zh: '否（warfarin、另一種 DOAC，或會繼續用）' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
    },
    { key: 'pe_unstable', type: 'select', label: { en: 'Haemodynamically unstable PE, or thrombolysis/embolectomy possible (acute VTE)', zh: '血行動力學不穩定 PE，或可能溶栓／取栓（急性 VTE）' }, options: YES_NO, defaultValue: '', optional: true },
    { key: 'vte_day', type: 'number', label: { en: 'Day of oral treatment (acute VTE, optional)', zh: '口服治療第幾天（急性 VTE，選填）' }, unit: 'day', optional: true },
    { key: 'postop_day', type: 'number', label: { en: 'Day after surgery, 0 = day of surgery (hip/knee, optional)', zh: '術後第幾天，手術當天為 0（髖膝預防，選填）' }, unit: 'day', optional: true },
    ...RENAL_INPUTS,
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
    REGIMEN_INPUT,
    ddi('ddi_ketoconazole', { en: 'Ketoconazole (systemic)', zh: 'Ketoconazole（全身性）' }),
    ddi('ddi_itraconazole', { en: 'Itraconazole', zh: 'Itraconazole' }),
    ddi('ddi_vori_posaconazole', { en: 'Voriconazole / posaconazole', zh: 'Voriconazole／posaconazole' }),
    ddi('ddi_hiv_pi', { en: 'HIV protease inhibitor (ritonavir…)', zh: 'HIV protease inhibitor（ritonavir 等）' }),
    ddi('ddi_ciclosporin', { en: 'Ciclosporin', zh: 'Ciclosporin' }),
    ddi('ddi_tacrolimus', { en: 'Tacrolimus', zh: 'Tacrolimus' }),
    ddi('ddi_dronedarone', { en: 'Dronedarone', zh: 'Dronedarone' }),
    ddi('ddi_verapamil', { en: 'Verapamil', zh: 'Verapamil' }),
    { ...ddi('ddi_amiodarone', { en: 'Amiodarone (dabigatran hip/knee prophylaxis)', zh: 'Amiodarone（dabigatran 髖膝預防用）' }), optional: true } as CalcInput,
    { ...ddi('ddi_quinidine', { en: 'Quinidine (dabigatran hip/knee prophylaxis)', zh: 'Quinidine（dabigatran 髖膝預防用）' }), optional: true } as CalcInput,
    ddi('ddi_erythromycin', { en: 'Erythromycin', zh: 'Erythromycin' }),
    ddi('ddi_clarithromycin', { en: 'Clarithromycin', zh: 'Clarithromycin' }),
    ddi('ddi_glecaprevir', { en: 'Glecaprevir/pibrentasvir', zh: 'Glecaprevir/pibrentasvir' }),
    ddi('ddi_inducer', { en: 'Strong inducer (rifampicin, phenytoin, carbamazepine, phenobarbital, St John’s wort)', zh: '強效誘導劑（rifampicin、phenytoin、carbamazepine、phenobarbital、St John’s wort）' }),
    ddi('ddi_anticoagulant', { en: 'Another anticoagulant (warfarin, heparin, another DOAC)', zh: '其他抗凝血劑（warfarin、heparin、另一種 DOAC）' }),
  ],
  inputGroups: [
    { key: 'indication', title: { zh: '適應症', en: 'Indication' }, hint: { zh: 'VTE 與髖膝預防各有劑量規則，不套用 NVAF 的減量條件。注射抗凝、注射劑轉換、不穩定 PE、口服第幾天只在急性 VTE 判讀；術後第幾天只在髖膝預防判讀。', en: 'VTE and hip/knee prophylaxis have their own dose rules, not NVAF’s reductions. Parenteral anticoagulation, the parenteral switch, unstable PE and the day of oral treatment are read for acute VTE only; the day after surgery for hip/knee prophylaxis only.' }, keys: ['indication', 'parenteral_lead_in', 'anticoagulant_switch', 'pe_unstable', 'vte_day', 'postop_day'] },
    { key: 'renal', title: { zh: '腎功能（Cockcroft–Gault，實際體重）', en: 'Renal function (Cockcroft–Gault, actual weight)' }, keys: ['age', 'sex', 'weight', 'scr', 'crcl_manual', 'dialysis'] },
    { key: 'patient', title: { zh: '肝功能與其他', en: 'Liver and other' }, hint: { zh: 'Child-Pugh 可用 Child-Pugh 計算機；未填視為未知，不當作「無」。', en: 'Use the Child-Pugh calculator if needed; a blank is unknown, not 「no」.' }, keys: ['liver', 'liver_enzymes', 'bilirubin_high', 'pregnancy', 'gi_risk'] },
    { key: 'regimen', title: { zh: '目前處方', en: 'Current prescription' }, keys: ['regimen'] },
    { key: 'ddi', title: { zh: '併用藥', en: 'Co-medications' }, hint: { zh: '依目前有效處方帶入，請核對實際服用與給藥途徑（僅全身性用藥）。', en: 'Filled from current prescriptions; check what is actually taken and the route (systemic only).' }, keys: ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant'] },
  ],
  // The headline the list and a note carry: the prescription against its
  // label, or the CrCl the four doses were read at. The four agents
  // themselves are `DoacDoseResults`.
  compute: (values) => {
    const { crcl, results } = calculateDoacDoses(values)
    if (!crcl) return null
    const check = checkRegimen(values.regimen, results, regimenDay(values))
    const crclText = `CrCl ${crclLabel(crcl.value)}${crcl.source === 'manual' ? '（手動）' : ''}`
    return {
      value: crclLabel(crcl.value),
      unit: 'mL/min',
      numericValue: crcl.value,
      severity: check?.state === 'matches' ? 'normal' : check ? 'moderate' : undefined,
      interpretation: check?.text ?? { zh: `${crclText}：四藥劑量見下表`, en: `${crclText}: four agents below` },
    }
  },
  reference: 'EU SmPC (EMA product information) of Eliquis, Xarelto, Lixiana and Pradaxa — NVAF, DVT/PE and hip/knee prophylaxis posology, sections 4.1–4.6. Taiwan labels pending pharmacy review; see the notes under the result.',
}, {
  id: 'doac-periop',
  version: DOAC_RULES_VERSION,
  name: { en: 'DOAC peri-procedural interruption', zh: 'DOAC 手術前後停藥計算機' },
  category: 'cardiac',
  blurb: { en: 'Last dose before a procedure and restart after it, by EHRA 2021, ASRA 2018 and each label.', zh: '依 EHRA 2021、ASRA 2018 與仿單，算術前最後一劑、跳過劑數與術後恢復時間。' },
  inputs: [
    REGIMEN_INPUT,
    { key: 'dose_time_1', type: 'time', label: { en: 'Actual dose time (first, or the only one)', zh: '實際服藥時刻（第一劑或 qd 那一劑）' } },
    { key: 'dose_time_2', type: 'time', label: { en: 'Actual dose time (second, bid)', zh: '實際服藥時刻（bid 的第二劑）' } },
    ...RENAL_INPUTS,
    {
      key: 'procedure_kind', type: 'select', label: { en: 'Procedure', zh: '處置' }, defaultValue: '',
      options: [
        { value: 'af-ablation', label: { en: 'AF catheter ablation', zh: 'AF 導管消融' } },
        { value: 'minimal', label: { en: 'Minor bleeding risk', zh: '極低出血風險' } },
        { value: 'low', label: { en: 'Low bleeding risk', zh: '低出血風險' } },
        { value: 'high', label: { en: 'High bleeding risk', zh: '高出血風險' } },
        { value: 'emergency', label: { en: 'Emergency or urgent (cannot be planned)', zh: '緊急／急迫（無法計畫）' } },
      ],
    },
    {
      key: 'neuraxial', type: 'select', label: { en: 'Spinal/epidural anaesthesia or lumbar puncture', zh: '脊髓／硬膜外麻醉或腰椎穿刺' }, defaultValue: '',
      options: [
        { value: 'none', label: { en: 'None', zh: '無' } },
        { value: 'single', label: { en: 'Single shot, no catheter', zh: '單次，無留置導管' } },
        { value: 'catheter', label: { en: 'Indwelling epidural catheter', zh: '留置硬膜外導管' } },
      ],
    },
    { key: 'surgery_at', type: 'datetime', label: { en: 'Start: anaesthesia or procedure (the neuraxial puncture, if any)', zh: '開始時刻：麻醉或處置（有脊髓／硬膜外時為穿刺時刻）' } },
    { key: 'surgery_end_at', type: 'datetime', label: { en: 'End of the procedure (restart is counted from it)', zh: '手術結束時刻（術後恢復由此起算）' } },
    { key: 'renal_reliable', type: 'select', label: { en: 'Renal function reliably determined (dabigatran, neuraxial)', zh: '腎功能已可靠評估（dabigatran、神經軸用）' }, options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }], defaultValue: '' },
    { key: 'hypertension', type: 'select', label: { en: 'Hypertension (dabigatran, neuraxial)', zh: '高血壓（dabigatran、神經軸用）' }, options: YES_NO, defaultValue: '' },
    { key: 'antiplatelet', type: 'select', label: { en: 'Antiplatelet drug (dabigatran, neuraxial)', zh: '抗血小板藥（dabigatran、神經軸用）' }, options: YES_NO, defaultValue: '' },
    { key: 'haemostasis', type: 'select', label: { en: 'Haemostasis after the procedure', zh: '術後止血' }, options: [{ value: 'no', label: { en: 'Not yet established', zh: '尚未止血' } }, { value: 'yes', label: { en: 'Confirmed', zh: '已確認' } }], defaultValue: '' },
    { key: 'catheter_removed_at', type: 'datetime', label: { en: 'Neuraxial catheter removed at', zh: '神經軸導管拔除時刻' } },
    { key: 'traumatic_puncture', type: 'select', label: { en: 'Traumatic (bloody) puncture', zh: '穿刺出血' }, options: YES_NO, defaultValue: '' },
  ],
  inputGroups: [
    { key: 'regimen', title: { zh: '目前處方與服藥時刻', en: 'Prescription and dose times' }, hint: { zh: '跳過幾劑要用病人實際服藥的時刻，不用處方預設時間。', en: 'Skipped doses need the times the patient actually takes them.' }, keys: ['regimen', 'dose_time_1', 'dose_time_2'] },
    { key: 'renal', title: { zh: '腎功能（Cockcroft–Gault，實際體重）', en: 'Renal function (Cockcroft–Gault, actual weight)' }, keys: ['age', 'sex', 'weight', 'scr', 'crcl_manual', 'dialysis'] },
    { key: 'procedure', title: { zh: '處置', en: 'Procedure' }, hint: { zh: '分級依 EHRA 2021 Table 12。極低：拔牙 ≤3 顆、白內障／青光眼、內視鏡不切片、表淺手術、心律調節器／ICD、電生理檢查。低：複雜牙科、內視鏡簡單切片、小型骨科手術。高：心臟、周邊血管、神經、腹部、胸腔、大型泌尿或骨科手術、肝腎切片、複雜內視鏡、體外震波碎石。有脊髓／硬膜外麻醉時一律另依 ASRA 2018，不論分級。未填視為未知。', en: 'Tiers follow EHRA 2021 Table 12. Minor: ≤3 teeth extracted, cataract/glaucoma, endoscopy without biopsy, superficial surgery, pacemaker/ICD, EP study. Low: complex dental, endoscopy with simple biopsy, small orthopaedic surgery. High: cardiac, vascular, neuro, abdominal, thoracic, major urologic or orthopaedic surgery, liver/kidney biopsy, complex endoscopy, ESWL. Spinal/epidural anaesthesia always adds ASRA 2018 whatever the tier. A blank is unknown.' }, keys: ['procedure_kind', 'neuraxial', 'surgery_at', 'renal_reliable', 'hypertension', 'antiplatelet'] },
    { key: 'after', title: { zh: '術後', en: 'After the procedure' }, hint: { zh: '術前停藥算到開始時刻，術後恢復從結束時刻起算。', en: 'The interval before runs to the start; the restart is counted from the end.' }, keys: ['surgery_end_at', 'haemostasis', 'catheter_removed_at', 'traumatic_puncture'] },
  ],
  compute: (values) => {
    const plan = calculatePeriop(values)
    if (!plan.agent) return null
    const lastBy = plan.lastDoseBy ? formatLocal(plan.lastDoseBy) : undefined
    const interpretation: L = plan.state === 'timed' || plan.state === 'ablation'
      ? {
        zh: `${plan.agent}：最後一劑距手術 ≥${plan.holdHours} 小時${lastBy ? `（${lastBy} 以前）` : ''}${plan.resume.earliest ? `；最早 ${formatLocal(plan.resume.earliest)} 恢復，需確認止血` : ''}`,
        en: `${plan.agent}: last dose ≥${plan.holdHours} h before${lastBy ? ` (by ${lastBy})` : ''}${plan.resume.earliest ? `; restart from ${formatLocal(plan.resume.earliest)} once haemostasis is confirmed` : ''}`,
      }
      : plan.state === 'no-hours'
        ? { zh: `${plan.agent}：無可用停藥時數，需個別評估`, en: `${plan.agent}: no interval applies; individual assessment` }
        : plan.state === 'emergency'
          ? { zh: `${plan.agent}：緊急手術，依 EHRA Figure 12`, en: `${plan.agent}: emergency, EHRA Figure 12` }
          : { zh: `${plan.agent}：尚待補資料`, en: `${plan.agent}: inputs needed` }
    return {
      value: plan.holdHours !== undefined ? String(plan.holdHours) : '—',
      unit: plan.holdHours !== undefined ? 'h' : undefined,
      severity: plan.state === 'timed' || plan.state === 'ablation' ? undefined : 'moderate',
      interpretation,
    }
  },
  reference: 'EHRA 2021 Practical Guide on NOACs (Steffel et al., Europace 2021;23:1612–1676), Table 12 and Figures 12, 14–16; ASRA 2018 (Horlocker et al., Reg Anesth Pain Med 2018;43:263–309), recommendations 6–8 and 11; EU SmPC section 4.4 of each agent.',
}]
