"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Bug, Check, Database, ListChecks, LoaderCircle, Settings2, Sparkles } from 'lucide-react'
import { AiExecutionDiagnosticsDialog } from '@/src/shared/components/AiExecutionDiagnosticsDialog'
import { downloadAiExecutionDiagnostics } from '@/src/shared/utils/ai-execution-diagnostics'
import { locales } from '@/src/shared/i18n/i18n.config'
import { DataSelectionDrawer } from '@/features/data-selection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/src/shared/utils/cn.utils'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
import { ModelPicker } from '@/src/shared/components/ModelPicker'
import { useSecondTick } from '@/src/shared/hooks/use-second-tick.hook'
import type { ResourceNavTarget } from '@/src/application/stores/resource-navigation.store'
import { formatGenerationDuration } from '@/features/medical-summary/utils/summary-generation-info'
import { TherapyResponseChart } from './TherapyResponseChart'
import type { CdssCoverageCheck, CdssCoverageSummary, CdssFactSource } from '../types'
import {
  selectNhiLipidAiCriteria,
  type NhiLipidAiDecision,
  type NhiLipidAiSuggestion,
} from '../ai/nhi-lipid-ai-assist'
import {
  useNhiLipidAiAssist,
  type NhiLipidAiAssist,
} from '../hooks/use-nhi-lipid-ai-assist.hook'
import {
  useNhiLipidReviewProvenance,
  type NhiLipidAnswerProvenance,
  type NhiLipidAnswerProvenanceById,
} from '../stores/nhi-lipid-review.store'

/**
 * 表一 as the published table draws it, with this patient's position on it.
 *
 * Zero factors, low risk, and moderate risk divide their shared region equally,
 * with aligned targets and initiation thresholds above shared prescribing steps.
 * The three higher-risk tiers each retain their own criteria column. What
 * this adds is which criteria the record can speak to — lit — and which it
 * cannot, which stay open circles. An open circle is 「查不到」, never 「沒有」,
 * and that distinction is the whole reason the panel exists: a tier read one
 * row too low denies a covered statin, one row too high claims coverage the
 * record cannot support.
 *
 * Every string here comes from the pack, including each clause's bracket. The
 * only thing this file decides is where a criterion sits on screen.
 */

/** The 表一 columns, left to right, as the published table orders them. */
const COLUMNS = ['none', 'low', 'moderate', 'high', 'very-high', 'extreme'] as const

/** A single-hue ramp: order without implying clinical alarm. */
const TINT: Record<string, string> = {
  low: 'bg-primary/5',
  none: 'bg-primary/[0.025]',
  moderate: 'bg-primary/10',
  high: 'bg-primary/20',
  'very-high': 'bg-primary/30',
  extreme: 'bg-primary/45',
}

const MARK: Record<CdssCoverageCheck['state'], { glyph: string; lit: boolean }> = {
  yes: { glyph: '●', lit: true },
  no: { glyph: '–', lit: false },
  unknown: { glyph: '○', lit: false },
}

/** 表一 prints a number; the pack formats it. Read it back for the bar height. */
function threshold(initiation: string): number {
  const digits = initiation.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : 0
}

const ANSWER_LABEL: Record<CdssCoverageCheck['state'], [zh: string, en: string]> = {
  yes: ['符合', 'Met'],
  no: ['不符合', 'Not met'],
  unknown: ['未確認', 'Unconfirmed'],
}

type PrescribingStep = NonNullable<CdssCoverageSummary['tiers'][number]['prescribing']>[number]

/**
 * Pack evidence says "prescribed" even when dose, intensity or elapsed-time
 * details leave the whole Table 1 rung unresolved. Keep that useful medication
 * fact visually separate from the rung's clinical state.
 */
function hasCurrentMedication(step: PrescribingStep): boolean {
  const evidence = step.evidence?.trim() ?? ''
  return /^(處方中(?:：|。)|Prescribed(?:[:.]|$))|ezetimibe 處方中|Ezetimibe is prescribed/i.test(evidence)
}

type ProvenanceKind = 'record' | 'ai' | 'manual-modified' | 'manual-selected' | 'manual-reviewed'

const PROVENANCE_STYLE: Record<ProvenanceKind, string> = {
  'manual-reviewed': 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  record: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200',
  ai: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200',
  'manual-modified': 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  'manual-selected': 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
}

function ProvenanceBadge({
  kind,
  isEnglish,
  testId,
}: {
  kind: ProvenanceKind
  isEnglish: boolean
  testId?: string
}) {
  const label: Record<ProvenanceKind, [zh: string, en: string]> = {
    'manual-reviewed': ['醫師已覆核', 'Clinician reviewed'],
    record: ['自動帶入', 'Record autofill'],
    ai: ['AI 判讀', 'AI assessment'],
    'manual-modified': ['醫師修改', 'Clinician changed'],
    'manual-selected': ['醫師選擇', 'Clinician selected'],
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium leading-none',
        PROVENANCE_STYLE[kind],
      )}
      data-testid={testId}
    >
      <span aria-hidden="true">{kind === 'record' ? '●' : kind === 'ai' ? '✦' : kind === 'manual-modified' ? '↺' : '✓'}</span>
      {label[kind][isEnglish ? 1 : 0]}
    </span>
  )
}

/**
 * One 表一 criterion: a mark, the clause's label, and what the record says.
 *
 * The clause's bracket and the clinician's answer appear after an explicit
 * click or keyboard activation, so scanning across a dense table does not
 * repeatedly cover adjacent criteria with transient cards.
 * Twenty-six criteria each carrying three answer buttons is a screen that asks
 * everything and is read by nobody; the tier only moves on a few of them, and
 * those are the ones a clinician opens.
 */
