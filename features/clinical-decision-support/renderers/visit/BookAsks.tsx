"use client"

import { useId } from 'react'
import { effectiveAnswer } from './visit-decisions'
import { carriedLabel, useCarriedLookup } from './carried-answer-context'
import type { VisitAnswerProvenance } from './VisitAsks'
import type { VisitAnswers, VisitAsk } from '../../types'
import styles from './VisitBookLayout.module.css'

/**
 * A class the clinician grades today beside the asks (the pack's optional
 * `examAsks`: HF's NYHA), read defensively — a pack from before it has none.
 */
export interface BookExamAsk {
  id: string
  label: string
  options: { value: string; label: string; detail?: string }[]
  answer?: string
  previous?: string
  note?: string
  usedBy?: { dp: string; label: string }[]
}

export function examAsksOf(model: object): BookExamAsk[] {
  const raw = (model as { examAsks?: unknown }).examAsks
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): BookExamAsk[] => {
    const { id, label, options, answer, previous, note, usedBy } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string' || !Array.isArray(options)) return []
    const parsed = options.flatMap((option) => {
      const { value, label: optionLabel, detail } = (option ?? {}) as Record<string, unknown>
      return typeof value === 'string' && typeof optionLabel === 'string'
        ? [{ value, label: optionLabel, ...(typeof detail === 'string' ? { detail } : {}) }]
        : []
    })
    if (!parsed.length) return []
    const uses = Array.isArray(usedBy)
      ? usedBy.flatMap((use) => {
        const { dp, label: useLabel } = (use ?? {}) as Record<string, unknown>
        return typeof dp === 'string' && typeof useLabel === 'string' ? [{ dp, label: useLabel }] : []
      })
      : []
    return [{
      id,
      label,
      options: parsed,
      ...(typeof answer === 'string' ? { answer } : {}),
      ...(typeof previous === 'string' ? { previous } : {}),
      ...(typeof note === 'string' ? { note } : {}),
      ...(uses.length ? { usedBy: uses } : {}),
    }]
  })
}

/**
 * The pocket-handbook page's every-visit questions (`?visit=book`): the pack's
 * asks, drawn as the prototype draws them — one row each, its answers one
 * segmented control — and, under them, what the pack asks the clinician to
 * grade today (HF's NYHA, each class with its meaning). The first visit
 * card's fuller questions were left off this page on 2026-09-30 (「原本的 UI
 * 跟問題那些都廢棄了，包含 DP03」); on 2026-10-02 the owner brought NYHA back
 * here and the other symptoms and signs back under DP-06, as the design canvas
 * 「決策地圖 v2 · 今日評估」 draws them (「NYHA 好像應該加回來？…這新的
 * prototype 很棒，請做」).
 *
 * The answers mean what they mean everywhere else: the record's reading (the
 * pack's prefill) stands selected with its basis, and one press makes it the
 * clinician's; pressing the clinician's own answer again withdraws it; an
 * answer given today on another disease's page shows here with where it was
 * given.
 */
export function BookAsks({
  asks,
  answers,
  isEnglish,
  onAnswer,
  pagePackId,
  sources,
  examAsks = [],
  onGrade,
}: {
  asks: readonly VisitAsk[]
  answers: VisitAnswers
  isEnglish: boolean
  onAnswer?: (id: VisitAsk['id'], value: string | null) => void
  pagePackId?: string
  sources?: VisitAnswerProvenance
  examAsks?: readonly BookExamAsk[]
  /** Writes a grade where the host keeps the clinic examination; `null` withdraws it. */
  onGrade?: (id: string, value: string | null) => void
}) {
  const idBase = useId()
  const carriedFrom = useCarriedLookup()
  if (asks.length === 0 && examAsks.length === 0) return null
  return (
    <div className={styles.asks} data-testid="cdss-book-asks">
      {asks.map((ask) => {
        const { value, prefilled } = effectiveAnswer(ask, answers)
        const labelId = `${idBase}-${ask.id}`
        const source = !prefilled && value ? sources?.[ask.id] : undefined
        const elsewhere = source?.packId && pagePackId && source.packId !== pagePackId ? source : undefined
        const carried = !prefilled && value ? carriedFrom(`visit:${ask.id}`) : null
        return (
          <div key={ask.id} className={styles.askRow} data-book-ask={ask.id} data-answered={value ? 'true' : 'false'}>
            <span id={labelId} className={styles.askLabel}>{ask.label}</span>
            <div role="group" aria-labelledby={labelId} className={styles.askGroup}>
              {ask.options.map((option) => {
                const selected = option.value === value
                const fromRecord = selected && prefilled
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={!onAnswer}
                    onClick={() => onAnswer?.(ask.id, selected && !prefilled ? null : option.value)}
                    data-book-ask-option={option.value}
                    data-prefilled={fromRecord ? 'true' : undefined}
                  >
                    {option.label}
                    {fromRecord ? <span className="sr-only">{isEnglish ? ' (from the record)' : '（紀錄預填）'}</span> : null}
                  </button>
                )
              })}
            </div>
            {prefilled && ask.prefill ? (
              <span className={styles.askNote}>{isEnglish ? 'From the record · ' : '紀錄帶入 · '}{ask.prefill.basis}</span>
            ) : carried ? (
              <span className={styles.carriedNote} data-carried-from={carried}>{carriedLabel(carried, isEnglish)}</span>
            ) : elsewhere ? (
              <span className={styles.askNote}>
                {isEnglish
                  ? `Answered on the ${elsewhere.pageLabel ?? elsewhere.packId} page`
                  : `已在「${elsewhere.pageLabel ?? elsewhere.packId}」頁回答`}
              </span>
            ) : null}
          </div>
        )
      })}
      {examAsks.map((ask) => {
        const labelId = `${idBase}-${ask.id}`
        const sep = isEnglish ? ', ' : '、'
        return (
          <div key={ask.id} className={styles.askRow} data-book-exam-ask={ask.id} data-answered={ask.answer ? 'true' : 'false'}>
            <span id={labelId} className={`${styles.askLabel} ${styles.askLabelTop}`}>{ask.label}</span>
            <div className={styles.gradeBody}>
              <div role="group" aria-labelledby={labelId} className={`${styles.askGroup} ${styles.gradeGroup}`}>
                {ask.options.map((option) => {
                  const selected = option.value === ask.answer
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      disabled={!onGrade}
                      onClick={() => onGrade?.(ask.id, selected ? null : option.value)}
                      data-book-grade-option={option.value}
                    >
                      <b>{option.label}</b>
                      {option.detail ? <span className={styles.gradeDetail}>{option.detail}</span> : null}
                    </button>
                  )
                })}
              </div>
              {ask.answer && carriedFrom(ask.id) ? (
                <span className={styles.carriedNote} data-carried-from={carriedFrom(ask.id) ?? undefined}>{carriedLabel(carriedFrom(ask.id) ?? '', isEnglish)}</span>
              ) : ask.previous ? <span className={styles.askNote}>{ask.previous}</span> : null}
              {ask.note || ask.usedBy?.length ? (
                <span className={styles.askNote}>
                  {ask.note ?? ''}
                  {ask.usedBy?.length ? (
                    <>
                      {isEnglish ? ' Read by ' : '會用在 '}
                      {ask.usedBy.map((use, index) => (
                        <span key={use.dp}>
                          {index > 0 ? sep : ''}
                          <span className={styles.dpTag}>{use.dp}</span> {use.label}
                        </span>
                      ))}
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
