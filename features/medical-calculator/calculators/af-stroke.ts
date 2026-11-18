import type { CalculatorDef, CalcValues, CalcResult, L, SelectInput } from '../types'
import { AGE_INPUT, SEX_INPUT, n } from './_shared'

const label = (zh: string, en: string): L => ({ zh, en })
const histories = [
  { key: 'chf', points: 1, label: label('心衰竭／左心室功能不良', 'Heart failure / LV dysfunction') },
  { key: 'htn', points: 1, label: label('高血壓', 'Hypertension') },
  { key: 'dm', points: 1, label: label('糖尿病（type 1／type 2）', 'Diabetes (type 1 / type 2)') },
  {
    key: 'stroke',
    points: 2,
    label: label('曾中風／TIA／動脈栓塞', 'Prior stroke / TIA / arterial embolism'),
  },
  { key: 'vascular', points: 1, label: label('血管疾病', 'Vascular disease') },
]
const historyInputs: SelectInput[] = histories.map(({ key, label }) => ({
  key,
  label,
  type: 'select',
  defaultValue: '',
  // Diabetes is read from the record and presumed absent when it shows none.
  ...(key === 'dm' ? { source: { kind: 'hfpefClinical' as const, key: 'diabetes' as const }, presumed: 'no' } : {}),
  options: [
    { value: 'no', label: { zh: '無', en: 'No' } },
    { value: 'yes', label: { zh: '有', en: 'Yes' } },
  ],
}))

/** Sole scoring implementation for the calculator UI and the AF CDSS handoff.
 * Blank history stays unknown. A lower bound never establishes low risk. */
function score(v: CalcValues, includeSex: boolean): CalcResult | null {
  const age = n(v, 'age')
  if (age === undefined || !Number.isFinite(age) || age < 18 || age > 120) return null
  if (includeSex && v.sex !== 'female' && v.sex !== 'male') return null
  if (histories.some((h) => v[h.key]?.trim() && !['yes', 'no'].includes(v[h.key]))) return null
  const items = [
    {
      key: 'age',
      label: label('年齡', 'Age'),
      known: true,
      points: age >= 75 ? 2 : age >= 65 ? 1 : 0,
      max: 2,
    },
    ...histories.map((h) => ({
      ...h,
      known: ['yes', 'no'].includes(v[h.key]),
      points: v[h.key] === 'yes' ? h.points : 0,
      max: h.points,
    })),
    ...(includeSex
      ? [{ key: 'sex', label: label('性別', 'Sex'), known: true, points: v.sex === 'female' ? 1 : 0, max: 1 }]
      : []),
  ]
  const numericValue = items.reduce((sum, item) => sum + item.points, 0)
  const missing = items.filter((item) => !item.known)
  const complete = missing.length === 0
  const upperBound = numericValue + missing.reduce((sum, item) => sum + item.max, 0)
  // Sex-specific interpretation belongs to the calculator; CDSS applies each
  // guideline's treatment thresholds to the returned score, without re-scoring.
  const recommended = includeSex ? numericValue >= (v.sex === 'female' ? 3 : 2) : numericValue >= 2
  const intermediate = includeSex ? numericValue === (v.sex === 'female' ? 2 : 1) : numericValue === 1
  return {
    value: complete ? String(numericValue) : `${numericValue}–${upperBound}`,
    numericValue,
    completeness: { complete, upperBound, missingKeys: missing.map((item) => item.key) },
    interpretation: !complete
      ? label('資料未齊 — 可能分數範圍', 'Incomplete — possible score range')
      : recommended
        ? label('達指引建議抗凝的分數門檻', 'Guideline score threshold for recommended OAC')
        : intermediate
          ? label('與病人討論抗凝', 'Discuss anticoagulation')
          : label(
              '低分 — 仍需臨床評估與追蹤',
              'Low score — clinical assessment and follow-up still required',
            ),
    severity: recommended ? 'high' : !complete || intermediate ? 'moderate' : 'normal',
    extra: [
      ...(includeSex && complete
        ? [
            {
              label: label('校正後每年缺血性中風率', 'Adjusted annual ischemic stroke rate'),
              value: `${['0.2', '0.6', '2.2', '3.2', '4.8', '7.2', '9.7', '11.2', '10.8', '12.2'][numericValue]}%`,
            },
          ]
        : []),
      ...(!complete
        ? [
            {
              label: label('待補項目', 'Missing inputs'),
              value: missing.map((item) => item.label.zh).join('、'),
            },
          ]
        : []),
      ...items.map((item) => ({ label: item.label, value: item.known ? String(item.points) : '—' })),
    ],
    notes: label(
      '未填病史不視為 0 分；不能僅依低的最低分排除抗凝需求。機械瓣、中重度 MS、HCM／心臟類澱粉沉積等另循專門指引。',
      'Missing history is not zero; a low minimum cannot exclude an OAC indication. Mechanical valves, significant MS, HCM and cardiac amyloidosis require dedicated guidance.',
    ),
  }
}

export const AF_STROKE: CalculatorDef[] = [
  {
    id: 'cha2ds2-va',
    version: 'v1',
    category: 'cardiac',
    name: label('CHA₂DS₂-VA 分數', 'CHA₂DS₂-VA Score'),
    blurb: label(
      'ESC 2024 心房顫動血栓風險（不計性別，0–8 分）。',
      'ESC 2024 AF thromboembolic risk (no sex point, 0–8).',
    ),
    inputs: [AGE_INPUT, ...historyInputs],
    compute: (v) => score(v, false),
    reference:
      '2024 ESC AF Guideline, Recommendation Table 6 and Table 10. Eur Heart J 2024;45:3314–3414. doi:10.1093/eurheartj/ehae176.',
  },
  {
    id: 'cha2ds2-vasc',
    version: 'v2',
    category: 'cardiac',
    name: label('CHA₂DS₂-VASc 分數', 'CHA₂DS₂-VASc Score'),
    blurb: label(
      'ACC/AHA 心房顫動血栓風險（含性別，0–9 分）。',
      'ACC/AHA AF thromboembolic risk (includes sex, 0–9).',
    ),
    inputs: [AGE_INPUT, SEX_INPUT, ...historyInputs],
    compute: (v) => score(v, true),
    reference:
      '2023 ACC/AHA/ACCP/HRS AF Guideline, Table 10 and §6.3.1. Circulation 2024;149:e1–e156. doi:10.1161/CIR.0000000000001193. Adjusted annual stroke rates: Friberg L et al. Eur Heart J 2012.',
  },
]
