import type { CalculatorDef, CalcResult, NumberInput, L } from '../types'
import { SEX_INPUT, n, round, HEIGHT_LOINC, WEIGHT_LOINC } from './_shared'
import type { EchoKey } from '../echo-autofill'
import { duBoisBsa, indexToBsa } from '../echo-derived'
import { ECHO_CHAMBER_REFERENCES, classifyLvGeometry, gradeEchoMetric, type EchoChamberMetric, type EchoGrade, type EchoSex, type LvGeometry } from '../echo-chamber-grading'

const label = (en: string, zh = en): L => ({ en, zh })
const echo = (key: EchoKey, en: string, zh: string, unit = ''): NumberInput => ({
  key, type: 'number', label: label(en, zh), unit, source: { kind: 'echo', key }, optional: true,
})

const GRADE: Record<EchoGrade | 'needsSex', L> = {
  normal: label('Normal', '正常'),
  abnormal: label('Abnormal', '異常'),
  mild: label('Mildly abnormal', '輕度異常'),
  moderate: label('Moderately abnormal', '中度異常'),
  severe: label('Severely abnormal', '重度異常'),
  above: label('Above range', '高於範圍'),
  below: label('Below range', '低於範圍'),
  needsSex: label('Sex needed', '需性別'),
}
const GEOMETRY: Record<LvGeometry | 'needsSex', L> = {
  normal: label('Normal geometry', '正常'),
  concentricRemodeling: label('Concentric remodelling', '向心性重塑'),
  concentricHypertrophy: label('Concentric hypertrophy', '向心性肥厚'),
  eccentricHypertrophy: label('Eccentric hypertrophy', '離心性肥厚'),
  needsSex: label('Sex needed', '需性別'),
}

// Display order, units and decimals; grading is always on the unrounded value.
const ROWS: Array<{ key: EchoChamberMetric; name: string; unit: string; dp: number; refDp: number }> = [
  { key: 'lvidd', name: 'LVIDd', unit: 'mm', dp: 1, refDp: 1 },
  { key: 'ivsd', name: 'IVSd', unit: 'mm', dp: 1, refDp: 0 },
  { key: 'lvpwd', name: 'LVPWd', unit: 'mm', dp: 1, refDp: 0 },
  { key: 'lvMass', name: 'LV mass', unit: 'g', dp: 1, refDp: 0 },
  { key: 'lvmi', name: 'LVMI', unit: 'g/m²', dp: 1, refDp: 0 },
  { key: 'rwt', name: 'RWT', unit: '', dp: 3, refDp: 2 },
  { key: 'lvef', name: 'LVEF', unit: '%', dp: 1, refDp: 0 },
  { key: 'lavi', name: 'LAVI', unit: 'mL/m²', dp: 1, refDp: 0 },
  { key: 'trv', name: 'TR Vmax', unit: 'm/s', dp: 2, refDp: 1 },
]
// LVEF from the report is single-plane; the reference is biplane, so it is shown ungraded.
const UNGRADED = new Set<EchoChamberMetric>(['lvef'])

const fmt = (value: number, dp: number) => round(value, dp).toFixed(dp)

function rangeText(metric: EchoChamberMetric, dp: number, sex?: EchoSex): string {
  const one = (s: EchoSex) => {
    const { lo, hi } = ECHO_CHAMBER_REFERENCES[metric][s].normal
    return lo === undefined ? `≤${hi!.toFixed(dp)}` : `${lo.toFixed(dp)}–${hi!.toFixed(dp)}`
  }
  if (sex) return one(sex)
  const male = one('male'), female = one('female')
  return male === female ? male : `M ${male} / F ${female}`
}

const withGrade = (name: string, grade: L): L => label(`${name} · ${grade.en}`, `${name} · ${grade.zh}`)

