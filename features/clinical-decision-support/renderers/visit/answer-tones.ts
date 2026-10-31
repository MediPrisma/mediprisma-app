import { cn } from '@/src/shared/utils/cn.utils'
import type { VisitAnswers, VisitAsk } from '../../types'

/**
 * What an answer means for the visit: a change that asks for action today
 * (喘變差, 體重增加, 有症狀／出血, 心絞痛更多), no change, a reassuring one (喘進步), and a
 * change that is neither (體重減少 — decongestion, or dehydration and wasting).
 * The label always says the same thing in words; colour never stands alone.
 */
export type AnswerTone = 'concern' | 'neutral' | 'reassuring' | 'change'

/**
 * The tone of each every-visit answer, typed against the pack's own answer
 * values: if the pack renames one, this stops compiling.
 */
const VISIT_ANSWER_TONES: { readonly [K in VisitAsk['id']]-?: Readonly<Record<NonNullable<VisitAnswers[K]>, AnswerTone>> } = {
  'dyspnoea-trend': { worse: 'concern', stable: 'neutral', better: 'reassuring' },
  'weight-trend': { up: 'concern', same: 'neutral', down: 'change' },
  'af-symptoms': { yes: 'concern', no: 'neutral' },
  bleeding: { yes: 'concern', no: 'neutral' },
  // 「更多」 goes to DP-00; 「較少」 and 「沒有」 are improvements, as 喘進步 is.
  'angina-trend': { more: 'concern', same: 'neutral', less: 'reassuring', none: 'reassuring' },
  // Whether a home reading exists says nothing about control by itself.
  'home-bp-measured': { yes: 'neutral', no: 'neutral' },
}

export function visitAnswerTone(id: VisitAsk['id'], value: string): AnswerTone {
  return (VISIT_ANSWER_TONES[id] as Readonly<Record<string, AnswerTone>>)[value] ?? 'neutral'
}

/*
 * DESIGN.md: one interaction blue for selection; red, amber and green only
 * for clinical risk, warning and success; shared tokens, restrained
 * backgrounds. So a chosen answer wears the page's own selected tint — the
 * `bg-primary/10 text-primary` every segmented choice uses — except where the
 * answer is itself a clinical state: a warning (喘變差, 體重增加) wears the
 * risk colour, an improvement (喘進步) the success green (clinician feedback
 * 2026-09-28: 「進步不是要綠色嗎」). The label says the same in words.
 */
const SELECTED = 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/10 dark:bg-primary/15'
const SELECTED_RISK = 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/10 dark:bg-destructive/20'
const SELECTED_GOOD = 'border-emerald-600/50 bg-emerald-50 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200'
/*
 * 體重減少 is neither: decongestion toward dry weight, or dehydration and
 * wasting. It wears the warning amber — 「look at which」 — apart from the
 * stable blue and clear of 變差's red (clinician question 2026-09-28: 「體重減少
 * 不確定是好的還壞的徵兆…用黃色或橘色這種跟穩定的藍色有區別的顏色？」).
 */
const SELECTED_CHANGE = 'border-amber-500/60 bg-amber-50 text-amber-900 hover:bg-amber-50 dark:border-amber-400/50 dark:bg-amber-500/15 dark:text-amber-200'
/*
 * Before one is chosen each answer's frame already carries its colour, on the
 * same ground as the others — so 變差 reads as the red one and 進步 as the
 * green one at a glance; choosing fills it in and sets the words in the
 * colour, bold (clinician feedback 2026-09-28: 「能沒選擇時就有一點顏色區隔
 * 嗎」, then 「沒選的時候可以只有外框有顏色，其他底色維持大家都一樣」).
 */
const IDLE_NEUTRAL = 'border-primary/40 bg-card text-foreground hover:bg-primary/5'
const IDLE_RISK = 'border-destructive/45 bg-card text-foreground hover:bg-destructive/5'
const IDLE_GOOD = 'border-emerald-600/45 bg-card text-foreground hover:bg-emerald-50/60 dark:border-emerald-400/40 dark:hover:bg-emerald-500/10'
const IDLE_CHANGE = 'border-amber-500/55 bg-card text-foreground hover:bg-amber-50/60 dark:border-amber-400/45 dark:hover:bg-amber-500/10'

const IDLE: Readonly<Record<AnswerTone, string>> = { concern: IDLE_RISK, neutral: IDLE_NEUTRAL, reassuring: IDLE_GOOD, change: IDLE_CHANGE }

const CHOSEN: Readonly<Record<AnswerTone, string>> = { concern: SELECTED_RISK, neutral: SELECTED, reassuring: SELECTED_GOOD, change: SELECTED_CHANGE }

/**
 * A choice button's colours at the page's own size (1px border, no icon):
 * open (its tone on the frame only), chosen (filled, bold), and — while it is the record's reading, not yet the
 * clinician's answer — chosen with a dashed border.
 */
export function answerToneClass(tone: AnswerTone, selected: boolean, prefilled = false): string {
  return cn(
    selected ? cn(CHOSEN[tone], 'font-semibold') : IDLE[tone],
    selected && prefilled && 'border-dashed',
  )
}
