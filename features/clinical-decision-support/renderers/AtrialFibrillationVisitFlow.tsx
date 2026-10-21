'use client'
import { type ReactNode, useState } from 'react'
import { AF_CLINICAL_QUESTIONS } from '@voho0000/personalized-care'
import { Check, ChevronDown, Copy, PencilLine } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/src/shared/utils/cn.utils'
import { TINTED_PRIMARY } from './visit/visit-presentation'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import type { CdssRecommendation, CdssResult } from '../types'
import type { AfAnswers } from '../stores/af-answers.store'
import type { ClinicVitals, ClinicVitalsPatch } from '../stores/clinic-vitals.store'
import type {
  PhysicianDecisionInput,
  PhysicianDecisionKind,
  PhysicianDecisionMap,
} from '../stores/physician-decisions.store'
import { ClinicVitalsForm } from './ClinicVitalsForm'
import { afSummary, type DiseaseBoardModel } from './disease-board'
import { statusLabel, statusStyle, StatusIcon } from './status-presentation'
import styles from './af-sections.module.css'

interface Props {
  board: DiseaseBoardModel
  result: CdssResult
  isEnglish: boolean
  now: Date
  expandedId: string | null
  onToggle: (id: string) => void
  renderDetail: (recommendation: CdssRecommendation) => ReactNode
  answers?: AfAnswers
  onAnswer?: (id: string, value: boolean | undefined) => void
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  onClearClinicVitals?: () => void
  decisions?: PhysicianDecisionMap
  onRecordDecision?: (id: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (id: string) => void
}
const QUESTION_GROUPS = [
  { id: 'screening', zh: '完整 AF 篩檢風險檢核', en: 'Comprehensive AF screening risk review' },
  { id: 'nhi', zh: 'Dronedarone 健保核對', en: 'Dronedarone NHI criteria' },
  {
    id: 'followup',
    zh: '治療效果、症狀與實際服藥',
    en: 'Treatment response, symptoms and adherence',
  },
  { id: 'adverse', zh: '目前用藥的副作用檢核', en: 'Adverse effects of current medication' },
  { id: 'bleeding', zh: '出血併發症', en: 'Bleeding complications' },
  { id: 'bleedingRisk', zh: 'HAS-BLED 因子', en: 'HAS-BLED factors' },
  { id: 'diagnosis', zh: 'AF 診斷與超音波／OSAS 判讀', en: 'AF diagnosis, echo and OSA assessment' },
  { id: 'stroke', zh: '血栓風險病史', en: 'Stroke risk history' },
  { id: 'safety', zh: '瓣膜與當下安全', en: 'Valves and immediate safety' },
  { id: 'rate', zh: '心率與節律', en: 'Rate and rhythm' },
  { id: 'antithrombotic', zh: '抗栓適應症', en: 'Antithrombotic indications' },
  { id: 'comorbidity', zh: '共病與生活型態', en: 'Comorbidities and lifestyle' },
]
const DECISIONS: { id: PhysicianDecisionKind; zh: string; en: string }[] = [
  { id: 'reviewed', zh: '已評估', en: 'Reviewed' },
  { id: 'prescribed', zh: '已開立', en: 'Prescribed' },
  { id: 'dose-adjusted', zh: '已調整劑量', en: 'Dose adjusted' },
  { id: 'ordered', zh: '已安排檢查', en: 'Test ordered' },
  { id: 'contraindicated', zh: '有禁忌', en: 'Contraindicated' },
  { id: 'deferred', zh: '暫緩', en: 'Deferred' },
  { id: 'patient-preference', zh: '依病人意願', en: 'Patient preference' },
]
type SectionId = 'diagnosis' | 'treatment' | 'prognosis'
function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className={styles.section}
      data-section={id}
      data-testid={`cdss-af-${id}`}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`af-panel-${id}`}
          onClick={onToggle}
          className={cn(
            styles.heading,
            'flex min-h-16 w-full items-center gap-3 px-4 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{title}</span>
            <span className={cn(styles.summary, 'mt-1 block text-xs font-normal leading-relaxed')}>
              {summary}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      {open ? (
        <div id={`af-panel-${id}`} className="border-t border-border">
          {children}
        </div>
      ) : null}
    </section>
  )
}
/** A question group's own title, as the AF flow prints it. */
export function afQuestionGroupTitle(id: string, isEnglish: boolean): string | undefined {
  const group = QUESTION_GROUPS.find((candidate) => candidate.id === id)
  return group ? (isEnglish ? group.en : group.zh) : undefined
}

