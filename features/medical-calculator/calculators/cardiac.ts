import { HAS_BLED } from './af-followup'
import { AF_STROKE } from './af-stroke'
import type { CalculatorDef, L } from '../types'
import { n, round, SEX_INPUT, AGE_INPUT, scoredQuestionnaire, ynItem } from './_shared'

// ── WHO 2019 laboratory-based CVD risk model ────────────────────────────────
// Two sex-specific Cox sub-models (MI/CHD + stroke), each 1 − S0^exp(L), then
// combined assuming independence: p = 1 − (1−p_mi)(1−p_stroke). Coefficients
// (β = log HR) and centering transcribed from the WHO 2019 supplementary
// appendix Table 1.6 (Kaptoge S, et al. Lancet Glob Health 2019;7:e1332),
// verified against the paper's published hazard ratios. S0 is the pooled
// (un-recalibrated) core-model baseline survival — WHO publishes no closed-form
// East-Asia regional S0, so this is the core model, NOT Taiwan-recalibrated and
// NOT the official NHI 健保 algorithm. Units: age yr, chol mmol/L, sbp mmHg.
const WHO_CENTRE = { age: 60, chol: 6, sbp: 120 }
const WHO_BETA = {
  male: {
    mi: { age: 0.0719227, chol: 0.2284944, sbp: 0.0132183, dm: 0.6410114, smk: 0.5638109, cholAge: -0.0045806, sbpAge: -0.0001576, dmAge: -0.0124966, smkAge: -0.0182545 },
    stroke: { age: 0.0986578, chol: 0.0295260, sbp: 0.0222629, dm: 0.6268712, smk: 0.4981217, cholAge: 0.0014200, sbpAge: -0.0004147, dmAge: -0.0263020, smkAge: -0.0150561 },
  },
  female: {
    mi: { age: 0.1020713, chol: 0.2050377, sbp: 0.0158230, dm: 1.0703580, smk: 1.0532230, cholAge: -0.0051932, sbpAge: -0.0001378, dmAge: -0.0234174, smkAge: -0.0332666 },
    stroke: { age: 0.1056632, chol: 0.0257782, sbp: 0.0206278, dm: 0.8581998, smk: 0.7443627, cholAge: -0.0021387, sbpAge: -0.0004897, dmAge: -0.0209826, smkAge: -0.0200822 },
  },
} as const
const WHO_S0 = {
  male: { mi: 0.9540, stroke: 0.9849 },
  female: { mi: 0.9890, stroke: 0.9890 },
} as const
interface WhoBeta { age: number; chol: number; sbp: number; dm: number; smk: number; cholAge: number; sbpAge: number; dmAge: number; smkAge: number }
function whoLinPred(b: WhoBeta, age: number, chol: number, sbp: number, dm: number, smk: number): number {
  const a = age - WHO_CENTRE.age, c = chol - WHO_CENTRE.chol, s = sbp - WHO_CENTRE.sbp
  return b.age * a + b.chol * c + b.sbp * s + b.dm * dm + b.smk * smk
    + b.cholAge * a * c + b.sbpAge * a * s + b.dmAge * a * dm + b.smkAge * a * smk
}
/** WHO 2019 lab-based 10-year total-CVD probability. chol in mmol/L. */
function who2019Cvd(sex: 'male' | 'female', age: number, chol: number, sbp: number, dm: number, smk: number): number {
  const b = WHO_BETA[sex], s0 = WHO_S0[sex]
  const pMi = 1 - Math.pow(s0.mi, Math.exp(whoLinPred(b.mi, age, chol, sbp, dm, smk)))
  const pStroke = 1 - Math.pow(s0.stroke, Math.exp(whoLinPred(b.stroke, age, chol, sbp, dm, smk)))
  return 1 - (1 - pMi) * (1 - pStroke)
}

