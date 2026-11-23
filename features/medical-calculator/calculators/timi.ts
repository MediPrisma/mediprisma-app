import type { CalculatorDef, CalcValues, CalcResult, L, SelectInput } from '../types'
import { AGE_INPUT, n } from './_shared'
import type { ClinicalSelectKey } from '../hfpef-clinical-autofill'

/**
 * The TIMI scores the CAD page asks for (owner request 2026-11-19, from the
 * cardiologist: 「CAD 有沒有 TIMI 等等的風險」): the secondary-prevention score
 * for chronic CAD after MI, and the UA/NSTEMI score for an acute presentation.
 * Each item is one point; a history the record does not show is prefilled 「無」
 * for the clinician to check (owner rule 2026-11-19).
 */
const label = (zh: string, en: string): L => ({ zh, en })

interface Item { key: string; label: L; record?: ClinicalSelectKey }

const yesNo = ({ key, label, record }: Item): SelectInput => ({
  key,
  label,
  type: 'select',
  defaultValue: '',
  ...(record ? { source: { kind: 'hfpefClinical' as const, key: record } } : {}),
  presumed: 'no',
  options: [
    { value: 'no', label: { zh: '無', en: 'No' } },
    { value: 'yes', label: { zh: '有', en: 'Yes' } },
  ],
})

/** One point per item; blank items give a range, never a low score. */
function pointScore(v: CalcValues, items: { key: string; label: L; point: boolean | undefined }[]) {
  const numericValue = items.filter((item) => item.point === true).length
  const missing = items.filter((item) => item.point === undefined)
  return { numericValue, missing, complete: missing.length === 0, upperBound: numericValue + missing.length }
}
const answer = (v: CalcValues, key: string) => v[key] === 'yes' ? true : v[key] === 'no' ? false : undefined

// ── TRS 2°P ──────────────────────────────────────────────────────────────
const TRS_HISTORY: Item[] = [
  { key: 'chf', label: label('心衰竭', 'Heart failure'), record: 'chf' },
  { key: 'htn', label: label('高血壓', 'Hypertension'), record: 'htn' },
  { key: 'dm', label: label('糖尿病', 'Diabetes'), record: 'diabetes' },
  { key: 'stroke', label: label('曾中風', 'Prior stroke'), record: 'stroke' },
  { key: 'cabg', label: label('曾接受冠狀動脈繞道手術（CABG）', 'Prior CABG'), record: 'priorCabg' },
  { key: 'pad', label: label('周邊動脈疾病（PAD）', 'Peripheral artery disease'), record: 'pad' },
  { key: 'smoking', label: label('目前吸菸', 'Current smoking'), record: 'smoker' },
]

function trs2p(v: CalcValues): CalcResult | null {
  const age = n(v, 'age')
  const egfr = n(v, 'egfr')
  if (age === undefined || age < 18 || age > 120) return null
  const items = [
    { key: 'age', label: label('年齡 ≥75 歲', 'Age ≥75'), point: age >= 75 },
    { key: 'egfr', label: label('eGFR <60', 'eGFR <60'), point: egfr === undefined ? undefined : egfr < 60 },
    ...TRS_HISTORY.map((item) => ({ key: item.key, label: item.label, point: answer(v, item.key) })),
  ]
  const { numericValue, missing, complete, upperBound } = pointScore(v, items)
  const high = numericValue >= 3
  const intermediate = numericValue === 2
  return {
    value: complete ? `${numericValue} / 9` : `${numericValue}–${upperBound} / 9`,
    numericValue,
    completeness: { complete, upperBound, missingKeys: missing.map((item) => item.key) },
    interpretation: !complete ? label('資料未齊 — 可能分數範圍', 'Incomplete — possible score range')
      : high ? label('高風險（≥3 分）', 'High risk (≥3)')
        : intermediate ? label('中風險（2 分）', 'Intermediate risk (2)')
          : label('低風險（0–1 分）', 'Low risk (0–1)'),
    severity: high ? 'high' : intermediate || !complete ? 'moderate' : 'normal',
    extra: [
      ...(!complete ? [{ label: label('待補項目', 'Missing inputs'), value: missing.map((item) => item.label.zh).join('、') }] : []),
      ...items.map((item) => ({ label: item.label, value: item.point === undefined ? '—' : item.point ? '1' : '0' })),
    ],
    notes: label(
      '心血管死亡、心肌梗塞、缺血性中風的復發風險隨分數上升；高風險者加強降脂（ezetimibe、PCSK9）或延長抗栓的絕對效益較大，仍須另評出血風險。紀錄未見的病史預填「無」，請核對。',
      'Recurrent CV death, MI and ischaemic stroke rise with the score; high-risk patients gain more in absolute terms from intensified lipid lowering (ezetimibe, PCSK9) or extended antithrombotic therapy, weighed against bleeding risk. Histories not in the record are prefilled No — check them.',
    ),
  }
}

