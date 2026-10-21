"use client"

import { useId, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/src/shared/utils/cn.utils'
import type { PhysicianInputRequest } from '../physician-input-contract'
import { todayIsoDate } from '../stores/clinic-vitals.store'
import { diagnosisAnswer, diagnosisOptionOf } from './visit/physician-input'
import type {
  PhenotypeAnswer,
  PhenotypeAnswerChoice,
} from '../stores/phenotype-answer.store'

/**
 * The structured questions a card puts to the physician.
 *
 * Every clinical word here is the pack's — the heading, the three choices, the
 * confirm action — because a threshold restated in the host is a threshold that
 * drifts. This file owns placement, the control, and nothing else.
 *
 * An answer is not applied to the card it was given on. It is written to the
 * store, handed back as facts on the profile, and the whole pack recomputes, so
 * a physician who answers 「已知 <50%」 sees the HFrEF pathway open rather than
 * one card changing its mind.
 */

interface PhysicianInputRequestPanelProps {
  inline?: boolean
  requests: readonly PhysicianInputRequest[]
  recommendationId: string
  isEnglish: boolean
  /** What this patient has already been answered for, if anything. */
  answer?: PhenotypeAnswer
  onAnswer: (answer: PhenotypeAnswer) => void
  /**
   * The signs already ticked for this visit, by the option ids the pack uses.
   * They live with the clinic vitals rather than here, because the congestion
   * card offers the same three groups and a sign is one examination, not two.
   */
  selectedSymptoms?: readonly string[]
  onToggleSymptom?: (id: string, selected: boolean) => void
  now?: Date
}

function HfSuspicionRequest({
  request,
  answer,
  onAnswer,
  now,
  showDetail,
}: {
  request: PhysicianInputRequest
  answer?: PhenotypeAnswer
  onAnswer: (answer: PhenotypeAnswer) => void
  now: Date
  /** Inline, the question row already prints the record line. */
  showDetail: boolean
}) {
  const groupId = useId()
  // The clinician's own phenotype, else what the record answers, else their
  // 還不確定.
  const selected = (answer?.diagnosis ? diagnosisOptionOf(answer) : undefined)
    ?? request.recordedOptionId
    ?? answer?.hfSuspicion
  // A lone choice (HFrEF where the LVEF rules HFpEF out) is a press to
  // answer, not a radio with nothing beside it: the circle hides, the choice
  // reads as the button it is and ticks once chosen.
  const lone = request.options?.length === 1
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-xs font-semibold text-foreground">
        {request.label}
      </legend>
      {showDetail && request.detail ? <p className="mb-1.5 text-[11px] leading-4 text-muted-foreground" data-testid="cdss-hf-suspicion-detail">{request.detail}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {(request.options ?? []).map((option) => {
          const inputId = `${groupId}-${option.id}`
          const isSelected = selected === option.id
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={cn(
                'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                'focus-within:ring-2 focus-within:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/[0.06] text-foreground'
                  : lone
                    ? 'border-primary/60 bg-card text-primary shadow-sm hover:bg-primary/[0.06]'
                    : 'border-border bg-card text-foreground hover:bg-muted/40',
              )}
            >
              {lone && isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
              <input
                id={inputId}
                type="radio"
                name={groupId}
                value={option.id}
                checked={isSelected}
                className={lone ? 'sr-only' : 'h-3.5 w-3.5 shrink-0 accent-primary'}
                onChange={() => {
                  const next = diagnosisAnswer(option.id, answer, now)
                  if (next) onAnswer(next)
                }}
                data-testid={`cdss-hf-suspicion-option-${option.id}`}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function HfSymptomsRequest({
  request,
  isEnglish,
  selectedSymptoms,
  onToggleSymptom,
}: {
  request: PhysicianInputRequest
  isEnglish: boolean
  selectedSymptoms: readonly string[]
  onToggleSymptom: (id: string, selected: boolean) => void
}) {
  const groupId = useId()
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-xs font-semibold text-foreground">
        {request.label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {(request.options ?? []).map((option) => {
          const inputId = `${groupId}-${option.id}`
          const isSelected = selectedSymptoms.includes(option.id)
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={cn(
                'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                'focus-within:ring-2 focus-within:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/[0.06] text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted/40',
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                checked={isSelected}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
                onChange={(event) => onToggleSymptom(option.id, event.target.checked)}
                data-testid={`cdss-hf-symptom-${option.id}`}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {isEnglish
          ? 'Written into the congestion table as today’s examination, and read as the first ESC criterion on the diagnosis card. Nothing ticked is not a negative finding.'
          : '寫進鬱血證據表作為今天的檢查，診斷卡的第一個條件也讀同一筆。沒勾不等於陰性。'}
      </p>
    </fieldset>
  )
}

function isPhenotypeChoice(value: string): value is PhenotypeAnswerChoice {
  return value === 'reduced' || value === 'preserved' || value === 'unknown'
}

/** A percentage the physician could have read off a report. */
function parseLvef(value: string): number | undefined {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return undefined
  return parsed
}

function LvefPhenotypeRequest({
  request,
  recommendationId,
  isEnglish,
  answer,
  onAnswer,
  now,
}: {
  request: PhysicianInputRequest
  recommendationId: string
  isEnglish: boolean
  answer?: PhenotypeAnswer
  onAnswer: (answer: PhenotypeAnswer) => void
  now: Date
}) {
  const groupId = useId()
  const selected = answer?.choice
  const [lvefDraft, setLvefDraft] = useState(
    answer?.lvef === undefined ? '' : String(answer.lvef),
  )
  const [measuredOnDraft, setMeasuredOnDraft] = useState(answer?.measuredOn ?? '')

  // A different patient's chart is a different question, and a stored answer
  // can arrive after the first render, so the fields follow the answer they
  // belong to. Adjusted during render rather than in an effect: an effect would
  // paint the previous patient's value first and then correct it.
  const answerKey = `${recommendationId}|${answer?.lvef ?? ''}|${answer?.measuredOn ?? ''}`
  const [syncedAnswerKey, setSyncedAnswerKey] = useState(answerKey)
  if (syncedAnswerKey !== answerKey) {
    setSyncedAnswerKey(answerKey)
    setLvefDraft(answer?.lvef === undefined ? '' : String(answer.lvef))
    setMeasuredOnDraft(answer?.measuredOn ?? '')
  }

  const selectedOption = request.options?.find((option) => option.id === selected)
  const takesValue = selectedOption?.valueLabel !== undefined
  const draftLvef = parseLvef(lvefDraft)
  const valueChanged = draftLvef !== answer?.lvef
    || (measuredOnDraft || undefined) !== answer?.measuredOn

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-xs font-semibold text-foreground">
        {request.label}
      </legend>
      <div className="flex flex-col gap-1">
        {(request.options ?? []).map((option) => {
          const inputId = `${groupId}-${option.id}`
          const isSelected = selected === option.id
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={cn(
                'flex min-h-9 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed transition-colors',
                'focus-within:ring-2 focus-within:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/[0.06] text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted/40',
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={groupId}
                value={option.id}
                checked={isSelected}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                onChange={(event) => {
                  if (!isPhenotypeChoice(event.target.value)) return
                  onAnswer({
                    ...(answer ?? {}),
                    choice: event.target.value,
                    answeredOn: todayIsoDate(now),
                    // 「不清楚」 states nothing about the ejection fraction, so
                    // any value entered against an earlier choice is dropped
                    // rather than left attached to an answer that disclaims it.
                    ...(event.target.value === 'unknown'
                      ? { lvef: undefined, measuredOn: undefined }
                      : {}),
                  })
                }}
                data-testid={`cdss-lvef-phenotype-option-${option.id}`}
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          )
        })}
      </div>

      {takesValue && selectedOption ? (
        <div
          className="mt-2 flex flex-wrap items-end gap-2"
          data-testid="cdss-lvef-phenotype-value"
        >
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            <span>{selectedOption.valueLabel}</span>
            <span className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="decimal"
                min="1"
                max="100"
                step="1"
                value={lvefDraft}
                onChange={(event) => setLvefDraft(event.target.value)}
                className="h-8 w-20 px-2 text-sm tabular-nums md:text-sm"
                aria-label={isEnglish ? 'LVEF, percent' : 'LVEF（%）'}
                data-testid="cdss-lvef-phenotype-lvef"
              />
              <Input
                type="date"
                value={measuredOnDraft}
                onChange={(event) => setMeasuredOnDraft(event.target.value)}
                className="h-8 w-36 px-2 text-sm tabular-nums md:text-sm"
                aria-label={isEnglish ? 'Study date' : '檢查日期'}
                data-testid="cdss-lvef-phenotype-date"
              />
            </span>
          </label>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!valueChanged}
            onClick={() => onAnswer({
              ...(answer ?? {}),
              choice: selectedOption.id as PhenotypeAnswerChoice,
              answeredOn: todayIsoDate(now),
              lvef: draftLvef,
              measuredOn: measuredOnDraft || undefined,
            })}
            data-testid="cdss-lvef-phenotype-apply"
          >
            {isEnglish ? 'Apply' : '套用'}
          </Button>
        </div>
      ) : null}

      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {isEnglish
          ? 'Encrypted and kept for this tab session only, never written to the chart; carrying it to the next visit is phase 2. Every module that reads an ejection fraction recomputes from the answer.'
          : '加密保存於本分頁的工作階段，不寫回病歷；跨次就診沿用為第二階段。回答後，所有讀 LVEF 的模組都會重新判定。'}
      </p>
    </fieldset>
  )
}

function HfpEfConfirmationRequest({
  request,
  isEnglish,
  answer,
  onAnswer,
  now,
}: {
  request: PhysicianInputRequest
  isEnglish: boolean
  answer?: PhenotypeAnswer
  onAnswer: (answer: PhenotypeAnswer) => void
  now: Date
}) {
  const confirmed = answer?.hfpEfConfirmed === true
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirmed ? (
        <>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            data-testid="cdss-hfpef-confirmed"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
            {isEnglish
              ? 'Confirmed by you this visit'
              : '本次門診已由你確認'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            // Takes back the phenotype the confirmation wrote with it.
            onClick={() => onAnswer({
              ...(diagnosisAnswer('suspected', answer, now) ?? answer ?? {}),
              answeredOn: todayIsoDate(now),
              hfpEfConfirmed: false,
            })}
            data-testid="cdss-hfpef-unconfirm"
          >
            {isEnglish ? 'Undo' : '取消確認'}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          className="h-8"
          // The same diagnosis as DP-00 「HFpEF」, reached the long way.
          onClick={() => onAnswer(diagnosisAnswer('hfpef', answer, now)!)}
          data-testid="cdss-hfpef-confirm"
        >
          {request.label}
        </Button>
      )}
      <span className="text-[11px] leading-4 text-muted-foreground">
        {isEnglish
          ? 'Encrypted and kept for this tab session only; carrying it to the next visit is phase 2. Nothing is written to the chart or to any claim.'
          : '加密保存於本分頁的工作階段，跨次就診沿用為第二階段；不寫回病歷，也不做健保申報。'}
      </span>
    </div>
  )
}

export function PhysicianInputRequestPanel({
  inline = false,
  requests,
  recommendationId,
  isEnglish,
  answer,
  onAnswer,
  selectedSymptoms = [],
  onToggleSymptom,
  now = new Date(),
}: PhysicianInputRequestPanelProps) {
  if (requests.length === 0) return null
  return (
    <section
      className={inline ? "[&_legend]:sr-only" : "rounded-md border border-border bg-muted/[0.08] px-3 py-2.5"}
      aria-label={isEnglish ? 'Physician input' : '醫師輸入'}
      data-testid={`cdss-physician-input-${recommendationId}`}
    >
      <div className="flex flex-col gap-3">
        {requests.map((request) => {
          if (request.kind === 'hf-suspicion') {
            return (
              <HfSuspicionRequest
                key={request.kind}
                request={request}
                answer={answer}
                onAnswer={onAnswer}
                now={now}
                showDetail={!inline}
              />
            )
          }
          // Rendered only where the host can route the answer to the clinic
          // examination it belongs to; a tick with nowhere to go is worse than
          // no tick-list at all.
          if (request.kind === 'hf-symptoms') {
            if (!onToggleSymptom) return null
            return (
              <HfSymptomsRequest
                key={request.kind}
                request={request}
                isEnglish={isEnglish}
                selectedSymptoms={selectedSymptoms}
                onToggleSymptom={onToggleSymptom}
              />
            )
          }
          if (request.kind === 'lvef-phenotype') {
            return (
              <LvefPhenotypeRequest
                key={request.kind}
                request={request}
                recommendationId={recommendationId}
                isEnglish={isEnglish}
                answer={answer}
                onAnswer={onAnswer}
                now={now}
              />
            )
          }
          if (request.kind === 'hfpef-diagnosis-confirmation') {
            return (
              <HfpEfConfirmationRequest
                key={request.kind}
                request={request}
                isEnglish={isEnglish}
                answer={answer}
                onAnswer={onAnswer}
                now={now}
              />
            )
          }
          return null
        })}
      </div>
    </section>
  )
}
