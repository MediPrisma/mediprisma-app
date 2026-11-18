// Shared helpers, question/answer factories, and reusable input fragments for
// the calculator definitions. Split out of the (large) definitions so each
// category file stays focused on its formulas.

import type { CalculatorDef, CalcValues, CalcInput, CalcResult, CalcCategory, CalcAudience, L } from '../types'

/** One yes/no item of a questionnaire; `scoreOn` is the answer worth 1 point. */
interface QItem {
  key: string
  label: L
  scoreOn: 'yes' | 'no'
  /** The answer filled when nothing says otherwise (see SelectInput.presumed). */
  presumed?: 'yes' | 'no'
}

/**
 * Build a yes/no questionnaire calculator (GDS-15, HAS-BLED, …). Each item is a
 * Yes/No select; the score sums items answered on their `scoreOn` side. Result
 * stays "answered / total" until every item is answered, then `interpret` runs.
 */
export function yesNoQuestionnaire(opts: {
  id: string
  name: L
  category: CalcCategory
  audience?: CalcAudience
  blurb?: L
  items: QItem[]
  interpret: (score: number, max: number) => CalcResult
  reference?: string
}): CalculatorDef {
  const yesNo = [
    { value: 'yes', label: { en: 'Yes', zh: '是' } },
    { value: 'no', label: { en: 'No', zh: '否' } },
  ]
  const inputs: CalcInput[] = opts.items.map((it) => ({
    key: it.key, type: 'select', label: it.label, options: yesNo, defaultValue: '', presumed: it.presumed,
  }))
  const { items } = opts
  return {
    id: opts.id, name: opts.name, category: opts.category, audience: opts.audience, blurb: opts.blurb,
    inputs,
    compute: (v) => {
      let score = 0
      let answered = 0
      for (const it of items) {
        const val = v[it.key]
        if (val === 'yes' || val === 'no') {
          answered += 1
          if (val === it.scoreOn) score += 1
        }
      }
      if (answered < items.length) {
        return { value: `${answered} / ${items.length}`, interpretation: { en: 'Answer all questions to score', zh: '請回答所有題目以計分' } }
      }
      return opts.interpret(score, items.length)
    },
    reference: opts.reference,
  }
}

/** One item of a scored (Likert / multi-choice) questionnaire. */
interface ScoredItem {
  key: string
  label: L
  /** Per-item options; falls back to the shared `scale` when omitted. */
  options?: { label: L; points: number }[]
  /** Index of the option filled when nothing says otherwise (see SelectInput.presumed). */
  presumed?: number
}

/**
 * Build a scored questionnaire where each item picks from a set of point-valued
 * options (PHQ-9, GAD-7, Epworth, AUDIT-C, GCS, Wells…). Items may share a
 * common `scale` or define their own `options`. Score sums the chosen points.
 */
export function scoredQuestionnaire(opts: {
  id: string
  name: L
  category: CalcCategory
  audience?: CalcAudience
  blurb?: L
  scale?: { label: L; points: number }[]
  items: ScoredItem[]
  interpret: (score: number) => CalcResult
  reference?: string
}): CalculatorDef {
  const optionsFor = (it: ScoredItem) => it.options ?? opts.scale ?? []
  const inputs: CalcInput[] = opts.items.map((it) => ({
    key: it.key,
    type: 'select',
    label: it.label,
    defaultValue: '',
    presumed: it.presumed === undefined ? undefined : String(it.presumed),
    options: optionsFor(it).map((o, i) => ({ value: String(i), label: o.label })),
  }))
  const { items } = opts
  return {
    id: opts.id, name: opts.name, category: opts.category, audience: opts.audience, blurb: opts.blurb,
    inputs,
    compute: (v) => {
      let score = 0
      let answered = 0
      for (const it of items) {
        const os = optionsFor(it)
        const raw = v[it.key]
        const idx = raw === '' || raw === undefined ? -1 : Number(raw)
        if (idx >= 0 && idx < os.length) {
          answered += 1
          score += os[idx].points
        }
      }
      if (answered < items.length) {
        return { value: `${answered} / ${items.length}`, interpretation: { en: 'Answer all items to score', zh: '請回答所有題目以計分' } }
      }
      return opts.interpret(score)
    },
    reference: opts.reference,
  }
}

// Shared Likert scale for PHQ-9 / GAD-7 ("over the last 2 weeks, how often…").
export const PHQ_SCALE = [
  { label: { en: 'Not at all', zh: '完全沒有' }, points: 0 },
  { label: { en: 'Several days', zh: '好幾天' }, points: 1 },
  { label: { en: 'More than half the days', zh: '一半以上天數' }, points: 2 },
  { label: { en: 'Nearly every day', zh: '幾乎每天' }, points: 3 },
]

// Epworth Sleepiness Scale chance-of-dozing scale.
export const EPWORTH_SCALE = [
  { label: { en: 'Would never doze', zh: '從不打瞌睡' }, points: 0 },
  { label: { en: 'Slight chance', zh: '很少' }, points: 1 },
  { label: { en: 'Moderate chance', zh: '中等機會' }, points: 2 },
  { label: { en: 'High chance', zh: '很可能' }, points: 3 },
]

/** A scored-questionnaire No/Yes item worth `points` when "Yes" (for Wells etc). */
export function ynItem(key: string, label: L, points: number, presume = true): ScoredItem {
  return {
    key,
    label,
    // Presumed 「否」: the clinician marks only what the patient has. A history
    // the record is not read for yet stays unanswered (`presume` false).
    ...(presume ? { presumed: 0 } : {}),
    options: [
      { label: { en: 'No', zh: '否' }, points: 0 },
      { label: { en: 'Yes', zh: '是' }, points },
    ],
  }
}

export function n(values: CalcValues, key: string): number | undefined {
  const raw = values[key]
  if (raw === undefined || raw === '') return undefined
  const v = parseFloat(raw)
  return Number.isFinite(v) ? v : undefined
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export function round(v: number, dp = 0): number {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

// ── Shared input fragments (auto-fill sources reused across calculators) ──────
export const SEX_INPUT = {
  key: 'sex',
  type: 'select' as const,
  label: { en: 'Sex', zh: '性別' },
  source: { kind: 'sex' as const },
  options: [
    { value: 'male', label: { en: 'Male', zh: '男' } },
    { value: 'female', label: { en: 'Female', zh: '女' } },
  ],
  // No default: when the patient's sex is unknown/other/absent the field stays
  // blank and sex-dependent formulas refuse to compute (via requireSex) rather
  // than silently assuming male.
  defaultValue: '',
}

/** Sex-dependent formulas must not silently assume male when sex is missing.
 *  Returns the confirmed sex, or null (→ compute returns null / no result). */
export function requireSex(v: CalcValues): 'male' | 'female' | null {
  return v.sex === 'male' || v.sex === 'female' ? v.sex : null
}
export const AGE_INPUT = {
  key: 'age',
  type: 'number' as const,
  label: { en: 'Age', zh: '年齡' },
  unit: 'y',
  source: { kind: 'age' as const },
}

// Weight / height sit outside the canonical lab map (vital signs), matched by
// LOINC. Multiple LOINCs cover the same vital across sources.
export const WEIGHT_LOINC = ['29463-7', '3141-9', '8341-0']
export const HEIGHT_LOINC = ['8302-2', '8306-3']
