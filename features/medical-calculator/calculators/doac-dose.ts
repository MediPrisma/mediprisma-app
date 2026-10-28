import type { CalcInput, CalcValues, CalculatorDef, L } from '../types'
import { AGE_INPUT, SEX_INPUT, WEIGHT_LOINC } from './_shared'
import { DOAC_REGIMEN_OPTIONS, type DoacSelectKey } from '../doac-clinical-autofill'
import { DOAC_FIELD_LABELS, DOAC_RULES_VERSION, calculateDoacDoses, checkRegimen, crclLabel, parseRegimen, regimenDay } from '../doac-dose-model'
import { calculatePeriop, formatLocal, hoursText } from '../doac-periop-model'

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

// Each indication's own questions, shown only for it; a hidden one reads as blank.
const acuteVte = (values: CalcValues) => values.indication === 'vte-acute'
const hipKnee = (values: CalcValues) => values.indication === 'vtep-hip' || values.indication === 'vtep-knee'

/**
 * The co-medications folded to one line: those on the current prescriptions
 * named, the blanks counted, and the group open while any is blank.
 */
const ddiSummary = (values: CalcValues, keys: string[]): { text: L; open: boolean } => {
  const name = (key: string) => DOAC_FIELD_LABELS[key]?.zh ?? key
  const nameEn = (key: string) => DOAC_FIELD_LABELS[key]?.en ?? key
  const yes = keys.filter((key) => values[key] === 'yes')
  const blank = keys.filter((key) => (values[key] ?? '') === '')
  const no = keys.length - yes.length - blank.length
  const zh = [yes.length ? `有 ${yes.map(name).join('、')}` : '', blank.length ? `${blank.length} 項未填` : '', no ? `${yes.length || blank.length ? '其餘 ' : ''}${no} 項無` : ''].filter(Boolean).join('；')
  const en = [yes.length ? `On ${yes.map(nameEn).join(', ')}` : '', blank.length ? `${blank.length} unanswered` : '', no ? `${yes.length || blank.length ? 'the other ' : ''}${no} none` : ''].filter(Boolean).join('; ')
  return { text: { zh, en }, open: blank.length > 0 }
}

const regimenLabel = (value: string): L => {
  const [agent, mg, perDay] = value.split(':')
  const text = `${agent} ${mg} mg ${perDay === '2' ? 'bid' : 'qd'}`
  return { en: text, zh: text }
}