export const ECHO_CHAMBER: CalculatorDef = {
  version: 'v1',
  id: 'echo-chamber', name: label('Echo chamber quantification (ASE/EACVI)', '心超腔室定量（ASE/EACVI）'), category: 'cardiac',
  blurb: label('LV size, wall, mass, LA volume and TR velocity indexed to BSA and graded against ASE/EACVI references.', '左心室大小、壁厚、質量、左心房容積與 TR 速度，以 BSA 指數化並對照 ASE/EACVI 參考值。'),
  inputs: [SEX_INPUT,
    { key: 'height', type: 'number', label: label('Height (for BSA)', '身高（算 BSA 用）'), unit: 'cm', dimension: 'height', optional: true, source: { kind: 'vital', loinc: HEIGHT_LOINC, vital: 'height' } },
    { key: 'weight', type: 'number', label: label('Weight (for BSA)', '體重（算 BSA 用）'), unit: 'kg', dimension: 'weight', optional: true, source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
    echo('lvidd', 'LV end-diastolic diameter (LVIDd)', '左心室舒張末期內徑（LVIDd）', 'mm'),
    echo('ivsd', 'Septal thickness (IVSd)', '室間隔厚度（IVSd）', 'mm'),
    echo('lvpwd', 'Posterior wall thickness (LVPWd)', '後壁厚度（LVPWd）', 'mm'),
    echo('lvMass', 'LV mass (LVMI = mass / BSA)', '左心室質量（LVMI＝質量／BSA）', 'g'),
    echo('laVolume', 'LA volume (LAVI = volume / BSA)', '左心房容積（LAVI＝容積／BSA）', 'mL'),
    echo('lvmi', 'LV mass index (LVMI)', '左心室質量指數（LVMI）', 'g/m²'),
    echo('lavi', 'LA volume index (LAVI)', '左心房容積指數（LAVI）', 'mL/m²'),
    echo('rwt', 'Relative wall thickness (RWT)', '相對壁厚（RWT）'),
    echo('lvef', 'LVEF', '左心室射出分率（LVEF）', '%'),
    echo('trv', 'TR peak velocity (TR Vmax)', '三尖瓣逆流峰值速度（TR Vmax）', 'm/s'),
  ],
  coherence: { keys: ['lvidd', 'ivsd', 'lvpwd', 'lvMass', 'laVolume', 'lvmi', 'lavi', 'rwt', 'lvef', 'trv'], windowDays: 0 },
  compute(v): CalcResult | null {
    const positive = (key: string) => { const x = n(v, key); return x !== undefined && x > 0 ? x : undefined }
    const sex: EchoSex | undefined = v.sex === 'male' || v.sex === 'female' ? v.sex : undefined
    const bsa = duBoisBsa(positive('height'), positive('weight'))
    const lvMass = positive('lvMass'), laVolume = positive('laVolume')
    // A stated index wins; otherwise the raw value over Du Bois BSA.
    const statedLvmi = positive('lvmi'), statedLavi = positive('lavi')
    const values: Partial<Record<EchoChamberMetric, number>> = {
      lvidd: positive('lvidd'), ivsd: positive('ivsd'), lvpwd: positive('lvpwd'), lvMass,
      lvmi: statedLvmi ?? indexToBsa(lvMass, bsa), rwt: positive('rwt'), lvef: positive('lvef'),
      lavi: statedLavi ?? indexToBsa(laVolume, bsa), trv: positive('trv'),
    }
    if (laVolume === undefined && !ROWS.some(row => values[row.key] !== undefined)) return null

    const extra: CalcResult['extra'] = []
    const abnormal: string[] = [], needsSex: string[] = []
    let graded = 0, severe = false
    const push = (row: (typeof ROWS)[number]) => {
      const value = values[row.key]
      if (value === undefined) return
      const derived = (row.key === 'lvmi' && statedLvmi === undefined) || (row.key === 'lavi' && statedLavi === undefined)
      const name = derived ? `${row.name} (÷BSA)` : row.name
      const shown = `${fmt(value, row.dp)}${row.unit ? ` ${row.unit}` : ''}`
      if (UNGRADED.has(row.key)) { extra.push({ label: label(name), value: shown }); return }
      const result = gradeEchoMetric(row.key, value, sex)!
      // A row waiting for sex is not graded yet, so it is not in the denominator.
      if (result.grade === 'needsSex') needsSex.push(row.name)
      else {
        graded++
        if (result.grade !== 'normal') { abnormal.push(row.name); if (result.grade === 'severe') severe = true }
      }
      extra.push({
        label: withGrade(name, GRADE[result.grade]),
        value: `${shown} (${rangeText(row.key, row.refDp, sex)})`,
      })
    }
    for (const row of ROWS) {
      if (row.key === 'lavi' && laVolume !== undefined) extra.push({ label: label('LA volume'), value: `${fmt(laVolume, 1)} mL` })
      push(row)
      if (row.key === 'rwt') {
        const geometry = classifyLvGeometry(values.lvmi, values.rwt, sex)
        const g = geometry && GEOMETRY[geometry.geometry]
        if (g) extra.push({ label: label(`LV geometry · ${g.en}`, `LV 幾何型態 · ${g.zh}`), value: '' })
      }
    }
    if (bsa !== undefined) extra.push({ label: label('BSA (Du Bois)', 'BSA（Du Bois）'), value: `${fmt(bsa, 2)} m²` })

    const notIndexed = [
      ...(statedLvmi === undefined && lvMass !== undefined && bsa === undefined ? ['LVMI'] : []),
      ...(statedLavi === undefined && laVolume !== undefined && bsa === undefined ? ['LAVI'] : []),
    ]
    const caution = label('Calculated against guideline references; does not replace the reading physician’s judgement.', '計算與指引對照，不取代判讀醫師的臨床判斷。')
    const notes = notIndexed.length
      ? label(`${notIndexed.join(' and ')} not calculated: height or weight missing. ${caution.en}`, `缺身高或體重，未算 ${notIndexed.join('、')}。${caution.zh}`)
      : caution

    const sexNote = needsSex.length ? label(`; ${needsSex.length} need sex`, `；${needsSex.length} 項需性別`) : label('')
    const interpretation = !graded
      ? (needsSex.length ? label(`${needsSex.length} need sex`, `${needsSex.length} 項需性別`) : label('No measurement to grade', '無可分級的量測'))
      : abnormal.length ? label(`Outside reference: ${abnormal.join(', ')}${sexNote.en}`, `超出參考範圍：${abnormal.join('、')}${sexNote.zh}`)
      : needsSex.length ? label(`None outside reference${sexNote.en}`, `未超出參考範圍${sexNote.zh}`)
      : label('All within reference range', '皆在參考範圍內')
    return {
      numericValue: abnormal.length,
      value: graded ? `${abnormal.length} / ${graded}` : '—',
      interpretation,
      severity: !graded || (needsSex.length && !abnormal.length) ? undefined : severe ? 'high' : abnormal.length ? 'moderate' : 'normal',
      extra, notes,
    }
  },
  reference: 'Lang RM et al. Recommendations for cardiac chamber quantification by echocardiography in adults: an update from the ASE and the EACVI. J Am Soc Echocardiogr 2015;28:1–39.e14 (Eur Heart J Cardiovasc Imaging 2015;16:233–271). Nagueh SF et al. Recommendations for the evaluation of left ventricular diastolic function by echocardiography: an update from the ASE and the EACVI. J Am Soc Echocardiogr 2016;29:277–314 (TR velocity cut-off). BSA: Du Bois D, Du Bois EF. Arch Intern Med 1916;17:863–871.',
}
