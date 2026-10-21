"use client"

import { useId } from 'react'
import { cn } from '@/src/shared/utils/cn.utils'
import { effectiveAnswer } from './visit-decisions'
import { answerToneClass, visitAnswerTone } from './answer-tones'
import type { VisitAnswers, VisitAsk, VisitObservationId } from '../../types'

/**
 * Where each of today's answers was given: when, and on which disease's page
 * (its pack id and the page's name). Answers are kept per observation, not
 * per page, so a page that asks what another page already asked shows that
 * answer and says where it came from, rather than asking again.
 */
export type VisitAnswerProvenance = Readonly<Partial<Record<VisitObservationId, {
  answeredAt: string
  packId?: string
  pageLabel?: string
}>>>

function clockTime(iso: string): string | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * The questions asked at every visit. A value the record already holds is
 * shown selected and marked as the record's, with the pack's basis beside it;
 * it counts as answered, and one press replaces it. Pressing the chosen answer
 * again withdraws the clinician's answer, and the record's reading — if the
 * pack has one — stands again. An answer given today on another disease's
 * page is shown answered here, with where and when it was given; one press
 * changes it, for both pages.
 */
export function VisitAsks({
  asks,
  answers,
  isEnglish,
  onAnswer,
  pagePackId,
  sources,
  testId = 'cdss-visit-asks',
}: {
  asks: readonly VisitAsk[]
  answers: VisitAnswers
  isEnglish: boolean
  onAnswer?: (id: VisitAsk['id'], value: string | null) => void
  /** This page's pack, to tell an answer given here from one given elsewhere. */
  pagePackId?: string
  sources?: VisitAnswerProvenance
  /** A second copy on the page (the questions carried into 02 and 03) is told apart by its own. */
  testId?: string
}) {
  // Its own ids: the questions can be on the page twice, in 01 and carried
  // into the step the clinician is on, and each group names its own label.
  const idBase = useId()
  if (asks.length === 0) return null
  return (
    <section
      className="space-y-2"
      aria-label={isEnglish ? 'Asked at every visit' : '每次必問'}
      data-testid={testId}
    >
      {asks.map((ask) => {
        const { value, prefilled } = effectiveAnswer(ask, answers)
        const labelId = `${idBase}-ask-${ask.id}`
        // Only the clinician's own answer has a page it was given on; the
        // record's reading (a prefill) does not.
        const source = !prefilled && value ? sources?.[ask.id] : undefined
        const elsewhere = source?.packId && pagePackId && source.packId !== pagePackId
          ? { packId: source.packId, pageLabel: source.pageLabel, time: clockTime(source.answeredAt) }
          : undefined
        return (
          <div
            key={ask.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            data-visit-ask-row={ask.id}
            data-answered={value ? 'true' : 'false'}
          >
            <span id={labelId} className="min-w-[4.5rem] text-sm font-semibold text-foreground">
              {ask.label}
            </span>
            <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
              {ask.options.map((option) => {
                const selected = option.value === value
                const fromRecord = selected && prefilled
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={!onAnswer}
                    onClick={() => {
                      if (!onAnswer) return
                      // Pressing the clinician's own answer again withdraws it;
                      // pressing the record's reading confirms it as an answer.
                      onAnswer(ask.id, selected && !prefilled ? null : option.value)
                    }}
                    className={cn(
                      'inline-flex h-11 min-w-16 items-center justify-center rounded-md border px-3.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      'disabled:pointer-events-none disabled:opacity-60',
                      answerToneClass(visitAnswerTone(ask.id, option.value), selected, fromRecord),
                    )}
                    data-visit-ask={ask.id}
                    data-value={option.value}
                    data-prefilled={fromRecord ? 'true' : undefined}
                  >
                    {option.label}
                    {fromRecord ? (
                      <span className="sr-only">{isEnglish ? ' (from the record)' : '（紀錄預填）'}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {prefilled && ask.prefill ? (
              <span className="text-xs text-muted-foreground" data-visit-prefill-basis={ask.id}>
                {isEnglish ? 'Prefilled · ' : '預填 · '}
                {ask.prefill.basis}
              </span>
            ) : null}
            {elsewhere ? (
              <span className="text-xs text-muted-foreground" data-visit-answer-source={ask.id} data-source-pack={elsewhere.packId}>
                {isEnglish
                  ? `Answered on the ${elsewhere.pageLabel ?? elsewhere.packId} page${elsewhere.time ? ` · ${elsewhere.time}` : ''}`
                  : `已在「${elsewhere.pageLabel ?? elsewhere.packId}」頁回答${elsewhere.time ? ` · ${elsewhere.time}` : ''}`}
              </span>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
