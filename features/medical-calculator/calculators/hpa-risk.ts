import type { CalculatorDef } from '../types'

const YES_NO = [
  { value: 'no', label: { en: 'No', zh: '無' } },
  { value: 'yes', label: { en: 'Yes', zh: '有' } },
]

/** One entry for the official site's five-outcome composite, not five
 * unrelated scores. Detail renders the five results independently; a single
 * headline score would obscure missing inputs and clinical exclusions. */
export const HPA_RISK: CalculatorDef[] = [{
  id: 'hpa-chronic-risk-reconstruction',
  name: { en: 'Taiwan HPA · 5 chronic disease risks (reconstructed)', zh: '國健署五項慢性病風險（重建版）' },
  category: 'general',
  audience: 'both',
  blurb: { en: 'Local estimate of 10-year risk; not the official model.', zh: '本地估計未來 10 年風險，非官方原始公式。' },
  inputs: [
    { key: 'gender', type: 'select', label: { en: 'Sex used by model', zh: '模型使用的性別' }, options: [
      { value: 'male', label: { en: 'Male', zh: '男' } },
      { value: 'female', label: { en: 'Female', zh: '女' } },
    ], source: { kind: 'sex' }, defaultValue: '' },
    { key: 'age', type: 'number', label: { en: 'Age', zh: '年齡' }, unit: 'y', source: { kind: 'age' } },
    { key: 'height', type: 'number', label: { en: 'Height', zh: '身高' }, unit: 'cm', dimension: 'height', source: { kind: 'vital', loinc: ['8302-2'], vital: 'height' } },
    { key: 'weight', type: 'number', label: { en: 'Weight', zh: '體重' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: ['29463-7'], vital: 'weight' } },
    { key: 'waist', type: 'number', label: { en: 'Waist circumference', zh: '腰圍' }, unit: 'cm', dimension: 'height', source: { kind: 'vital', loinc: ['8280-0'], vital: 'waist' } },
    { key: 'sbp', type: 'number', label: { en: 'Systolic blood pressure', zh: '收縮壓' }, unit: 'mmHg', source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' } },
    // Explicit fasting LOINC only. A generic GLU observation may be random,
    // postprandial or point-of-care; it must not silently stand in for FPG.
    { key: 'glu', type: 'number', label: { en: 'Fasting plasma glucose', zh: '空腹血糖' }, unit: 'mg/dL', dimension: 'glucose', source: { kind: 'labLoinc', loinc: ['1558-6'] } },
    { key: 'chol', type: 'number', label: { en: 'Total cholesterol', zh: '總膽固醇' }, unit: 'mg/dL', dimension: 'cholesterol', source: { kind: 'lab', keys: ['CHOL'] } },
    { key: 'tg', type: 'number', label: { en: 'Triglycerides', zh: '三酸甘油酯' }, unit: 'mg/dL', dimension: 'triglyceride', source: { kind: 'lab', keys: ['TG'] } },
    { key: 'ldlc', type: 'number', label: { en: 'LDL cholesterol', zh: '低密度脂蛋白膽固醇' }, unit: 'mg/dL', dimension: 'cholesterol', source: { kind: 'lab', keys: ['LDL'] } },
    { key: 'hdlc', type: 'number', label: { en: 'HDL cholesterol', zh: '高密度脂蛋白膽固醇' }, unit: 'mg/dL', dimension: 'cholesterol', source: { kind: 'lab', keys: ['HDL'] } },
    { key: 'diabetes', type: 'select', label: { en: 'Known diabetes', zh: '已知糖尿病' }, options: YES_NO, defaultValue: '', source: { kind: 'hfpefClinical', key: 'diabetes' }, presumed: 'no' },
    { key: 'hbp', type: 'select', label: { en: 'Known hypertension', zh: '已知高血壓' }, options: YES_NO, defaultValue: '' },
    { key: 'smoke', type: 'select', label: { en: 'Current smoking', zh: '目前吸菸' }, options: YES_NO, defaultValue: '', presumed: 'no' },
    { key: 'prior_cvd', type: 'select', label: { en: 'Prior coronary disease or stroke', zh: '既往冠心病或中風' }, options: YES_NO, defaultValue: '' },
  ],
  // This composite deliberately has no single-number result. Detail presents
  // independently eligible outcomes; generic inline list scoring stays blank.
  compute: () => null,
  coherence: { keys: ['glu', 'chol', 'tg', 'ldlc', 'hdlc'], windowDays: 7 },
  reference: '國健署慢性疾病風險評估公開網頁（2026-09-16）之合成案例重建；非官方係數、非官方 API。2022 IJERPH MACE 文獻僅供背景，非五項 V4 公式。',
}]