/**
 * The AF structured questions for the named groups, each group folded under
 * its own title with its count of unsettled answers. The pack's evidence
 * decides what is prefilled; only a deliberate correction is stored. Shared by
 * the AF visit flow and the decision map, over the same answers.
 */
/**
 * The groups that are checklists of problems — where 「全部皆無」 means what it
 * says: today's symptoms, side effects and bleeding, and the stroke-risk
 * history, valves and immediate safety, HAS-BLED, comorbidities and screening
 * risks (owner, 2026-09-30: 盡量這種的都要有全部皆無的按鈕). Not the diagnosis,
 * whose 無 turns the page to a reassessment, nor the dronedarone NHI
 * criteria, rate and rhythm, or the antithrombotic indications: their rows
 * are criteria and findings, not problems to rule out.
 *
 * A bulk 無 never writes over the record. A row the record reads 有 is left as
 * it is, and so is one the record holds but could not settle (a suspected
 * diagnosis, a value the pack cannot read): it stays 待確定 with what the
 * record holds under it, for the clinician to answer row by row.
 */
const BULK_NONE_GROUPS: ReadonlySet<string> = new Set([
  'screening', 'followup', 'adverse', 'bleeding', 'bleedingRisk', 'stroke', 'safety', 'comorbidity',
])
/**
 * The HAS-BLED questions and the score rows the pack reads them into. The pack
 * scores a dialysis, a creatinine >2.26, a cirrhosis, a major bleed or an
 * antiplatelet／NSAID on the prescription from the record when no answer is
 * given, so the question shows that reading rather than 待確定.
 */
const HAS_BLED_SCORE_ROWS: Readonly<Record<string, string>> = {
  abnormalRenal: 'renal',
  abnormalLiver: 'liver',
  hasBledStroke: 'stroke',
  bleedingHistory: 'bleeding',
  bleedingDrugs: 'drugs',
  excessAlcohol: 'alcohol',
}
/** Items whose 有 is good news; a bulk 無 would record the opposite of 「沒有問題」. */
const BULK_NONE_EXCLUDED: ReadonlySet<string> = new Set(['treatmentBenefit'])

