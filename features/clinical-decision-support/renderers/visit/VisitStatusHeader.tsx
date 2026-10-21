"use client"

import type { QueueRow } from './visit-decisions'
import type { VisitDecisionModel } from '../../types'

/**
 * A value's date as a clinician reads it beside the number: nothing for
 * today's, month-day within this year, the full date otherwise.
 */
export function displayDate(date: string | undefined, now: Date): string | undefined {
  if (!date) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return date
  const [, year, month, day] = match
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (`${year}-${month}-${day}` === today) return undefined
  return Number(year) === now.getFullYear() ? `${month}-${day}` : `${year}-${month}-${day}`
}

/**
 * The pack's sentence for where this patient stands — or, once everything
 * queued is recorded, its own words for that (`headlineWhenDecided`), with
 * what still needs the clinician outside the queue.
 */
export function visitStatusSentence(model: VisitDecisionModel, rows: readonly QueueRow[], stillToConfirm: number, isEnglish: boolean): { text: string; decided: boolean } {
  const allDecided = rows.length > 0 && rows.every((row) => !row.current)
  return allDecided && model.headlineWhenDecided
    ? { text: `${model.headlineWhenDecided}${stillToConfirm ? (isEnglish ? ` · ${stillToConfirm} still to confirm` : ` · 還有 ${stillToConfirm} 項需你確認`) : ''}`, decided: true }
    : { text: model.headline, decided: false }
}

/**
 * That sentence for a screen reader and the page's structure only. On screen
 * each decision says it for itself, the decided sentence heads the summary,
 * and the sentence opens the copied note (owner feedback 2026-09-30: the line
 * 「HFrEF（LVEF 57.2%，05-05）：首次評估」 need not take a row).
 */
export function VisitStatusLine({ model, sentence }: { model: VisitDecisionModel; sentence: string }) {
  return (
    <section
      className="sr-only"
      aria-labelledby="cdss-visit-headline"
      data-testid="cdss-visit-status"
      data-stage={model.stage}
      data-flags={model.flags?.join(' ') || undefined}
    >
      <h3 id="cdss-visit-headline">{sentence}</h3>
    </section>
  )
}
