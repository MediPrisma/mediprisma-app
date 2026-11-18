import type { CalculatorDef, L } from '../types'
import { n, SEX_INPUT, AGE_INPUT, scoredQuestionnaire } from './_shared'

export const GI: CalculatorDef[] = [
  // ── Glasgow-Blatchford Score ────────────────────────────────────────────
    {
      id: 'glasgow-blatchford',
      name: { en: 'Glasgow-Blatchford Score', zh: 'Glasgow-Blatchford 分數' },
      category: 'gi',
      audience: 'medical',
      blurb: { en: 'Upper GI bleed risk / need for intervention.', zh: '上消化道出血風險／介入需求。' },
      inputs: [
        { key: 'bun', type: 'number', label: { en: 'BUN', zh: '尿素氮 (BUN)' }, unit: 'mg/dL', dimension: 'bun', normalRange: { low: 7, high: 20 }, source: { kind: 'lab', keys: ['BUN'] } },
        { key: 'hb', type: 'number', label: { en: 'Hemoglobin', zh: '血色素' }, unit: 'g/dL', dimension: 'hemoglobin', normalRange: { low: 12, high: 16 }, source: { kind: 'lab', keys: ['HB'] } },
        { key: 'sbp', type: 'number', label: { en: 'Systolic BP', zh: '收縮壓' }, unit: 'mmHg', normalRange: { low: 90, high: 120 } },
        SEX_INPUT,
        { key: 'hr', type: 'select', label: { en: 'Heart rate ≥ 100', zh: '心率 ≥ 100' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'melena', type: 'select', label: { en: 'Melena', zh: '黑便' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'syncope', type: 'select', label: { en: 'Syncope', zh: '昏厥' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'hepatic', type: 'select', label: { en: 'Hepatic disease', zh: '肝臟疾病' }, defaultValue: '', presumed: 'no', source: { kind: 'hfpefClinical', key: 'liverDisease' }, options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'cardiac', type: 'select', label: { en: 'Cardiac failure', zh: '心臟衰竭' }, defaultValue: '', presumed: 'no', source: { kind: 'hfpefClinical', key: 'chf' }, options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
      ],
      compute: (v) => {
        const bun = n(v, 'bun'); const hb = n(v, 'hb'); const sbp = n(v, 'sbp')
        if (bun === undefined || hb === undefined || sbp === undefined) return null
        if (v.sex !== 'male' && v.sex !== 'female') return null // require confirmed sex (sex-specific Hb bands)
        const female = v.sex === 'female'
        let s = 0
        // BUN (mg/dL)
        if (bun >= 70) s += 6; else if (bun >= 28) s += 4; else if (bun >= 22.4) s += 3; else if (bun >= 18.2) s += 2
        // Hemoglobin (sex-specific)
        if (female) { if (hb < 10) s += 6; else if (hb < 12) s += 1 }
        else { if (hb < 10) s += 6; else if (hb < 12) s += 3; else if (hb < 13) s += 1 }
        // Systolic BP
        if (sbp < 90) s += 3; else if (sbp < 100) s += 2; else if (sbp < 110) s += 1
        if (v.hr === 'yes') s += 1
        if (v.melena === 'yes') s += 1
        if (v.syncope === 'yes') s += 2
        if (v.hepatic === 'yes') s += 2
        if (v.cardiac === 'yes') s += 2
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s === 0) { interp = { en: '0 — very low risk; consider outpatient management', zh: '0 — 極低風險；可考慮門診處理' }; severity = 'normal' }
        else if (s <= 5) { interp = { en: '1–5 — low–moderate risk', zh: '1–5 — 低至中度風險' }; severity = 'moderate' }
        else { interp = { en: '≥ 6 — high risk; likely needs intervention', zh: '≥ 6 — 高風險；可能需介入' }; severity = 'high' }
        return { value: `${s} / 23`, interpretation: interp, severity }
      },
      reference: 'Blatchford O, et al. Lancet 2000. Score 0 identifies patients safe for outpatient care.',
    },

  // ── BISAP (pancreatitis severity) ───────────────────────────────────────
    {
      id: 'bisap',
      name: { en: 'BISAP Score (Pancreatitis)', zh: 'BISAP 分數（胰臟炎）' },
      category: 'gi',
      audience: 'medical',
      blurb: { en: 'Early acute pancreatitis mortality risk.', zh: '急性胰臟炎早期死亡風險。' },
      inputs: [
        { key: 'bun', type: 'number', label: { en: 'BUN', zh: '尿素氮 (BUN)' }, unit: 'mg/dL', dimension: 'bun', normalRange: { low: 7, high: 20 }, source: { kind: 'lab', keys: ['BUN'] } },
        AGE_INPUT,
        { key: 'mental', type: 'select', label: { en: 'Impaired mental status', zh: '意識改變' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'sirs', type: 'select', label: { en: 'SIRS (≥2 criteria)', zh: 'SIRS（≥2 項）' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
        { key: 'effusion', type: 'select', label: { en: 'Pleural effusion', zh: '肋膜積液' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
      ],
      compute: (v) => {
        const bun = n(v, 'bun'); const age = n(v, 'age')
        if (bun === undefined || age === undefined) return null
        let s = 0
        if (bun > 25) s += 1
        if (age > 60) s += 1
        if (v.mental === 'yes') s += 1
        if (v.sirs === 'yes') s += 1
        if (v.effusion === 'yes') s += 1
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s <= 1) { interp = { en: '0–1 — low mortality (<2%)', zh: '0–1 — 低死亡率（<2%）' }; severity = 'normal' }
        else if (s === 2) { interp = { en: '2 — intermediate (~2%)', zh: '2 — 中度（約 2%）' }; severity = 'moderate' }
        else { interp = { en: '≥ 3 — high mortality (5–20%)', zh: '≥ 3 — 高死亡率（5–20%）' }; severity = 'high' }
        return { value: `${s} / 5`, interpretation: interp, severity }
      },
      reference: 'Wu BU, et al. Gut 2008. BUN > 25, Impaired mental status, SIRS, Age > 60, Pleural effusion.',
    },

  // ── Ranson's Criteria (pancreatitis) ────────────────────────────────────
    {
      id: 'ranson',
      name: { en: "Ranson's Criteria (Pancreatitis)", zh: 'Ranson 準則（胰臟炎）' },
      category: 'gi',
      audience: 'medical',
      blurb: { en: 'Acute pancreatitis severity (admission + 48h).', zh: '急性胰臟炎嚴重度（入院＋48 小時）。' },
      inputs: [
        AGE_INPUT,
        { key: 'wbc', type: 'number', label: { en: 'WBC (admission)', zh: '白血球（入院）' }, unit: '10⁹/L', dimension: 'wbc', normalRange: { low: 4, high: 11 }, source: { kind: 'lab', keys: ['WBC'] } },
        { key: 'glucose', type: 'number', label: { en: 'Glucose (admission)', zh: '血糖（入院）' }, unit: 'mg/dL', dimension: 'glucose', normalRange: { low: 70, high: 100 }, source: { kind: 'lab', keys: ['GLUCOSE', 'GLUCOSE-AC'] } },
        { key: 'ast', type: 'number', label: { en: 'AST (admission)', zh: 'AST（入院）' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 10, high: 40 }, source: { kind: 'lab', keys: ['AST'] } },
        { key: 'ldh', type: 'number', label: { en: 'LDH (admission)', zh: 'LDH（入院）' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 140, high: 280 }, source: { kind: 'lab', keys: ['LDH'] } },
        { key: 'hctFall', type: 'number', label: { en: 'Hct fall at 48h (%)', zh: '48 小時 Hct 下降 (%)' }, unit: '%', optional: true, defaultValue: '0' },
        { key: 'bunRise', type: 'number', label: { en: 'BUN rise at 48h (mg/dL)', zh: '48 小時 BUN 上升 (mg/dL)' }, unit: 'mg/dL', optional: true, defaultValue: '0' },
        { key: 'ca', type: 'number', label: { en: 'Calcium at 48h', zh: '48 小時血鈣' }, unit: 'mg/dL', dimension: 'calcium', normalRange: { low: 8.5, high: 10.5 }, optional: true, source: { kind: 'lab', keys: ['CA'] } },
        { key: 'pao2', type: 'number', label: { en: 'PaO₂ at 48h', zh: '48 小時 PaO₂' }, unit: 'mmHg', dimension: 'pressure', optional: true, source: { kind: 'labLoinc', loinc: ['2703-7'] } },
        { key: 'baseDeficit', type: 'number', label: { en: 'Base deficit at 48h', zh: '48 小時鹼缺失' }, unit: 'mmol/L', optional: true, defaultValue: '0' },
        { key: 'fluid', type: 'number', label: { en: 'Fluid sequestration at 48h (L)', zh: '48 小時體液滯留 (L)' }, unit: 'L', optional: true, defaultValue: '0' },
      ],
      compute: (v) => {
        const age = n(v, 'age'); const wbc = n(v, 'wbc'); const glu = n(v, 'glucose'); const ast = n(v, 'ast'); const ldh = n(v, 'ldh')
        if ([age, wbc, glu, ast, ldh].some((x) => x === undefined)) return null
        const ca = n(v, 'ca'); const pao2 = n(v, 'pao2'); const hctFall = n(v, 'hctFall'); const bunRise = n(v, 'bunRise'); const bd = n(v, 'baseDeficit'); const fluid = n(v, 'fluid')
        let c = 0
        if (age! > 55) c += 1
        if (wbc! > 16) c += 1
        if (glu! > 200) c += 1
        if (ast! > 250) c += 1
        if (ldh! > 350) c += 1
        if (hctFall !== undefined && hctFall > 10) c += 1
        if (bunRise !== undefined && bunRise > 5) c += 1
        if (ca !== undefined && ca < 8) c += 1
        if (pao2 !== undefined && pao2 < 60) c += 1
        if (bd !== undefined && bd > 4) c += 1
        if (fluid !== undefined && fluid > 6) c += 1
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (c <= 2) { interp = { en: '0–2 — ~2% mortality', zh: '0–2 — 約 2% 死亡率' }; severity = 'normal' }
        else if (c <= 4) { interp = { en: '3–4 — ~15% mortality', zh: '3–4 — 約 15% 死亡率' }; severity = 'high' }
        else if (c <= 6) { interp = { en: '5–6 — ~40% mortality', zh: '5–6 — 約 40% 死亡率' }; severity = 'high' }
        else { interp = { en: '≥ 7 — ~100% mortality', zh: '≥ 7 — 接近 100% 死亡率' }; severity = 'high' }
        return { value: `${c} / 11`, interpretation: interp, severity }
      },
      reference: 'Ranson JH, et al. 1974 (non-gallstone). ≥ 3 indicates severe pancreatitis.',
    },

  // ── AIMS65 (upper GI bleed mortality) ───────────────────────────────────
    {
      id: 'aims65',
      name: { en: 'AIMS65 Score (GI Bleed)', zh: 'AIMS65 分數（消化道出血）' },
      category: 'gi',
      audience: 'medical',
      blurb: { en: 'In-hospital mortality in upper GI bleed.', zh: '上消化道出血院內死亡率。' },
      inputs: [
        { key: 'alb', type: 'number', label: { en: 'Albumin', zh: '白蛋白' }, unit: 'g/dL', dimension: 'albumin', normalRange: { low: 3.5, high: 5.0 }, source: { kind: 'lab', keys: ['ALB'] } },
        { key: 'inr', type: 'number', label: { en: 'INR', zh: 'INR' }, normalRange: { low: 0.8, high: 1.1 }, source: { kind: 'lab', keys: ['INR'] } },
        { key: 'sbp', type: 'number', label: { en: 'Systolic BP', zh: '收縮壓' }, unit: 'mmHg', normalRange: { low: 90, high: 120 } },
        AGE_INPUT,
        { key: 'mental', type: 'select', label: { en: 'Altered mental status', zh: '意識改變' }, defaultValue: '', presumed: 'no', options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }] },
      ],
      compute: (v) => {
        const alb = n(v, 'alb'); const inr = n(v, 'inr'); const sbp = n(v, 'sbp'); const age = n(v, 'age')
        if ([alb, inr, sbp, age].some((x) => x === undefined)) return null
        let s = 0
        if (alb! < 3) s += 1
        if (inr! > 1.5) s += 1
        if (v.mental === 'yes') s += 1
        if (sbp! < 90) s += 1
        if (age! > 65) s += 1
        // In-hospital mortality by score (Saltzman 2011 derivation cohort).
        const mortality = ['0.3', '1.2', '3.6', '9.8', '21.8', '31.8'][s]
        let cat: L; let severity: 'normal' | 'moderate' | 'high'
        if (s === 0) { cat = { en: 'Low risk', zh: '低風險' }; severity = 'normal' }
        else if (s === 1) { cat = { en: 'Low–moderate risk', zh: '低至中度風險' }; severity = 'moderate' }
        else { cat = { en: 'High risk', zh: '高風險' }; severity = 'high' }
        return {
          value: `${s} / 5`,
          interpretation: cat,
          severity,
          extra: [{ label: { en: 'In-hospital mortality', zh: '院內死亡率' }, value: `${mortality}%` }],
          notes: s >= 2
            ? { en: 'Higher-risk bleed — consider ICU-level monitoring and urgent endoscopy.', zh: '出血風險較高 — 考慮加護監測與緊急內視鏡。' }
            : { en: 'Lower risk of in-hospital mortality; manage per standard UGIB pathway.', zh: '院內死亡風險較低;依常規上消化道出血流程處理。' },
        }
      },
      reference: 'Saltzman JR, et al. Gastrointest Endosc 2011 (derivation cohort). Mortality by score 0–5: 0.3/1.2/3.6/9.8/21.8/31.8% (validation cohort reports ~24.5% at score 5).',
    },

  // ── Rockall Score (upper GI bleed) ──────────────────────────────────────
    scoredQuestionnaire({
      id: 'rockall',
      name: { en: 'Rockall Score (GI Bleed)', zh: 'Rockall 分數（消化道出血）' },
      category: 'gi',
      audience: 'medical',
      blurb: { en: 'Rebleeding & mortality after UGIB (post-endoscopy).', zh: '上消化道出血再出血與死亡風險（內視鏡後）。' },
      items: [
        { key: 'age', label: { en: 'Age', zh: '年齡' }, options: [
          { label: { en: '< 60 (0)', zh: '< 60 (0)' }, points: 0 },
          { label: { en: '60–79 (1)', zh: '60–79 (1)' }, points: 1 },
          { label: { en: '≥ 80 (2)', zh: '≥ 80 (2)' }, points: 2 },
        ] },
        { key: 'shock', label: { en: 'Shock', zh: '休克' }, options: [
          { label: { en: 'None — SBP ≥ 100, HR < 100 (0)', zh: '無 — 收縮壓 ≥ 100、心率 < 100 (0)' }, points: 0 },
          { label: { en: 'Tachycardia — HR ≥ 100 (1)', zh: '心搏過速 — 心率 ≥ 100 (1)' }, points: 1 },
          { label: { en: 'Hypotension — SBP < 100 (2)', zh: '低血壓 — 收縮壓 < 100 (2)' }, points: 2 },
        ] },
        { key: 'comorbid', label: { en: 'Comorbidity', zh: '共病' }, options: [
          { label: { en: 'None (0)', zh: '無 (0)' }, points: 0 },
          { label: { en: 'Cardiac / other major (2)', zh: '心臟或其他重大疾病 (2)' }, points: 2 },
          { label: { en: 'Renal / liver failure, metastatic (3)', zh: '腎／肝衰竭、轉移癌 (3)' }, points: 3 },
        ] },
        { key: 'diagnosis', label: { en: 'Diagnosis (endoscopy)', zh: '診斷（內視鏡）' }, options: [
          { label: { en: 'Mallory-Weiss / no lesion (0)', zh: 'Mallory-Weiss／無病灶 (0)' }, points: 0 },
          { label: { en: 'All other diagnoses (1)', zh: '其他診斷 (1)' }, points: 1 },
          { label: { en: 'GI malignancy (2)', zh: '消化道惡性腫瘤 (2)' }, points: 2 },
        ] },
        { key: 'stigmata', label: { en: 'Stigmata of recent bleeding', zh: '近期出血徵象' }, options: [
          { label: { en: 'None / dark spot (0)', zh: '無／暗色斑點 (0)' }, points: 0 },
          { label: { en: 'Blood, adherent clot, visible/spurting vessel (2)', zh: '出血、附著血塊、可見或噴血血管 (2)' }, points: 2 },
        ] },
      ],
      interpret: (s) => {
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (s <= 2) { interp = { en: '≤ 2 — low risk', zh: '≤ 2 — 低風險' }; severity = 'normal' }
        else if (s <= 5) { interp = { en: '3–5 — intermediate risk', zh: '3–5 — 中度風險' }; severity = 'moderate' }
        else { interp = { en: '≥ 6 — high risk of rebleeding / death', zh: '≥ 6 — 再出血／死亡高風險' }; severity = 'high' }
        return { value: `${s} / 11`, interpretation: interp, severity }
      },
      reference: 'Rockall TA, et al. Gut 1996. Full (post-endoscopy) score, range 0–11.',
    }),
]