function AfQuestionGroups({
  groupIds,
  board,
  result,
  isEnglish: en,
  answers = {},
  onAnswer,
  onDiagnosisAnswer,
}: {
  groupIds: readonly string[]
  board: DiseaseBoardModel
  result: CdssResult
  isEnglish: boolean
  answers?: AfAnswers
  onAnswer?: (id: string, value: boolean | undefined) => void
  /** Called when the diagnosis-confirmed answer changes, so a view can follow it. */
  onDiagnosisAnswer?: () => void
}) {
  const diagnosis = board.items.find((r) => r.id === 'af-diagnosis-and-pattern')?.diagnosisContext
  const confirmed = diagnosis?.mode === 'follow-up'
  // An answer brought in from a saved record says so, as it does on the decision map.
  const carriedFrom = useCarriedLookup()
  const evidenceFor = (id: string) => {
    const rows = result.recommendations.flatMap((r) => r.evidenceTables ?? []).flatMap((t) => t.items)
    // A HAS-BLED question's record reading is its score row; one the record
    // cannot fill (「未確認」) is no reading at all.
    const scoreRow = HAS_BLED_SCORE_ROWS[id]
    if (scoreRow) {
      const row = rows.find((candidate) => candidate.id === `af-hasbled:${scoreRow}`)
      return row && row.direction !== 'unknown' ? row : undefined
    }
    return rows.find((row) => row.id === `af-stroke:${id}` || row.id === `af-clinic:${id}`)
  }

  // Display the pack's evidence decision directly; only deliberate corrections are stored.
  const answerValue = (id: string): boolean | undefined => {
    if (answers[id] !== undefined) return answers[id]
    if (id === 'diagnosisConfirmed') return confirmed ? true : undefined
    const row = evidenceFor(id)
    if (!row || row.defaultEnabled === false) return undefined
    return row.direction === 'supports' ? true : row.direction === 'against' ? false : undefined
  }
  const currentAdverseIds = new Set(
    board.items
      .find((r) => r.id === 'af-followup-assessment')
      ?.evidenceTables?.flatMap((t) => t.items)
      .map((r) => r.id.replace('af-clinic:', '')) ?? [],
  )
  const availableQuestions = AF_CLINICAL_QUESTIONS.filter(
    (q) => q.group !== 'adverse' || currentAdverseIds.has(q.id),
  )
  const groups = QUESTION_GROUPS.filter(
    (group) => groupIds.includes(group.id) && availableQuestions.some((q) => q.group === group.id),
  )
  // What each group's rows held before 全部皆無 was pressed, for a second press to restore.
  const [beforeNone, setBeforeNone] = useState<Record<string, Record<string, boolean | undefined>>>({})
  if (groups.length === 0) return null
  // The record holds something on this row it could not settle — a suspected
  // diagnosis, a switched-off finding, a value the pack cannot read.
  const recordHeld = (id: string) => (
    answers[id] === undefined && answerValue(id) === undefined && evidenceFor(id)?.derivability === 'record-derived'
  )
  const noneTargets = (groupId: string) => availableQuestions.filter((q) => (
    q.group === groupId && !BULK_NONE_EXCLUDED.has(q.id) && answerValue(q.id) !== true && !recordHeld(q.id)
  ))
  // Pressed while every row it covers was answered 無 by the clinician —
  // a record's prefilled 無 is not the clinician's answer.
  const noneApplied = (groupId: string) => {
    const targets = noneTargets(groupId)
    return targets.length > 0 && targets.every((q) => answers[q.id] === false)
  }
  const toggleNone = (groupId: string) => {
    if (!onAnswer) return
    const targets = noneTargets(groupId)
    if (noneApplied(groupId)) {
      const saved = beforeNone[groupId]
      for (const q of targets) onAnswer(q.id, saved ? saved[q.id] : undefined)
      setBeforeNone((current) => { const next = { ...current }; delete next[groupId]; return next })
      return
    }
    setBeforeNone((current) => ({ ...current, [groupId]: Object.fromEntries(targets.map((q) => [q.id, answers[q.id]])) }))
    for (const q of targets) onAnswer(q.id, false)
  }
  return (
    <div data-testid="cdss-af-question-groups" data-groups={groups.map((group) => group.id).join(' ')}>
      {en ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Diagnoses and comorbidities are prefilled from records. You can correct the selected buttons; missing evidence remains pending.
        </p>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          診斷與共病已依病歷預填，不需逐項點選；可直接以按鈕修正，缺少資料保留待確定。
        </p>
      )}
      {groups.map((group) => (
        <details key={group.id} className="border-t border-border" data-af-question-group={group.id}>
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {en ? group.en : group.zh}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {
                availableQuestions.filter(
                  (q) => q.group === group.id && answerValue(q.id) === undefined,
                ).length
              }{' '}
              {en ? 'pending data' : '項待確定'}
            </span>
          </summary>
          {BULK_NONE_GROUPS.has(group.id) && onAnswer ? (() => {
            const applied = noneApplied(group.id)
            const anyYes = availableQuestions.some((q) => q.group === group.id && !BULK_NONE_EXCLUDED.has(q.id) && answerValue(q.id) === true)
            const targets = noneTargets(group.id)
            const held = availableQuestions.filter((q) => q.group === group.id && recordHeld(q.id)).length
            const label = anyYes ? (en ? 'Rest: none' : '其餘皆無') : (en ? 'None of these' : '全部皆無')
            return (
              <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 px-3 pb-2">
                {held ? (
                  <span className="text-xs text-muted-foreground" data-testid={`cdss-af-none-held-${group.id}`}>
                    {en
                      ? `${held} held in the record: answer ${held === 1 ? 'it' : 'them'} one by one`
                      : `病歷有紀錄的 ${held} 項請逐項確認`}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60',
                    applied
                      ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                      : 'border-border bg-background text-foreground hover:bg-muted/60',
                  )}
                  disabled={targets.length === 0}
                  aria-pressed={applied}
                  title={applied
                    ? (en ? 'Press again to restore these rows' : '再按一次，恢復成按下前的答案')
                    : (en ? `Mark ${targets.length} as absent` : `把 ${targets.length} 項記為「無」`)}
                  onClick={() => toggleNone(group.id)}
                  data-testid={`cdss-af-none-${group.id}`}
                >
                  {applied ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                  {label}
                  {applied ? <span className="font-normal">{en ? '· press again to undo' : '· 再按一次復原'}</span> : null}
                </button>
              </div>
            )
          })() : null}
          <div className="divide-y divide-border">
            {availableQuestions
              .filter((q) => q.group === group.id)
              .map((q) => (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 text-sm">
                    {en ? q.en : q.zh}
                    {answers[q.id] !== undefined && carriedFrom(`af:${q.id}`) ? (
                      <span className="mt-1 block w-fit rounded border border-primary/25 bg-primary/5 px-1.5 text-xs tabular-nums text-primary"
                        data-carried-from={carriedFrom(`af:${q.id}`) ?? undefined}>
                        {carriedLabel(carriedFrom(`af:${q.id}`) ?? '', en)}
                      </span>
                    ) : null}
                    {answers[q.id] === undefined &&
                    answerValue(q.id) !== undefined ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {en ? 'Prefilled from records: ' : '病歷預填：'}
                        {evidenceFor(q.id)?.value}
                        {evidenceFor(q.id)?.date ? ` · ${evidenceFor(q.id)?.date}` : ''}
                      </span>
                    ) : recordHeld(q.id) ? (
                      <span className="mt-1 block text-xs text-muted-foreground" data-af-record-held={q.id}>
                        {en ? 'In the record, not settled: ' : '病歷有紀錄、未能判定：'}
                        {evidenceFor(q.id)?.value}
                        {evidenceFor(q.id)?.date ? ` · ${evidenceFor(q.id)?.date}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <div
                    role="group"
                    aria-label={en ? q.en : q.zh}
                    className="flex overflow-hidden rounded-md border border-border"
                  >
                    {[
                      { label: en ? 'Yes' : '有', value: true },
                      { label: en ? 'No' : '無', value: false },
                      { label: en ? 'Reset / pending' : '依病歷／待確定', value: undefined },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        disabled={!onAnswer}
                        aria-pressed={answerValue(q.id) === option.value}
                        onClick={() => {
                          if (q.id === 'diagnosisConfirmed') onDiagnosisAnswer?.()
                          onAnswer?.(q.id, option.value)
                        }}
                        className={cn(
                          'min-h-11 min-w-11 border-r border-border px-3 text-xs last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50',
                          answerValue(q.id) === option.value
                            ? 'bg-primary/10 font-semibold text-primary'
                            : 'hover:bg-muted/30',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </details>
      ))}
    </div>
  )
}

type AfControlStrategy = 'rate' | 'rhythm'

/** R · the primary control strategy, one of two; it opens that strategy's questions and cards. */
function AfControlStrategyPicker({
  value,
  onChange,
  isEnglish: en,
  name = 'af-control-strategy',
}: {
  value: AfControlStrategy | null
  onChange: (value: AfControlStrategy) => void
  isEnglish: boolean
  /** The radio group's name; unique per rendering. */
  name?: string
}) {
  return (
    <fieldset className="px-3 py-3" data-testid="af-control-strategy">
      <legend className="pt-3 text-sm font-semibold">
        {en ? 'R · Primary control strategy' : 'R · 主要控制策略（擇一）'}
      </legend>
      <div className="flex flex-wrap gap-3">
        {(['rate', 'rhythm'] as const).map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="h-4 w-4 accent-primary"
            />
            {option === 'rate'
              ? en
                ? 'Rate control'
                : 'Rate control（心率控制）'
              : en
                ? 'Rhythm control'
                : 'Rhythm control（節律控制）'}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {en
          ? 'Select a primary strategy; existing medication safety assessments remain available. Rhythm control may also require rate control.'
          : '選擇主要策略；既有用藥安全評估持續保留。節律控制仍可能需要合併心率控制。'}
      </p>
    </fieldset>
  )
}

/** The record's AF inputs as the flow shows them: value, date, and 「建議複驗」 when stale. */
function AfRecordMetrics({ board, isEnglish: en }: { board: DiseaseBoardModel; isEnglish: boolean }) {
  return (
    <dl className="grid grid-cols-2 @min-[40rem]:grid-cols-4" data-testid="cdss-af-record-metrics">
      {board.metrics.map((m) => (
        <div
          key={m.key}
          className="min-w-0 border-b border-r border-border px-3 py-2"
          style={
            !m.value ? { backgroundImage: 'var(--clinical-missing-data-pattern)' } : undefined
          }
          data-testid={`cdss-af-metric-${m.key}`}
        >
          <dt className="text-xs text-muted-foreground">{m.label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold tabular-nums">
            {m.value ?? (en ? 'Not in record' : '紀錄無值')}
          </dd>
          {m.date ? (
            <dd
              className={cn(
                'mt-1 text-xs tabular-nums',
                m.stale ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
              )}
            >
              {m.date}
              {m.stale ? (en ? ' · repeat advised' : ' · 建議複驗') : ''}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  )
}

export function AtrialFibrillationVisitFlow({
  board,
  result,
  isEnglish: en,
  now,
  expandedId,
  onToggle,
  renderDetail,
  answers = {},
  onAnswer,
  clinicVitals,
  onSaveClinicVitals,
  onClearClinicVitals,
  decisions = {},
  onRecordDecision,
  onClearDecision,
}: Props) {
  const [strategy, setStrategy] = useState<'rate' | 'rhythm' | null>(null)
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const { copied, copy } = useCopyToClipboard()
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set())
  const toggleSection = (id: SectionId) =>
    setOpenSections((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const sectionFor = (r: CdssRecommendation): SectionId => r.clinicalSection ?? 'treatment'
  const modules = (id: SectionId) => board.items.filter((r) => sectionFor(r) === id)
  const diagnosis = board.items.find((r) => r.id === 'af-diagnosis-and-pattern')?.diagnosisContext
  const confirmed = diagnosis?.mode === 'follow-up'
  const [modeChoice, setModeChoice] = useState<{ confirmed: boolean; followUp: boolean } | null>(
    null,
  )
  // An updated clinical diagnosis takes precedence over a prior view selection.
  if (modeChoice && modeChoice.confirmed !== confirmed) setModeChoice(null)
  const followUp = modeChoice?.confirmed === confirmed ? modeChoice.followUp : confirmed
  const selectMode = (followUp: boolean) => setModeChoice({ confirmed, followUp })
  const summary = afSummary(result, decisions, en ? 'en' : 'zh-TW')
  const sectionProps = (id: SectionId, title: string, summary: string) => ({
    id,
    title,
    summary,
    open: openSections.has(id),
    onToggle: () => toggleSection(id),
  })

  function renderRow(r: CdssRecommendation) {
    return (
      <div
        key={r.id}
        id={`af-action-${r.id}`}
        className="border-t border-border first:border-t-0"
        data-testid={`cdss-af-action-${r.id}`}
      >
        <button
          type="button"
          className="flex min-h-11 w-full items-start gap-2 px-3 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onToggle(r.id)}
          aria-expanded={expandedId === r.id}
        >
          <StatusIcon status={r.status} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <Badge className={statusStyle[r.status]}>{statusLabel(r.status, en)}</Badge>
              <span className="text-xs text-muted-foreground">{r.moduleName}</span>
            </span>
            <span
              data-testid={`cdss-module-cell-${r.id}`}
              className="mt-1 block text-sm font-semibold"
            >
              {r.title}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none',
              expandedId === r.id && 'rotate-180',
            )}
          />
        </button>
        {expandedId === r.id && onRecordDecision ? (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
            <label className="text-xs text-muted-foreground" htmlFor={`af-decision-${r.id}`}>
              {en ? 'Your decision' : '你的決定'}
            </label>
            <select
              id={`af-decision-${r.id}`}
              aria-label={`${r.moduleName}：${en ? 'decision' : '處置'}`}
              className="min-h-11 max-w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={decisions[r.id]?.decision ?? ''}
              onChange={(e) =>
                e.target.value
                  ? onRecordDecision(r.id, {
                      decision: e.target.value as PhysicianDecisionKind,
                      reasons: [],
                      packVersion: result.packVersion,
                    })
                  : onClearDecision?.(r.id)
              }
            >
              <option value="">{en ? 'Not recorded' : '尚未記錄'}</option>
              {DECISIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {en ? d.en : d.zh}
                </option>
              ))}
            </select>
            {decisions[r.id] ? (
              <span className="text-xs text-muted-foreground">
                {new Date(decisions[r.id].recordedAt).toLocaleDateString(en ? 'en-CA' : 'zh-TW')}
              </span>
            ) : null}
          </div>
        ) : null}
        {expandedId === r.id ? (
          <div className="border-t border-border bg-muted/10 px-3 py-2">
            <p className="mb-3 text-sm leading-relaxed">{r.recommendation}</p>
            {renderDetail(r)}
          </div>
        ) : null}
      </div>
    )
  }
  function questions(ids: string[]) {
    return (
      <AfQuestionGroups
        groupIds={ids}
        board={board}
        result={result}
        isEnglish={en}
        answers={answers}
        onAnswer={onAnswer}
        onDiagnosisAnswer={() => setModeChoice(null)}
      />
    )
  }
  const rateIds = ['af-rate-control-and-lvef-safety']
  const rhythmIds = [
    'af-antiarrhythmic-drug-safety',
    'af-rhythm-control-and-ablation',
    'af-dronedarone-nhi',
    'af-amiodarone-monitoring',
  ]
  const strokeRisk = board.items.find((r) => r.id === 'af-documented-cha2ds2-vasc')
  const anticoagulationIds = [
    'af-anticoagulation-concordance',
    'af-anticoagulant-selection-safety',
    'af-doac-renal-dose-check',
    'antithrombotic-coordination',
    'af-drug-interactions',
    'af-warfarin-ttr',
    'af-anticoagulation-monitoring',
    'af-anticoagulation-bp',
  ]
  const assigned = new Set([...rateIds, ...rhythmIds, ...anticoagulationIds])
  const treatmentGroups = [
    {
      label: en
        ? 'A · Anticoagulation · shared by both strategies'
        : 'A · Anticoagulation · 兩種策略共用',
      ids: anticoagulationIds,
    },
    {
      label: en ? 'C · Comorbidities and risk factors' : 'C · 共病與風險因子',
      ids: modules('treatment')
        .filter((r) => !assigned.has(r.id))
        .map((r) => r.id),
    },
  ]
  return (
    <div className="space-y-3" data-testid="cdss-af-visit-flow">
      {board.alerts.length ? (
        <div
          role="region"
          aria-label={en ? 'Safety alerts' : '優先安全警訊'}
          className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 dark:bg-amber-500/10"
        >
          <p className="text-sm font-semibold">{en ? 'Safety first' : '優先安全警訊'}</p>
          {board.alerts.map((r) => (
            <button
              key={r.id}
              type="button"
              className="block min-h-11 w-full text-left text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                if (rateIds.includes(r.id)) setStrategy('rate')
                if (rhythmIds.includes(r.id)) setStrategy('rhythm')
                setOpenSections((old) => new Set([...old, sectionFor(r)]))
                if (expandedId !== r.id) onToggle(r.id)
              }}
            >
              {r.title}
            </button>
          ))}
        </div>
      ) : null}
      <Section
        {...sectionProps(
          'diagnosis',
          followUp ? (en ? 'Follow-up' : '追蹤') : en ? 'Diagnosis' : '診斷',
          diagnosis?.basis ?? (en ? 'Review diagnosis and monitoring' : '核對診斷與追蹤'),
        )}
      >
        <div
          role="group"
          aria-label={en ? 'Diagnosis or follow-up view' : '診斷或追蹤檢視'}
          className="flex gap-2 px-3 py-3"
        >
          <Button
            variant="outline"
            className={cn('min-h-11', !followUp && cn('font-semibold', TINTED_PRIMARY))}
            aria-pressed={!followUp}
            onClick={() => selectMode(false)}
          >
            {en ? 'Diagnosis' : '診斷'}
          </Button>
          <Button
            variant="outline"
            className={cn('min-h-11', followUp && cn('font-semibold', TINTED_PRIMARY))}
            aria-pressed={followUp}
            onClick={() => selectMode(true)}
          >
            {en ? 'Follow-up' : '追蹤'}
          </Button>
        </div>
        {followUp && !confirmed ? (
          <p role="status" className="px-3 pb-3 text-sm text-muted-foreground">
            {en
              ? 'AF is not yet confirmed. Return to diagnosis to review and confirm the evidence.'
              : 'AF 尚未確診，請回到診斷核對並確認依據。'}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <h4 className="text-sm font-semibold">{en ? 'From the record' : '病歷與本次量測'}</h4>
          {onSaveClinicVitals ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() => setVitalsOpen(!vitalsOpen)}
            >
              <PencilLine className="mr-1 h-4 w-4" />
              {en ? 'Clinic measurements' : '門診量測'}
            </Button>
          ) : null}
        </div>
        <AfRecordMetrics board={board} isEnglish={en} />
        {vitalsOpen && onSaveClinicVitals ? (
          <div className="p-3">
            <ClinicVitalsForm
              isEnglish={en}
              now={now}
              initial={clinicVitals}
              onSave={onSaveClinicVitals}
              onClear={onClearClinicVitals}
              onClose={() => setVitalsOpen(false)}
            />
          </div>
        ) : null}
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {en
            ? 'Missing inputs remain unknown. Old results retain their date and stay in the assessment.'
            : '缺少資料保留未知；過期資料標示日期並仍納入判斷。'}
        </p>

        {questions(followUp ? ['followup', 'bleeding', 'adverse'] : ['diagnosis', 'screening', 'stroke', 'comorbidity'])}
        {followUp ? (
          <h4 className="border-y border-border px-3 py-2 text-sm font-semibold">
            {en ? 'E · Treatment response and safety reassessment' : 'E · 治療效果與用藥安全再評估'}
          </h4>
        ) : null}
        {modules('diagnosis').map(renderRow)}
        {followUp ? (
          <div className="border-t border-border px-3 py-3">
            <p className="mb-2 text-sm font-semibold">
              {en ? 'Medication monitoring and interactions' : '藥物監測與交互作用'}
            </p>
            <div className="flex flex-wrap gap-2">
              {modules('treatment')
                .filter((r) =>
                  [
                    'af-amiodarone-monitoring',
                    'af-anticoagulation-monitoring',
                    'af-warfarin-ttr',
                    'af-anticoagulation-bp',
                    'af-drug-interactions',
                    'af-antiarrhythmic-drug-safety',
                    'af-dronedarone-nhi',
                  ].includes(r.id),
                )
                .map((r) => (
                  <Button
                    key={r.id}
                    variant="outline"
                    className="h-auto min-h-11 whitespace-normal text-left"
                    onClick={() => {
                      setOpenSections((old) => new Set([...old, 'treatment']))
                      if (rhythmIds.includes(r.id)) setStrategy('rhythm')
                      if (expandedId !== r.id) onToggle(r.id)
                    }}
                  >
                    {r.moduleName ?? r.title}
                  </Button>
                ))}
            </div>
          </div>
        ) : null}
      </Section>
      <Section
        {...sectionProps(
          'treatment',
          en ? 'Treatment' : '治療',
          en
            ? `AF-CARE · ${modules('treatment').length} modules`
            : `AF-CARE · ${modules('treatment').length} 項決策`,
        )}
      >
        {modules('treatment').length ? (
          <>
            {questions(['safety', 'antithrombotic', 'comorbidity'])}
            {[...treatmentGroups].reverse().map((g) => (
              <div key={g.label}>
                <h4 className="border-y border-border bg-muted/30 px-3 py-2 text-sm font-semibold">
                  {g.label}
                </h4>
                {g.ids === anticoagulationIds && strokeRisk ? (
                  <div
                    className="space-y-2 border-b border-border px-3 py-3"
                    data-testid="af-anticoagulation-stroke-risk"
                  >
                    <p className="text-sm font-semibold">{strokeRisk.title}</p>
                    <p className="text-sm">{strokeRisk.recommendation}</p>
                    <p className="text-xs text-muted-foreground">{strokeRisk.rationale}</p>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => {
                        setOpenSections((old) => new Set([...old, 'prognosis']))
                        if (expandedId !== strokeRisk.id) onToggle(strokeRisk.id)
                      }}
                    >
                      {en ? 'Review score inputs in prognosis' : '展開預後：查看與修改計分依據'}
                    </Button>
                  </div>
                ) : null}
                {modules('treatment')
                  .filter((r) => g.ids.includes(r.id))
                  .map(renderRow)}
              </div>
            ))}
            <AfControlStrategyPicker value={strategy} onChange={setStrategy} isEnglish={en} />
            {!strategy ? (
              <p role="status" className="px-3 pb-3 text-sm">
                {en
                  ? 'Select rate or rhythm control to view its medications and assessments.'
                  : '請選擇 Rate control 或 Rhythm control，查看對應藥物與評估。'}
              </p>
            ) : null}
            <div hidden={strategy !== 'rate'} data-testid="af-rate-control">
              <h4 className="border-y border-border px-3 py-2 text-sm font-semibold">
                {en
                  ? 'Rate control · beta-blockers / non-DHP calcium channel blockers'
                  : 'Rate control · β-blocker／Non-DHP 鈣離子阻斷劑'}
              </h4>
              {questions(['rate'])}
              {modules('treatment')
                .filter((r) => rateIds.includes(r.id))
                .map(renderRow)}
            </div>
            <div hidden={strategy !== 'rhythm'} data-testid="af-rhythm-control">
              <h4 className="border-y border-border px-3 py-2 text-sm font-semibold">
                {en ? 'Rhythm control · antiarrhythmic drugs' : 'Rhythm control · 抗心律不整藥物'}
              </h4>
              {questions(['nhi'])}
              {modules('treatment')
                .filter((r) => rhythmIds.includes(r.id))
                .map(renderRow)}
            </div>
          </>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            {en
              ? 'Confirm AF before applying its treatment pathway.'
              : '先確認 AF 診斷，再進入 AF 治療路徑。'}
          </p>
        )}
        <div className="border-t border-border p-3">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={async () => setCopyError(!(await copy(summary)))}
          >
            <Copy className="mr-1 h-4 w-4" />
            {copied ? (en ? 'Copied' : '已複製') : en ? 'Copy visit summary' : '複製本次摘要'}
          </Button>
        </div>
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {en
            ? 'Recording a decision does not prescribe or close a finding; future assessments continue to use the medical record.'
            : '處置紀錄不等於開立處方，也不會消除規則提示；下次仍依病歷重新判斷。'}
        </p>
        {copyError ? (
          <p role="alert" className="px-3 pb-2 text-sm text-destructive">
            {en
              ? 'Copy failed. Select the summary below to copy manually.'
              : '複製失敗，請展開摘要後手動複製。'}
          </p>
        ) : null}
        <details className="border-t border-border">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium">
            {en ? 'Full visit summary' : '完整本次摘要'}
          </summary>
          <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-sans text-xs leading-relaxed">
            {summary}
          </pre>
        </details>
      </Section>
      <Section
        {...sectionProps(
          'prognosis',
          en ? 'Prognosis' : '預後',
          en ? 'Stroke · bleeding · heart failure' : '中風風險 · 出血風險 · 心衰竭',
        )}
      >
        {modules('prognosis').length ? (
          <>
            {questions(['stroke', 'bleedingRisk'])}
            {modules('prognosis').map(renderRow)}
          </>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            {en
              ? 'AF-specific scores follow diagnostic confirmation.'
              : '確診後評估 AF 中風、出血與心衰竭風險。'}
          </p>
        )}
      </Section>
    </div>
  )
}
