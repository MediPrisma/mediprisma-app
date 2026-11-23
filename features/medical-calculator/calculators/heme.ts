import type { CalculatorDef, L } from '../types'
import { n, round } from './_shared'

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
]
