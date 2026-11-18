import type { CalculatorDef } from '../types'
/** Rosendaal linear interpolation. Policy: 180-day window; do not bridge >56-day gaps.
 * The gap/window are explicit local analysis policies, not guideline thresholds.
 * No extrapolation before first or after last observation. Interruption dates are
 * not yet available, so a reported interruption suppresses the overall estimate.
 */
export function calculateAfTtr(input: {
  series: readonly { date: string; value: number }[]
  interrupted?: boolean
  mechanicalValve?: boolean
  prostheticValveRecord: boolean
  asOf?: string
}): {
  percent?: number
  belowPercent?: number
  abovePercent?: number
  evaluatedDays: number
  excludedDays: number
  reason?: string
  start?: string
  end?: string
} {
  const none = (reason: string) => ({ evaluatedDays: 0, excludedDays: 0, reason })
  if (input.mechanicalValve || (input.prostheticValveRecord && input.mechanicalValve !== false))
    return none('valve-target')
  if (input.interrupted !== false)
    return none(input.interrupted ? 'interruption' : 'confirm-continuity')
  const end = Date.parse(input.asOf ?? '')
  if (!Number.isFinite(end)) return none('date')
  const day = 86400000,
    start = end - 180 * day
  const byDate = new Map<number, number>()
  for (const r of input.series) {
    const d = Date.parse(r.date)
    if (!Number.isFinite(d) || d > end || !Number.isFinite(r.value) || r.value <= 0) continue
    if (byDate.has(d) && byDate.get(d) !== r.value) return none('conflicting-same-day')
    byDate.set(d, r.value)
  }
  const series = [...byDate.entries()].sort((a, b) => a[0] - b[0])
  let total = 0,
    below = 0,
    above = 0,
    excluded = 0
  let first: number | undefined, last: number | undefined
  for (let i = 1; i < series.length; i++) {
    const [d0, v0] = series[i - 1],
      [d1, v1] = series[i]
    const a = Math.max(start, d0),
      b = Math.min(end, d1)
    if (b <= a) continue
    if ((d1 - d0) / day > 56) {
      excluded += (b - a) / day
      continue
    }
    const va = v0 + ((v1 - v0) * (a - d0)) / (d1 - d0),
      vb = v0 + ((v1 - v0) * (b - d0)) / (d1 - d0)
    const cuts = [
      0,
      1,
      ...[2, 3].map((v) => (v - va) / (vb - va)).filter((t) => t > 0 && t < 1),
    ].sort((a, b) => a - b)
    for (let j = 1; j < cuts.length; j++) {
      const days = ((b - a) / day) * (cuts[j] - cuts[j - 1]),
        mid = va + ((vb - va) * (cuts[j] + cuts[j - 1])) / 2
      if (mid < 2) below += days
      else if (mid > 3) above += days
    }
    total += (b - a) / day
    first ??= a
    last = b
  }
  if (!total) return { ...none('insufficient-pairs'), excludedDays: excluded }
  return {
    percent: ((total - below - above) / total) * 100,
    belowPercent: (below / total) * 100,
    abovePercent: (above / total) * 100,
    evaluatedDays: total,
    excludedDays: excluded,
    start: new Date(first!).toISOString().slice(0, 10),
    end: new Date(last!).toISOString().slice(0, 10),
  }
}

export function calculateHasBled(inputs: Record<string, boolean | undefined>) {
  const score = Object.values(inputs).filter((v) => v === true).length
  const missingInputs = Object.keys(inputs).filter((k) => inputs[k] === undefined)
  return {
    numericValue: score,
    upperBound: score + missingInputs.length,
    complete: !missingInputs.length,
    missingInputs,
  }
}