function Criterion({
  check,
  isEnglish,
  onAnswer,
  aiSuggestion,
  aiDecision,
  answerProvenance,
  recordSources,
  onNavigate,
}: {
  check: CdssCoverageCheck
  isEnglish: boolean
  onAnswer?: (
    id: string,
    state: CdssCoverageCheck['state'] | undefined,
    provenance?: NhiLipidAnswerProvenance,
  ) => void
  aiSuggestion?: NhiLipidAiSuggestion
  aiDecision?: NhiLipidAiDecision
  answerProvenance?: NhiLipidAnswerProvenance
  recordSources?: readonly CdssFactSource[]
  onNavigate?: (target: ResourceNavTarget) => void
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const mark = MARK[check.state]
  const fromCode = check.state === 'yes' && check.origin === 'record'
  const aiApplied = answerProvenance?.source === 'ai'
  const manuallyChanged = answerProvenance?.source === 'manual'
  const provenanceKind: ProvenanceKind | undefined = aiApplied
    ? 'ai'
    : manuallyChanged
      ? answerProvenance?.manualAction === 'reviewed' ? 'manual-reviewed' : answerProvenance?.manualAction === 'selected' ? 'manual-selected' : 'manual-modified'
      : check.origin === 'record' && check.state !== 'unknown'
        ? 'record'
        : undefined
  const glyph = fromCode && !answerProvenance && check.evidenceKind !== 'measurement' ? '◐' : mark.glyph
  const states: readonly CdssCoverageCheck['state'][] = ['yes', 'no', 'unknown']
  const recordState = answerProvenance?.recordState
    ?? (check.origin === 'record' ? check.state : undefined)
  const overridesAi = answerProvenance?.source === 'ai' || answerProvenance?.overrides === 'ai'
  const reviewedAi = manuallyChanged
    && answerProvenance?.manualAction === 'reviewed'
    && answerProvenance?.overrides === 'ai'
  const retainsAiEvidence = aiApplied || reviewedAi
  const traceableRecordSources = check.origin === 'record' ? recordSources ?? [] : []
  const interactive = Boolean(onAnswer && check.editable)
    || Boolean(check.detail)
    || Boolean(retainsAiEvidence && aiSuggestion)
    || traceableRecordSources.length > 0
  const aiEvidenceCount = aiSuggestion?.evidence.length ?? 0
  const aiDisplayValue = retainsAiEvidence && aiSuggestion && aiSuggestion.state !== 'unknown'
    ? aiSuggestion.rationale || check.value
    : check.value
  const answerManually = (state: CdssCoverageCheck['state']) => {
    if (!onAnswer) return
    const confirmsRecordCode = !answerProvenance
      && check.origin === 'record'
      && check.evidenceKind === 'code'
      && check.state === 'yes'
      && state === check.state
    // Re-clicking an already reviewed answer is a no-op. The exception is a
    // record-code positive: clicking its preselected 「符合」 is the explicit
    // clinical confirmation the ◐ marker says is still missing.
    if (state === check.state && !confirmsRecordCode) return
    // Selecting the record's original value is a restore, not another manual
    // assertion. An AI override is the exception: choosing the record value is
    // still a clinician correction of that AI assessment and remains visible.
    // Confirming a record code is also not a restore: its value stays yes while
    // its evidence layer changes from claim support to explicit review.
    if (recordState !== undefined && state === recordState && !overridesAi && !confirmsRecordCode) {
      onAnswer(check.id, undefined)
      return
    }
    const manualAction = confirmsRecordCode || (!overridesAi && recordState === 'unknown')
      ? 'selected'
      : 'modified'
    onAnswer(check.id, state, {
      source: 'manual',
      manualAction,
      ...(recordState !== undefined ? { recordState } : {}),
      overrides: overridesAi ? 'ai' : 'record',
    })
  }

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('w-3 shrink-0 font-semibold', mark.lit ? 'text-primary' : 'text-muted-foreground/70')}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5 text-left">
        <span
          className={cn(
            'block',
            mark.lit ? 'font-medium text-foreground' : 'text-muted-foreground',
            (check.detail || (retainsAiEvidence && aiSuggestion) || traceableRecordSources.length > 0)
              && 'underline decoration-dotted decoration-muted-foreground/50 underline-offset-4',
          )}
        >
          {check.label}
        </span>
        <span className={cn('block text-xs tabular-nums', mark.lit ? 'text-primary' : 'text-muted-foreground')}>
          <span className="font-medium text-foreground">
            {isEnglish ? ANSWER_LABEL[check.state][1] : ANSWER_LABEL[check.state][0]}
          </span>
          {aiDisplayValue ? ` · ${aiDisplayValue}` : ''}
          {provenanceKind ? (
            <span className="ml-1 inline-block">
              <ProvenanceBadge
                kind={provenanceKind}
                isEnglish={isEnglish}
                testId={`nhi-criterion-provenance-${check.id}`}
              />
            </span>
          ) : null}
        </span>
        {aiSuggestion && aiSuggestion.state !== 'unknown' && aiEvidenceCount > 0 && (manuallyChanged || aiApplied || !aiDecision) ? (
          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {answerProvenance?.manualAction === 'reviewed'
              ? isEnglish ? 'Clinician reviewed this assessment' : '醫師已覆核此判讀'
              : manuallyChanged
              ? isEnglish
                ? `Clinician changed this to ${ANSWER_LABEL[check.state][1].toLowerCase()}`
                : `醫師已改為${ANSWER_LABEL[check.state][0]}`
              : isEnglish
                ? `AI assessed ${aiSuggestion.state === 'yes' ? 'met' : 'not met'} · included in tier`
                : `AI 判讀${aiSuggestion.state === 'yes' ? '符合' : '不符合'} · 已納入分級`}
            {!manuallyChanged || reviewedAi
              ? aiEvidenceCount > 0
                ? isEnglish
                  ? ` · ${aiEvidenceCount} source${aiEvidenceCount === 1 ? '' : 's'} · click to review`
                  : ` · ${aiEvidenceCount} 筆來源 · 點擊查看`
                : isEnglish ? ' · no traceable source' : ' · 缺少可回查來源'
              : null}
          </span>
        ) : null}
        {traceableRecordSources.length > 0 ? (
          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
            <Database className="h-3 w-3" aria-hidden="true" />
            {isEnglish
              ? `Record evidence · ${traceableRecordSources.length} source${traceableRecordSources.length === 1 ? '' : 's'} · click to review`
              : `自動帶入依據 · ${traceableRecordSources.length} 筆來源 · 點擊查看`}
          </span>
        ) : null}
      </span>
    </>
  )

  if (!interactive) {
    return <div className="flex gap-2 py-1.5 text-[13px] leading-relaxed">{body}</div>
  }

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
    >
      <PopoverTrigger
        className="flex w-full gap-2 rounded-sm py-1.5 text-[13px] leading-relaxed hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={check.label}
        onClick={(event) => {
          if (window.getSelection()?.toString()) event.preventDefault()
        }}
      >
        {body}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-3 text-xs leading-relaxed"
        data-testid={`nhi-criterion-popover-${check.id}`}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium">{check.label}</p>
          {check.detail ? <p className="text-muted-foreground">{check.detail}</p> : null}
          <p className="tabular-nums text-muted-foreground">{aiDisplayValue}</p>
        </div>
        {aiSuggestion && (aiApplied || manuallyChanged) ? (
          <div className="space-y-2 border-t border-border pt-2">
            <p className="font-medium">
              {isEnglish ? 'AI evidence' : 'AI 判讀依據'}
              {aiEvidenceCount > 0 ? ` · ${aiEvidenceCount}` : ''}
            </p>
            {aiSuggestion.rationale ? <p className="text-muted-foreground">{aiSuggestion.rationale}</p> : null}
            {aiSuggestion.evidence.map((evidence) => (
              <blockquote key={`${evidence.sourceKey}-${evidence.excerpt}`} className="space-y-1 border-l-2 border-primary/40 pl-2">
                <p>「{evidence.excerpt}」</p>
                {onNavigate ? (
                  <button
                    type="button"
                    className="min-h-8 text-left text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onNavigate({
                      resourceType: evidence.sourceResourceType,
                      resourceId: evidence.sourceResourceId,
                      display: evidence.sourceLabel,
                      date: evidence.date,
                      evidenceQuote: evidence.excerpt,
                    })}
                  >
                    {isEnglish ? 'Open source record' : '開啟原始病歷'} · {evidence.sourceLabel}{evidence.date ? ` · ${evidence.date}` : ''}
                  </button>
                ) : (
                  <footer className="text-muted-foreground">{evidence.sourceLabel}{evidence.date ? ` · ${evidence.date}` : ''}</footer>
                )}
              </blockquote>
            ))}
            {aiEvidenceCount === 0 ? (
              <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                {isEnglish
                  ? 'No source passage can be traced in the selected record. This result must not affect the tier; run the AI review again.'
                  : '在目前選定病歷中沒有可回查的原文；此結果不應影響分級，請重新執行 AI 判讀。'}
              </p>
            ) : null}
            {aiSuggestion.missing.length > 0 ? (
              <p className="text-muted-foreground">
                {isEnglish ? 'Still needed: ' : '仍需補充：'}{aiSuggestion.missing.join(isEnglish ? '; ' : '；')}
              </p>
            ) : null}
          </div>
        ) : null}
        {traceableRecordSources.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-2">
            <p className="font-medium">
              {isEnglish ? 'Record evidence' : '自動帶入依據'} · {traceableRecordSources.length}
            </p>
            {traceableRecordSources.map((source) => {
              const codingLabel = source.coding?.map((coding) => coding.display || coding.code).filter(Boolean).join('、')
              const sourceLabel = codingLabel || (typeof source.value === 'string' ? source.value : undefined) || check.label
              const sourceMeta = [source.resourceType, source.date, source.facility].filter(Boolean).join(' · ')
              return onNavigate ? (
                <button
                  key={`${source.resourceType}-${source.resourceId}`}
                  type="button"
                  className="block min-h-8 w-full rounded-sm border-l-2 border-primary/40 pl-2 text-left text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onNavigate({
                    resourceType: source.resourceType,
                    resourceId: source.resourceId,
                    display: sourceLabel,
                    date: source.date,
                  })}
                >
                  {isEnglish ? 'Open source record' : '開啟原始病歷'} · {sourceLabel}
                  {sourceMeta ? <span className="block text-muted-foreground no-underline">{sourceMeta}</span> : null}
                </button>
              ) : (
                <div key={`${source.resourceType}-${source.resourceId}`} className="border-l-2 border-primary/40 pl-2">
                  <p>{sourceLabel}</p>
                  {sourceMeta ? <p className="text-muted-foreground">{sourceMeta}</p> : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {onAnswer && check.editable ? (
          <div className="space-y-2 border-t border-border pt-2">
            <p className="text-muted-foreground">
              {isEnglish
                ? 'A change recalculates the tier immediately and overrides the AI assessment for this visit.'
                : '修改後立即重新計算分級，並覆蓋本次看診的 AI 判讀。'}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={check.label}>
              {states.map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={check.state === state}
                  onClick={() => answerManually(state)}
                  className={cn(
                    'min-h-11 flex-1 rounded-md border px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    check.state === state
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border hover:bg-muted/40',
                  )}
                >
                  {isEnglish ? ANSWER_LABEL[state][1] : ANSWER_LABEL[state][0]}
                </button>
              ))}
            </div>
            {check.origin === 'physician' ? (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onAnswer(check.id, undefined)}
              >
                {isEnglish ? 'Restore the record reading' : '恢復資料判讀'}
              </button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

const AI_STATE_LABEL: Record<NhiLipidAiSuggestion['state'], [zh: string, en: string]> = {
  yes: ['判讀符合', 'Assessed met'],
  no: ['判讀不符合', 'Assessed not met'],
  unknown: ['仍無法判斷', 'Still unknown'],
}

const AI_CONFIDENCE_LABEL: Record<NhiLipidAiSuggestion['confidence'], [zh: string, en: string]> = {
  high: ['高信心', 'High confidence'],
  medium: ['中信心', 'Medium confidence'],
  low: ['低信心', 'Low confidence'],
}

function AiSuggestionCard({
  suggestion,
  check,
  isEnglish,
  answerProvenance,
  onAnswer,
  onNavigate,
}: {
  suggestion: NhiLipidAiSuggestion
  check?: CdssCoverageCheck
  isEnglish: boolean
  answerProvenance?: NhiLipidAnswerProvenance
  onAnswer?: NhiTable1PanelProps['onAnswer']
  onNavigate?: (target: ResourceNavTarget) => void
}) {
  const clinicianChanged = answerProvenance?.source === 'manual'
  const included = suggestion.state !== 'unknown'
    && answerProvenance?.source === 'ai'
    && check?.state === suggestion.state
  return (
    <article
      className="space-y-1 border-b border-border py-2 last:border-b-0"
      data-testid={`nhi-lipid-ai-suggestion-${suggestion.criterionId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{check?.label ?? suggestion.criterionId}</p>
        <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
          {AI_STATE_LABEL[suggestion.state][isEnglish ? 1 : 0]}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {AI_CONFIDENCE_LABEL[suggestion.confidence][isEnglish ? 1 : 0]}
        </span>
      </div>
      <details className="text-xs">
        <summary className="min-h-9 cursor-pointer py-2 text-primary">{isEnglish ? 'Evidence' : '判讀依據'}</summary>
      {suggestion.rationale ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{suggestion.rationale}</p>
      ) : null}
      {suggestion.evidence.map((evidence) => (
        <blockquote
          key={`${evidence.sourceKey}-${evidence.excerpt}`}
          className="space-y-1 border-l-2 border-primary/40 pl-3 text-xs leading-relaxed"
        >
          <p>「{evidence.excerpt}」</p>
          <footer className="text-[11px] text-muted-foreground">
            {onNavigate ? (
              <button
                type="button"
                className="min-h-6 text-left text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onNavigate({
                  resourceType: evidence.sourceResourceType,
                  resourceId: evidence.sourceResourceId,
                  display: evidence.sourceLabel,
                  date: evidence.date,
                  evidenceQuote: evidence.excerpt,
                })}
              >
                {isEnglish ? 'Open source record' : '開啟原始病歷'} · {evidence.sourceLabel}{evidence.date ? ` · ${evidence.date}` : ''}
              </button>
            ) : (
              <>{evidence.sourceLabel}{evidence.date ? ` · ${evidence.date}` : ''}</>
            )}
          </footer>
        </blockquote>
      ))}
      </details>
      {answerProvenance?.manualAction === 'reviewed' ? (
        <p className="text-xs font-medium text-primary">{isEnglish ? 'Clinician reviewed this assessment.' : '醫師已覆核此判讀。'}</p>
      ) : clinicianChanged ? (
        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {isEnglish
            ? `Clinician changed this to ${check ? ANSWER_LABEL[check.state][1].toLowerCase() : 'another answer'}.`
            : `醫師已改為${check ? ANSWER_LABEL[check.state][0] : '其他答案'}。`}
        </p>
      ) : included ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Check className="h-4 w-4" aria-hidden="true" />
          {isEnglish ? 'Applied to the current assessment.' : '已套用至目前評估。'}
        </p>
      ) : null}
      {onAnswer && check?.editable ? (
        <details>
          <summary className="min-h-9 cursor-pointer py-2 text-xs text-primary">{isEnglish ? 'Change' : '修改'}</summary>
        <div className="flex flex-wrap gap-1.5 pt-2" role="group" aria-label={isEnglish ? `Review ${check.label}` : `覆核${check.label}`}>
          {(['yes', 'no', 'unknown'] as const).map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={check.state === state}
              className={cn(
                'min-h-11 flex-1 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                check.state === state ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-muted/40',
              )}
              onClick={() => onAnswer(check.id, state, {
                ...answerProvenance,
                source: 'manual',
                reviewedAt: state === check.state ? new Date().toISOString() : undefined,
                manualAction: state === check.state ? 'reviewed' : 'modified',
                recordState: answerProvenance?.recordState,
                overrides: 'ai',
              })}
            >
              {isEnglish ? ANSWER_LABEL[state][1] : ANSWER_LABEL[state][0]}
            </button>
          ))}
        </div>
        </details>
      ) : null}
    </article>
  )
}

function NhiLipidAiReview({
  ai,
  checks,
  reviewableCount,
  patientId,
  isEnglish,
  onAnswer,
  answerProvenance,
  onNavigate,
  reviewAction,
}: {
  reviewAction?: ReactNode
  ai: NhiLipidAiAssist
  checks: readonly CdssCoverageCheck[]
  reviewableCount: number
  patientId?: string
  isEnglish: boolean
  onAnswer?: (
    id: string,
    state: CdssCoverageCheck['state'] | undefined,
    provenance?: NhiLipidAnswerProvenance,
  ) => void
  answerProvenance?: NhiLipidAnswerProvenanceById
  onNavigate?: (target: ResourceNavTarget) => void
}) {
  const diagnostic = useAiExecutionDiagnosticsStore(state => state.records.filter(record => record.feature === 'nhi-lipid-ai-assist' && record.operationKey === `nhi-lipid-ai:${patientId ?? 'none'}`).at(-1))
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [dataScopeOpen, setDataScopeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const suggestions = ai.suggestions
  const decisions = ai.decisions
  const decide = ai.decide
  const checkById = useMemo(
    () => new Map(checks.map((check) => [check.id, check])),
    [checks],
  )
  const allSuggestions = Object.values(suggestions)
  const decisive = allSuggestions.filter((suggestion) => suggestion.state !== 'unknown')
    .sort((a, b) => Number(checkById.get(b.criterionId)?.state !== b.state)
      - Number(checkById.get(a.criterionId)?.state !== a.state))
  const unknown = allSuggestions.filter((suggestion) => (checkById.get(suggestion.criterionId)?.state ?? 'unknown') === 'unknown')
  const included = allSuggestions.filter(suggestion => checkById.get(suggestion.criterionId)?.state === 'yes')
  const notMet = allSuggestions.filter(suggestion => checkById.get(suggestion.criterionId)?.state === 'no')
  const unresolved = allSuggestions.length - included.length - notMet.length
  const clinicianChanged = allSuggestions.filter((suggestion) => (
    answerProvenance?.[suggestion.criterionId]?.source === 'manual'
    && answerProvenance?.[suggestion.criterionId]?.manualAction !== 'reviewed'
  ))
  const disabled = !patientId || !onAnswer || !ai.isDataReady || ai.isRunning || reviewableCount === 0
  const tick = useSecondTick(ai.isRunning)
  const runningStartedAt = ai.latestAttempt ? Date.parse(ai.latestAttempt.startedAt) : Number.NaN
  const runningDuration = ai.isRunning && Number.isFinite(runningStartedAt)
    ? formatGenerationDuration(Math.max(0, tick - runningStartedAt)) ?? '00:00'
    : undefined
  const completedStartedAt = ai.lastCompleted ? Date.parse(ai.lastCompleted.startedAt) : Number.NaN
  const completedAt = ai.lastCompleted?.completedAt ? Date.parse(ai.lastCompleted.completedAt) : Number.NaN
  const completedDuration = Number.isFinite(completedStartedAt) && Number.isFinite(completedAt)
    ? formatGenerationDuration(Math.max(0, completedAt - completedStartedAt))
    : undefined

  useEffect(() => {
    if (!onAnswer) return
    for (const suggestion of Object.values(suggestions)) {
      const provenance = answerProvenance?.[suggestion.criterionId]
      if (provenance?.source === 'manual' || decisions[suggestion.criterionId]) continue
      if (suggestion.state === 'unknown' || suggestion.evidence.length === 0) {
        if (provenance?.source === 'ai') onAnswer(suggestion.criterionId, undefined)
        continue
      }
      onAnswer(suggestion.criterionId, suggestion.state, {
        source: 'ai',
        recordState: checkById.get(suggestion.criterionId)?.state,
        modelId: suggestion.modelId,
        modelName: suggestion.modelName,
        generatedAt: suggestion.generatedAt,
        confidence: suggestion.confidence,
      })
      decide(suggestion.criterionId, 'applied')
    }
  }, [answerProvenance, checkById, decide, decisions, onAnswer, suggestions])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background" data-testid="nhi-lipid-ai-review">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="mr-auto min-w-fit">
          <p className="flex items-center gap-1.5 text-sm font-semibold leading-none">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {isEnglish ? 'AI-assisted evidence review' : 'AI 協助判讀'}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1.5 max-sm:basis-full">
          {ai.selectedModelId && ai.fallbackModelId && ai.selectModel ? (
            <ModelPicker
              modelId={ai.selectedModelId}
              fallbackModelId={ai.fallbackModelId}
              onSelect={ai.selectModel}
              disabled={ai.isRunning}
              compact
              tooltip={isEnglish ? 'Model for this AI evidence review' : '本次 AI 證據判讀使用的模型'}
              triggerClassName="min-h-11 min-w-0 flex-1 basis-24 text-xs shadow-none sm:max-w-[12rem] lg:min-h-8"
            />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={allSuggestions.length > 0 ? 'outline' : 'default'}
            disabled={disabled}
            className="min-h-11 shrink-0 gap-1.5 px-3 text-xs shadow-none hover:shadow-none lg:min-h-8"
            data-testid="nhi-lipid-ai-run"
            onClick={() => { void ai.run() }}
          >
            {ai.isRunning
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {ai.isRunning
              ? isEnglish ? 'Reviewing…' : 'AI 判讀中…'
              : allSuggestions.length > 0
                ? isEnglish ? 'Review again' : '重新判讀'
                : isEnglish ? 'Start AI review' : 'AI 協助判讀'}
          </Button>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={settingsOpen || dataScopeOpen ? 'secondary' : 'outline'}
                disabled={ai.isRunning}
                className="min-h-11 shrink-0 gap-1 px-2 text-xs shadow-none hover:shadow-none lg:min-h-8"
                aria-label={isEnglish ? 'AI review settings' : 'AI 判讀設定'}
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{isEnglish ? 'Settings' : '設定'}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-1 p-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 w-full justify-start gap-2 px-2 text-xs lg:min-h-8"
                onClick={() => {
                  setSettingsOpen(false)
                  setDataScopeOpen(true)
                }}
                disabled={!patientId}
              >
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                {isEnglish ? 'Data scope' : '資料範圍'}
              </Button>
              <div className="flex justify-end border-t pt-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={!diagnostic}
                  aria-label={isEnglish ? 'View AI execution details' : '查看 AI 執行紀錄'}
                  title={diagnostic
                    ? isEnglish ? 'View AI execution details' : '查看 AI 執行紀錄'
                    : isEnglish ? 'Run an AI review to view execution details' : '完成一次 AI 判讀後可查看執行紀錄'}
                  onClick={() => {
                    setSettingsOpen(false)
                    setDiagnosticsOpen(true)
                  }}
                  className="h-8 w-8 text-muted-foreground"
                >
                  <Bug className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-2 border-t border-border px-3 py-2.5 empty:hidden">
      {ai.isRunning && runningDuration ? (
        <p
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
          data-testid="nhi-lipid-ai-run-meta"
          role="timer"
          aria-live="off"
        >
          <span className="font-medium text-primary">{isEnglish ? 'Reviewing' : '判讀中'}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 max-w-48 truncate" title={ai.latestAttempt?.modelName ?? ai.modelName}>
            {ai.latestAttempt?.modelName ?? ai.modelName}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">
            {isEnglish ? `Elapsed ${runningDuration}` : `已等待 ${runningDuration}`}
          </span>
        </p>
      ) : !ai.isRunning && ai.lastCompleted && completedDuration ? (
        <p
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
          data-testid="nhi-lipid-ai-run-meta"
        >
          <span className="min-w-0 max-w-48 truncate" title={ai.lastCompleted.modelName ?? ai.modelName}>
            {ai.lastCompleted.modelName ?? ai.modelName}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">
            {isEnglish ? `Duration ${completedDuration}` : `耗時 ${completedDuration}`}
          </span>
        </p>
      ) : null}

      {!ai.isDataReady && patientId ? (
        <p className="text-xs text-muted-foreground" role="status">
          {isEnglish ? 'Preparing the selected clinical data…' : '正在準備目前選定的病歷資料…'}
        </p>
      ) : null}
      {ai.isRunning ? (
        <div className="space-y-1 text-xs text-muted-foreground" role="status" aria-live="polite">
          <p className="flex items-center gap-2">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {isEnglish ? 'Waiting for the model’s complete assessment…' : '已開始請求，等待模型回傳完整判讀…'}
          </p>
          {ai.latestAttempt?.inputSummary ? (
            <>
              <p>{isEnglish
                ? `Prepared ${ai.latestAttempt.inputSummary.criteriaCount} criteria and ${ai.latestAttempt.inputSummary.sourceCount} source records.`
                : `已整理 ${ai.latestAttempt.inputSummary.criteriaCount} 項表一條件、${ai.latestAttempt.inputSummary.sourceCount} 筆來源。`}</p>
              <p>{Object.entries(ai.latestAttempt.inputSummary.sourceCounts).map(([type, count]) => {
                const names: Record<string, string> = { Encounter: '就醫', MedicationRequest: '用藥', MedicationStatement: '用藥陳述', Observation: '檢驗／量測', DiagnosticReport: '檢查報告', DocumentReference: '病歷文件', Composition: '病歷文件', Condition: '診斷', Procedure: '處置', CarePlan: '照護計畫', Immunization: '疫苗' }
                return `${isEnglish ? type : names[type] ?? type} ${count}`
              }).join(' · ')}</p>
              {ai.latestAttempt.inputSummary.earliestDate ? <p>{isEnglish ? 'Source dates: ' : '來源日期：'}{ai.latestAttempt.inputSummary.earliestDate} ～ {ai.latestAttempt.inputSummary.latestDate}</p> : null}
            </>
          ) : null}
          <p>{isEnglish
            ? 'Next: verify source quotations, then apply supported answers. This request does not report per-criterion progress.'
            : '回覆後將核對原文引用，再帶入有證據的答案。目前模型不回報逐項進度。'}</p>
        </div>
      ) : null}
      {ai.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {ai.error}
        </p>
      ) : null}

      {ai.error && ai.lastCompleted ? (
        <p className="text-[11px] text-muted-foreground">
          {isEnglish
            ? `Showing the last completed review from ${ai.lastCompleted.completedAt ?? ai.lastCompleted.startedAt}; it was not replaced by the failed attempt.`
            : `目前保留 ${ai.lastCompleted.completedAt ?? ai.lastCompleted.startedAt} 完成的上次判讀；失敗的本次嘗試未覆蓋它。`}
        </p>
      ) : null}

      {reviewAction}

      <DataSelectionDrawer
        open={dataScopeOpen}
        onOpenChange={setDataScopeOpen}
        title={isEnglish ? 'AI review data scope' : 'AI 判讀資料範圍'}
        description={isEnglish ? 'Choose the clinical data included in this Table 1 AI review. This scope is independent from AI Summary.' : '選擇表一 AI 判讀要納入的病歷資料；此範圍獨立於 AI 摘要。'}
        applyHint={isEnglish ? 'Changes apply to the next review.' : '變更會套用至下一次判讀。'}
        modelId={ai.selectedModelId ?? ai.modelId}
        fallbackModelId={ai.fallbackModelId}
        consumer="nhiLipid"
      />
      <AiExecutionDiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} records={diagnostic ? [diagnostic] : []} labels={locales[isEnglish ? 'en' : 'zh-TW'].aiDiagnostics} onDownloadAll={() => { if (diagnostic) downloadAiExecutionDiagnostics('nhi-lipid-ai-assist', [diagnostic]) }} onDownloadRecord={() => { if (diagnostic) downloadAiExecutionDiagnostics('nhi-lipid-ai-assist', [diagnostic]) }} />

      {allSuggestions.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-xs font-medium">
            {isEnglish
              ? `${included.length} met · ${notMet.length} not met · ${unresolved} unknown · ${clinicianChanged.length} changed by the clinician.`
              : `${included.length} 項符合 · ${notMet.length} 項不符合 · ${unresolved} 項未確認 · ${clinicianChanged.length} 項醫師修改。`}
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-primary">{isEnglish ? 'Review findings and evidence' : '查看判讀結果與依據'}</summary>
          <div className="divide-y divide-border">
            {decisive.map((suggestion) => (
              <AiSuggestionCard
                key={suggestion.criterionId}
                suggestion={suggestion}
                check={checkById.get(suggestion.criterionId)}
                isEnglish={isEnglish}
                answerProvenance={answerProvenance?.[suggestion.criterionId]}
                onAnswer={onAnswer}
                onNavigate={onNavigate}
              />
            ))}
          </div>
          </details>
          {unknown.length > 0 ? (
            <details className="border-t border-border">
              <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-primary">
                {isEnglish ? `Why ${unknown.length} items remain unknown` : `查看 ${unknown.length} 項仍待補資料原因`}
              </summary>
              <div className="space-y-2 border-t border-border py-3">
                {unknown.map((suggestion) => (
                  <div key={suggestion.criterionId} className="text-xs leading-relaxed">
                    <p className="font-medium">{checkById.get(suggestion.criterionId)?.label ?? suggestion.criterionId}</p>
                    <p className="text-muted-foreground">
                      {suggestion.rationale}
                      {suggestion.missing.length > 0 ? ` ${suggestion.missing.join('；')}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

        </div>
      ) : null}
      </div>
    </div>
  )
}

export interface NhiTable1PanelProps {
  summary: CdssCoverageSummary
  locale: string
  patientId?: string
  onAnswer?: (
    id: string,
    state: CdssCoverageCheck['state'] | undefined,
    provenance?: NhiLipidAnswerProvenance,
  ) => void
  answerProvenance?: NhiLipidAnswerProvenanceById
  recordSources?: Readonly<Record<string, readonly CdssFactSource[]>>
  onNavigate?: (target: ResourceNavTarget) => void
  /** Development/review injection. Production omits this and uses the
   * patient-scoped connected wrapper below. */
  aiAssist?: NhiLipidAiAssist
}

function NhiTable1PanelContent({
  summary,
  locale,
  patientId,
  onAnswer,
  answerProvenance,
  recordSources,
  aiAssist,
  onNavigate,
}: NhiTable1PanelProps) {
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const preserveTierRef = useRef<{ tier: string; until: number } | null>(null)
  const isEnglish = locale === 'en'
  const allChecks = [...summary.factors, ...summary.metabolicChecks, ...summary.diseaseChecks]
  const tiers = COLUMNS.map((id) => summary.tiers.find((tier) => tier.id === id)).filter(
    (tier): tier is CdssCoverageSummary['tiers'][number] => Boolean(tier),
  )

  useEffect(() => {
    const viewport = tableScrollRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const keepPendingTierVisible = () => {
      const pending = preserveTierRef.current
      if (!pending || performance.now() > pending.until) return
      const anchor = viewport.querySelector<HTMLElement>(`[data-nhi-tier="${pending.tier}"]`)
      if (!anchor) return
      const viewportRect = viewport.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      const centeredOffset = anchorRect.left - viewportRect.left
        - ((viewportRect.width - anchorRect.width) / 2)
      viewport.scrollLeft += centeredOffset
    }
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(keepPendingTierVisible)
    })
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [tiers.length])

  if (tiers.length === 0) return null

  const pendingReview = [...new Map(allChecks.filter(check => check.editable).map(check => [check.id, check])).values()]
    .filter(check => check.editable && check.state !== 'unknown'
      && check.origin !== 'physician' && answerProvenance?.[check.id]?.source !== 'manual')
  const reviewedCount = Object.values(answerProvenance ?? {}).filter(item => item.manualAction === 'reviewed').length
  const reviewAction = onAnswer ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/40 px-2.5 py-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5 bg-background px-2.5 text-xs shadow-none hover:shadow-none lg:min-h-8"
            disabled={aiAssist?.isRunning || pendingReview.length === 0}
            onClick={() => {
              const reviewedAt = new Date().toISOString()
              for (const check of pendingReview) {
                const prior = answerProvenance?.[check.id]
                onAnswer(check.id, check.state, {
                  ...prior,
                  source: 'manual',
                  manualAction: 'reviewed',
                  reviewedAt,
                  recordState: prior?.recordState ?? check.state,
                  overrides: prior?.source === 'ai' ? 'ai' : 'record',
                })
              }
            }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {isEnglish ? 'Review current results' : '一鍵覆核目前結果'}
            {pendingReview.length > 0 ? `（${pendingReview.length}）` : ''}
          </Button>
          <p className="text-xs text-muted-foreground" role="status">
            {isEnglish
              ? `${reviewedCount} reviewed · Unknown items stay unknown.`
              : `已覆核 ${reviewedCount} 項 · 未確認項目維持原狀。`}
          </p>
        </div>
      ) : null

  const zeroFactorTier = tiers.find((tier) => tier.id === 'none')
  const compactZeroFactorTier = Boolean(zeroFactorTier && tiers.some((tier) => tier.id === 'low') && tiers.some((tier) => tier.id === 'moderate'))
  const primaryTiers = compactZeroFactorTier
    ? tiers.filter((tier) => tier.id !== 'none' && tier.id !== 'moderate')
    : tiers
  const tableGrid = compactZeroFactorTier
    ? 'grid-cols-[6rem_repeat(5,minmax(0,1fr))]'
    : 'grid-cols-[6rem_repeat(6,minmax(0,1fr))]'
  const tallest = Math.max(...tiers.map((tier) => threshold(tier.initiation)), 1)
  const selected = tiers.find((tier) => tier.selected)
  const lowerTiers = (['none', 'low', 'moderate'] as const)
    .map((id) => tiers.find((tier) => tier.id === id))
    .filter((tier): tier is CdssCoverageSummary['tiers'][number] => Boolean(tier))
  const lowerPrescribingShared = lowerTiers.length === 3
    && lowerTiers.every((tier) => (
      JSON.stringify((tier.prescribing ?? []).map((step) => step.text))
      === JSON.stringify((lowerTiers[0].prescribing ?? []).map((step) => step.text))
    ))
  const selectedLowerTier = lowerTiers.find((tier) => tier.selected)
  const lowerPrescribingSteps = (selectedLowerTier?.prescribing ?? lowerTiers[0]?.prescribing ?? [])
    .map((step) => selectedLowerTier ? step : { ...step, state: 'unknown' as const, evidence: undefined })
  // These rows are authored by the pack: latest LDL-C, this patient's
  // treatment goals, and the pack's attainment assessment. Keeping their
  // wording intact avoids re-deriving clinical meaning in the renderer.
  const clinicalSummaryRows = [3, 2, 5]
    .map((index) => summary.rows[index])
    .filter((row): row is CdssCoverageSummary['rows'][number] => Boolean(row))
  const actionPoints = summary.clinicianActionPoints
  const navigateToEvidence = onNavigate ? (target: ResourceNavTarget) => {
    onNavigate(target.resourceType === 'Observation'
      ? { ...target, reportView: 'cumulative' }
      : target)
  } : undefined
  const forTier = (id: string) => summary.diseaseChecks.filter((check) => check.tier === id)
  const groupsOf = (id: string) => {
    const checks = forTier(id)
    const order: string[] = []
    for (const check of checks) {
      const key = check.group ?? ''
      if (!order.includes(key)) order.push(key)
    }
    return order.map((key) => ({ key, checks: checks.filter((check) => (check.group ?? '') === key) }))
  }
  const criterionProps = (check: CdssCoverageCheck) => ({
    aiSuggestion: aiAssist?.suggestions[check.id],
    aiDecision: aiAssist?.decisions[check.id],
    answerProvenance: answerProvenance?.[check.id],
    recordSources: recordSources?.[check.id],
    onNavigate: navigateToEvidence ? (target: ResourceNavTarget) => {
      if (check.tier) {
        preserveTierRef.current = { tier: check.tier, until: performance.now() + 1_500 }
      }
      navigateToEvidence(target)
    } : undefined,
  })
  const prescribingStep = (
    step: PrescribingStep,
    showCurrentMedication: boolean,
  ) => {
    const medicationInUse = showCurrentMedication && hasCurrentMedication(step)
    return (
    <Popover key={step.text}>
      <PopoverTrigger
        data-current-medication={medicationInUse ? 'true' : undefined}
        className={cn(
          'flex w-full gap-1.5 rounded px-2 py-1 text-left text-xs leading-snug hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          medicationInUse
            ? 'bg-emerald-500/10 text-emerald-950 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/15 dark:text-emerald-100'
            : step.state === 'yes'
            ? 'bg-primary/10 font-medium text-foreground'
            : step.state === 'no'
              ? 'text-muted-foreground'
              : 'text-muted-foreground',
        )}
      >
        <span aria-hidden="true" className={cn('shrink-0 font-semibold', medicationInUse ? 'text-emerald-600 dark:text-emerald-400' : step.state === 'yes' ? 'text-primary' : 'text-muted-foreground/70')}>
          {MARK[step.state].glyph}
        </span>
        <span className="min-w-0">{step.text}</span>
        {medicationInUse ? (
          <Badge
            variant="outline"
            className="ml-auto shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
          >
            {isEnglish ? 'In use' : '使用中'}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-1 text-xs leading-relaxed">
        <p className="text-sm font-medium">{step.text}</p>
        {medicationInUse ? (
          <p className="rounded bg-emerald-500/10 px-2 py-1.5 font-medium text-emerald-800 dark:text-emerald-200">
            {isEnglish
              ? 'A related medication is currently prescribed. The marker below separately indicates whether the full rung is supported.'
              : '目前有相關藥物處方；是否符合這一階的強度、療程與血脂條件，仍依下方判讀。'}
          </p>
        ) : null}
        <p className="text-primary">
          {step.state === 'yes'
            ? isEnglish ? 'Supported by the record' : '紀錄支持走到這一階'
            : step.state === 'no'
              ? isEnglish ? 'Not shown as met in this record; not a contraindication' : '目前紀錄未顯示符合此步驟，不代表禁用或不建議'
              : isEnglish ? 'The record cannot say' : '紀錄無法判讀'}
        </p>
        {step.evidence ? <p className="text-muted-foreground">{step.evidence}</p> : null}
      </PopoverContent>
    </Popover>
    )
  }

  return (
    <section className="space-y-3 px-3 pb-4" aria-label={summary.title} data-testid="nhi-table1-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">{summary.conclusion}</p>
        <a
          className="text-xs text-primary underline underline-offset-2"
          href={summary.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {summary.source}
        </a>
      </div>

      {clinicalSummaryRows.length > 0 ? (
        <dl className="grid gap-x-5 gap-y-1 text-xs sm:grid-cols-3" data-testid="nhi-table1-clinical-summary">
          {clinicalSummaryRows.map((row) => (
            <div key={row.label} className="flex min-w-0 gap-2 sm:block">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="break-words font-medium tabular-nums sm:mt-0.5">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {actionPoints.length > 0 ? (
        <section
          className="space-y-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2.5"
          aria-label={isEnglish ? 'Suggested actions' : '建議處置'}
          data-testid="nhi-table1-action-points"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {isEnglish ? 'Suggested actions' : '建議處置'}
          </p>
          <dl className="grid gap-2 text-xs lg:grid-cols-3">
            {actionPoints.map((action) => (
              <div
                key={action.id}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2"
                data-action-id={action.id}
                data-action-kind={action.kind}
              >
                <dt className="rounded bg-background px-1.5 py-0.5 font-medium text-primary ring-1 ring-inset ring-primary/20">
                  {action.label}
                </dt>
                <dd className="break-words leading-relaxed text-foreground">{action.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium text-muted-foreground">{isEnglish ? 'Status' : '狀態'}</span>
        <span><span className="font-semibold text-primary">●</span> {isEnglish ? 'Met' : '符合'}</span>
        <span><span className="font-semibold text-primary">◐</span> {isEnglish ? 'Claims record (diagnosis code or prescription); confirm clinically' : '申報紀錄（診斷碼或處方）支持，須臨床確認'}</span>
        <span className="text-muted-foreground"><span className="font-semibold">○</span> {isEnglish ? 'Not in the record — unknown, not absent' : '紀錄讀不到 — 未知，不等於沒有'}</span>
        <span className="text-muted-foreground"><span className="font-semibold">–</span> {isEnglish ? 'Not met' : '不符合'}</span>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <span className="font-medium text-muted-foreground">{isEnglish ? 'Source' : '來源'}</span>
        <ProvenanceBadge kind="record" isEnglish={isEnglish} />
        <ProvenanceBadge kind="ai" isEnglish={isEnglish} />
        <ProvenanceBadge kind="manual-modified" isEnglish={isEnglish} />
        <ProvenanceBadge kind="manual-selected" isEnglish={isEnglish} />
      </div>

      {aiAssist ? (
        <NhiLipidAiReview
          ai={aiAssist}
          checks={allChecks}
          reviewableCount={selectNhiLipidAiCriteria(allChecks).length}
          patientId={patientId}
          isEnglish={isEnglish}
          onAnswer={onAnswer}
          answerProvenance={answerProvenance}
          onNavigate={navigateToEvidence}
          reviewAction={reviewAction}
        />
      ) : null}

      {!aiAssist ? reviewAction : null}

      <div ref={tableScrollRef} className="overflow-x-auto" data-testid="nhi-table1-scroll" tabIndex={0} aria-label={isEnglish ? 'Complete NHI Table 1; scroll horizontally for all risk groups' : '完整健保表一；可水平捲動查看所有風險分級'}>
        <p className="sticky left-0 mb-2 w-fit text-[11px] text-muted-foreground">
          {isEnglish ? 'Scroll horizontally to compare all risk groups →' : '向右捲動可對照所有風險分級 →'}
        </p>
        <div className="min-w-[78rem] space-y-3">
        <div className={cn('grid gap-2', tableGrid)}>
          <div className="self-end pb-2 pr-2 text-right text-xs font-medium leading-snug">
            {isEnglish ? 'Criteria' : '表一條件'}
          </div>
          {primaryTiers.map((tier) => tier.id === 'low' && compactZeroFactorTier ? (
            <div
              key="lower-tiers"
              className="col-span-2 grid grid-cols-3 gap-2"
              data-testid="nhi-zero-tier-compact"
            >
              {lowerTiers.map((baseTier) => (
                <div
                  key={baseTier.id}
                  data-nhi-tier={baseTier.id}
                  aria-label={baseTier.label}
                  className={cn(
                    'flex min-w-0 flex-col items-center justify-center rounded-t-md bg-card px-1.5 py-2 text-center',
                    TINT[baseTier.id],
                    baseTier.selected && 'ring-2 ring-inset ring-primary',
                  )}
                >
                  <span className="text-base font-semibold leading-tight">
                    {baseTier.id === 'none' ? (isEnglish ? '0 factors' : '0 項') : baseTier.label}
                  </span>
                  {baseTier.id === 'none' ? (
                    <span className="text-[10px] font-medium leading-tight text-muted-foreground">
                      {isEnglish ? 'risk factors' : '風險因子'}
                    </span>
                  ) : null}
                  {baseTier.selected ? (
                    <span className="mt-1 rounded border border-primary bg-background px-1 py-0.5 text-[10px] font-medium leading-none text-primary">
                      {baseTier.status}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div
              key={tier.id}
              data-nhi-tier={tier.id}
              className={cn(
                'rounded-t-md px-3 py-2 text-center text-base font-semibold',
                TINT[tier.id],
                tier.selected && 'ring-2 ring-inset ring-primary',
              )}
            >
              {tier.label}
              {tier.selected ? (
                <span className="ml-2 rounded border border-primary bg-background px-1.5 py-0.5 align-middle text-[11px] font-medium text-primary">
                  {tier.status}
                </span>
              ) : null}
            </div>
          ))}

          <div aria-hidden="true" />
          <div className={cn('space-y-2 rounded-b-md border border-t-0 border-border bg-card p-3', compactZeroFactorTier ? 'col-span-2' : 'col-span-3')}>
            <p className="text-center text-xs font-medium leading-relaxed">
              {isEnglish
                ? 'Confirmed zero, one, and two or more risk factors correspond to no-risk-factor, low-risk, and moderate-risk rows.'
                : '確認 0 項、1 項、2 項以上風險因子，分別對應 0 項、低風險與中風險；未查到不等於 0 項。'}
            </p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {summary.factors.map((check) => (
                <Criterion key={check.id} check={check} isEnglish={isEnglish} onAnswer={onAnswer} {...criterionProps(check)} />
              ))}
            </div>
            <details open className="border-t border-border pt-1">
              <summary className="min-h-11 cursor-pointer py-2 text-xs font-medium text-primary">
                {isEnglish ? 'Metabolic syndrome components' : '代謝性症候群五項細節'}
              </summary>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {summary.metabolicChecks.map((check) => (
                  <Criterion key={check.id} check={check} isEnglish={isEnglish} onAnswer={onAnswer} {...criterionProps(check)} />
                ))}
              </div>
            </details>
          </div>

          {(['high', 'very-high', 'extreme'] as const).map((id) => (
            <div key={id} className="space-y-1 rounded-b-md border border-t-0 border-border bg-card p-3">
              {groupsOf(id).map((group) => (
                <div key={group.key} className="space-y-0.5">
                  {group.key ? (
                    <p className="pt-1 text-xs font-semibold leading-snug">{group.key}</p>
                  ) : null}
                  {group.checks.map((check) => (
                    <Criterion key={check.id} check={check} isEnglish={isEnglish} onAnswer={onAnswer} {...criterionProps(check)} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
          <div className="space-y-2">
          <div className={cn('grid items-end gap-2', tableGrid)}>
            <p className="pb-1 pr-2 text-right text-xs font-medium leading-snug">
              {isEnglish ? <>LDL-C<br />goal</> : '治療目標值'}
              <span className="block font-normal text-muted-foreground">mg/dL</span>
            </p>
            {primaryTiers.map((tier) => tier.id === 'low' && compactZeroFactorTier ? (
              <div key="lower-tiers" className="col-span-2 grid grid-cols-3 items-end gap-2">
                {lowerTiers.map((baseTier) => (
                  <div key={baseTier.id} className="flex min-w-0 flex-col items-center gap-1">
                    <span className={cn('text-center tabular-nums', baseTier.selected && 'text-primary')}>
                      <span className="block text-[10px] font-medium text-muted-foreground">
                        {baseTier.id === 'none' ? (isEnglish ? '0 factors' : '0 項') : 'LDL-C'}
                      </span>
                      <span className="block text-lg font-bold">{baseTier.target.split(' / ')[0]}</span>
                      <span className="block text-[10px] leading-tight">
                        non-HDL-C {baseTier.target.split(' / ')[1] ?? '—'}
                      </span>
                    </span>
                    <div
                      className={cn('w-full rounded-t border border-border', TINT[baseTier.id], baseTier.selected && 'ring-2 ring-inset ring-primary')}
                      style={{ height: `${Math.round((threshold(baseTier.initiation) / tallest) * 108)}px` }}
                    />
                    <span className={cn('text-center text-[10px] leading-tight tabular-nums', baseTier.selected ? 'font-medium text-primary' : 'text-muted-foreground')}>
                      {baseTier.targetMet === undefined
                        ? isEnglish ? 'No LDL-C' : '無 LDL-C'
                        : baseTier.targetMet
                          ? isEnglish ? 'At goal' : '已達標'
                          : isEnglish ? 'Above goal' : '未達標'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div key={tier.id} className="flex flex-col items-center gap-1">
                <span className={cn('text-center tabular-nums', tier.selected && 'text-primary')}>
                  <span className="block text-[11px] font-medium text-muted-foreground">LDL-C</span>
                  <span className="block text-xl font-bold">{tier.target.split(' / ')[0]}</span>
                  <span className="block text-[11px]">
                    non-HDL-C {tier.target.split(' / ')[1] ?? '—'}
                  </span>
                </span>
                <div
                  className={cn('w-full rounded-t border border-border', TINT[tier.id], tier.selected && 'ring-2 ring-inset ring-primary')}
                  style={{ height: `${Math.round((threshold(tier.initiation) / tallest) * 108)}px` }}
                />
                <span className={cn('text-[11px] tabular-nums', tier.selected ? 'font-medium text-primary' : 'text-muted-foreground')}>
                  {tier.targetMet === undefined
                    ? isEnglish ? 'No LDL-C on record' : '紀錄無 LDL-C'
                    : tier.targetMet
                      ? isEnglish ? 'At goal' : '已達標'
                      : isEnglish ? 'Above goal' : '未達標'}
                </span>
              </div>
            ))}
          </div>

          <div className={cn('grid items-stretch gap-2', tableGrid)}>
            <p className="pt-2 pr-2 text-right text-xs font-medium leading-snug">
              {isEnglish ? <>Drug<br />initiation</> : <>起始藥物<br />治療血脂值</>}
            </p>
            {primaryTiers.map((tier) => tier.id === 'low' && compactZeroFactorTier ? (
              <div key="lower-tiers" className="col-span-2 grid grid-cols-3 items-end gap-2">
                {lowerTiers.map((baseTier) => (
                  <div
                    key={baseTier.id}
                    className={cn(
                      'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-2',
                      baseTier.selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30',
                    )}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {baseTier.id === 'none' ? (isEnglish ? '0 factors' : '0 項') : baseTier.label}
                    </span>
                    <span className={cn('text-sm font-semibold tabular-nums', baseTier.selected && 'text-primary')}>
                      {baseTier.initiation}
                    </span>
                    <span className={cn('text-center text-[10px] leading-tight tabular-nums', baseTier.selected ? 'font-medium text-primary' : 'text-muted-foreground')}>
                      {baseTier.initiationReached === undefined
                        ? '—'
                        : baseTier.initiationReached
                          ? isEnglish ? 'Reached' : '已達起始值'
                          : isEnglish ? 'Not reached' : '未達起始值'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                key={tier.id}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-md border px-2 py-2',
                  tier.selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30',
                )}
              >
                <span className={cn('text-base font-semibold tabular-nums', tier.selected && 'text-primary')}>
                  {tier.initiation}
                </span>
                <span className={cn('text-[11px] tabular-nums', tier.selected ? 'font-medium text-primary' : 'text-muted-foreground')}>
                  {tier.initiationReached === undefined
                    ? '—'
                    : tier.initiationReached
                      ? isEnglish ? 'Reached' : '已達起始值'
                      : isEnglish ? 'Not reached' : '未達起始值'}
                </span>
              </div>
            ))}
          </div>

          <div className={cn('grid items-stretch gap-2', tableGrid)}>
            <p className="pt-2 pr-2 text-right text-xs font-medium leading-snug">
              {isEnglish ? 'Prescribing' : '處方規定'}
              <span className="block font-normal text-primary">
                {isEnglish ? 'Blue = record-supported' : '藍＝紀錄支持'}
              </span>
              <span className="block font-normal text-emerald-700 dark:text-emerald-300">
                {isEnglish ? 'Green = current medication' : '綠＝目前用藥'}
              </span>
            </p>
            {lowerPrescribingShared ? (
              <div
                className={cn(
                  'col-span-2 space-y-1 rounded-md border p-2',
                  selectedLowerTier ? 'border-primary bg-card' : 'border-border bg-muted/30',
                )}
                data-testid="nhi-lower-tier-prescribing"
              >
                <p className={cn('px-2 pb-1 text-[10px] font-medium', selectedLowerTier ? 'text-primary' : 'text-muted-foreground')}>
                  {isEnglish
                    ? 'Shared by 0 factors, low risk, and moderate risk; highlighting follows the current tier'
                    : '0 項、低風險與中風險共用；亮起狀態依目前分級'}
                </p>
                {lowerPrescribingSteps.map(step => prescribingStep(step, Boolean(selectedLowerTier)))}
              </div>
            ) : null}
            {primaryTiers
              .filter((tier) => !lowerPrescribingShared || (tier.id !== 'low' && tier.id !== 'moderate'))
              .map((tier) => (
              <div
                key={tier.id}
                className={cn(
                  'space-y-1 rounded-md border p-2',
                  tier.selected ? 'border-primary bg-card' : 'border-border bg-muted/30',
                )}
              >
                {(tier.prescribing ?? []).map(step => prescribingStep(step, tier.selected))}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      {summary.therapy ? (
        <div className="space-y-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-muted-foreground">{summary.therapy.label}</span>
            <span className="font-medium tabular-nums">{summary.therapy.value}</span>
            {summary.therapy.duration ? (
              <span className="tabular-nums text-primary">{summary.therapy.duration}</span>
            ) : null}
          </div>
          <TherapyResponseChart
            therapy={summary.therapy}
            goal={selected ? threshold(selected.initiation) : undefined}
            locale={locale}
          />
          {summary.therapy.timeline && summary.therapy.timeline.length > 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isEnglish
                ? 'Prescribing and laboratory records. A span ends at its last prescription, not at a stop; a daily dose appears only where the prescription stated one; and the left edge is where the data window begins, not where treatment did.'
                : '為處方與檢驗紀錄。一段的結束是最後一筆處方，不代表停藥；每日劑量只在處方本身寫明時顯示；左端是資料窗起點，不是療程起點。'}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1 border-t border-border pt-3">
        <p className="text-xs font-medium">{isEnglish ? 'Pending verification' : '待核對與可能升級條件'}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          {summary.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ConnectedNhiTable1Panel(props: NhiTable1PanelProps & { patientId: string }) {
  const storedProvenance = useNhiLipidReviewProvenance(props.patientId)
  const answerProvenance = props.answerProvenance ?? storedProvenance
  const criteria = useMemo(() => {
    const checks = [
      ...props.summary.factors,
      ...props.summary.metabolicChecks,
      ...props.summary.diseaseChecks,
    ]
    const selected = selectNhiLipidAiCriteria(checks).filter(
      (check) => answerProvenance[check.id]?.source !== 'manual',
    )
    const selectedIds = new Set(selected.map((check) => check.id))
    for (const check of checks) {
      if (check.editable && answerProvenance[check.id]?.source === 'ai' && !selectedIds.has(check.id)) {
        selected.push(check)
      }
    }
    return selected
  }, [answerProvenance, props.summary.diseaseChecks, props.summary.factors, props.summary.metabolicChecks])
  const aiAssist = useNhiLipidAiAssist({
    patientId: props.patientId,
    criteria,
    locale: props.locale,
  })
  return <NhiTable1PanelContent {...props} aiAssist={aiAssist} answerProvenance={answerProvenance} />
}

/**
 * Keep the renderer usable in development fixtures and static reviews without
 * mounting the application's patient/AI providers. The live CDSS always passes
 * a patient id and therefore takes the connected branch.
 */
export function NhiTable1Panel(props: NhiTable1PanelProps) {
  if (props.aiAssist) return <NhiTable1PanelContent {...props} />
  if (props.patientId) return <ConnectedNhiTable1Panel {...props} patientId={props.patientId} />
  return <NhiTable1PanelContent {...props} />
}
