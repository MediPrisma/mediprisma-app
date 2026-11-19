import type { CalculatorDef, NumberInput, SelectInput, CalcValues, L } from '../types'
import { AGE_INPUT, SEX_INPUT, n } from './_shared'
import type { EchoKey } from '../echo-autofill'

const label = (en: string, zh = en): L => ({ en, zh })
const echo = (key: EchoKey, en: string, zh: string, unit = ''): NumberInput => ({
  key, type: 'number', label: label(en, zh), unit, source: { kind: 'echo', key }, optional: true,
})
const yesNo = (key: string, en: string, zh: string): SelectInput => ({
  key, type: 'select', label: label(en, zh), defaultValue: '',
  options: [{ value: 'no', label: label('No', '否') }, { value: 'yes', label: label('Yes', '是') }],
})
const valid = (v: CalcValues, keys: string[]) => keys.every(key => {
  if (!v[key]?.trim()) return true
  const value = n(v, key)
  return value !== undefined && Number.isFinite(value) && value >= 0
})
const context = label('For stable, symptomatic patients with preserved EF after considering alternative causes. Confirm report values and clinical context.', '用於射出分率保留、穩定且有症狀者，須先評估其他病因，並確認報告數值與臨床情境。')

const h2Ranges = [
  { range: '0–1', meaning: label('Low probability of HFpEF', 'HFpEF 低可能性') },
  { range: '2–5', meaning: label('Intermediate probability; further testing needed', '中間可能性，需進一步檢查') },
  { range: '6–9', meaning: label('High probability of HFpEF', 'HFpEF 高可能性') },
]
const hfaRanges = [
  { range: '0–1', meaning: label('HFpEF unlikely', 'HFpEF 可能性低') },
  { range: '2–4', meaning: label('Indeterminate; exercise echo or invasive exercise haemodynamics needed', '診斷未定，需運動心超或侵入性運動血流動力學評估') },
  { range: '5–6', meaning: label('Supports HFpEF in the appropriate clinical context', '在適當臨床情境下支持 HFpEF 診斷') },
]