export const CARDIAC: CalculatorDef[] = [
  ...AF_STROKE,

  // ── Mean arterial pressure ──────────────────────────────────────────────
    {
      id: 'map',
      name: { en: 'Mean Arterial Pressure (MAP)', zh: '平均動脈壓 (MAP)' },
      category: 'cardiac',
      blurb: { en: '(SBP + 2×DBP) / 3.', zh: '(收縮壓 + 2×舒張壓) / 3。' },
      inputs: [
        { key: 'sbp', type: 'number', label: { en: 'Systolic BP', zh: '收縮壓' }, unit: 'mmHg', normalRange: { low: 90, high: 120 }, source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' } },
        { key: 'dbp', type: 'number', label: { en: 'Diastolic BP', zh: '舒張壓' }, unit: 'mmHg', normalRange: { low: 60, high: 80 }, source: { kind: 'vital', loinc: ['8462-4'] } },
      ],
      compute: (v) => {
        const sbp = n(v, 'sbp'); const dbp = n(v, 'dbp')
        if (sbp === undefined || dbp === undefined) return null
        const map = (sbp + 2 * dbp) / 3
        const val = round(map)
        let severity: 'normal' | 'moderate' | 'high' = 'normal'
        let interp: L
        if (val < 65) { severity = 'high'; interp = { en: '< 65 — organ perfusion at risk', zh: '< 65 — 器官灌流不足風險' } }
        else if (val > 100) { severity = 'moderate'; interp = { en: '> 100 — elevated', zh: '> 100 — 偏高' } }
        else interp = { en: '65–100 — adequate perfusion', zh: '65–100 — 灌流足夠' }
        return { value: String(val), unit: 'mmHg', interpretation: interp, severity }
      },
      reference: 'MAP = (SBP + 2 × DBP) / 3. Target ≥ 65 mmHg for organ perfusion.',
    },

  // ── HAS-BLED (major bleeding risk on anticoagulation) ───────────────────
    HAS_BLED,

  // ── Corrected QT (QTc) ──────────────────────────────────────────────────
    {
      id: 'qtc',
      name: { en: 'Corrected QT (QTc)', zh: '校正 QT (QTc)' },
      category: 'cardiac',
      audience: 'medical',
      blurb: { en: 'Bazett & Fridericia correction.', zh: 'Bazett 與 Fridericia 校正。' },
      inputs: [
        { key: 'qt', type: 'number', label: { en: 'QT interval', zh: 'QT 間期' }, unit: 'ms', normalRange: { low: 350, high: 450 }, source: { kind: 'labLoinc', loinc: ['8634-8'] } },
        { key: 'hr', type: 'number', label: { en: 'Heart rate', zh: '心率' }, unit: 'bpm', normalRange: { low: 60, high: 100 }, source: { kind: 'vital', loinc: ['8867-4'] } },
      ],
      compute: (v) => {
        const qt = n(v, 'qt'); const hr = n(v, 'hr')
        if (qt === undefined || hr === undefined || hr <= 0) return null
        const rr = 60 / hr
        const bazett = qt / Math.sqrt(rr)
        const frid = qt / Math.cbrt(rr)
        const val = round(bazett)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val > 500) { interp = { en: '> 500 ms — high torsades risk', zh: '> 500 ms — 高度尖端扭轉風險' }; severity = 'high' }
        else if (val >= 450) { interp = { en: '450–500 ms — prolonged', zh: '450–500 ms — 延長' }; severity = 'moderate' }
        else { interp = { en: '< 450 ms — normal', zh: '< 450 ms — 正常' }; severity = 'normal' }
        return { value: String(val), unit: 'ms', interpretation: interp, severity, extra: [{ label: { en: 'Fridericia QTc', zh: 'Fridericia QTc' }, value: `${round(frid)} ms` }] }
      },
      reference: 'Bazett QTc = QT / √RR; Fridericia = QT / ∛RR (RR seconds = 60/HR).',
    },

  // ── HEART Score ─────────────────────────────────────────────────────────
    {
      id: 'heart',
      name: { en: 'HEART Score (Chest Pain)', zh: 'HEART 分數（胸痛）' },
      category: 'cardiac',
      audience: 'medical',
      blurb: { en: '6-week MACE risk in chest pain.', zh: '胸痛 6 週主要心臟事件風險。' },
      inputs: [
        { key: 'history', type: 'select', label: { en: 'History', zh: '病史' }, defaultValue: '0', options: [
          { value: '0', label: { en: 'Slightly suspicious (0)', zh: '稍可疑 (0)' } },
          { value: '1', label: { en: 'Moderately suspicious (1)', zh: '中度可疑 (1)' } },
          { value: '2', label: { en: 'Highly suspicious (2)', zh: '高度可疑 (2)' } },
        ] },
        { key: 'ecg', type: 'select', label: { en: 'ECG', zh: '心電圖' }, defaultValue: '0', options: [
          { value: '0', label: { en: 'Normal (0)', zh: '正常 (0)' } },
          { value: '1', label: { en: 'Non-specific repolarization (1)', zh: '非特異性再極化 (1)' } },
          { value: '2', label: { en: 'Significant ST deviation (2)', zh: '顯著 ST 偏移 (2)' } },
        ] },
        AGE_INPUT,
        { key: 'risk', type: 'select', label: { en: 'Risk factors', zh: '危險因子' }, defaultValue: '0', options: [
          { value: '0', label: { en: 'None (0)', zh: '無 (0)' } },
          { value: '1', label: { en: '1–2 risk factors (1)', zh: '1–2 項 (1)' } },
          { value: '2', label: { en: '≥ 3 or known atherosclerosis (2)', zh: '≥ 3 項或已知動脈硬化 (2)' } },
        ] },
        { key: 'trop', type: 'select', label: { en: 'Troponin', zh: '心肌旋轉素' }, defaultValue: '0', options: [
          { value: '0', label: { en: '≤ normal limit (0)', zh: '≤ 正常上限 (0)' } },
          { value: '1', label: { en: '1–3× normal (1)', zh: '1–3 倍 (1)' } },
          { value: '2', label: { en: '> 3× normal (2)', zh: '> 3 倍 (2)' } },
        ] },
      ],
      compute: (v) => {
        const age = n(v, 'age')
        if (age === undefined) return null
        const agePts = age >= 65 ? 2 : age >= 45 ? 1 : 0
        const s = Number(v.history || 0) + Number(v.ecg || 0) + agePts + Number(v.risk || 0) + Number(v.trop || 0)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        let mace: string; let note: L
        if (s <= 3) { interp = { en: 'Low risk', zh: '低風險' }; severity = 'normal'; mace = '0.9–1.7%'; note = { en: 'Low 6-week MACE — early discharge with outpatient follow-up is often reasonable.', zh: '6 週主要心臟事件風險低 — 通常可早期出院並門診追蹤。' } }
        else if (s <= 6) { interp = { en: 'Moderate risk', zh: '中度風險' }; severity = 'moderate'; mace = '12–16.6%'; note = { en: 'Admit for observation and further cardiac workup.', zh: '建議住院觀察並進一步心臟檢查。' } }
        else { interp = { en: 'High risk', zh: '高風險' }; severity = 'high'; mace = '50–65%'; note = { en: 'High MACE — early invasive strategy is generally warranted.', zh: '主要心臟事件風險高 — 一般建議早期侵入性處置。' } }
        return {
          value: `${s} / 10`,
          interpretation: interp,
          severity,
          extra: [{ label: { en: '6-week MACE risk', zh: '6 週主要心臟事件風險' }, value: mace }],
          notes: note,
        }
      },
      reference: 'Six AJ, et al. 2008; Backus BE, et al. 2013. MACE by tier: 0–3 ≈0.9–1.7%, 4–6 ≈12–16.6%, 7–10 ≈50–65%.',
    },

  // ── Wells' Criteria for DVT ─────────────────────────────────────────────
    scoredQuestionnaire({
      id: 'wells-dvt',
      name: { en: "Wells' Criteria for DVT", zh: 'Wells DVT 準則' },
      category: 'cardiac',
      audience: 'medical',
      blurb: { en: 'Pre-test probability of DVT.', zh: '深部靜脈栓塞前測機率。' },
      items: [
        ynItem('cancer', { en: 'Active cancer (treatment within 6 mo)', zh: '活動性癌症（6 個月內治療）' }, 1, 'activeCancer'),
        ynItem('paralysis', { en: 'Paralysis/paresis or recent leg immobilization', zh: '下肢癱瘓或近期固定' }, 1),
        ynItem('bedridden', { en: 'Bedridden ≥ 3 days or major surgery within 12 wk', zh: '臥床 ≥ 3 天或 12 週內大手術' }, 1),
        ynItem('tenderness', { en: 'Localized tenderness along deep veins', zh: '深靜脈走向局部壓痛' }, 1),
        ynItem('swollenleg', { en: 'Entire leg swollen', zh: '整條腿腫脹' }, 1),
        ynItem('calf', { en: 'Calf swelling > 3 cm vs other leg', zh: '小腿較對側腫 > 3 cm' }, 1),
        ynItem('edema', { en: 'Pitting edema (symptomatic leg)', zh: '患肢凹陷性水腫' }, 1),
        ynItem('collateral', { en: 'Collateral superficial veins (non-varicose)', zh: '側枝表淺靜脈（非靜脈曲張）' }, 1),
        ynItem('priordvt', { en: 'Previously documented DVT', zh: '曾確診 DVT' }, 1, 'priorDvt'),
        ynItem('altdx', { en: 'Alternative diagnosis at least as likely', zh: '其他診斷同樣或更可能' }, -2),
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s <= 0) { interp = { en: 'DVT unlikely (≤ 0)', zh: '不太可能 DVT（≤ 0）' }; severity = 'normal' }
        else if (s <= 2) { interp = { en: 'Moderate (1–2)', zh: '中度（1–2）' }; severity = 'moderate' }
        else { interp = { en: 'DVT likely (≥ 3)', zh: '可能 DVT（≥ 3）' }; severity = 'high' }
        return { value: String(s), interpretation: interp, severity }
      },
      reference: 'Wells PS, et al. 2003. "Likely" (≥ 2) → imaging; otherwise D-dimer.',
    }),

  // ── Wells' Criteria for PE ──────────────────────────────────────────────
    scoredQuestionnaire({
      id: 'wells-pe',
      name: { en: "Wells' Criteria for PE", zh: 'Wells PE 準則' },
      category: 'cardiac',
      audience: 'medical',
      blurb: { en: 'Pre-test probability of PE.', zh: '肺栓塞前測機率。' },
      items: [
        ynItem('dvt', { en: 'Clinical signs of DVT', zh: 'DVT 臨床徵象' }, 3),
        ynItem('altdx', { en: 'PE is the #1 or equally likely diagnosis', zh: 'PE 為最可能或同等可能診斷' }, 3),
        ynItem('hr', { en: 'Heart rate > 100', zh: '心率 > 100' }, 1.5),
        ynItem('immob', { en: 'Immobilization ≥ 3 days or surgery within 4 wk', zh: '固定 ≥ 3 天或 4 週內手術' }, 1.5),
        ynItem('prior', { en: 'Previous PE / DVT', zh: '曾有 PE / DVT' }, 1.5, 'priorVte'),
        ynItem('hemoptysis', { en: 'Hemoptysis', zh: '咳血' }, 1),
        ynItem('cancer', { en: 'Malignancy (treatment within 6 mo)', zh: '惡性腫瘤（6 個月內治療）' }, 1, 'activeCancer'),
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s < 2) { interp = { en: 'Low (< 2)', zh: '低（< 2）' }; severity = 'normal' }
        else if (s <= 6) { interp = { en: 'Moderate (2–6)', zh: '中度（2–6）' }; severity = 'moderate' }
        else { interp = { en: 'High (> 6)', zh: '高（> 6）' }; severity = 'high' }
        return { value: String(s), interpretation: interp, severity }
      },
      reference: 'Wells PS, et al. 2000. Two-tier: ≤ 4 PE unlikely, > 4 likely.',
    }),

  // ── 10-year CVD risk — WHO 2019 (laboratory-based) ──────────────────────
    {
      id: 'who-cvd-2019',
      name: { en: 'CVD 10-year Risk (WHO 2019)', zh: '心血管疾病10年風險 (WHO 2019)' },
      category: 'cardiac',
      audience: 'both',
      blurb: {
        en: '10-yr fatal+non-fatal CVD risk (WHO lab-based model; not the NHI algorithm).',
        zh: '未來10年心血管疾病風險（WHO 實驗室版；非健保署演算法）。',
      },
      inputs: [
        SEX_INPUT,
        AGE_INPUT,
        { key: 'sbp', type: 'number', label: { en: 'Systolic BP', zh: '收縮壓' }, unit: 'mmHg', normalRange: { low: 90, high: 120 }, source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' } },
        { key: 'chol', type: 'number', label: { en: 'Total cholesterol', zh: '總膽固醇' }, unit: 'mg/dL', dimension: 'cholesterol', normalRange: { low: 125, high: 200 }, source: { kind: 'lab', keys: ['CHOL'] } },
        {
          key: 'dm', type: 'select', label: { en: 'Diabetes', zh: '糖尿病' }, defaultValue: '', source: { kind: 'hfpefClinical', key: 'diabetes' }, presumed: 'no',
          options: [
            { value: 'no', label: { en: 'No', zh: '無' } },
            { value: 'yes', label: { en: 'Yes', zh: '有' } },
          ],
        },
        {
          key: 'smk', type: 'select', label: { en: 'Current smoker', zh: '目前吸菸' }, defaultValue: '', source: { kind: 'hfpefClinical', key: 'smoker' }, presumed: 'no',
          options: [
            { value: 'no', label: { en: 'No', zh: '無' } },
            { value: 'yes', label: { en: 'Yes', zh: '有' } },
          ],
        },
      ],
      compute: (v) => {
        const age = n(v, 'age'); const sbp = n(v, 'sbp'); const cholMg = n(v, 'chol')
        if (age === undefined || sbp === undefined || cholMg === undefined) return null
        if (v.dm !== 'yes' && v.dm !== 'no') return null
        if (v.smk !== 'yes' && v.smk !== 'no') return null
        if (age <= 0 || sbp <= 0 || cholMg <= 0) return null
        if (v.sex !== 'male' && v.sex !== 'female') return null // require confirmed sex
        const sex: 'male' | 'female' = v.sex === 'female' ? 'female' : 'male'
        const chol = cholMg / 38.67 // mg/dL → mmol/L
        const dm = v.dm === 'yes' ? 1 : 0; const smk = v.smk === 'yes' ? 1 : 0
        const p = who2019Cvd(sex, age, chol, sbp, dm, smk)
        const pct = round(p * 100, 1)
        let interp: L; let severity: 'normal' | 'low' | 'moderate' | 'high'
        if (p < 0.05) { interp = { en: 'Low risk (< 5%)', zh: '低風險（< 5%）' }; severity = 'normal' }
        else if (p < 0.10) { interp = { en: 'Moderate risk (5–<10%)', zh: '中度風險（5–<10%）' }; severity = 'low' }
        else if (p < 0.20) { interp = { en: 'High risk (10–<20%)', zh: '高風險（10–<20%）' }; severity = 'moderate' }
        else if (p < 0.30) { interp = { en: 'Very high risk (20–<30%)', zh: '極高風險（20–<30%）' }; severity = 'high' }
        else { interp = { en: 'Critical risk (≥ 30%)', zh: '極高風險（≥ 30%）' }; severity = 'high' }
        const outOfRange = age < 40 || age > 80
        return {
          value: String(pct),
          unit: '%',
          interpretation: interp,
          severity,
          notes: {
            en: `${outOfRange ? 'Age is outside the model’s validated 40–80 y range — result is an extrapolation. ' : ''}WHO 2019 core model, NOT recalibrated for Taiwan and NOT the official NHI 健保 algorithm — for reference/comparison only.`,
            zh: `${outOfRange ? '年齡超出模型驗證範圍（40–80 歲），此結果為外推。' : ''}WHO 2019 核心模型，未經台灣區域校正、亦非健保署官方演算法，僅供參考比較。`,
          },
        }
      },
      reference: 'WHO CVD Risk Chart Working Group / Kaptoge S, et al. Lancet Glob Health 2019;7:e1332 (laboratory-based). Two Cox sub-models (MI + stroke) combined; pooled (un-recalibrated) baseline survival — not region-specific. Valid age 40–80. Total cholesterol converted mg/dL ÷ 38.67. Not the NHI 健保 model.',
    },
]