/** Shared definition used by the calculator catalog and CDSS handoff tests. */
export const HAS_BLED: CalculatorDef = {
  id: 'has-bled',
  version: '1.1.0',
  name: { zh: 'HAS-BLED 出血風險分數', en: 'HAS-BLED Score' },
  category: 'cardiac',
  audience: 'medical',
  blurb: {
    zh: '保留未確認因子的出血風險評估。',
    en: 'Bleeding risk with unconfirmed factors retained.',
  },
  inputs: [
    ['htn', 'H：收縮壓 >160 mmHg', 'H: SBP >160 mmHg'],
    ['renal', '腎異常：透析／移植／Cr >2.26 mg/dL', 'Renal: dialysis/transplant/Cr >2.26 mg/dL'],
    [
      'liver',
      '肝異常：慢性肝病，或 bilirubin >2× 且 AST/ALT/ALP >3×ULN',
      'Liver: chronic disease, or bilirubin >2× AND AST/ALT/ALP >3×ULN',
    ],
    ['stroke', '中風病史（非單純 TIA／周邊栓塞）', 'Stroke (not isolated TIA/peripheral embolism)'],
    ['bleeding', '重大出血病史／出血傾向', 'Major bleeding history/predisposition'],
    ['inr', 'INR 不穩定（TTR <60%）', 'Labile INR (TTR <60%)'],
    ['elderly', '年齡 >65', 'Age >65'],
    ['drugs', '併用抗血小板／NSAID', 'Antiplatelet/NSAID'],
    ['alcohol', '酒精每週 >8 單位', 'Alcohol >8 units/week'],
  ].map(([key, zh, en]) => ({
    key,
    type: 'select',
    label: { zh, en },
    defaultValue: '',
    ...(key === 'elderly' ? { source: { kind: 'hfpefClinical' as const, key: 'ageOver65' as const } } : {}),
    ...(key === 'stroke' ? { source: { kind: 'hfpefClinical' as const, key: 'stroke' as const } } : {}),
    ...(key === 'liver' ? { source: { kind: 'hfpefClinical' as const, key: 'chronicLiverDisease' as const } } : {}),
    ...(key === 'htn' ? { source: { kind: 'hfpefClinical' as const, key: 'sbpOver160' as const } } : {}),
    ...(key === 'renal' ? { source: { kind: 'hfpefClinical' as const, key: 'hasBledRenal' as const } } : {}),
    ...(key === 'drugs' ? { source: { kind: 'hfpefClinical' as const, key: 'antiplateletNsaid' as const } } : {}),
    // Owner rule 2026-11-19: every item is presumed 「無」 unless the record shows it.
    presumed: key === 'elderly' ? undefined : 'no',
    options: [
      { value: 'yes', label: { zh: '是', en: 'Yes' } },
      { value: 'no', label: { zh: '否', en: 'No' } },
    ],
  })),
  compute: (v) => {
    const keys = [
      'htn',
      'renal',
      'liver',
      'stroke',
      'bleeding',
      'inr',
      'elderly',
      'drugs',
      'alcohol',
    ]
    const score = calculateHasBled(
      Object.fromEntries(
        keys.map((k) => [k, v[k] === 'yes' ? true : v[k] === 'no' ? false : undefined]),
      ),
    )
    return {
      value: score.complete
        ? `${score.numericValue} / 9`
        : `${score.numericValue}–${score.upperBound}`,
      numericValue: score.numericValue,
      completeness: {
        complete: score.complete,
        upperBound: score.upperBound,
        missingKeys: score.missingInputs,
      },
      interpretation: !score.complete
        ? { zh: '資料未齊 — 可能分數範圍', en: 'Incomplete — possible score range' }
        : score.numericValue >= 3
          ? {
              zh: '≥3：出血風險較高，修正因子並追蹤；不單憑分數取消抗凝。',
              en: '≥3: increased bleeding risk; address factors and follow up. Do not withhold OAC based only on score.',
            }
          : {
              zh: '持續修正出血風險與追蹤。',
              en: 'Continue risk-factor management and follow-up.',
            },
      severity:
        score.numericValue >= 3
          ? 'high'
          : !score.complete || score.numericValue === 2
            ? 'moderate'
            : 'normal',
    }
  },
  reference:
    'Pisters R et al. Chest 2010; ACC/AHA/ACCP/HRS AF 2023. A score alone does not contraindicate anticoagulation.',
}
