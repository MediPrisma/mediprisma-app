"use client"

import { Check } from 'lucide-react'
import { cn } from '@/src/shared/utils/cn.utils'
import type { CriterionSummary, DiagnosticSummary } from '../physician-input-contract'

/**
 * How far the diagnosis has got, criterion by criterion.
 *
 * The clinician's own conclusion leads when they have reached one — it is the
 * answer to the question the card asks, and it outranks anything the record
 * added up to. Below it, ESC 2026's own reading of 「有多少把握」: where each
 * §5.2.2 criterion stands, and how many Table 10 parameters support the third.
 * Every word is the pack's; state is carried by text and an icon as well as
 * colour, because colour alone is not a state.
 */
export function DiagnosisReading({
  summary,
  isEnglish,
  showScores = true,
  showBasis = true,
}: {
  summary: DiagnosticSummary | undefined
  isEnglish: boolean
  /** The guideline paragraph under the criteria; a compact surface folds it elsewhere. */
  showBasis?: boolean
  /**
   * The visit flow prints the calculator's own score beside the criteria and
   * turns this off: the pack reads the same numbers off the host's facts, and
   * one score printed twice reads as two scores.
   */
  showScores?: boolean
}) {
  if (!summary) return null
  const stateStyle: Record<CriterionSummary['state'], string> = {
    met: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    refuted: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    undetermined: 'border-border bg-muted/40 text-muted-foreground',
  }
  const stateText: Record<CriterionSummary['state'], string> = {
    met: isEnglish ? 'met' : '成立',
    refuted: isEnglish ? 'contradicted' : '有反證',
    undetermined: isEnglish ? 'undetermined' : '無法判定',
  }
  return (
    <div className="space-y-1.5" data-testid="cdss-hf-diagnosis-reading">
      <p
        className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
        data-testid="cdss-hf-diagnosis-verdict"
        data-confirmed={summary.confirmedByClinician ? 'true' : undefined}
      >
        {summary.confirmedByClinician ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
        ) : null}
        {summary.verdict}
      </p>
      <ul className="flex flex-col items-start gap-1.5" data-testid="cdss-hf-diagnosis-criteria">
        {summary.criteria.map((criterion) => (
          <li
            key={criterion.id}
            className={cn(
              'inline-flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-4',
              stateStyle[criterion.state],
            )}
            data-testid={`cdss-hf-diagnosis-criterion-${criterion.id}`}
            data-state={criterion.state}
          >
            <span className="font-medium">{criterion.label}</span>
            <span>{stateText[criterion.state]}</span>
            {criterion.detail ? (
              <span className="tabular-nums opacity-80">{criterion.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {showBasis ? (
        <p className="text-[11px] leading-4 text-muted-foreground" data-testid="cdss-hf-diagnosis-basis">
          {summary.basis}
        </p>
      ) : null}
      {(showScores ? summary.scores ?? [] : []).map((score) => (
        <div
          key={score.name}
          className="rounded-md border border-border bg-muted/[0.12] px-2.5 py-2"
          data-testid={`cdss-hf-diagnosis-score-${score.name}`}
          data-floor={score.isFloor ? 'true' : undefined}
        >
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold text-foreground">{score.name}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {/* A floor is never shown as a bare number: the variables the
                  record could not supply can only have raised it. */}
              {score.isFloor ? '≥' : ''}
              {score.value} / {score.maximum}
            </span>
            <span className="text-muted-foreground">{score.bandLabel}</span>
          </p>
          {score.components && score.components.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-muted-foreground">
              {score.components.map((component) => (
                <li key={component.label}>
                  <span className="font-medium text-foreground">{component.label}</span>
                  {' · '}
                  {component.detail}
                </li>
              ))}
            </ul>
          ) : null}
          {score.isFloor && score.unmeasured ? (
            <p
              className="mt-1 text-[11px] leading-4 text-amber-800 dark:text-amber-300"
              data-testid={`cdss-hf-diagnosis-score-unmeasured-${score.name}`}
            >
              {isEnglish
                ? `Reported as a minimum: this record cannot supply ${score.unmeasured.join('; ')}. A missing variable can only have raised the score.`
                : `以下限呈現：本紀錄無法提供 ${score.unmeasured.join('、')}。缺的項目只會讓分數更高，不會更低。`}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{score.source}</p>
        </div>
      ))}
    </div>
  )
}
