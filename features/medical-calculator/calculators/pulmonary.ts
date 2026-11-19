import type { CalculatorDef, L } from '../types'
import { n, round, AGE_INPUT, yesNoQuestionnaire } from './_shared'

export const PULMONARY: CalculatorDef[] = [
  // ── CURB-65 (pneumonia severity) ─────────────────────────────────────────
    {
      id: 'curb-65',
      name: { en: 'CURB-65 (Pneumonia Severity)', zh: 'CURB-65（肺炎嚴重度）' },
      category: 'pulmonary',
      blurb: { en: 'Community-acquired pneumonia severity / disposition.', zh: '社區型肺炎嚴重度／處置建議。' },
      inputs: [
        {
          key: 'confusion', type: 'select', label: { en: 'Confusion (new)', zh: '新發意識混亂' }, defaultValue: '', presumed: 'no',
          options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
        },
        { key: 'bun', type: 'number', label: { en: 'BUN', zh: '尿素氮 (BUN)' }, unit: 'mg/dL', dimension: 'bun', normalRange: { low: 7, high: 20 }, source: { kind: 'lab', keys: ['BUN'] } },
        {
          key: 'rr', type: 'select', label: { en: 'Respiratory rate ≥ 30/min', zh: '呼吸速率 ≥ 30/分' }, defaultValue: '', presumed: 'no',
          options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
        },
        {
          key: 'bp', type: 'select', label: { en: 'SBP < 90 or DBP ≤ 60 mmHg', zh: '收縮壓 < 90 或舒張壓 ≤ 60 mmHg' }, defaultValue: '', presumed: 'no',
          options: [{ value: 'no', label: { en: 'No', zh: '否' } }, { value: 'yes', label: { en: 'Yes', zh: '是' } }],
        },
        AGE_INPUT,
      ],
      compute: (v) => {
        const bun = n(v, 'bun'); const age = n(v, 'age')
        if (bun === undefined || age === undefined) return null
        let score = 0
        if (v.confusion === 'yes') score += 1
        if (bun > 19) score += 1
        if (v.rr === 'yes') score += 1
        if (v.bp === 'yes') score += 1
        if (age >= 65) score += 1
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        const mortality = ['0.6', '2.7', '6.8', '14.0', '27.8', '27.8'][score]
        if (score <= 1) { interp = { en: 'Low risk', zh: '低風險' }; severity = 'normal' }
        else if (score === 2) { interp = { en: 'Moderate risk', zh: '中度風險' }; severity = 'moderate' }
        else { interp = { en: 'Severe', zh: '重度' }; severity = 'high' }
        return {
          value: String(score),
          interpretation: interp,
          severity,
          extra: [{ label: { en: '30-day mortality', zh: '30 天死亡率' }, value: `${mortality}%` }],
          notes: score <= 1
            ? { en: 'Consider outpatient treatment.', zh: '可考慮門診治療。' }
            : score === 2
              ? { en: 'Consider a short inpatient stay or closely supervised outpatient care.', zh: '考慮短期住院或密切追蹤之門診治療。' }
              : { en: 'Admit; score 4–5 — assess for ICU / higher level of care.', zh: '建議住院;4–5 分需評估加護病房或更高級照護。' },
        }
      },
      reference: 'Lim WS, et al. Thorax 2003. 1 pt each: Confusion, Urea > 19 mg/dL, RR ≥ 30, low BP, age ≥ 65. 30-day mortality by score 0–5: 0.6/2.7/6.8/14.0/27.8/27.8%.',
    },

  // ── qSOFA ───────────────────────────────────────────────────────────────
    yesNoQuestionnaire({
      id: 'qsofa',
      name: { en: 'qSOFA Score', zh: 'qSOFA 分數' },
      category: 'pulmonary',
      audience: 'medical',
      blurb: { en: 'Quick sepsis risk outside the ICU.', zh: '非加護病房之快速敗血症風險。' },
      items: [
        { key: 'rr', scoreOn: 'yes', presumed: 'no', label: { en: 'Respiratory rate ≥ 22/min', zh: '呼吸速率 ≥ 22/分' } },
        { key: 'ams', scoreOn: 'yes', presumed: 'no', label: { en: 'Altered mentation (GCS < 15)', zh: '意識改變（GCS < 15）' } },
        { key: 'sbp', scoreOn: 'yes', presumed: 'no', label: { en: 'Systolic BP ≤ 100 mmHg', zh: '收縮壓 ≤ 100 mmHg' } },
      ],
      interpret: (s) => ({
        value: `${s} / 3`,
        interpretation: s >= 2
          ? { en: '≥ 2 — high risk; assess for sepsis', zh: '≥ 2 — 高風險；評估敗血症' }
          : { en: 'Low risk', zh: '低風險' },
        severity: s >= 2 ? 'high' : s === 1 ? 'moderate' : 'normal',
      }),
      reference: 'Seymour CW, et al. JAMA 2016. ≥ 2 predicts worse outcomes.',
    }),

  // ── SIRS criteria ───────────────────────────────────────────────────────
    {
      id: 'sirs',
      name: { en: 'SIRS Criteria', zh: 'SIRS 準則' },
      category: 'pulmonary',
      audience: 'medical',
      blurb: { en: 'Systemic inflammatory response.', zh: '全身性發炎反應。' },
      inputs: [
        { key: 'temp', type: 'number', label: { en: 'Temperature', zh: '體溫' }, unit: '°C', normalRange: { low: 36, high: 38 } },
        { key: 'hr', type: 'number', label: { en: 'Heart rate', zh: '心率' }, unit: 'bpm', normalRange: { low: 60, high: 90 } },
        { key: 'rr', type: 'number', label: { en: 'Respiratory rate', zh: '呼吸速率' }, unit: '/min', normalRange: { low: 12, high: 20 } },
        { key: 'wbc', type: 'number', label: { en: 'WBC', zh: '白血球' }, unit: '10⁹/L', dimension: 'wbc', normalRange: { low: 4, high: 12 }, source: { kind: 'lab', keys: ['WBC'] } },
      ],
      compute: (v) => {
        const t = n(v, 'temp'); const hr = n(v, 'hr'); const rr = n(v, 'rr'); const wbc = n(v, 'wbc')
        if ([t, hr, rr, wbc].some((x) => x === undefined)) return null
        let c = 0
        if (t! > 38 || t! < 36) c += 1
        if (hr! > 90) c += 1
        if (rr! > 20) c += 1
        if (wbc! > 12 || wbc! < 4) c += 1
        return {
          value: `${c} / 4`,
          interpretation: c >= 2 ? { en: '≥ 2 criteria — SIRS present', zh: '≥ 2 項 — 符合 SIRS' } : { en: '< 2 criteria', zh: '< 2 項' },
          severity: c >= 2 ? 'moderate' : 'normal',
        }
      },
      reference: '≥ 2 of: T > 38 or < 36 °C, HR > 90, RR > 20, WBC > 12 or < 4 (×10⁹/L).',
    },

  // ── A-a oxygen gradient ─────────────────────────────────────────────────
    {
      id: 'aa-gradient',
      name: { en: 'A-a Oxygen Gradient', zh: '肺泡–動脈血氧梯度 (A-a)' },
      category: 'pulmonary',
      audience: 'medical',
      blurb: { en: 'Alveolar–arterial O₂ difference.', zh: '肺泡與動脈血氧差。' },
      inputs: [
        { key: 'fio2', type: 'number', label: { en: 'FiO₂', zh: '吸入氧濃度 FiO₂' }, unit: '%', dimension: 'fio2', defaultValue: '21', source: { kind: 'labLoinc', loinc: ['3150-0'] } },
        { key: 'paco2', type: 'number', label: { en: 'PaCO₂', zh: '動脈 PaCO₂' }, unit: 'mmHg', dimension: 'pressure', normalRange: { low: 35, high: 45 }, source: { kind: 'labLoinc', loinc: ['2019-8'] } },
        { key: 'pao2', type: 'number', label: { en: 'PaO₂', zh: '動脈 PaO₂' }, unit: 'mmHg', dimension: 'pressure', normalRange: { low: 80, high: 100 }, source: { kind: 'labLoinc', loinc: ['2703-7'] } },
        AGE_INPUT,
      ],
      compute: (v) => {
        const fio2 = n(v, 'fio2'); const paco2 = n(v, 'paco2'); const pao2 = n(v, 'pao2'); const age = n(v, 'age')
        if (fio2 === undefined || paco2 === undefined || pao2 === undefined) return null
        const pAO2 = (fio2 / 100) * (760 - 47) - paco2 / 0.8
        const aa = pAO2 - pao2
        const val = round(aa)
        const extra: { label: L; value: string }[] = []
        let severity: 'normal' | 'moderate' | 'high' = 'normal'
        let interp: L = { en: 'Alveolar–arterial oxygen gradient', zh: '肺泡–動脈血氧梯度' }
        if (age !== undefined) {
          const expected = age / 4 + 4
          extra.push({ label: { en: 'Expected (age-based)', zh: '預期值（依年齡）' }, value: `≤ ${round(expected)} mmHg` })
          if (aa > expected) { severity = 'moderate'; interp = { en: 'Elevated for age — impaired gas exchange (V/Q mismatch, shunt, diffusion)', zh: '高於年齡預期 — 氣體交換異常（V/Q 不匹配、分流、擴散障礙）' } }
          else interp = { en: 'Within expected range for age', zh: '在年齡預期範圍內' }
        }
        return { value: String(val), unit: 'mmHg', interpretation: interp, severity, extra }
      },
      reference: 'PAO₂ = FiO₂ × (760 − 47) − PaCO₂/0.8; A-a = PAO₂ − PaO₂. Expected ≤ age/4 + 4.',
      coherence: { keys: ['fio2', 'paco2', 'pao2'], windowDays: 1 },
    },

  // ── PaO₂/FiO₂ ratio ─────────────────────────────────────────────────────
    {
      id: 'pf-ratio',
      name: { en: 'PaO₂/FiO₂ Ratio (P/F)', zh: '氧合指數 (P/F ratio)' },
      category: 'pulmonary',
      audience: 'medical',
      blurb: { en: 'Oxygenation / ARDS severity.', zh: '氧合狀態／ARDS 嚴重度。' },
      inputs: [
        { key: 'pao2', type: 'number', label: { en: 'PaO₂', zh: '動脈 PaO₂' }, unit: 'mmHg', dimension: 'pressure', normalRange: { low: 80, high: 100 }, source: { kind: 'labLoinc', loinc: ['2703-7'] } },
        { key: 'fio2', type: 'number', label: { en: 'FiO₂', zh: '吸入氧濃度 FiO₂' }, unit: '%', dimension: 'fio2', defaultValue: '21', source: { kind: 'labLoinc', loinc: ['3150-0'] } },
      ],
      compute: (v) => {
        const pao2 = n(v, 'pao2'); const fio2 = n(v, 'fio2')
        if (pao2 === undefined || fio2 === undefined || fio2 <= 0) return null
        const pf = pao2 / (fio2 / 100)
        const val = round(pf)
        let interp: L; let severity: 'normal' | 'moderate' | 'high'
        if (val > 300) { interp = { en: '> 300 — normal / no ARDS', zh: '> 300 — 正常 / 無 ARDS' }; severity = 'normal' }
        else if (val > 200) { interp = { en: '201–300 — mild ARDS', zh: '201–300 — 輕度 ARDS' }; severity = 'moderate' }
        else if (val > 100) { interp = { en: '101–200 — moderate ARDS', zh: '101–200 — 中度 ARDS' }; severity = 'high' }
        else { interp = { en: '≤ 100 — severe ARDS', zh: '≤ 100 — 重度 ARDS' }; severity = 'high' }
        return { value: String(val), unit: 'mmHg', interpretation: interp, severity }
      },
      reference: 'Berlin ARDS: ≤ 100 severe, ≤ 200 moderate, ≤ 300 mild (with PEEP ≥ 5).',
      coherence: { keys: ['pao2', 'fio2'], windowDays: 1 },
    },
]