/** The renal inputs both calculators read, under the same keys so one patient fills both alike. */
const RENAL_INPUTS: CalcInput[] = [
  AGE_INPUT,
  SEX_INPUT,
  // Older than a year (owner decision 2026-10-22): the dose turns on the 60 kg and CrCl cut-offs.
  { key: 'weight', type: 'number', label: { en: 'Weight (actual)', zh: '體重（實際）' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' }, staleAfterDays: 365 },
  { key: 'scr', type: 'number', label: { en: 'Creatinine', zh: '肌酸酐' }, unit: 'mg/dL', dimension: 'creatinine', normalRange: { low: 0.6, high: 1.2 }, source: { kind: 'lab', keys: ['CREA'] }, staleAfterDays: 365 },
  { key: 'crcl_manual', type: 'number', label: { en: 'CrCl override (optional)', zh: 'CrCl 手動覆寫（選填）' }, unit: 'mL/min', optional: true },
  { key: 'dialysis', type: 'select', label: { en: 'On dialysis', zh: '透析中' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'doac_dialysis' } },
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
      key: 'parenteral_lead_in', type: 'select', label: { en: 'Parenteral anticoagulation', zh: '注射抗凝' }, defaultValue: '', optional: true, visibleWhen: acuteVte,
      options: [
        { value: 'done', label: { en: '≥5 days completed', zh: '已完成 ≥5 天' } },
        { value: 'ongoing', label: { en: 'Under way, <5 days', zh: '進行中，未滿 5 天' } },
        { value: 'none', label: { en: 'None given', zh: '未使用' } },
      ],
    },
    {
      key: 'anticoagulant_switch', type: 'select', label: { en: 'The other anticoagulant is only the parenteral agent, stopped as the oral one starts', zh: '其他抗凝血劑只有注射劑，開始口服時停用' }, defaultValue: '', optional: true, visibleWhen: acuteVte,
      options: [{ value: 'no', label: { en: 'No (warfarin, another DOAC, or kept on)', zh: '否（warfarin、另一種 DOAC，或會繼續用）' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
    },
    { key: 'pe_unstable', type: 'select', label: { en: 'Haemodynamically unstable PE, or thrombolysis/embolectomy possible', zh: '血行動力學不穩定 PE，或可能溶栓／取栓' }, options: YES_NO, defaultValue: '', optional: true, visibleWhen: acuteVte },
    { key: 'vte_day', type: 'number', label: { en: 'Day of oral treatment (optional)', zh: '口服治療第幾天（選填）' }, unit: 'day', optional: true, visibleWhen: acuteVte },
    { key: 'postop_day', type: 'number', label: { en: 'Day after surgery, 0 = day of surgery (optional)', zh: '術後第幾天，手術當天為 0（選填）' }, unit: 'day', optional: true, visibleWhen: hipKnee },
    ...RENAL_INPUTS,
    {
      key: 'liver', type: 'select', label: { en: 'Liver', zh: '肝功能' }, defaultValue: '',
      source: { kind: 'hfpefClinical', key: 'doac_liver' }, staleAfterDays: 365,
      options: [
        { value: 'none', label: { en: 'No liver disease', zh: '無肝病' } },
        { value: 'A', label: { en: 'Child-Pugh A', zh: 'Child-Pugh A' } },
        { value: 'B', label: { en: 'Child-Pugh B', zh: 'Child-Pugh B' } },
        { value: 'C', label: { en: 'Child-Pugh C', zh: 'Child-Pugh C' } },
        { value: 'coag', label: { en: 'Liver disease with coagulopathy and bleeding risk', zh: '肝病合併凝血異常與出血風險' } },
      ],
    },
    { key: 'liver_enzymes', type: 'select', label: { en: 'ALT/AST >2×ULN', zh: 'ALT/AST >2×ULN' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'doac_liver_enzymes' }, staleAfterDays: 365 },
    { key: 'bilirubin_high', type: 'select', label: { en: 'Total bilirubin ≥1.5×ULN', zh: '總膽紅素 ≥1.5×ULN' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'doac_bilirubin_high' }, staleAfterDays: 365 },
    { key: 'pregnancy', type: 'select', label: { en: 'Pregnant or breast-feeding', zh: '懷孕或哺乳' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'doac_pregnancy' } },
    { key: 'gi_risk', type: 'select', label: { en: 'Gastritis, oesophagitis, GERD or other bleeding risk (dabigatran)', zh: '胃炎／食道炎／GERD 或其他出血風險（dabigatran 用）' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'doac_gi_risk' } },
    REGIMEN_INPUT,
    ddi('ddi_ketoconazole', { en: 'Ketoconazole (systemic)', zh: 'Ketoconazole（全身性）' }),
    ddi('ddi_itraconazole', { en: 'Itraconazole', zh: 'Itraconazole' }),
    ddi('ddi_vori_posaconazole', { en: 'Voriconazole / posaconazole', zh: 'Voriconazole／posaconazole' }),
    ddi('ddi_hiv_pi', { en: 'HIV protease inhibitor (ritonavir…)', zh: 'HIV protease inhibitor（ritonavir 等）' }),
    ddi('ddi_ciclosporin', { en: 'Ciclosporin', zh: 'Ciclosporin' }),
    ddi('ddi_tacrolimus', { en: 'Tacrolimus', zh: 'Tacrolimus' }),
    ddi('ddi_dronedarone', { en: 'Dronedarone', zh: 'Dronedarone' }),
    ddi('ddi_verapamil', { en: 'Verapamil', zh: 'Verapamil' }),
    { ...ddi('ddi_amiodarone', { en: 'Amiodarone', zh: 'Amiodarone' }), optional: true, visibleWhen: hipKnee } as CalcInput,
    { ...ddi('ddi_quinidine', { en: 'Quinidine', zh: 'Quinidine' }), optional: true, visibleWhen: hipKnee } as CalcInput,
    ddi('ddi_erythromycin', { en: 'Erythromycin', zh: 'Erythromycin' }),
    ddi('ddi_clarithromycin', { en: 'Clarithromycin', zh: 'Clarithromycin' }),
    ddi('ddi_glecaprevir', { en: 'Glecaprevir/pibrentasvir', zh: 'Glecaprevir/pibrentasvir' }),
    ddi('ddi_inducer', { en: 'Strong inducer (rifampicin, phenytoin, carbamazepine, phenobarbital, St John’s wort)', zh: '強效誘導劑（rifampicin、phenytoin、carbamazepine、phenobarbital、St John’s wort）' }),
    ddi('ddi_anticoagulant', { en: 'Another anticoagulant (warfarin, heparin, another DOAC)', zh: '其他抗凝血劑（warfarin、heparin、另一種 DOAC）' }),
  ],
  inputGroups: [
    { key: 'indication', title: { zh: '適應症', en: 'Indication' }, keys: ['indication', 'parenteral_lead_in', 'anticoagulant_switch', 'pe_unstable', 'vte_day', 'postop_day'] },
    { key: 'renal', title: { zh: '腎功能（Cockcroft–Gault，實際體重）', en: 'Renal function (Cockcroft–Gault, actual weight)' }, keys: ['age', 'sex', 'weight', 'scr', 'crcl_manual', 'dialysis'] },
    { key: 'patient', title: { zh: '肝功能與其他', en: 'Liver and other' }, keys: ['liver', 'liver_enzymes', 'bilirubin_high', 'pregnancy', 'gi_risk'] },
    { key: 'regimen', title: { zh: '目前處方', en: 'Current prescription' }, keys: ['regimen'] },
    { key: 'ddi', title: { zh: '併用藥', en: 'Co-medications' }, hint: { zh: '依目前有效處方帶入（僅全身性用藥），請核對實際服用。', en: 'Filled from current prescriptions (systemic only); check what is actually taken.' }, summary: ddiSummary, keys: ['ddi_ketoconazole', 'ddi_itraconazole', 'ddi_vori_posaconazole', 'ddi_hiv_pi', 'ddi_ciclosporin', 'ddi_tacrolimus', 'ddi_dronedarone', 'ddi_verapamil', 'ddi_amiodarone', 'ddi_quinidine', 'ddi_erythromycin', 'ddi_clarithromycin', 'ddi_glecaprevir', 'ddi_inducer', 'ddi_anticoagulant'] },
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
}, {
  id: 'doac-periop',
  version: DOAC_RULES_VERSION,
  name: { en: 'DOAC peri-procedural interruption', zh: 'DOAC 手術前後停藥計算機' },
  category: 'cardiac',
  blurb: { en: 'Last dose before a procedure and restart after it, by EHRA 2021, ASRA 2025 and each label.', zh: '依 EHRA 2021、ASRA 2025 與仿單，算術前最後一劑、跳過劑數與術後恢復時間。' },
  inputs: [
    REGIMEN_INPUT,
    {
      key: 'dose_intent', type: 'select', label: { en: 'Apixaban 2.5 mg bid is for', zh: 'apixaban 2.5 mg bid 的用途' }, defaultValue: '', optional: true,
      visibleWhen: (values) => values.regimen === 'apixaban:2.5:2',
      options: [
        { value: 'high', label: { en: 'NVAF (reduced therapeutic dose)', zh: 'NVAF（減量的治療劑量）' } },
        { value: 'low', label: { en: 'Extended VTE prevention or post-op prophylaxis', zh: 'VTE 延長期或術後預防' } },
      ],
    },
    { key: 'dose_time_1', type: 'time', label: { en: 'Time the patient actually takes it (first, or the only one)', zh: '病人實際服藥時刻（第一劑或 qd）' } },
    { key: 'dose_time_2', type: 'time', label: { en: 'Time the patient actually takes it (second)', zh: '病人實際服藥時刻（第二劑）' }, optional: true, visibleWhen: (values) => parseRegimen(values.regimen)?.perDay !== 1 },
    ...RENAL_INPUTS,
    {
      key: 'procedure_kind', type: 'select', label: { en: 'Procedure', zh: '處置' }, defaultValue: '',
      options: [
        { value: 'af-ablation', label: { en: 'AF catheter ablation', zh: 'AF 導管消融' } },
        // EHRA 2021 Table 12's examples, so the tier is picked from them.
        { value: 'minimal', label: { en: 'Minor risk: ≤3 teeth, cataract/glaucoma, endoscopy without biopsy, superficial surgery, pacemaker/ICD, EP study', zh: '極低出血風險：拔牙 ≤3 顆、白內障／青光眼、內視鏡不切片、表淺手術、PM／ICD、電生理檢查' } },
        { value: 'low', label: { en: 'Low risk: complex dental, endoscopy with simple biopsy, small orthopaedic surgery', zh: '低出血風險：複雜牙科、內視鏡簡單切片、小型骨科手術' } },
        { value: 'high', label: { en: 'High risk: cardiac, vascular, neuro, abdominal, thoracic, major urologic/orthopaedic, liver/kidney biopsy, complex endoscopy, ESWL', zh: '高出血風險：心臟、周邊血管、神經、腹部、胸腔、大型泌尿／骨科、肝腎切片、複雜內視鏡、ESWL' } },
        { value: 'emergency', label: { en: 'Emergency or urgent (cannot be planned)', zh: '緊急／急迫（無法計畫）' } },
      ],
    },
    {
      key: 'neuraxial', type: 'select', label: { en: 'Spinal/epidural, lumbar puncture, or deep plexus/peripheral block', zh: '脊髓／硬膜外、腰椎穿刺，或深部神經叢／周邊神經阻斷' }, defaultValue: '',
      options: [
        { value: 'none', label: { en: 'None', zh: '無' } },
        { value: 'single', label: { en: 'Spinal/epidural or LP, single', zh: '脊髓／硬膜外或腰椎穿刺，單次' } },
        { value: 'catheter', label: { en: 'Epidural catheter', zh: '留置硬膜外導管' } },
        { value: 'plexus', label: { en: 'Deep plexus/peripheral block', zh: '深部神經叢／周邊阻斷' } },
        { value: 'plexus-catheter', label: { en: 'Deep plexus/peripheral catheter', zh: '深部神經叢／周邊導管' } },
      ],
    },
    { key: 'surgery_at', type: 'datetime', label: { en: 'Start: anaesthesia or procedure (the neuraxial puncture, if any)', zh: '開始時刻：麻醉或處置（有脊髓／硬膜外時為穿刺時刻）' } },
    { key: 'surgery_end_at', type: 'datetime', label: { en: 'End of the procedure (restart is counted from it)', zh: '手術結束時刻（術後恢復由此起算）' }, optional: true },
    { key: 'haemostasis', type: 'select', label: { en: 'Haemostasis after the procedure', zh: '術後止血' }, options: [{ value: 'no', label: { en: 'Not yet established', zh: '尚未止血' } }, { value: 'yes', label: { en: 'Confirmed', zh: '已確認' } }], defaultValue: '', optional: true },
    { key: 'catheter_removed_at', type: 'datetime', label: { en: 'Catheter removed at', zh: '導管拔除時刻' }, optional: true, visibleWhen: (values) => values.neuraxial === 'catheter' || values.neuraxial === 'plexus-catheter' },
    { key: 'sheath_removed_at', type: 'datetime', label: { en: 'Sheath removed at', zh: '拔 sheath 時刻' }, optional: true, visibleWhen: (values) => values.procedure_kind === 'af-ablation' },
    // An emergency with the block unanswered still reads it (「if the puncture was traumatic」).
    { key: 'traumatic_puncture', type: 'select', label: { en: 'Traumatic (bloody) neuraxial puncture', zh: '脊髓／硬膜外穿刺出血' }, options: YES_NO, defaultValue: '', optional: true, visibleWhen: (values) => values.neuraxial === 'single' || values.neuraxial === 'catheter' || (values.procedure_kind === 'emergency' && (values.neuraxial ?? '') === '') },
  ],
  inputGroups: [
    { key: 'regimen', title: { zh: '目前處方與服藥時刻', en: 'Prescription and dose times' }, keys: ['regimen', 'dose_intent', 'dose_time_1', 'dose_time_2'] },
    { key: 'renal', title: { zh: '腎功能（Cockcroft–Gault，實際體重）', en: 'Renal function (Cockcroft–Gault, actual weight)' }, keys: ['age', 'sex', 'weight', 'scr', 'crcl_manual', 'dialysis'] },
    { key: 'procedure', title: { zh: '處置', en: 'Procedure' }, keys: ['procedure_kind', 'neuraxial', 'surgery_at'] },
    { key: 'after', title: { zh: '術後', en: 'After the procedure' }, keys: ['surgery_end_at', 'haemostasis', 'catheter_removed_at', 'sheath_removed_at', 'traumatic_puncture'] },
  ],
  compute: (values) => {
    const plan = calculatePeriop(values)
    if (!plan.agent) return null
    const lastBy = plan.lastDoseBy ? formatLocal(plan.lastDoseBy) : undefined
    const interpretation: L = plan.troughOnly
      // AF ablation or minor risk: the last scheduled dose is kept, so no 「≥N 小時」 headline that would invite skipping one.
      ? {
        zh: `${plan.agent}：不提前停藥（谷底約 ${plan.holdHours} 小時）${plan.heldBefore ? `；${formatLocal(plan.heldBefore)} 那一劑距開始太近，處置前不服` : ''}${plan.lastDose ? `；${plan.heldBefore ? '處置前最後服用' : '照常服用最後一劑'} ${formatLocal(plan.lastDose)}，距開始 ${hoursText(plan.hoursFromLastDose!)} 小時` : ''}${plan.resume.earliest ? `；最早 ${formatLocal(plan.resume.earliest)} 恢復，需確認止血` : ''}`,
        en: `${plan.agent}: not stopped early (trough about ${plan.holdHours} h)${plan.heldBefore ? `; the ${formatLocal(plan.heldBefore)} dose is too close to the start and not taken before it` : ''}${plan.lastDose ? `; ${plan.heldBefore ? 'last taken' : 'last dose taken as usual'} ${formatLocal(plan.lastDose)}, ${hoursText(plan.hoursFromLastDose!)} h before the start` : ''}${plan.resume.earliest ? `; restart from ${formatLocal(plan.resume.earliest)} once haemostasis is confirmed` : ''}`,
      }
      : plan.state === 'timed' || plan.state === 'ablation'
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
      // A trough to check is not an interval to stop for: no bare 「N h」 for it.
      value: plan.holdHours !== undefined && !plan.troughOnly ? String(plan.holdHours) : '—',
      unit: plan.holdHours !== undefined && !plan.troughOnly ? 'h' : undefined,
      severity: plan.state === 'timed' || plan.state === 'ablation' ? undefined : 'moderate',
      interpretation,
    }
  },
}]
