import type { CalculatorDef, L } from '../types'
import { n, round, WEIGHT_LOINC } from './_shared'

/** One decimal, with a second where the first would round onto a threshold (19.97 is not shown as 「20」). */
function tsatDisplay(tsat: number): string {
  const shown = round(tsat, 1)
  return (shown === 20 && tsat !== 20) || (shown === 45 && tsat !== 45) ? String(round(tsat, 2)) : String(shown)
}

export const HEME: CalculatorDef[] = [
  // ── Absolute neutrophil count ───────────────────────────────────────────
    {
      id: 'anc',
      name: { en: 'Absolute Neutrophil Count (ANC)', zh: '絕對嗜中性球數 (ANC)' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Neutropenia assessment.', zh: '嗜中性球低下評估。' },
      inputs: [
        { key: 'wbc', type: 'number', label: { en: 'WBC', zh: '白血球' }, unit: '10⁹/L', dimension: 'wbc', normalRange: { low: 4, high: 11 }, source: { kind: 'lab', keys: ['WBC'] } },
        { key: 'neut', type: 'number', label: { en: 'Neutrophils (segs)', zh: '嗜中性球（分葉核）' }, unit: '%', normalRange: { low: 40, high: 75 }, source: { kind: 'lab', keys: ['NEU'] } },
        { key: 'bands', type: 'number', label: { en: 'Bands (optional)', zh: '帶狀核（選填）' }, unit: '%', optional: true, defaultValue: '0' },
      ],
      compute: (v) => {
        const wbc = n(v, 'wbc'); const neut = n(v, 'neut'); const bands = n(v, 'bands') ?? 0
        if (wbc === undefined || neut === undefined) return null
        const anc = wbc * 1000 * (neut + bands) / 100
        const val = Math.round(anc)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val < 500) { interp = { en: '< 500 — severe neutropenia', zh: '< 500 — 嚴重嗜中性球低下' }; severity = 'high' }
        else if (val < 1000) { interp = { en: '500–1000 — moderate neutropenia', zh: '500–1000 — 中度低下' }; severity = 'high' }
        else if (val < 1500) { interp = { en: '1000–1500 — mild neutropenia', zh: '1000–1500 — 輕度低下' }; severity = 'moderate' }
        else { interp = { en: '≥ 1500 — normal', zh: '≥ 1500 — 正常' }; severity = 'normal' }
        return { value: String(val), unit: '/µL', interpretation: interp, severity }
      },
      reference: 'ANC = WBC × (%neutrophils + %bands) / 100. Severe < 500/µL.',
    },

  // ── Corrected reticulocyte / reticulocyte production index ───────────────
    {
      id: 'reticulocyte-index',
      name: { en: 'Reticulocyte Production Index (RPI)', zh: '網狀紅血球生成指數 (RPI)' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Adequacy of marrow response in anemia.', zh: '貧血時骨髓反應是否足夠。' },
      inputs: [
        { key: 'retic', type: 'number', label: { en: 'Reticulocytes', zh: '網狀紅血球' }, unit: '%', normalRange: { low: 0.5, high: 2.5 }, source: { kind: 'lab', keys: ['RETIC'] } },
        { key: 'hct', type: 'number', label: { en: 'Hematocrit', zh: '血球比容 (Hct)' }, unit: '%', normalRange: { low: 36, high: 50 }, source: { kind: 'lab', keys: ['HCT'] } },
      ],
      compute: (v) => {
        const retic = n(v, 'retic'); const hct = n(v, 'hct')
        if (retic === undefined || hct === undefined || hct <= 0) return null
        const corrected = retic * (hct / 45)
        const mat = hct >= 36 ? 1 : hct >= 26 ? 1.5 : hct >= 16 ? 2 : 2.5
        const rpi = corrected / mat
        const val = round(rpi, 1)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val >= 2) { interp = { en: '≥ 2 — adequate marrow response (e.g. hemolysis, blood loss)', zh: '≥ 2 — 骨髓反應足夠（如溶血、失血）' }; severity = 'normal' }
        else { interp = { en: '< 2 — inadequate response (hypoproliferative anemia)', zh: '< 2 — 反應不足（增生不良性貧血）' }; severity = 'moderate' }
        return { value: String(val), interpretation: interp, severity, extra: [{ label: { en: 'Corrected reticulocyte', zh: '校正網狀紅血球' }, value: `${round(corrected, 1)} %` }] }
      },
      reference: 'RPI = (retic% × Hct/45) / maturation factor. < 2 suggests inadequate marrow response.',
    },

  // ── Transferrin saturation ───────────────────────────────────────────────
    {
      id: 'tsat',
      name: { en: 'Transferrin Saturation (TSAT)', zh: '運鐵蛋白飽和度 (TSAT)' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Serum iron ÷ TIBC; iron deficiency and overload.', zh: '血清鐵 ÷ TIBC；評估缺鐵與鐵過載。' },
      inputs: [
        { key: 'iron', type: 'number', label: { en: 'Serum iron', zh: '血清鐵 (Fe)' }, unit: 'µg/dL', dimension: 'iron', normalRange: { low: 60, high: 170 }, source: { kind: 'lab', keys: ['IRON'], loinc: ['2498-4'] } },
        // Filled from the record's TIBC, else the same day's serum iron + UIBC.
        { key: 'tibc', type: 'number', label: { en: 'TIBC (or serum iron + UIBC)', zh: '總鐵結合能力 (TIBC)（或 Fe＋UIBC）' }, unit: 'µg/dL', dimension: 'iron', normalRange: { low: 250, high: 450 }, source: { kind: 'tibc' } },
        { key: 'ferritin', type: 'number', label: { en: 'Ferritin (optional)', zh: 'Ferritin（選填）' }, unit: 'ng/mL', dimension: 'ferritin', optional: true, source: { kind: 'lab', keys: ['FERRITIN'] } },
      ],
      compute: (v) => {
        const iron = n(v, 'iron'); const tibc = n(v, 'tibc'); const ferritin = n(v, 'ferritin')
        if (iron === undefined || iron < 0 || tibc === undefined || tibc <= 0) return null
        // Thresholds read the unrounded value; rounding is for display only.
        const tsat = (iron / tibc) * 100
        let interp: L; let severity: 'normal' | 'moderate'
        if (tsat < 20) { interp = { en: '< 20% — low: iron deficiency (the ESC 2026 definition in heart failure)', zh: '< 20% — 偏低：缺鐵（ESC 2026 心衰竭以此定義缺鐵）' }; severity = 'moderate' }
        else if (tsat <= 45) { interp = { en: '20–45% — within the usual range', zh: '20–45% — 一般範圍' }; severity = 'normal' }
        else { interp = { en: '> 45% — high: consider iron overload; repeat fasting', zh: '> 45% — 偏高：考慮鐵過載，建議空腹複驗' }; severity = 'moderate' }
        const extra: { label: L; value: string }[] = []
        if (ferritin !== undefined) {
          // ESC 2021: ferritin < 100 ng/mL, or 100–299 ng/mL with TSAT < 20%.
          const met = ferritin < 100 || (ferritin < 300 && tsat < 20)
          extra.push({
            label: { en: 'Older HF definition (ESC 2021: ferritin < 100, or 100–299 with TSAT < 20%)', zh: '心衰竭舊定義（ESC 2021：ferritin < 100，或 100–299 且 TSAT < 20%）' },
            value: `${met ? '✓' : '✗'} ferritin ${ferritin}`,
          })
        }
        return {
          numericValue: tsat, value: tsatDisplay(tsat), unit: '%', interpretation: interp, severity, extra,
          ...(tsat > 100 ? { notes: { en: 'Serum iron exceeds TIBC: check the values and their units.', zh: '血清鐵大於 TIBC：請核對數值與單位。' } } : {}),
        }
      },
      coherence: { keys: ['iron', 'tibc'], windowDays: 0 },
      reference: 'TSAT (%) = serum iron / TIBC × 100; TIBC = serum iron + UIBC. ESC 2026 heart failure guideline §10.4: iron deficiency is TSAT < 20%.',
    },

  // ── Ganzoni total iron deficit ───────────────────────────────────────────
    {
      id: 'iron-deficit-ganzoni',
      name: { en: 'Iron Deficit (Ganzoni)', zh: '缺鐵量估算 (Ganzoni)' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Total iron to replace in iron-deficiency anemia.', zh: '缺鐵性貧血需補足的總鐵量。' },
      inputs: [
        { key: 'weight', type: 'number', label: { en: 'Weight', zh: '體重' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
        { key: 'hb', type: 'number', label: { en: 'Hemoglobin', zh: '血色素' }, unit: 'g/dL', dimension: 'hemoglobin', normalRange: { low: 12, high: 16 }, source: { kind: 'lab', keys: ['HB'] } },
        { key: 'target', type: 'number', label: { en: 'Target hemoglobin', zh: '目標血色素' }, unit: 'g/dL', defaultValue: '15' },
        { key: 'stores', type: 'number', label: { en: 'Iron stores', zh: '儲存鐵' }, unit: 'mg', defaultValue: '500' },
      ],
      compute: (v) => {
        const weight = n(v, 'weight'); const hb = n(v, 'hb'); const target = n(v, 'target'); const stores = n(v, 'stores')
        if (weight === undefined || hb === undefined || target === undefined || stores === undefined) return null
        if (weight <= 0 || hb <= 0 || target <= 0 || stores < 0) return null
        // Nothing to replace for hemoglobin once it is at the target: the stores remain.
        const forHb = Math.max(0, weight * (target - hb) * 2.4)
        const deficit = forHb + stores
        return {
          numericValue: deficit, value: String(Math.round(deficit)), unit: 'mg',
          interpretation: { en: 'Total iron deficit', zh: '總缺鐵量' },
          extra: [
            { label: { en: 'For hemoglobin', zh: '補足血色素' }, value: `${Math.round(forHb)} mg` },
            { label: { en: 'Iron stores', zh: '儲存鐵' }, value: `${Math.round(stores)} mg` },
          ],
          notes: {
            en: 'An estimate of the total dose. The dose per infusion and its maximum follow each product’s label.',
            zh: '此為總量估算；單次劑量與上限依各鐵劑仿單。',
          },
        }
      },
      reference: 'Ganzoni AM. Schweiz Med Wochenschr 1970;100:301–3. Iron deficit (mg) = weight (kg) × (target Hb − actual Hb) (g/dL) × 2.4 + iron stores (mg).',
    },

  // ── i.v. iron: total need and dose caps from the product label ───────────
    {
      id: 'iv-iron-label-dose',
      name: { en: 'IV Iron Dose (Label Table)', zh: '靜脈鐵劑仿單劑量' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Total iron need and per-dose maximum from the label’s simplified table.', zh: '依仿單簡化表查總鐵需求量與單次上限。' },
      inputs: [
        {
          key: 'product', type: 'select', label: { en: 'Product', zh: '製劑' }, defaultValue: 'fcm',
          options: [
            { value: 'fcm', label: { en: 'Ferric carboxymaltose (Ferinject)', zh: 'Ferric carboxymaltose（Ferinject）' } },
            { value: 'fdi', label: { en: 'Ferric derisomaltose (Monofer)', zh: 'Ferric derisomaltose（Monofer）' } },
          ],
        },
        { key: 'weight', type: 'number', label: { en: 'Weight', zh: '體重' }, unit: 'kg', dimension: 'weight', source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
        { key: 'hb', type: 'number', label: { en: 'Hemoglobin', zh: '血色素' }, unit: 'g/dL', dimension: 'hemoglobin', normalRange: { low: 12, high: 16 }, source: { kind: 'lab', keys: ['HB'] } },
      ],
      compute: (v) => {
        const weight = n(v, 'weight'); const hb = n(v, 'hb'); const product = v.product
        if (weight === undefined || hb === undefined || weight <= 0 || hb <= 0) return null
        const mg = (value: number) => `${Math.round(value)} mg`
        if (product === 'fcm') {
          // Ferinject SmPC 4.2, Table 1: columns <35 kg, 35 to <70 kg, ≥70 kg; rows Hb <10, 10 to <14, ≥14 g/dL.
          const row = hb < 10 ? 0 : hb < 14 ? 1 : 2
          const total = weight < 35
            ? weight * [30, 15, 15][row]!
            : weight < 70 ? [1500, 1000, 500][row]! : [2000, 1500, 500][row]!
          return {
            numericValue: total, value: String(Math.round(total)), unit: 'mg',
            interpretation: { en: 'Total iron need (Ferinject)', zh: '總鐵需求量（Ferinject）' },
            extra: [
              { label: { en: 'Max single dose, infusion (20 mg/kg, ≤ 1000 mg)', zh: '單次上限，輸注（20 mg/kg，≤ 1000 mg）' }, value: mg(Math.min(weight * 20, 1000)) },
              { label: { en: 'Max single dose, injection (15 mg/kg, ≤ 1000 mg)', zh: '單次上限，推注（15 mg/kg，≤ 1000 mg）' }, value: mg(Math.min(weight * 15, 1000)) },
              { label: { en: 'Max per week', zh: '每週上限' }, value: '1000 mg' },
            ],
            notes: {
              en: 'UK/EU label, age ≥ 14. A further dose at least 7 days after the first. Haemodialysis: no more than 200 mg in a day. Check the label of the product you stock.',
              zh: '依英國／歐盟仿單，適用 ≥ 14 歲。總量超過單次上限時，下一劑至少間隔 7 天。血液透析者單日不超過 200 mg。請核對院內品項仿單。',
            },
          }
        }
        if (product === 'fdi') {
          // Monofer SmPC 4.2, Table 1: columns <50 kg, 50 to <70 kg, ≥70 kg; rows Hb ≥10, <10 g/dL.
          const column = weight < 50 ? 0 : weight < 70 ? 1 : 2
          const total = (hb < 10 ? [500, 1500, 2000] : [500, 1000, 1500])[column]!
          return {
            numericValue: total, value: String(total), unit: 'mg',
            interpretation: { en: 'Total iron need (Monofer)', zh: '總鐵需求量（Monofer）' },
            extra: [
              { label: { en: 'Max single infusion (20 mg/kg)', zh: '單次輸注上限（20 mg/kg）' }, value: mg(weight * 20) },
              { label: { en: 'Max single bolus', zh: '單次推注上限' }, value: '500 mg' },
              { label: { en: 'Max per week (20 mg/kg)', zh: '每週上限（20 mg/kg）' }, value: mg(weight * 20) },
            ],
            notes: {
              en: 'UK/EU label, adults. Check the label of the product you stock.',
              zh: '依英國／歐盟仿單，適用成人。請核對院內品項仿單。',
            },
          }
        }
        return null
      },
      reference: 'Ferinject 50 mg iron/mL SmPC (UK, emc), section 4.2, Table 1; text revised 22 May 2025. Monofer 100 mg/mL SmPC (UK, emc), section 4.2, Table 1; text revised 28 March 2025.',
    },

  // ── Mentzer index ────────────────────────────────────────────────────────
    {
      id: 'mentzer-index',
      name: { en: 'Mentzer Index', zh: 'Mentzer 指數' },
      category: 'heme',
      audience: 'medical',
      blurb: { en: 'Microcytic anemia: iron deficiency or thalassemia trait.', zh: '小球性貧血：缺鐵或地中海型貧血帶因。' },
      inputs: [
        { key: 'mcv', type: 'number', label: { en: 'MCV', zh: '平均紅血球容積 (MCV)' }, unit: 'fL', normalRange: { low: 80, high: 100 }, source: { kind: 'lab', keys: ['MCV'] } },
        { key: 'rbc', type: 'number', label: { en: 'RBC count', zh: '紅血球數 (RBC)' }, unit: '10⁶/µL', dimension: 'rbc', normalRange: { low: 4, high: 5.5 }, source: { kind: 'lab', keys: ['RBC'] } },
      ],
      compute: (v) => {
        const mcv = n(v, 'mcv'); const rbc = n(v, 'rbc')
        if (mcv === undefined || rbc === undefined || mcv <= 0 || rbc <= 0) return null
        const index = mcv / rbc
        // The threshold reads the unrounded index; a value that rounds to 13 is shown with one more decimal.
        const interp: L = index < 13
          ? { en: '< 13 — thalassemia trait more likely', zh: '< 13 — 較像地中海型貧血帶因' }
          : index > 13
            ? { en: '> 13 — iron deficiency more likely', zh: '> 13 — 較像缺鐵性貧血' }
            : { en: '13 — indeterminate', zh: '13 — 無法區分' }
        const val = index !== 13 && round(index, 1) === 13 ? round(index, 2) : round(index, 1)
        return { numericValue: index, value: String(val), interpretation: interp, severity: 'normal' }
      },
      coherence: { keys: ['mcv', 'rbc'], windowDays: 0 },
      reference: 'Mentzer WC. Lancet 1973;1:882. Mentzer index = MCV (fL) / RBC (10⁶/µL).',
    },
]