// ── TIMI UA/NSTEMI ───────────────────────────────────────────────────────
const TIMI_ITEMS: Item[] = [
  { key: 'riskFactors', label: label('≥3 項冠心病危險因子（高血壓、高血脂、糖尿病、吸菸、早發冠心病家族史）', '≥3 CAD risk factors (hypertension, hyperlipidaemia, diabetes, smoking, family history of premature CAD)'), record: 'timiRiskFactors' },
  { key: 'knownCad', label: label('已知冠狀動脈狹窄 ≥50%', 'Known coronary stenosis ≥50%'), record: 'ihd' },
  { key: 'aspirin', label: label('7 天內使用 aspirin', 'Aspirin use in the past 7 days'), record: 'aspirin' },
  { key: 'angina', label: label('24 小時內 ≥2 次嚴重心絞痛', '≥2 severe angina episodes in 24 h') },
  { key: 'st', label: label('心電圖 ST 偏移 ≥0.5 mm', 'ST deviation ≥0.5 mm on ECG'), record: 'timiSt' },
  { key: 'marker', label: label('心肌標記（troponin／CK-MB）升高', 'Positive cardiac marker (troponin / CK-MB)'), record: 'timiMarker' },
]
/** 14-day all-cause death, new or recurrent MI, or severe recurrent ischaemia requiring urgent revascularisation (TIMI 11B). */
const TIMI_14_DAY = ['4.7', '4.7', '8.3', '13.2', '19.9', '26.2', '40.9', '40.9']

function timiUa(v: CalcValues): CalcResult | null {
  const age = n(v, 'age')
  if (age === undefined || age < 18 || age > 120) return null
  const items = [
    { key: 'age', label: label('年齡 ≥65 歲', 'Age ≥65'), point: age >= 65 },
    ...TIMI_ITEMS.map((item) => ({ key: item.key, label: item.label, point: answer(v, item.key) })),
  ]
  const { numericValue, missing, complete, upperBound } = pointScore(v, items)
  const high = numericValue >= 5
  const intermediate = numericValue >= 3 && numericValue <= 4
  return {
    value: complete ? `${numericValue} / 7` : `${numericValue}–${upperBound} / 7`,
    numericValue,
    completeness: { complete, upperBound, missingKeys: missing.map((item) => item.key) },
    interpretation: !complete ? label('資料未齊 — 可能分數範圍', 'Incomplete — possible score range')
      : high ? label('高風險（5–7 分）', 'High risk (5–7)')
        : intermediate ? label('中風險（3–4 分）', 'Intermediate risk (3–4)')
          : label('低風險（0–2 分）', 'Low risk (0–2)'),
    severity: high ? 'high' : intermediate || !complete ? 'moderate' : 'normal',
    extra: [
      ...(complete ? [{ label: label('14 天死亡、心肌梗塞或需緊急血行重建', '14-day death, MI or urgent revascularisation'), value: `${TIMI_14_DAY[numericValue]}%` }] : []),
      ...(!complete ? [{ label: label('待補項目', 'Missing inputs'), value: missing.map((item) => item.label.zh).join('、') }] : []),
      ...items.map((item) => ({ label: item.label, value: item.point === undefined ? '—' : item.point ? '1' : '0' })),
    ],
    notes: label(
      '用於疑似不穩定心絞痛／NSTEMI 的急性評估；門診穩定病人不適用。病歷帶入的危險因子、已知狹窄、aspirin，以及 72 小時內的 troponin 與 EKG 請核對；心絞痛次數依今天問診填寫。事件率來自 2000 年 TIMI 11B，早於高敏感度 troponin 與現代治療。',
      'For suspected UA/NSTEMI at presentation; not for stable outpatients. Check the risk factors, known stenosis, aspirin and the troponin and ECG of the last 72 hours read from the record; answer the angina count from today’s history. Event rates are from TIMI 11B (2000), before high-sensitivity troponin and contemporary therapy.',
    ),
  }
}

export const TIMI: CalculatorDef[] = [
  {
    id: 'timi-trs2p',
    version: 'v1',
    category: 'cardiac',
    name: label('TIMI 二級預防風險分數（TRS 2°P）', 'TIMI Risk Score for Secondary Prevention (TRS 2°P)'),
    blurb: label('心肌梗塞後穩定冠心病之復發心血管事件風險（0–9 分）。', 'Recurrent cardiovascular risk in stable CAD after MI (0–9).'),
    inputs: [
      AGE_INPUT,
      { key: 'egfr', type: 'number', label: label('eGFR', 'eGFR'), source: { kind: 'lab', keys: ['EGFR(EPI)', 'EGFR(M)'] }, unit: 'mL/min/1.73m²', dimension: 'egfr' },
      ...TRS_HISTORY.map(yesNo),
    ],
    compute: trs2p,
    reference: 'Bohula EA, et al. Circulation 2016;134:304–313 (TRA 2°P–TIMI 50). Risk groups 0–1 / 2 / ≥3: Bohula EA, et al. J Am Coll Cardiol 2017;69:911–921 (IMPROVE-IT).',
  },
  {
    id: 'timi-ua-nstemi',
    version: 'v1',
    category: 'cardiac',
    name: label('TIMI 風險分數（UA／NSTEMI）', 'TIMI Risk Score for UA/NSTEMI'),
    blurb: label('不穩定心絞痛／NSTEMI 之 14 天主要事件風險（0–7 分）。', '14-day major events in UA/NSTEMI (0–7).'),
    inputs: [AGE_INPUT, ...TIMI_ITEMS.map(yesNo)],
    compute: timiUa,
    reference: 'Antman EM, et al. JAMA 2000;284:835–842 (TIMI 11B). 14-day rates by score: 0–1 4.7%, 2 8.3%, 3 13.2%, 4 19.9%, 5 26.2%, 6–7 40.9%.',
  },
]