export const HFPEF: CalculatorDef[] = [{
  id: 'h2fpef', name: label('H₂FPEF Score', 'H₂FPEF 分數'), category: 'cardiac',
  blurb: label('Six-item weighted score for HFpEF (0–9 points).', 'HFpEF 六項加權計分（0–9 分）。'),
  inputs: [AGE_INPUT,
    { key: 'bmi', type: 'number', label: label('BMI'), unit: 'kg/m²', source: { kind: 'bmi' } },
    { ...echo('ee', "E/e′ ratio", 'E/e′ 比值'), optional: false },
    { ...echo('pasp', 'Pulmonary artery systolic pressure', '肺動脈收縮壓（PASP）', 'mmHg'), optional: false },
    { ...yesNo('af', 'Paroxysmal or persistent atrial fibrillation', '陣發性或持續性心房顫動'), source: { kind: 'hfpefClinical', key: 'afHistory' }, presumed: 'no' },
    { ...yesNo('antihypertensives', 'Taking ≥2 antihypertensive medications', '使用 ≥2 種降血壓藥物'), source: { kind: 'hfpefClinical', key: 'antihypertensives' }, presumed: 'no' },
  ],
  coherence: { keys: ['ee', 'pasp', 'bmi'], windowDays: 0 },
  compute(v) {
    if (!valid(v, ['age', 'bmi', 'ee', 'pasp'])) return null
    const age = n(v, 'age'), bmi = n(v, 'bmi'), ee = n(v, 'ee'), pasp = n(v, 'pasp')
    if ((age !== undefined && age < 18) || [bmi, ee, pasp].some(x => x !== undefined && x <= 0)) return null
    if (['af', 'antihypertensives'].some(key => v[key]?.trim() && !['yes', 'no'].includes(v[key]))) return null
    const items = [
      { label: label('BMI >30'), known: bmi !== undefined, points: bmi !== undefined && bmi > 30 ? 2 : 0, max: 2 },
      { label: label('≥2 antihypertensives', '≥2 種降血壓藥'), known: ['yes', 'no'].includes(v.antihypertensives), points: v.antihypertensives === 'yes' ? 1 : 0, max: 1 },
      { label: label('Atrial fibrillation', '心房顫動'), known: ['yes', 'no'].includes(v.af), points: v.af === 'yes' ? 3 : 0, max: 3 },
      { label: label('PASP >35 mmHg'), known: pasp !== undefined, points: pasp !== undefined && pasp > 35 ? 1 : 0, max: 1 },
      { label: label('Age >60', '年齡 >60'), known: age !== undefined, points: age !== undefined && age > 60 ? 1 : 0, max: 1 },
      { label: label('E/e′ >9'), known: ee !== undefined, points: ee !== undefined && ee > 9 ? 1 : 0, max: 1 },
    ]
    if (!items.some(item => item.known)) return null
    const rows = items.map(item => ({ label: item.label, value: item.known ? String(item.points) : '—' }))
    const missing = items.filter(item => !item.known)
    const score = items.reduce((sum, item) => sum + item.points, 0)
    const upper = score + missing.reduce((sum, item) => sum + item.max, 0)
    if (missing.length) return {
      value: `${score} / 9`,
      interpretation: label(`Known subtotal (${6 - missing.length}/6 items); incomplete`, `已知項目小計（${6 - missing.length}/6 項）；資料未齊`),
      extra: [
        { label: label('Possible total score', '可能總分範圍'), value: `${score}–${upper} / 9` },
        { label: label('Missing items', '待補項目'), value: missing.map(item => item.label.zh).join('、') },
        ...rows,
      ],
      scoreRanges: h2Ranges,
      notes: label('Missing items remain unknown, not zero. Do not classify from this incomplete subtotal or diagnose from the score alone.', '未填項目不視為 0 分，不可直接用小計分級；須結合臨床情境，不能僅憑分數確診。'),
    }
    return {
      value: `${score} / 9`, extra: rows,
      interpretation: score <= 1 ? label('Low probability', '低可能性') : score >= 6 ? label('High probability', '高可能性') : label('Intermediate probability; further testing', '中間可能性；需進一步檢查'),
      scoreRanges: h2Ranges,
      notes: context,
    }
  },
  reference: 'Reddy YNV et al. Circulation 2018;138:861–870. doi:10.1161/CIRCULATIONAHA.118.034646. MDCalc: https://www.mdcalc.com/calc/10105/h2fpef-score-for-heart-failure-with-preserved-ejection-fraction',
}, {
  id: 'hfa-peff', name: label('HFA-PEFF Score', 'HFA-PEFF 分數'), category: 'cardiac',
  blurb: label('Step E: functional, morphological and biomarker domains (0–6). Blank measurements remain unknown.', 'Step E：功能、結構與生物標記三領域（0–6 分）。空白值維持未知。'),
  inputs: [AGE_INPUT, SEX_INPUT,
    { key: 'rhythm', type: 'select', source: { kind: 'hfpefClinical', key: 'rhythm' }, label: label('Rhythm at assessment', '評估時心律'), defaultValue: '', options: [{ value: 'sr', label: label('Sinus rhythm', '竇性心律') }, { value: 'af', label: label('Atrial fibrillation', '心房顫動') }] },
    echo('averageEe', 'Average E/e′ (direct or E / mean e′)', '平均 E/e′（報告值或 E／平均 e′）'),
    echo('e', 'Mitral E velocity', '二尖瓣 E 波速度', 'cm/s'),
    echo('septalE', 'Septal e′', '室間隔側 e′', 'cm/s'),
    echo('lateralE', 'Lateral e′', '側壁 e′', 'cm/s'),
    echo('trv', 'TR peak velocity', '三尖瓣逆流峰值速度', 'm/s'),
    echo('gls', 'GLS (absolute magnitude)', 'GLS（絕對值）', '%'),
    echo('lavi', 'Left atrial volume index (LAVI)', '左心房容積指數（LAVI）', 'mL/m²'),
    echo('lvmi', 'LV mass index (LVMI)', '左心室質量指數（LVMI）', 'g/m²'),
    echo('rwt', 'Relative wall thickness (RWT)', '相對壁厚（RWT）'),
    echo('wall', 'Max LV end-diastolic wall thickness', '最大左心室舒張末期壁厚', 'mm'),
    { key: 'ntprobnp', type: 'number', label: label('NT-proBNP'), unit: 'pg/mL', optional: true, source: { kind: 'natriuretic', assay: 'NT-PROBNP' } },
    { key: 'bnp', type: 'number', label: label('BNP'), unit: 'pg/mL', optional: true, source: { kind: 'natriuretic', assay: 'BNP' } },
  ],
  coherence: { keys: ['averageEe', 'e', 'septalE', 'lateralE', 'trv', 'gls', 'lavi', 'lvmi', 'rwt', 'wall', 'ntprobnp', 'bnp'], windowDays: 0 },
  compute(v) {
    const numeric = ['age', 'averageEe', 'e', 'septalE', 'lateralE', 'trv', 'gls', 'lavi', 'lvmi', 'rwt', 'wall', 'ntprobnp', 'bnp']
    if (!valid(v, numeric)) return null
    const age = n(v, 'age')
    if (age === undefined || age < 18 || !['male', 'female'].includes(v.sex) || !['sr', 'af'].includes(v.rhythm)) return null
    const af = v.rhythm === 'af'
    const septal = n(v, 'septalE'), lateral = n(v, 'lateralE'), e = n(v, 'e')
    const ee = n(v, 'averageEe') ?? (e !== undefined && septal !== undefined && lateral !== undefined && septal + lateral > 0 ? 2 * e / (septal + lateral) : undefined)
    const tr = n(v, 'trv'), gls = n(v, 'gls'), lavi = n(v, 'lavi'), lvmi = n(v, 'lvmi'), rwt = n(v, 'rwt'), wall = n(v, 'wall')
    const nt = n(v, 'ntprobnp'), bnp = n(v, 'bnp')
    const functionalMajor = (septal !== undefined && septal < (age >= 75 ? 5 : 7)) || (lateral !== undefined && lateral < (age >= 75 ? 7 : 10)) || (ee !== undefined && ee >= 15) || (tr !== undefined && tr > 2.8)
    const functionalMinor = (ee !== undefined && ee >= 9 && ee < 15) || (gls !== undefined && gls < 16)
    const morphologyMajor = (lavi !== undefined && lavi > (af ? 40 : 34)) || (lvmi !== undefined && lvmi >= (v.sex === 'male' ? 149 : 122) && rwt !== undefined && rwt > 0.42)
    const morphologyMinor = (lavi !== undefined && lavi >= (af ? 34 : 29)) || (lvmi !== undefined && lvmi >= (v.sex === 'male' ? 115 : 95)) || (rwt !== undefined && rwt > 0.42) || (wall !== undefined && wall >= 12)
    const biomarkerMajor = (nt !== undefined && nt > (af ? 660 : 220)) || (bnp !== undefined && bnp > (af ? 240 : 80))
    const biomarkerMinor = (nt !== undefined && nt >= (af ? 365 : 125)) || (bnp !== undefined && bnp >= (af ? 105 : 35))
    // Missing criteria cannot establish zero or exclude a major criterion.
    // A domain reaching its maximum is already resolved even if other inputs lack.
    const domains = [
      { label: label('Functional', '功能領域'), score: functionalMajor ? 2 : functionalMinor ? 1 : 0, complete: [septal, lateral, ee, tr, gls].every(x => x !== undefined) },
      { label: label('Morphological', '結構領域'), score: morphologyMajor ? 2 : morphologyMinor ? 1 : 0, complete: [lavi, lvmi, rwt, wall].every(x => x !== undefined) },
      { label: label('Biomarker', '生物標記領域'), score: biomarkerMajor ? 2 : biomarkerMinor ? 1 : 0, complete: nt !== undefined || bnp !== undefined },
    ]
    if (![ee, septal, lateral, tr, gls, lavi, lvmi, rwt, wall, nt, bnp].some(x => x !== undefined)) return null
    const score = domains.reduce((sum, d) => sum + d.score, 0)
    const upper = domains.reduce((sum, d) => sum + (d.complete ? d.score : 2), 0)
    const complete = score === upper
    return {
      value: complete ? `${score} / 6` : `${score}–${upper} / 6`,
      interpretation: !complete ? label('Incomplete data — possible score range', '資料未齊 — 顯示可能分數範圍') : score >= 5 ? label('Supports HFpEF', '支持 HFpEF') : score <= 1 ? label('HFpEF unlikely', 'HFpEF 可能性低') : label('Indeterminate — functional testing required', '未定 — 需功能性檢查'),
      extra: domains.map(d => ({ label: d.label, value: d.complete || d.score === 2 ? `${d.score} / 2` : `${d.score}–2 / 2` })),
      scoreRanges: hfaRanges,
      notes: label('Each domain contributes at most 2 points. When data are incomplete, do not classify from the lower bound alone.', '每領域最多 2 分。資料未齊時顯示可能範圍，不能僅用範圍下限分級。'),
    }
  },
  reference: 'Pieske B et al. Eur Heart J 2019;40:3297–3317. doi:10.1093/eurheartj/ehz641. Appcardio comparison: https://appcardio.com/hfa-peff-score-calculator/',
}]
