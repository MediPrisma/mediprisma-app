import type { CalculatorDef, CalcResult, NumberInput, L } from '../types'
import { SEX_INPUT, n, round, HEIGHT_LOINC, WEIGHT_LOINC } from './_shared'
import type { EchoKey } from '../echo-autofill'
import { aseLvMass, duBoisBsa, indexToBsa, relativeWallThickness } from '../echo-derived'
import { ECHO_CHAMBER_REFERENCES, classifyLvGeometry, gradeEchoMetric, type EchoChamberMetric, type EchoGrade, type EchoSex, type LvGeometry } from '../echo-chamber-grading'

const label = (en: string, zh = en): L => ({ en, zh })
const echo = (key: EchoKey, en: string, zh: string, unit = ''): NumberInput => ({
  key, type: 'number', label: label(en, zh), unit, source: { kind: 'echo', key }, optional: true,
})

// A normal row shows its name alone, so normal needs no word.
const GRADE: Record<Exclude<EchoGrade, 'normal'> | 'needsSex', L> = {
  abnormal: label('Abnormal', '異常'),
  mild: label('Mildly abnormal', '輕度異常'),
  moderate: label('Moderately abnormal', '中度異常'),
  severe: label('Severely abnormal', '重度異常'),
  // No severity partitions for these (wall thickness, diameter, mass): same word as the other ungraded abnormals.
  above: label('Abnormal', '異常'),
  below: label('Below range', '低於範圍'),
  needsSex: label('Sex needed', '需性別'),
}
// Only an abnormal geometry is named, at the head of the summary line.
const GEOMETRY: Record<Exclude<LvGeometry, 'normal'>, L> = {
  concentricRemodeling: label('Concentric remodelling', '向心性重塑'),
  concentricHypertrophy: label('Concentric hypertrophy', '向心性肥厚'),
  eccentricHypertrophy: label('Eccentric hypertrophy', '離心性肥厚'),
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
// LVEF is read by the heart-failure categories (owner decision 2026-11-27), not ASE Table 4, whose
// biplane sex-specific limits would call a single-plane 50–51 % abnormal: ≤40 reduced, above 40 and
// below 50 mildly reduced, ≥50 preserved. A value between 40 and 41 is past the reduced band.
const lvefCategory = (lvef: number): L | undefined =>
  lvef <= 40 ? label('Reduced', '降低') : lvef < 50 ? label('Mildly reduced', '輕度降低') : undefined

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

// Rows outside reference carry ▲ and their grade; a normal row is its name alone.
const withGrade = (name: string, grade: L, flagged: boolean): L => label(`${flagged ? '▲ ' : ''}${name} · ${grade.en}`, `${flagged ? '▲ ' : ''}${name} · ${grade.zh}`)

export const ECHO_CHAMBER: CalculatorDef = {
  version: 'v1',
  id: 'echo-chamber', name: label('Echo chamber quantification (ASE/EACVI)', '心超腔室定量（ASE/EACVI）'), category: 'cardiac',
  blurb: label('LV size, wall, mass, LA volume and TR velocity indexed to BSA and graded against ASE/EACVI references.', '左心室大小、壁厚、質量、左心房容積與 TR 速度，以 BSA 指數化並對照 ASE/EACVI 參考值。'),
  inputs: [SEX_INPUT,
    { key: 'height', type: 'number', label: label('Height (for BSA)', '身高（算 BSA 用）'), unit: 'cm', dimension: 'height', optional: true, source: { kind: 'vital', loinc: HEIGHT_LOINC, vital: 'height' } },
    { key: 'weight', type: 'number', label: label('Weight (for BSA)', '體重（算 BSA 用）'), unit: 'kg', dimension: 'weight', optional: true, source: { kind: 'vital', loinc: WEIGHT_LOINC, vital: 'weight' } },
    echo('lvidd', 'LVIDd (LV end-diastolic diameter)', 'LVIDd（左心室舒張末期內徑）', 'mm'),
    echo('ivsd', 'IVSd (septum)', 'IVSd（室間隔）', 'mm'),
    echo('lvpwd', 'LVPWd (posterior wall)', 'LVPWd（後壁）', 'mm'),
    // Only what the report states: left blank, mass and RWT follow the dimensions above, so an edited dimension is never judged against a stale estimate.
    { ...echo('lvMassStated', 'LV mass (reported)', 'LV mass（報告值）', 'g'), key: 'lvMass' },
    echo('laVolume', 'LA volume', 'LA volume（左心房容積）', 'mL'),
    echo('lvmi', 'LV mass index (LVMI)', '左心室質量指數（LVMI）', 'g/m²'),
    echo('lavi', 'LA volume index (LAVI)', '左心房容積指數（LAVI）', 'mL/m²'),
    { ...echo('rwtStated', 'RWT (reported)', 'RWT（報告值）'), key: 'rwt' },
    echo('lvef', 'LVEF', '左心室射出分率（LVEF）', '%'),
    echo('trv', 'TR peak velocity (TR Vmax)', '三尖瓣逆流峰值速度（TR Vmax）', 'm/s'),
  ],
  coherence: { keys: ['lvidd', 'ivsd', 'lvpwd', 'lvMass', 'laVolume', 'lvmi', 'lavi', 'rwt', 'lvef', 'trv'], windowDays: 0 },
  compute(v): CalcResult | null {
    const positive = (key: string) => { const x = n(v, key); return x !== undefined && x > 0 ? x : undefined }
    const sex: EchoSex | undefined = v.sex === 'male' || v.sex === 'female' ? v.sex : undefined
    const bsa = duBoisBsa(positive('height'), positive('weight'))
    const lvidd = positive('lvidd'), ivsd = positive('ivsd'), lvpwd = positive('lvpwd')
    // A stated mass or RWT wins; otherwise both are derived from the dimensions as they stand now.
    const lvMass = positive('lvMass') ?? aseLvMass(lvidd, ivsd, lvpwd), laVolume = positive('laVolume')
    // A stated index wins; otherwise the raw value over Du Bois BSA.
    const statedLvmi = positive('lvmi'), statedLavi = positive('lavi')
    const values: Partial<Record<EchoChamberMetric, number>> = {
      lvidd, ivsd, lvpwd, lvMass,
      lvmi: statedLvmi ?? indexToBsa(lvMass, bsa), rwt: positive('rwt') ?? relativeWallThickness(lvpwd, lvidd), lvef: positive('lvef'),
      lavi: statedLavi ?? indexToBsa(laVolume, bsa), trv: positive('trv'),
    }
    if (laVolume === undefined && !ROWS.some(row => values[row.key] !== undefined)) return null

    const extra: CalcResult['extra'] = []
    const abnormal: string[] = [], needsSex: string[] = []
    let graded = 0, severe = false
    // The raw value its index came from rides on the index row; it gets a row of its own only without the index.
    const raw: Partial<Record<EchoChamberMetric, string>> = {
      lvmi: lvMass !== undefined ? ` [${fmt(lvMass, 1)} g]` : '',
      lavi: laVolume !== undefined ? ` [${fmt(laVolume, 1)} mL]` : '',
    }
    for (const row of ROWS) {
      if (row.key === 'lavi' && values.lavi === undefined && laVolume !== undefined) extra.push({ label: label('LA volume'), value: `${fmt(laVolume, 1)} mL` })
      const value = values[row.key]
      if (value === undefined || (row.key === 'lvMass' && values.lvmi !== undefined)) continue
      const shown = `${fmt(value, row.dp)}${row.unit ? ` ${row.unit}` : ''}`
      if (row.key === 'lvef') {
        const category = lvefCategory(value)
        graded++
        if (category) abnormal.push(row.name)
        extra.push({ label: category ? withGrade(row.name, category, true) : label(row.name), value: `${shown} (≥50)` })
        continue
      }
      const result = gradeEchoMetric(row.key, value, sex)!
      // A row waiting for sex is not graded yet, so it is not in the denominator.
      if (result.grade === 'needsSex') needsSex.push(row.name)
      else {
        graded++
        if (result.grade !== 'normal') { abnormal.push(row.name); if (result.grade === 'severe') severe = true }
      }
      extra.push({
        label: result.grade === 'normal' ? label(row.name) : withGrade(row.name, GRADE[result.grade], result.grade !== 'needsSex'),
        value: `${shown} (${rangeText(row.key, row.refDp, sex)})${raw[row.key] ?? ''}`,
      })
    }
    if (bsa !== undefined) extra.push({ label: label('BSA (Du Bois)', 'BSA（Du Bois）'), value: `${fmt(bsa, 2)} m²` })

    const notIndexed = [
      ...(statedLvmi === undefined && lvMass !== undefined && bsa === undefined ? ['LVMI'] : []),
      ...(statedLavi === undefined && laVolume !== undefined && bsa === undefined ? ['LAVI'] : []),
    ]
    const missing = notIndexed.length
      ? label(' (no BSA: not indexed)', '（缺 BSA）')
      : label('')
    // An abnormal LV geometry leads the summary line; a normal one adds nothing to read.
    const geometry = classifyLvGeometry(values.lvmi, values.rwt, sex)?.geometry
    const shape = geometry && geometry !== 'normal' && geometry !== 'needsSex' ? label(`${GEOMETRY[geometry].en} | `, `${GEOMETRY[geometry].zh}｜`) : label('')
    const sexNote = needsSex.length ? label(`; ${needsSex.length} need sex`, `；${needsSex.length} 項需性別`) : label('')
    const summary = !graded
      ? (needsSex.length ? label(`${needsSex.length} need sex`, `${needsSex.length} 項需性別`) : label('No measurement to grade', '無可分級的量測'))
      : abnormal.length ? label(`${shape.en}Outside range: ${abnormal.join(', ')}${sexNote.en}`, `${shape.zh}超出範圍：${abnormal.join('、')}${sexNote.zh}`)
      : needsSex.length ? label(`None outside range${sexNote.en}`, `未超出範圍${sexNote.zh}`)
      : label('All within reference range', '皆在參考範圍內')
    const interpretation = label(`${summary.en}${missing.en}`, `${summary.zh}${missing.zh}`)
    const notes = label('For reference only; the clinical reading prevails.', '僅供參考，以臨床判讀為準。')
    return {
      numericValue: abnormal.length,
      // ▲ ties the count to the flagged rows, so it does not read as a score.
      value: !graded ? '—' : abnormal.length ? `▲ ${abnormal.length} / ${graded}` : `0 / ${graded}`,
      interpretation,
      severity: !graded || (needsSex.length && !abnormal.length) ? undefined : severe ? 'high' : abnormal.length ? 'moderate' : 'normal',
      extra, notes,
    }
  },
  reference: 'Lang RM et al. Recommendations for cardiac chamber quantification by echocardiography in adults: an update from the ASE and the EACVI. J Am Soc Echocardiogr 2015;28:1–39.e14 (Eur Heart J Cardiovasc Imaging 2015;16:233–271). Nagueh SF et al. Recommendations for the evaluation of left ventricular diastolic function by echocardiography: an update from the ASE and the EACVI. J Am Soc Echocardiogr 2016;29:277–314 (TR velocity cut-off). LVEF categories: Bozkurt B et al. Universal definition and classification of heart failure. J Card Fail 2021;27:387–413. BSA: Du Bois D, Du Bois EF. Arch Intern Med 1916;17:863–871.',
}
