import type { CalculatorDef, L } from '../types'
import { n, clamp, round, SEX_INPUT, AGE_INPUT, WEIGHT_LOINC, HEIGHT_LOINC } from './_shared'

export const HEPATIC: CalculatorDef[] = [
  // ── MELD-Na (UNOS 2016) ─────────────────────────────────────────────────
    {
      id: 'meld-na',
      name: { en: 'MELD-Na Score', zh: 'MELD-Na 分數' },
      category: 'hepatic',
      blurb: { en: 'Liver disease severity / transplant priority.', zh: '肝病嚴重度／移植優先序。' },
      inputs: [
        { key: 'bili', type: 'number', label: { en: 'Total bilirubin', zh: '總膽紅素' }, unit: 'mg/dL', dimension: 'bilirubin', normalRange: { low: 0.3, high: 1.2 }, source: { kind: 'lab', keys: ['T.BILI'] } },
        { key: 'inr', type: 'number', label: { en: 'INR', zh: 'INR' }, normalRange: { low: 0.8, high: 1.1 }, source: { kind: 'lab', keys: ['INR'] } },
        { key: 'scr', type: 'number', label: { en: 'Creatinine', zh: '肌酸酐' }, unit: 'mg/dL', dimension: 'creatinine', normalRange: { low: 0.6, high: 1.2 }, source: { kind: 'lab', keys: ['CREA'] } },
        { key: 'na', type: 'number', label: { en: 'Sodium', zh: '鈉' }, unit: 'mmol/L', dimension: 'electrolyte', normalRange: { low: 136, high: 145 }, source: { kind: 'lab', keys: ['NA'] } },
        {
          key: 'dialysis', type: 'select', label: { en: 'Dialysis ≥2× in past week', zh: '過去一週洗腎 ≥2 次' },
          defaultValue: '',
          options: [
            { value: 'no', label: { en: 'No', zh: '否' } },
            { value: 'yes', label: { en: 'Yes', zh: '是' } },
          ],
        },
      ],
      compute: (v) => {
        const biliRaw = n(v, 'bili'); const inrRaw = n(v, 'inr'); const scrRaw = n(v, 'scr'); const naRaw = n(v, 'na')
        if (biliRaw === undefined || inrRaw === undefined || scrRaw === undefined || naRaw === undefined) return null
        // Lab values floored at 1.0; creatinine capped at 4.0 (or forced to 4.0 on dialysis).
        const bili = Math.max(biliRaw, 1)
        const inr = Math.max(inrRaw, 1)
        let scr = Math.max(scrRaw, 1)
        if (v.dialysis === 'yes') scr = 4.0
        scr = Math.min(scr, 4.0)
        let meld = 0.957 * Math.log(scr) + 0.378 * Math.log(bili) + 1.120 * Math.log(inr) + 0.643
        meld = Math.round(meld * 10)
        if (meld > 11) {
          const na = clamp(naRaw, 125, 137)
          meld = meld + 1.32 * (137 - na) - 0.033 * meld * (137 - na)
        }
        const val = clamp(Math.round(meld), 6, 40)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        let mort: string
        if (val <= 9) { interp = { en: 'Lower risk', zh: '風險較低' }; severity = 'normal'; mort = '~1.9%' }
        else if (val <= 19) { interp = { en: 'Intermediate risk', zh: '中度風險' }; severity = 'moderate'; mort = '~6.0%' }
        else if (val <= 29) { interp = { en: 'High risk', zh: '高風險' }; severity = 'high'; mort = '~19.6%' }
        else { interp = { en: 'Very high risk', zh: '極高風險' }; severity = 'high'; mort = '~52.6%+' }
        return {
          value: String(val),
          interpretation: interp,
          severity,
          extra: [{ label: { en: '90-day mortality', zh: '90 天死亡率' }, value: mort }],
          notes: { en: 'Drives liver-transplant prioritization — higher = greater urgency. MELD 3.0 is the current UNOS standard.', zh: '用於肝臟移植優先排序 — 分數越高越緊急。MELD 3.0 為現行 UNOS 標準。' },
        }
      },
      reference: 'OPTN/UNOS MELD-Na (2016). Range 6–40; labs floored at 1.0, Cr capped at 4.0. 90-day mortality ≈ 1.9/6.0/19.6/52.6% by band.',
    },

  // ── MELD 3.0 ────────────────────────────────────────────────────────────
    {
      id: 'meld-3',
      name: { en: 'MELD 3.0 Score', zh: 'MELD 3.0 分數' },
      category: 'hepatic',
      audience: 'medical',
      blurb: { en: 'Current UNOS liver allocation score.', zh: '現行 UNOS 肝臟分配分數。' },
      inputs: [
        { key: 'bili', type: 'number', label: { en: 'Total bilirubin', zh: '總膽紅素' }, unit: 'mg/dL', dimension: 'bilirubin', normalRange: { low: 0.3, high: 1.2 }, source: { kind: 'lab', keys: ['T.BILI'] } },
        { key: 'inr', type: 'number', label: { en: 'INR', zh: 'INR' }, normalRange: { low: 0.8, high: 1.1 }, source: { kind: 'lab', keys: ['INR'] } },
        { key: 'scr', type: 'number', label: { en: 'Creatinine', zh: '肌酸酐' }, unit: 'mg/dL', dimension: 'creatinine', normalRange: { low: 0.6, high: 1.2 }, source: { kind: 'lab', keys: ['CREA'] } },
        { key: 'na', type: 'number', label: { en: 'Sodium', zh: '鈉' }, unit: 'mmol/L', dimension: 'electrolyte', normalRange: { low: 136, high: 145 }, source: { kind: 'lab', keys: ['NA'] } },
        { key: 'alb', type: 'number', label: { en: 'Albumin', zh: '白蛋白' }, unit: 'g/dL', dimension: 'albumin', normalRange: { low: 3.5, high: 5.0 }, source: { kind: 'lab', keys: ['ALB'] } },
        SEX_INPUT,
        {
          key: 'dialysis', type: 'select', label: { en: 'Dialysis ≥2× in past week', zh: '過去一週洗腎 ≥2 次' }, defaultValue: '',
          options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
        },
      ],
      compute: (v) => {
        const biliR = n(v, 'bili'); const inrR = n(v, 'inr'); const scrR = n(v, 'scr'); const naR = n(v, 'na'); const albR = n(v, 'alb')
        if ([biliR, inrR, scrR, naR, albR].some((x) => x === undefined)) return null
        if (v.sex !== 'male' && v.sex !== 'female') return null // require confirmed sex
        const female = v.sex === 'female' ? 1 : 0
        const bili = Math.max(biliR!, 1)
        const inr = Math.max(inrR!, 1)
        let scr = clamp(scrR!, 1, 3)
        if (v.dialysis === 'yes') scr = 3
        const na = clamp(naR!, 125, 137)
        const alb = clamp(albR!, 1.5, 3.5)
        const meld = 1.33 * female
          + 4.56 * Math.log(bili)
          + 0.82 * (137 - na)
          - 0.24 * (137 - na) * Math.log(bili)
          + 9.09 * Math.log(inr)
          + 11.14 * Math.log(scr)
          + 1.85 * (3.5 - alb)
          - 1.83 * (3.5 - alb) * Math.log(scr)
          + 6
        const val = clamp(Math.round(meld), 6, 40)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val <= 9) { interp = { en: 'Lower short-term mortality', zh: '短期死亡率較低' }; severity = 'normal' }
        else if (val <= 19) { interp = { en: 'Intermediate risk', zh: '中度風險' }; severity = 'moderate' }
        else { interp = { en: 'High short-term mortality', zh: '短期死亡率高' }; severity = 'high' }
        return { value: String(val), interpretation: interp, severity }
      },
      reference: 'Kim WR, et al. Gastroenterology 2021. UNOS since 2023; adds sex + albumin to MELD-Na.',
    },

  // ── Child-Pugh ──────────────────────────────────────────────────────────
    {
      id: 'child-pugh',
      name: { en: 'Child-Pugh Score', zh: 'Child-Pugh 分數' },
      category: 'hepatic',
      blurb: { en: 'Cirrhosis severity classification.', zh: '肝硬化嚴重度分級。' },
      inputs: [
        { key: 'bili', type: 'number', label: { en: 'Total bilirubin', zh: '總膽紅素' }, unit: 'mg/dL', dimension: 'bilirubin', normalRange: { low: 0.3, high: 1.2 }, source: { kind: 'lab', keys: ['T.BILI'] } },
        { key: 'alb', type: 'number', label: { en: 'Albumin', zh: '白蛋白' }, unit: 'g/dL', dimension: 'albumin', normalRange: { low: 3.5, high: 5.0 }, source: { kind: 'lab', keys: ['ALB'] } },
        { key: 'inr', type: 'number', label: { en: 'INR', zh: 'INR' }, normalRange: { low: 0.8, high: 1.1 }, source: { kind: 'lab', keys: ['INR'] } },
        {
          key: 'ascites', type: 'select', label: { en: 'Ascites', zh: '腹水' }, defaultValue: 'none',
          options: [
            { value: 'none', label: { en: 'None', zh: '無' }, points: 1 },
            { value: 'mild', label: { en: 'Mild (controlled)', zh: '輕度（可控制）' }, points: 2 },
            { value: 'severe', label: { en: 'Moderate–severe', zh: '中重度' }, points: 3 },
          ],
        },
        {
          key: 'enceph', type: 'select', label: { en: 'Encephalopathy', zh: '肝腦病變' }, defaultValue: 'none',
          options: [
            { value: 'none', label: { en: 'None', zh: '無' }, points: 1 },
            { value: 'mild', label: { en: 'Grade 1–2', zh: '第 1–2 級' }, points: 2 },
            { value: 'severe', label: { en: 'Grade 3–4', zh: '第 3–4 級' }, points: 3 },
          ],
        },
      ],
      compute: (v) => {
        const bili = n(v, 'bili'); const alb = n(v, 'alb'); const inr = n(v, 'inr')
        if (bili === undefined || alb === undefined || inr === undefined) return null
        const biliPts = bili < 2 ? 1 : bili <= 3 ? 2 : 3
        const albPts = alb > 3.5 ? 1 : alb >= 2.8 ? 2 : 3
        const inrPts = inr < 1.7 ? 1 : inr <= 2.3 ? 2 : 3
        const ascPts = v.ascites === 'severe' ? 3 : v.ascites === 'mild' ? 2 : 1
        const encPts = v.enceph === 'severe' ? 3 : v.enceph === 'mild' ? 2 : 1
        const total = biliPts + albPts + inrPts + ascPts + encPts
        let cls: string; let interp: L; let severity: 'normal' | 'moderate' | 'high'
        let survival: string; let note: L
        if (total <= 6) { cls = 'A'; interp = { en: 'Class A — well compensated', zh: 'A 級 — 代償良好' }; severity = 'normal'; survival = '~100% / 85%'; note = { en: 'Good perioperative and short-term prognosis.', zh: '手術與短期預後良好。' } }
        else if (total <= 9) { cls = 'B'; interp = { en: 'Class B — significant compromise', zh: 'B 級 — 明顯受損' }; severity = 'moderate'; survival = '~80% / 60%'; note = { en: 'Elevated surgical risk; consider transplant referral if decompensating.', zh: '手術風險升高;若失代償應考慮轉介移植評估。' } }
        else { cls = 'C'; interp = { en: 'Class C — decompensated', zh: 'C 級 — 失代償' }; severity = 'high'; survival = '~45% / 35%'; note = { en: 'Poor prognosis; refer for liver transplant evaluation.', zh: '預後差;建議轉介肝臟移植評估。' } }
        return {
          value: `${total} (${cls})`,
          interpretation: interp,
          severity,
          extra: [{ label: { en: '1-year / 2-year survival', zh: '1 年／2 年存活率' }, value: survival }],
          notes: note,
        }
      },
      reference: 'Pugh RN, et al. Br J Surg 1973. Class A ≤6, B 7–9, C 10–15. Survival: A ~100/85%, B ~80/60%, C ~45/35% (1-/2-yr).',
    },

  // ── FIB-4 ───────────────────────────────────────────────────────────────
    {
      id: 'fib-4',
      name: { en: 'FIB-4 Index', zh: 'FIB-4 肝纖維化指數' },
      category: 'hepatic',
      blurb: { en: 'Non-invasive liver fibrosis estimate.', zh: '非侵入性肝纖維化評估。' },
      inputs: [
        AGE_INPUT,
        { key: 'ast', type: 'number', label: { en: 'AST', zh: 'AST' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 10, high: 40 }, source: { kind: 'lab', keys: ['AST'] } },
        { key: 'alt', type: 'number', label: { en: 'ALT', zh: 'ALT' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 7, high: 56 }, source: { kind: 'lab', keys: ['ALT'] } },
        { key: 'plt', type: 'number', label: { en: 'Platelets', zh: '血小板' }, unit: '10⁹/L', dimension: 'platelets', normalRange: { low: 150, high: 400 }, source: { kind: 'lab', keys: ['PLT'] } },
      ],
      compute: (v) => {
        const age = n(v, 'age'); const ast = n(v, 'ast'); const alt = n(v, 'alt'); const plt = n(v, 'plt')
        if (age === undefined || ast === undefined || alt === undefined || plt === undefined || plt <= 0 || alt <= 0) return null
        const fib4 = (age * ast) / (plt * Math.sqrt(alt))
        const val = round(fib4, 2)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val < 1.45) { interp = { en: '< 1.45 — advanced fibrosis unlikely', zh: '< 1.45 — 較不可能為進展性纖維化' }; severity = 'normal' }
        else if (val <= 3.25) { interp = { en: '1.45–3.25 — indeterminate', zh: '1.45–3.25 — 無法判定（灰色地帶）' }; severity = 'moderate' }
        else { interp = { en: '> 3.25 — advanced fibrosis likely', zh: '> 3.25 — 可能為進展性纖維化' }; severity = 'high' }
        return { value: String(val), interpretation: interp, severity }
      },
      reference: 'Sterling RK, et al. Hepatology 2006. FIB-4 = (age × AST) / (platelets × √ALT).',
    },

  // ── APRI (AST to Platelet Ratio Index) ──────────────────────────────────
    {
      id: 'apri',
      name: { en: 'APRI (AST-to-Platelet Ratio)', zh: 'APRI（AST 血小板比值指數）' },
      category: 'hepatic',
      blurb: { en: 'Non-invasive fibrosis / cirrhosis estimate.', zh: '非侵入性肝纖維化／肝硬化評估。' },
      inputs: [
        { key: 'ast', type: 'number', label: { en: 'AST', zh: 'AST' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 10, high: 40 }, source: { kind: 'lab', keys: ['AST'] } },
        { key: 'astUln', type: 'number', label: { en: 'AST upper limit of normal', zh: 'AST 正常值上限' }, unit: 'U/L', dimension: 'enzyme', defaultValue: '40' },
        { key: 'plt', type: 'number', label: { en: 'Platelets', zh: '血小板' }, unit: '10⁹/L', dimension: 'platelets', normalRange: { low: 150, high: 400 }, source: { kind: 'lab', keys: ['PLT'] } },
      ],
      compute: (v) => {
        const ast = n(v, 'ast'); const plt = n(v, 'plt'); const uln = n(v, 'astUln') ?? 40
        if (ast === undefined || plt === undefined || plt <= 0 || uln <= 0) return null
        const apri = ((ast / uln) * 100) / plt
        const val = round(apri, 2)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val < 0.5) { interp = { en: '< 0.5 — significant fibrosis unlikely', zh: '< 0.5 — 較不可能有明顯纖維化' }; severity = 'normal' }
        else if (val <= 1.5) { interp = { en: '0.5–1.5 — indeterminate', zh: '0.5–1.5 — 無法判定' }; severity = 'moderate' }
        else if (val < 2.0) { interp = { en: '> 1.5 — significant fibrosis likely', zh: '> 1.5 — 可能有明顯纖維化' }; severity = 'high' }
        else { interp = { en: '≥ 2.0 — cirrhosis likely', zh: '≥ 2.0 — 可能為肝硬化' }; severity = 'high' }
        return { value: String(val), interpretation: interp, severity }
      },
      reference: 'Wai CT, et al. Hepatology 2003. APRI = (AST / AST-ULN) × 100 / platelets (10⁹/L).',
    },

  // ── NAFLD Fibrosis Score ─────────────────────────────────────────────────
    {
      id: 'nafld-fibrosis',
      name: { en: 'NAFLD Fibrosis Score', zh: 'NAFLD 肝纖維化分數' },
      category: 'hepatic',
      blurb: { en: 'Advanced fibrosis risk in fatty liver disease.', zh: '脂肪肝之進展性纖維化風險。' },
      inputs: [
        AGE_INPUT,
        { key: 'weight', type: 'number', label: { en: 'Weight', zh: '體重' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
        { key: 'height', type: 'number', label: { en: 'Height', zh: '身高' }, unit: 'cm', dimension: 'height', source: { kind: 'vital', loinc: HEIGHT_LOINC, vital: 'height' } },
        {
          key: 'dm', type: 'select', label: { en: 'Impaired fasting glucose / diabetes', zh: '空腹血糖異常／糖尿病' }, defaultValue: '',
          options: [
            { value: 'no', label: { en: 'No', zh: '否' } },
            { value: 'yes', label: { en: 'Yes', zh: '是' } },
          ],
        },
        { key: 'ast', type: 'number', label: { en: 'AST', zh: 'AST' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 10, high: 40 }, source: { kind: 'lab', keys: ['AST'] } },
        { key: 'alt', type: 'number', label: { en: 'ALT', zh: 'ALT' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 7, high: 56 }, source: { kind: 'lab', keys: ['ALT'] } },
        { key: 'alb', type: 'number', label: { en: 'Albumin', zh: '白蛋白' }, unit: 'g/dL', dimension: 'albumin', normalRange: { low: 3.5, high: 5.0 }, source: { kind: 'lab', keys: ['ALB'] } },
        { key: 'plt', type: 'number', label: { en: 'Platelets', zh: '血小板' }, unit: '10⁹/L', dimension: 'platelets', normalRange: { low: 150, high: 400 }, source: { kind: 'lab', keys: ['PLT'] } },
      ],
      compute: (v) => {
        const age = n(v, 'age'); const wt = n(v, 'weight'); const ht = n(v, 'height')
        const ast = n(v, 'ast'); const alt = n(v, 'alt'); const alb = n(v, 'alb'); const plt = n(v, 'plt')
        if ([age, wt, ht, ast, alt, alb, plt].some((x) => x === undefined) || !ht || !alt || !plt) return null
        const m = ht! / 100
        const bmi = wt! / (m * m)
        const dm = v.dm === 'yes' ? 1 : 0
        const nfs = -1.675 + 0.037 * age! + 0.094 * bmi + 1.13 * dm + 0.99 * (ast! / alt!) - 0.013 * plt! - 0.66 * alb!
        const val = round(nfs, 2)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val < -1.455) { interp = { en: '< −1.455 — F0–F2, advanced fibrosis unlikely', zh: '< −1.455 — F0–F2，較不可能進展性纖維化' }; severity = 'normal' }
        else if (val <= 0.676) { interp = { en: '−1.455 to 0.676 — indeterminate', zh: '−1.455 至 0.676 — 無法判定' }; severity = 'moderate' }
        else { interp = { en: '> 0.676 — F3–F4, advanced fibrosis likely', zh: '> 0.676 — F3–F4，可能進展性纖維化' }; severity = 'high' }
        return { value: String(val), interpretation: interp, severity, extra: [{ label: { en: 'BMI', zh: 'BMI' }, value: `${round(bmi, 1)} kg/m²` }] }
      },
      reference: 'Angulo P, et al. Hepatology 2007. Cutoffs −1.455 and 0.676.',
    },

  // ── Maddrey's Discriminant Function ─────────────────────────────────────
    {
      id: 'maddrey-df',
      name: { en: "Maddrey's Discriminant Function", zh: 'Maddrey 判別函數' },
      category: 'hepatic',
      audience: 'medical',
      blurb: { en: 'Severity of alcoholic hepatitis.', zh: '酒精性肝炎嚴重度。' },
      inputs: [
        { key: 'pt', type: 'number', label: { en: 'Prothrombin time (patient)', zh: '凝血酶原時間 (病人)' }, unit: 'sec', source: { kind: 'lab', keys: ['PT'] } },
        { key: 'control', type: 'number', label: { en: 'Control PT', zh: '對照 PT' }, unit: 'sec', defaultValue: '12' },
        { key: 'bili', type: 'number', label: { en: 'Total bilirubin', zh: '總膽紅素' }, unit: 'mg/dL', dimension: 'bilirubin', normalRange: { low: 0.3, high: 1.2 }, source: { kind: 'lab', keys: ['T.BILI'] } },
      ],
      compute: (v) => {
        const pt = n(v, 'pt'); const control = n(v, 'control') ?? 12; const bili = n(v, 'bili')
        if (pt === undefined || bili === undefined) return null
        const df = 4.6 * (pt - control) + bili
        const val = round(df, 1)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val >= 32) { interp = { en: '≥ 32 — severe; consider corticosteroids', zh: '≥ 32 — 重度；考慮類固醇治療' }; severity = 'high' }
        else { interp = { en: '< 32 — non-severe', zh: '< 32 — 非重度' }; severity = 'normal' }
        return { value: String(val), interpretation: interp, severity }
      },
      reference: "Maddrey WC, et al. 1978. DF = 4.6 × (PT − control) + bilirubin. ≥ 32 = severe.",
    },

  // ── Liver-cancer (HCC) risk — REACH-B / REVEAL-HBV, NHI 健保存摺 version ───
    // Patient-facing risk score from Taiwan's 健保存摺 (health record app).
    // Simplified 4-factor REACH-B (sex, age, ALT, HBeAg) — the published
    // REACH-B/REVEAL-HBV score also uses serum HBV DNA, which the NHI version
    // drops. Points and 10-year-risk bands are transcribed verbatim from the
    // official 健保存摺 「計算說明」 table.
    {
      id: 'hcc-risk-reveal',
      name: { en: 'Liver Cancer (HCC) Risk — Chronic Hepatitis B', zh: '肝癌風險評估（慢性B型肝炎）' },
      category: 'hepatic',
      audience: 'both',
      blurb: {
        en: '10-year HCC risk in chronic hepatitis B (NHI simplified REACH-B).',
        zh: '慢性B型肝炎患者未來10年肝癌風險（健保存摺簡化版 REACH-B）。',
      },
      inputs: [
        SEX_INPUT,
        AGE_INPUT,
        { key: 'alt', type: 'number', label: { en: 'S-GPT / ALT', zh: 'S-GPT / ALT' }, unit: 'U/L', dimension: 'enzyme', normalRange: { low: 7, high: 56 }, source: { kind: 'lab', keys: ['ALT'] } },
        {
          key: 'hbeag', type: 'select', label: { en: 'Hepatitis B e antigen (HBeAg)', zh: 'B型肝炎e抗原 (HBeAg)' },
          defaultValue: '',
          options: [
            { value: 'neg', label: { en: 'Negative', zh: '陰性' } },
            { value: 'pos', label: { en: 'Positive', zh: '陽性' } },
          ],
        },
      ],
      compute: (v) => {
        const age = n(v, 'age'); const alt = n(v, 'alt'); const hbeag = v.hbeag
        if (age === undefined || alt === undefined || (hbeag !== 'pos' && hbeag !== 'neg')) return null
        if (age < 0 || alt < 0) return null
        if (v.sex !== 'male' && v.sex !== 'female') return null // require confirmed sex
        // Sex: female 0, male 2
        const sexPts = v.sex === 'female' ? 0 : 2
        // Age bands: <35:0, 35–39:1, 40–44:2, 45–49:3, 50–54:4, 55–59:5, ≥60:6
        const agePts = age >= 60 ? 6 : age >= 55 ? 5 : age >= 50 ? 4 : age >= 45 ? 3 : age >= 40 ? 2 : age >= 35 ? 1 : 0
        // ALT: <15:0, 15–44:1, ≥45:3
        const altPts = alt >= 45 ? 3 : alt >= 15 ? 1 : 0
        // HBeAg: negative 0, positive 4
        const hbePts = hbeag === 'pos' ? 4 : 0
        const score = sexPts + agePts + altPts + hbePts
        let interp: L; let severity: 'normal' | 'moderate' | 'high'; let risk: string
        if (score <= 4) { interp = { en: 'Low risk', zh: '風險較低' }; severity = 'normal'; risk = '< 1%' }
        else if (score <= 9) { interp = { en: 'Increased risk', zh: '風險上升' }; severity = 'moderate'; risk = '1–10%' }
        else if (score <= 12) { interp = { en: 'High risk', zh: '高風險' }; severity = 'high'; risk = '10–25%' }
        else if (score <= 14) { interp = { en: 'Very high risk', zh: '極高風險' }; severity = 'high'; risk = '30–50%' }
        else { interp = { en: 'Extremely high risk', zh: '極高風險' }; severity = 'high'; risk = '~65%' }
        return {
          value: `${score} / 15`,
          interpretation: interp,
          severity,
          extra: [{ label: { en: '10-year HCC risk', zh: '未來10年肝癌發生機率' }, value: risk }],
          notes: {
            en: 'A risk estimate for chronic hepatitis B carriers, not a diagnosis. Does NOT apply to cirrhosis, HCV/HDV/HIV co-infection, prior HCC, or a sudden ALT rise ≥2×. Antiviral therapy may lower risk; smoking, diabetes, alcohol, or family history may raise it. All chronic HBV carriers — regardless of score — need regular follow-up.',
            zh: '此為慢性B型肝炎帶原者之風險估算，非診斷。不適用於肝硬化、合併C肝/D肝/HIV、肝癌病史或ALT突然上升≥兩倍者。抗病毒治療可能降低風險；抽菸、糖尿病、酗酒或家族史可能提高風險。所有慢性B肝帶原者無論風險高低，都需定期就醫追蹤。',
          },
        }
      },
      reference: 'Yang HI, Chen CJ, et al. REACH-B, Lancet Oncol 2011 (REVEAL-HBV cohort). NHI 健保存摺 uses a simplified 4-factor version (sex/age/ALT/HBeAg, without serum HBV DNA). For non-HBV or cirrhotic patients it may overestimate risk.',
    },
]
