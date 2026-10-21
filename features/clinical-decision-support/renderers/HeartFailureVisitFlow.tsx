"use client"

import { Fragment, type ReactNode, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  ClipboardList,
  Copy,
  ListChecks,
  PencilLine,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/src/shared/utils/cn.utils'
import { GROUP_TONES } from '@/src/shared/constants/group-tones'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import type { CdssRecommendation, DecisionPointState, VisitAnswers, VisitAsk } from '../types'
import {
  NOT_ASSESSED,
  todayIsoDate,
  type ClinicVitals,
  type ClinicVitalsPatch,
  type CompensationAnswerValue,
  type NyhaAnswerValue,
  type SignAnswerValue,
} from '../stores/clinic-vitals.store'
import { HFPEF_NOT_CONFIRMED, type PhenotypeAnswer } from '../stores/phenotype-answer.store'
import type {
  PhysicianDecisionInput,
  PhysicianDecisionKind,
} from '../stores/physician-decisions.store'
import { diagnosticSummaryOf, type DiagnosticSummary } from '../physician-input-contract'
import type { HfpefInputsPatch } from '../stores/hfpef-inputs.store'
import {
  HFPEF_CALCULATOR_VERSION,
  type HfpefReading,
  type HfpefScoreReading,
  type HfpefScoreId,
} from '../utils/hfpef-scores'
import { HfpefInputsDialog } from './HfpefInputsDialog'
import { CareTimeline } from './CareTimeline'
import { ClinicalHandoffCard } from './ClinicalHandoffCard'
import { EchoReportButton } from './EchoReportButton'
import { RecordMetricEditor } from './RecordMetricEditor'
import { RecordValuesEditor, type RecordValueChange } from './RecordValuesEditor'
import { DiagnosisReading } from './DiagnosisReading'
import { HfpEfCriteriaList } from './HfpEfCriteriaList'
import { PhysicianInputRequestPanel } from './PhysicianInputRequestPanel'
import { diagnosisAnswer } from './visit/physician-input'
import { StatePill, TINTED_PRIMARY } from './visit/visit-presentation'
import { statusLabel, statusStyle, StatusIcon } from './status-presentation'
import {
  DECISION_REASONS,
  VISIT_DECISIONS,
  VISIT_SIDE_LABELS,
  decisionLabel,
  decisionReasonIds,
  decisionReasonLabel,
  formatDay,
  formatStamp,
  type HeartFailureVisitFlow as VisitFlowModel,
  type VisitActionGroupId,
  type VisitActionRow,
  type VisitNextStepTarget,
  type VisitQuestion,
  type VisitQuestionId,
  type VisitSignItem,
  type VisitSignSide,
  type VisitStep,
} from './heart-failure-visit-flow'
import { heartFailureMedicationSafetyAssessment } from './heart-failure-medication-safety'
import { CdssModuleSections } from './CdssModuleSections'
import { HfDiagnosisConfirmation } from './HfDiagnosisConfirmation'
import { HfFollowUpPriorities } from './HfFollowUpPriorities'
import type { HfFollowUpHistory } from '../utils/hf-follow-up'
import { diagnosisContextOf } from './cdss-sections'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'
import type { HeartFailureBoardModel, HeartFailureMetric } from './heart-failure-board'

/** The element a step's 「前往」 button scrolls to. */
export function visitQuestionElementId(questionId: VisitQuestionId): string {
  return `cdss-hf-question-${questionId}`
}

export function visitActionElementId(moduleId: string): string {
  return `cdss-hf-action-${moduleId}`
}

/**
 * Takes the reader to what the next step names.
 *
 * A DOM lookup rather than a ref map: the target can be inside a folded group
 * or a card the reader has not opened, and the id is the one contract every
 * one of those renderings already shares.
 */
export function focusVisitFlowTarget(target: VisitNextStepTarget): void {
  if (typeof document === 'undefined') return
  const id = target.kind === 'question'
    ? visitQuestionElementId(target.questionId)
    : target.kind === 'action'
      ? visitActionElementId(target.moduleId)
      : undefined
  if (!id) return
  const element = document.getElementById(id)
  if (!element) return
  // Questions and modules may be inside independently collapsed sections.
  let ancestor: HTMLElement | null = element
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    ancestor = ancestor.parentElement
  }
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const focusable = element.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  focusable?.focus()
}

const GROUP_PRESENTATION: Readonly<Record<VisitActionGroupId, { toneClass: string; dividerClass: string }>> = {
  safety: GROUP_TONES.rose,
  actionable: GROUP_TONES.indigo,
  'needs-data': GROUP_TONES.orange,
  review: GROUP_TONES.blue,
  'no-action': GROUP_TONES.teal,
}

/** The colour of the 3px bar down the left of a row: its status. */
const ROW_BAR_CLASS: Readonly<Record<VisitActionGroupId, string>> = {
  safety: 'bg-amber-500',
  actionable: 'bg-primary',
  'needs-data': 'bg-orange-400',
  review: 'bg-blue-400',
  'no-action': 'bg-emerald-400',
}


/** The measurements this stage can take back from the clinician. */
const METRIC_ENTRY_KEYS = { oxygenSaturation: 'oxygenSaturation', bodyHeight: 'bodyHeight', heartRate: 'heartRate', bodyWeight: 'bodyWeight', potassium: 'potassium', eGFR: 'eGFR', sodium: 'sodium', NTproBNP: 'NTproBNP', hemoglobin: 'hemoglobin' } as const

export interface HeartFailureVisitFlowProps {
  flow: VisitFlowModel
  board: HeartFailureBoardModel
  isEnglish: boolean
  now: Date
  /** Which recommendation's detail is open, shared with the module list's state. */
  expandedId: string | null
  onToggle: (id: string) => void
  /** The same decision detail every other surface opens. */
  renderDetail: (recommendation: CdssRecommendation) => ReactNode
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  onClearClinicVitals?: () => void
  phenotypeAnswer?: PhenotypeAnswer
  onAnswerPhenotype?: (answer: PhenotypeAnswer) => void
  onRecordDecision?: (moduleId: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (moduleId: string) => void
  /** The host's own HFpEF calculator reading, where the pathway raised one. */
  hfpefReading?: HfpefReading
  onSaveHfpefInputs?: (patch: HfpefInputsPatch) => void
  packVersion: string
  rhythmPanel?: ReactNode
  /** Present the same editors and decisions in the shared three-section shell. */
  sectionRecommendations?: readonly CdssRecommendation[]
  prognosisContent?: ReactNode
  followUpHistory?: HfFollowUpHistory
  /**
   * The every-visit answers the decision map asks at its top. The three-section
   * follow-up reads and writes the same two (喘, 體重), so switching layouts
   * never asks them again and the pack reads one answer.
   */
  visitAnswers?: VisitAnswers
  onVisitAnswer?: (id: VisitAsk['id'], value: string | null) => void
}

export function HeartFailureVisitFlow({
  flow,
  board,
  isEnglish,
  now,
  expandedId,
  onToggle,
  renderDetail,
  clinicVitals,
  onSaveClinicVitals,
  phenotypeAnswer,
  onAnswerPhenotype,
  onRecordDecision,
  onClearDecision,
  hfpefReading,
  onSaveHfpefInputs,
  packVersion,
  rhythmPanel,
  sectionRecommendations,
  prognosisContent,
  followUpHistory,
  visitAnswers,
  onVisitAnswer,
}: HeartFailureVisitFlowProps) {
  const [calculatorTab, setCalculatorTab] = useState<HfpefScoreId>('hfa-peff')
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<VisitActionGroupId>>(
    () => new Set(flow.actionGroups
      .filter((group) => group.collapsedByDefault)
      .map((group) => group.id)),
  )
  const [editingDecisions, setEditingDecisions] = useState<ReadonlySet<string>>(new Set())

  const {
    editingMetric,
    setEditingMetric,
    recordValuesOpen,
    setRecordValuesOpen,
    allEditableMetrics,
    saveMetrics,
    saveMetric,
  } = useRecordValueEditing({ flow, isEnglish, now, clinicVitals, onSaveClinicVitals, phenotypeAnswer, onAnswerPhenotype, onSaveHfpefInputs })
  const diagnosisContext = sectionRecommendations?.map(diagnosisContextOf).find(Boolean)
  const followUp = Boolean(phenotypeAnswer?.diagnosisConfirmation) || phenotypeAnswer?.hfpEfConfirmed === true || diagnosisContext?.mode === 'follow-up'
  const [selectedMode, setSelectedMode] = useState<{ confirmed: boolean; diagnosis: boolean } | null>(null)
  const showFollowUp = followUp && !(selectedMode?.confirmed === followUp && selectedMode.diagnosis)
  const diagnosticIds: VisitQuestionId[] = ['hf-suspicion', 'lvef-phenotype', 'hfpef-confirmation']
  const subset = (questions: VisitQuestion[]) => ({ ...flow, questions, openQuestionCount: questions.filter(question => question.counted && question.state === 'open').length })
  const assessmentFlow = followUp ? subset(flow.questions.filter(question => showFollowUp ? !diagnosticIds.includes(question.id) : diagnosticIds.includes(question.id))) : flow
  const renderQuestions = (questionFlow: VisitFlowModel) => <QuestionsCard
    flow={questionFlow} isEnglish={isEnglish} now={now} clinicVitals={clinicVitals}
    onSaveClinicVitals={onSaveClinicVitals} phenotypeAnswer={phenotypeAnswer}
    onAnswerPhenotype={onAnswerPhenotype} board={board} hfpefReading={hfpefReading}
    onOpenCalculator={onSaveHfpefInputs ? (id = 'hfa-peff') => { setCalculatorTab(id); setCalculatorOpen(true) } : undefined}
  />
  const actionRows = new Map(flow.actionGroups.flatMap(group => group.rows).map(row => [row.recommendation.id, row]))

  return (
    <div className="space-y-3" data-testid="cdss-hf-visit-flow">
      {editingMetric ? <RecordMetricEditor key={editingMetric.factKey} metric={editingMetric} isEnglish={isEnglish} now={now}
        onSave={(values, date) => saveMetric(editingMetric, values, date)}
        onRestore={() => saveMetric(editingMetric, null, todayIsoDate(now))}
        onClose={() => setEditingMetric(null)} /> : null}
      {recordValuesOpen ? <RecordValuesEditor rhythm={hfpefReading?.inputs.find(input => input.key === 'rhythm')?.value} onSaveRhythm={onSaveHfpefInputs} metrics={allEditableMetrics} isEnglish={isEnglish} now={now}
        onSave={saveMetrics} onClose={() => setRecordValuesOpen(false)} /> : null}
      {!sectionRecommendations ? <>
      <StepCard
        steps={flow.steps}
        nextStep={flow.nextStep}
        isEnglish={isEnglish}
        onGo={() => {
          if (flow.nextStep.target.kind === 'copy') return
          focusVisitFlowTarget(flow.nextStep.target)
        }}
        summaryText={flow.englishSummaryText}
      />

      <RecordCard
        rhythmPanel={rhythmPanel}
        metrics={allEditableMetrics}
        isEnglish={isEnglish}
        canEdit={Boolean(onSaveClinicVitals)}
        onOpenForm={() => setRecordValuesOpen(true)}
      />

      <QuestionsCard
        flow={flow}
        isEnglish={isEnglish}
        now={now}
        clinicVitals={clinicVitals}
        onSaveClinicVitals={onSaveClinicVitals}
        phenotypeAnswer={phenotypeAnswer}
        onAnswerPhenotype={onAnswerPhenotype}
        board={board}
        hfpefReading={hfpefReading}
        onOpenCalculator={onSaveHfpefInputs ? (id = 'hfa-peff') => { setCalculatorTab(id); setCalculatorOpen(true) } : undefined}
      />

      <ActionsCard
        flow={flow}
        isEnglish={isEnglish}
        now={now}
        expandedId={expandedId}
        onToggle={onToggle}
        renderDetail={renderDetail}
        collapsedGroups={collapsedGroups}
        onToggleGroup={(id) => setCollapsedGroups((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })}
        editingDecisions={editingDecisions}
        onEditDecision={(moduleId, editing) => setEditingDecisions((current) => {
          const next = new Set(current)
          if (editing) next.add(moduleId)
          else next.delete(moduleId)
          return next
        })}
        onRecordDecision={onRecordDecision}
        onClearDecision={onClearDecision}
        packVersion={packVersion}
      />

      <FollowUpCard
        flow={flow}
        board={board}
        isEnglish={isEnglish}
        now={now}
      />
      </> : <>
        <details className="rounded-lg border border-border bg-card">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">{isEnglish ? 'Clinical values and sources' : '臨床數值與來源'} · {board.lvef?.value ? `LVEF ${board.lvef.value}` : (isEnglish ? 'LVEF not documented' : 'LVEF 未取得')}</summary>
          <RecordCard rhythmPanel={rhythmPanel} metrics={allEditableMetrics} isEnglish={isEnglish} canEdit={Boolean(onSaveClinicVitals)} onOpenForm={() => setRecordValuesOpen(true)} />
        </details>
        <CdssModuleSections
          recommendations={followUp && !showFollowUp ? sectionRecommendations.filter(item => item.id !== 'heart-failure-monitoring') : sectionRecommendations}
          isEnglish={isEnglish}
          renderDetail={renderDetail}
          followUp={showFollowUp}
          diagnosisModeControl={<div role="group" aria-label={isEnglish ? 'Diagnosis or follow-up' : '診斷或追蹤'} className="mt-3 flex flex-wrap gap-1">
            <Button variant="outline" aria-pressed={!showFollowUp} className={cn('min-h-11', !showFollowUp && cn('font-semibold', TINTED_PRIMARY))} onClick={() => setSelectedMode({ confirmed: followUp, diagnosis: true })}>{isEnglish ? 'Diagnosis' : '診斷'}</Button>
            <Button variant="outline" aria-pressed={showFollowUp} className={cn('min-h-11', showFollowUp && cn('font-semibold', TINTED_PRIMARY))} disabled={!followUp} title={!followUp ? (isEnglish ? 'Confirm diagnosis to enter follow-up' : '確認診斷後進入追蹤') : undefined} onClick={() => setSelectedMode({ confirmed: followUp, diagnosis: false })}>{isEnglish ? 'Follow-up' : '追蹤'}</Button>
          </div>}
          sectionSummary={prognosisContent ? { prognosis: isEnglish ? 'Medical calculators · formulas pending' : '醫學計算機・公式待串接' } : undefined}
          sectionContent={{ prognosis: prognosisContent, diagnosis: <>
            <HfDiagnosisConfirmation answer={phenotypeAnswer} onConfirm={flow.readOnly ? undefined : onAnswerPhenotype} now={now} isEnglish={isEnglish} followUp={followUp} basis={diagnosisContext?.basis ?? (isEnglish ? 'Heart failure; phenotype requires review of diagnostic evidence.' : '心衰竭；分型請參照診斷依據。')} />
            {followUp && diagnosisContext?.mode === 'reassessment' ? <p data-cdss-action="" className="px-4 py-2 text-sm">{isEnglish ? 'New evidence requires review. Open diagnostic evidence; the prior confirmation is retained.' : '新資料需核對，請開啟診斷依據；既有確診紀錄仍保留。'}</p> : null}
            {followUp && flow.questions.some(question => question.id === 'lvef-phenotype' && question.state === 'open') ? <p data-cdss-action="" className="px-4 py-2 text-sm">{isEnglish ? 'HF phenotype pending: review LVEF in diagnostic evidence when available.' : '心衰竭分型待補：取得 LVEF 後可開啟診斷依據補充。'}</p> : null}
            {showFollowUp ? <HfFollowUpPriorities history={followUpHistory} vitals={clinicVitals} onSave={flow.readOnly ? undefined : onSaveClinicVitals} now={now} isEnglish={isEnglish} onBreathDetails={() => focusVisitFlowTarget({ kind: 'question', questionId: 'symptoms' })} trendAnswers={visitAnswers} onTrendAnswer={flow.readOnly ? undefined : onVisitAnswer} /> : null}
            <details key={showFollowUp ? 'follow-up' : 'diagnosis'} open={followUp && !showFollowUp} className="border-t border-border" data-testid="cdss-condition-assessment">
              <summary data-cdss-action={assessmentFlow.openQuestionCount > 0 ? '' : undefined} className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring">{showFollowUp ? (isEnglish ? 'Other symptoms, signs and NYHA' : '其他症狀、徵象與 NYHA') : (isEnglish ? 'Diagnostic assessment' : '診斷評估')} · {isEnglish ? `${assessmentFlow.openQuestionCount} questions pending` : `${assessmentFlow.openQuestionCount} 題待補`}</summary>
              {renderQuestions(assessmentFlow)}
            </details>
          </> }}
          sectionFooter={{ diagnosis: board.timeline ? <div className="border-t border-border px-3 py-3"><CareTimeline timeline={board.timeline} isEnglish={isEnglish} /></div> : null }}
          decisionLabel={item => {
            const row = actionRows.get(item.id)
            return row?.decision && row.decisionSource !== 'medication-record' ? decisionLabel(row.decision.decision, isEnglish) : undefined
          }}
          renderDecision={item => {
            const row = actionRows.get(item.id)
            if (!row) return null
            return <DecisionControls row={row} isEnglish={isEnglish} now={now}
              editing={editingDecisions.has(item.id)}
              onEdit={editing => setEditingDecisions(current => { const next = new Set(current); if (editing) next.add(item.id); else next.delete(item.id); return next })}
              onRecordDecision={onRecordDecision} onClearDecision={onClearDecision}
              packVersion={packVersion} readOnly={flow.readOnly} />
          }}
        />
        <details className="rounded-lg border border-border bg-card" data-testid="cdss-shared-summary">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">{isEnglish ? 'Visit summary and recorded decisions' : '本次摘要與處置紀錄'}</summary>
          <FollowUpCard flow={flow} board={{ ...board, timeline: undefined }} isEnglish={isEnglish} now={now} />
        </details>
      </>}

      {hfpefReading && onSaveHfpefInputs ? (
        <HfpefInputsDialog
          key={`${calculatorTab}-${calculatorOpen}`}
          initialTab={calculatorTab}
          open={calculatorOpen}
          onOpenChange={setCalculatorOpen}
          reading={hfpefReading}
          isEnglish={isEnglish}
          now={now}
          onApply={onSaveHfpefInputs}
          {...(natriureticRowId(flow)
            ? {
              onOrderNtProBnp: () => focusVisitFlowTarget({
                kind: 'action',
                moduleId: natriureticRowId(flow)!,
                index: 1,
              }),
            }
            : {})}
        />
      ) : null}
    </div>
  )
}

/**
 * The clinical values a clinician can complete or correct, and the saving of
 * them: an LVEF is the phenotype answer, a blood pressure is two entries, the
 * rest are clinic-vitals entries. Shared by the visit flow, the three sections
 * and the decision map so the three editors are one editor.
 */
function useRecordValueEditing({
  flow,
  isEnglish,
  now,
  clinicVitals,
  onSaveClinicVitals,
  phenotypeAnswer,
  onAnswerPhenotype,
  onSaveHfpefInputs,
}: {
  flow: VisitFlowModel
  isEnglish: boolean
  now: Date
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  phenotypeAnswer?: PhenotypeAnswer
  onAnswerPhenotype?: (answer: PhenotypeAnswer) => void
  onSaveHfpefInputs?: (patch: HfpefInputsPatch) => void
}) {
  const [editingMetric, setEditingMetric] = useState<HeartFailureMetric | null>(null)
  const [recordValuesOpen, setRecordValuesOpen] = useState(false)
  const allEditableMetrics: HeartFailureMetric[] = [...flow.metrics]
  if (!allEditableMetrics.some(metric => metric.factKey === 'LVEF')) allEditableMetrics.unshift({ factKey: 'LVEF', label: 'LVEF', unit: '%', kind: 'measure', stale: false, entered: false, evaluated: false })
  for (const [key, label, unit] of [['oxygenSaturation', 'SpO₂', '%'], ['bodyHeight', isEnglish ? 'Height' : '身高', 'cm']] as const) {
    if (allEditableMetrics.some(metric => metric.factKey === key)) continue
    const entry = clinicVitals?.entries[key]
    allEditableMetrics.push({ factKey: key, label, unit, value: entry ? String(entry.value) : undefined, date: entry?.measuredOn, kind: 'measure', stale: false, entered: Boolean(entry), evaluated: false })
  }
  const recordOrder = ['LVEF', 'NTproBNP', 'eGFR', 'potassium', 'sodium', 'hemoglobin', 'bloodPressure', 'heartRate', 'oxygenSaturation', 'bodyWeight', 'bodyHeight']
  allEditableMetrics.sort((a, b) => recordOrder.indexOf(a.factKey) - recordOrder.indexOf(b.factKey))
  const saveMetrics = (changes: RecordValueChange[]) => {
    const entries: NonNullable<ClinicVitalsPatch['entries']> = {}
    for (const { metric, values, measuredOn } of changes) {
      if (metric.factKey === 'LVEF') {
        onAnswerPhenotype?.({ ...phenotypeAnswer, choice: undefined, lvef: values?.[0], measuredOn: values ? measuredOn : undefined, answeredOn: todayIsoDate(now) })
      } else if (metric.factKey === 'bloodPressure') {
        entries.systolic = values ? { value: values[0], measuredOn } : null
        entries.diastolic = values ? { value: values[1], measuredOn } : null
      } else {
        const key = METRIC_ENTRY_KEYS[metric.factKey as keyof typeof METRIC_ENTRY_KEYS]
        if (key) entries[key] = values ? { value: values[0], measuredOn } : null
        if (metric.factKey === 'NTproBNP') onSaveHfpefInputs?.({ ntprobnp: null })
      }
    }
    if (Object.keys(entries).length) onSaveClinicVitals?.({ entries })
    setEditingMetric(null)
    setRecordValuesOpen(false)
  }
  const saveMetric = (metric: HeartFailureMetric, values: number[] | null, measuredOn: string) => saveMetrics([{ metric, values, measuredOn }])
  return { editingMetric, setEditingMetric, recordValuesOpen, setRecordValuesOpen, allEditableMetrics, saveMetrics, saveMetric }
}

/**
 * The row that would order an NT-proBNP, where the pack raised one.
 *
 * Read off the pack's own 「這項決策還缺」 rather than named here: which module
 * asks for the assay is the pack's to decide, and a hard-coded module id would
 * send the reader to a row that had moved.
 */
function natriureticRowId(flow: VisitFlowModel): string | undefined {
  return flow.actionGroups
    .flatMap((group) => group.rows)
    .find((row) => (
      row.recommendation.missingData?.some((item) => /NT-proBNP|BNP/i.test(item))
      || /NT-proBNP/i.test(row.headline)
    ))?.recommendation.id
}

/* ----------------------------------------------------------- 區塊 1 步驟列 */

function StepIcon({ state }: { state: VisitStep['state'] }) {
  if (state === 'done') {
    return <Check className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
  }
  if (state === 'na') {
    return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  }
  return (
    <Circle
      className={cn(
        'h-4 w-4 shrink-0',
        state === 'current' ? 'fill-primary/15 text-primary' : 'text-muted-foreground/60',
      )}
      aria-hidden="true"
    />
  )
}

function StepCard({
  steps,
  nextStep,
  isEnglish,
  onGo,
  summaryText,
}: {
  steps: readonly VisitStep[]
  nextStep: VisitFlowModel['nextStep']
  isEnglish: boolean
  onGo: () => void
  summaryText: string
}) {
  const { copied, copy } = useCopyToClipboard()
  const isCopy = nextStep.target.kind === 'copy'
  const stateText: Record<VisitStep['state'], string> = {
    done: isEnglish ? 'done' : '完成',
    current: isEnglish ? 'in progress' : '進行中',
    todo: isEnglish ? 'not started' : '尚未',
    na: isEnglish ? 'not applicable' : '不適用',
  }
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label={isEnglish ? 'Visit progress' : '看診進度'}
      data-testid="cdss-hf-steps"
    >
      <ol className="grid divide-y divide-border @min-[40rem]:grid-cols-4 @min-[40rem]:divide-x @min-[40rem]:divide-y-0">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn('flex min-h-11 items-start gap-2 px-3 py-2', step.state === 'current' && 'bg-primary/[0.04]')}
            data-testid={`cdss-hf-step-${step.id}`}
            data-state={step.state}
          >
            <span className="mt-0.5 flex items-center gap-1.5">
              <StepIcon state={step.state} />
              <span className={cn(
                'text-[11px] font-semibold tabular-nums',
                step.state === 'current' ? 'text-primary' : 'text-muted-foreground',
              )}>
                {step.index}
              </span>
            </span>
            <span className="min-w-0">
              <span className={cn(
                'block text-sm font-semibold leading-5',
                step.state === 'todo' || step.state === 'na' ? 'text-muted-foreground' : 'text-foreground',
              )}>
                {step.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {step.detail}
              </span>
              <span className="sr-only">{stateText[step.state]}</span>
            </span>
          </li>
        ))}
      </ol>

      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2.5',
          nextStep.tone === 'safety'
            ? 'bg-amber-50 dark:bg-amber-500/[0.08]'
            : nextStep.tone === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-500/[0.08]'
              : 'bg-primary/[0.05]',
        )}
        data-testid="cdss-hf-next-step"
        data-tone={nextStep.tone}
      >
        {nextStep.tone === 'safety' ? (
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        ) : nextStep.tone === 'ok' ? (
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
        ) : (
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-5 text-foreground">
            {nextStep.message}
          </span>
          {nextStep.hint ? (
            <span
              className="mt-0.5 block text-[11px] leading-4 text-muted-foreground"
              data-testid="cdss-hf-next-step-hint"
            >
              {nextStep.hint}
            </span>
          ) : null}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => {
            if (!isCopy) {
              onGo()
              return
            }
            void copy(summaryText).then((ok) => {
              if (!ok) {
                toast.error(isEnglish
                  ? 'Could not copy — the clipboard is unavailable in this context.'
                  : '無法複製，此環境無法使用剪貼簿。')
              }
            })
          }}
          data-testid="cdss-hf-next-step-action"
        >
          {isCopy && copied
            ? (isEnglish ? 'Copied' : '已複製')
            : nextStep.actionLabel}
        </Button>
      </div>
    </section>
  )
}

/* ------------------------------------------------- 區塊 2 系統已從病歷讀到 */

const MISSING_PATTERN_STYLE = { backgroundImage: 'var(--clinical-missing-data-pattern)' } as const

function metricSourceLine(
  metric: HeartFailureMetric,
 ): string | undefined {
  const day = formatDay(metric.date)
  if (metric.entered) {
    return day
  }
  if (!day) return undefined
  return day
}

function RecordCard({
  rhythmPanel,
  metrics,
  isEnglish,
  canEdit,
  onOpenForm,
}: {
  rhythmPanel?: ReactNode
  metrics: readonly HeartFailureMetric[]
  isEnglish: boolean
  canEdit: boolean
  onOpenForm: () => void
}) {
  const weightMetric = metrics.find((item) => item.factKey === 'bodyWeight')
  const heightMetric = metrics.find((item) => item.factKey === 'bodyHeight')
  const weight = Number.parseFloat(weightMetric?.value ?? '')
  const height = Number.parseFloat(heightMetric?.value ?? '')
  const bmi = Number.isFinite(weight) && weight > 0 && Number.isFinite(height) && height > 0
    ? (weight / (height / 100) ** 2).toFixed(1)
    : undefined
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label={isEnglish ? 'Read from the record' : '系統已從病歷讀到'}
      data-testid="cdss-hf-record-values"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-indigo-700 dark:text-secondary-foreground/80">
          {isEnglish ? 'Read from the record' : '系統已從病歷讀到'}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {isEnglish ? 'Clinical inputs for the decisions' : '決策所需臨床資訊'}
        </span>
        {canEdit ? (
          <button
            type="button"
            className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpenForm}
            data-testid="cdss-hf-record-values-edit"
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
            {isEnglish ? 'Edit clinical values' : '補填／修改臨床數值'}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 @min-[24rem]:grid-cols-3 @min-[32rem]:grid-cols-5 @min-[40rem]:grid-cols-[11rem_repeat(5,minmax(0,1fr))]">
        {metrics.map((metric) => {
          const isLvef = metric.factKey === 'LVEF'
          const isBmi = metric.factKey === 'bodyHeight'
          const displayedValue = isBmi ? bmi : metric.value
          const missing = displayedValue === undefined
          const source = isBmi
            ? (isEnglish ? 'Calculated from height & weight' : '由身高、體重計算')
            : metricSourceLine(metric)
          return (
            <div
              key={metric.factKey}
              className={cn(
                'min-w-0 border-b border-r border-border/60 px-3 py-2',
                isLvef && 'relative col-span-full grid grid-cols-1 p-0 @min-[24rem]:grid-cols-2 @min-[40rem]:col-span-1 @min-[40rem]:row-span-2 @min-[40rem]:grid-cols-1 @min-[40rem]:grid-rows-subgrid',
                metric.factKey === 'bloodPressure' && 'col-start-1 @min-[40rem]:col-start-auto',
                missing && 'bg-muted/40',
              )}
              style={missing ? MISSING_PATTERN_STYLE : undefined}
              title={isBmi ? `${weightMetric?.value ?? '—'} kg (${weightMetric?.date ?? '—'}) / ${heightMetric?.value ?? '—'} cm (${heightMetric?.date ?? '—'})` : metric.fullValue}
              data-testid={`cdss-hf-flow-metric-${metric.factKey}`}
              data-missing={missing ? 'true' : undefined}
              data-stale={metric.stale ? 'true' : undefined}
              data-entered={metric.entered ? 'true' : undefined}
            >
              <div className={isLvef ? "relative flex w-full flex-col items-start px-3 py-2" : undefined}>
              <div className="truncate text-[11px] font-medium leading-4 text-muted-foreground">
                {isBmi ? 'BMI' : metric.label}
                {isBmi ? <span className="ml-1 font-normal opacity-80">kg/m²</span> : metric.unit ? <span className="ml-1 font-normal opacity-80">{metric.unit}</span> : null}
              </div>
              {missing ? (
                <>
                  <div className="mt-0.5 text-sm font-medium leading-5 text-muted-foreground">
                    {isEnglish ? 'No value in the record' : '紀錄無值'}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                  <div className={cn(
                    'mt-0.5 font-semibold tabular-nums',
                    isLvef ? 'text-2xl leading-tight tracking-tight' : 'truncate text-base leading-5',
                    metric.stale ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
                  )}>
                    {displayedValue}
                  </div>
                  </div>
                  <div className="flex w-full items-center justify-between gap-2">
                  {source ? (
                    <div className={cn(
                      'truncate text-[11px] leading-4 tabular-nums',
                      metric.stale
                        ? 'font-medium text-amber-700 dark:text-amber-300'
                        : metric.entered
                          ? 'font-medium text-primary'
                          : 'text-muted-foreground',
                    )}>
                      {source}
                      {metric.stale && metric.ageDays !== undefined
                        ? ` · ${isEnglish ? `${metric.ageDays}d` : `${metric.ageDays} 天`}`
                        : ''}
                    </div>
                  ) : null}
                  {isLvef ? <EchoReportButton metric={metric} isEnglish={isEnglish} /> : null}
                  </div>
                </>
              )}

              {isLvef && missing ? <EchoReportButton metric={metric} isEnglish={isEnglish} /> : null}
              </div>
              {isLvef && rhythmPanel ? <div className="relative border-t border-border px-3 py-2 @min-[24rem]:border-l @min-[24rem]:border-t-0 @min-[40rem]:border-l-0 @min-[40rem]:border-t">{rhythmPanel}</div> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* --------------------------------------------------- 區塊 3 需要你判斷 */

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onSelect,
  testId,
  disabled,
  equalWidth = false,
}: {
  label: string
  options: readonly { id: T; text: string; description?: string }[]
  value: T | null
  onSelect: (next: T) => void
  testId: string
  disabled?: boolean
  equalWidth?: boolean
}) {
  return (
    <div
      className={cn("shrink-0 overflow-hidden rounded-md border border-border", equalWidth ? "inline-grid w-fit max-w-full grid-flow-col auto-cols-fr" : "flex")}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {options.map((option) => {
        const isSelected = value === option.id
        const button = (
          <button
            key={option.id}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            className={cn(
              'min-h-8 min-w-[2.5rem] px-2.5 text-xs font-medium transition-colors',
              'border-r border-border last:border-r-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isSelected
                ? 'bg-primary/10 text-primary'
                : 'bg-card text-muted-foreground hover:bg-muted/40',
            )}
            onClick={() => onSelect(option.id)}
            data-testid={`${testId}-${option.id}`}
          >
            {option.text}
          </button>
        )
        return option.description ? (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-72 leading-relaxed">
              <span className="font-semibold">NYHA {option.text}</span><br />{option.description}
            </TooltipContent>
          </Tooltip>
        ) : button
      })}
    </div>
  )
}

/** The one-character side tag in front of a symptom or a sign. */
const SIDE_TAG_CLASS: Readonly<Record<VisitSignSide, string>> = {
  pulmonary: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200',
  systemic: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  both: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
}

function SideTag({ side, isEnglish }: { side: VisitSignSide; isEnglish: boolean }) {
  const meta = VISIT_SIDE_LABELS[side]
  return (
    <span
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none',
        SIDE_TAG_CLASS[side],
      )}
      title={isEnglish ? meta.legendEn : meta.legendZh}
      data-testid={`cdss-hf-side-tag-${side}`}
    >
      {isEnglish ? meta.tagEn : meta.tagZh}
    </span>
  )
}

/** 「肺鬱血 2 · 體循環 2」 beside the folded answer of question ④. */
function SideTallyChip({
  tally,
  isEnglish,
}: {
  tally: { pulmonary: number; systemic: number }
  isEnglish: boolean
}) {
  if (tally.pulmonary === 0 && tally.systemic === 0) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-px text-[11px] tabular-nums text-muted-foreground"
      data-testid="cdss-hf-side-tally"
      data-pulmonary={tally.pulmonary}
      data-systemic={tally.systemic}
    >
      <span>{isEnglish ? `Pulmonary ${tally.pulmonary}` : `肺鬱血 ${tally.pulmonary}`}</span>
      <span aria-hidden="true">·</span>
      <span>{isEnglish ? `Systemic ${tally.systemic}` : `體循環 ${tally.systemic}`}</span>
    </span>
  )
}

/**
 * One question's rows: a side tag, the finding, and 有／無／未評估.
 *
 * The 常見 rows are open; the rest fold behind 「更多 n 項」, whose folded line
 * names them so the reader knows what is behind it rather than having to open
 * it to find out. Each row writes its own term with its own stamp — a visit
 * where only 腳腫 was asked about says exactly that.
 *
 * 「全部皆無」 answers 無 for every row of the question in one press, the folded
 * ones included (the button says how many it covers, and opens them so the
 * answers are on screen). Once any row is 有 it
 * reads 「其餘皆無」 and leaves the 有 rows as they are. It is a toggle: while
 * every row it covers reads 無 it shows pressed, and a second press puts those
 * rows back as they were before the first — or unanswered, when this block
 * was closed in between and no longer remembers.
 */
function SignItemRows({
  questionId,
  items,
  clinicVitals,
  isEnglish,
  showLegend,
  compact = false,
  onAnswer,
  onAnswerAll,
}: {
  questionId: VisitQuestionId
  items: readonly VisitSignItem[]
  clinicVitals?: ClinicVitals
  isEnglish: boolean
  showLegend: boolean
  /**
   * The map: 全部皆無／其餘皆無 sits at the foot beside 更多, where the list is
   * finished — not alone on a row above it.
   */
  compact?: boolean
  onAnswer: (term: string, value: SignAnswerValue) => void
  onAnswerAll?: (answers: Record<string, SignAnswerValue | null>) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const carriedLookup = useCarriedLookup()
  // What the rows held before 全部皆無 was pressed, so a second press restores it.
  const [beforeNone, setBeforeNone] = useState<Record<string, SignAnswerValue | null> | null>(null)
  const common = items.filter((item) => item.common)
  const more = items.filter((item) => !item.common)
  const answerOf = (term: string) => clinicVitals?.signAnswers?.[term]?.value
  const anyPresent = items.some((item) => answerOf(item.term) === 'present')
  const noneTargets = items.filter((item) => answerOf(item.term) !== 'present')
  const allNone = noneTargets.length > 0 && noneTargets.every((item) => answerOf(item.term) === 'absent')
  const foldedTargets = moreOpen ? 0 : noneTargets.filter((item) => !item.common).length
  const noneLabel = anyPresent
    ? (isEnglish ? 'Rest: none' : '其餘皆無')
    : (isEnglish ? 'None of these' : '全部皆無')
  const noneTitle = allNone
    ? (isEnglish ? 'Press again to restore these rows' : '再按一次，恢復成按下前的答案')
    : isEnglish
      ? `Mark ${noneTargets.length} finding${noneTargets.length === 1 ? '' : 's'} as absent${foldedTargets ? `, including ${foldedTargets} folded under more` : ''}`
      : `把 ${noneTargets.length} 項記為「無」${foldedTargets ? `，含收起的 ${foldedTargets} 項` : ''}`
  const toggleNone = () => {
    if (!onAnswerAll) return
    if (allNone) {
      // Only rows still reading 無 go back; a row changed since keeps its answer.
      const restore: Record<string, SignAnswerValue | null> = {}
      for (const item of noneTargets) {
        if (answerOf(item.term) !== 'absent') continue
        restore[item.term] = beforeNone ? (beforeNone[item.term] ?? null) : null
      }
      setBeforeNone(null)
      onAnswerAll(restore)
      return
    }
    setBeforeNone(Object.fromEntries(noneTargets.map((item) => [item.term, answerOf(item.term) ?? null])))
    onAnswerAll(Object.fromEntries(noneTargets.map((item) => [item.term, 'absent' as const])))
    // The folded rows were answered too: open them so the answer is seen, not assumed.
    if (foldedTargets > 0) setMoreOpen(true)
  }
  const noneButton = onAnswerAll ? (
            <button
              type="button"
              className={cn(
                'ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60',
                allNone
                  ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border bg-background text-foreground hover:bg-muted/60',
              )}
              disabled={noneTargets.length === 0}
              aria-pressed={allNone}
              title={noneTitle}
              onClick={toggleNone}
              data-testid={`cdss-hf-sign-none-${questionId}`}
            >
              {allNone ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              {noneLabel}
              {allNone ? (
                <span className="font-normal">{isEnglish ? '· press again to undo' : '· 再按一次復原'}</span>
              ) : foldedTargets ? (
                <span className="font-normal text-muted-foreground">
                  {isEnglish ? `(incl. ${foldedTargets} folded)` : `（含收起 ${foldedTargets} 項）`}
                </span>
              ) : null}
            </button>
  ) : null
  const moreButton = (
    <button
      type="button"
      className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={moreOpen}
      onClick={() => setMoreOpen((open) => !open)}
      data-testid={`cdss-hf-sign-more-${questionId}`}
    >
      <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', moreOpen && 'rotate-180')} aria-hidden="true" />
      {isEnglish ? `${more.length} more` : `更多 ${more.length} 項`}
      {moreOpen ? null : (
        <span className="min-w-0 truncate font-normal text-muted-foreground">
          {more
            .map((item) => `${isEnglish ? item.shortEn : item.shortZh}（${isEnglish ? VISIT_SIDE_LABELS[item.side].tagEn : VISIT_SIDE_LABELS[item.side].tagZh}）`)
            .join(' · ')}
        </span>
      )}
    </button>
  )
  const row = (item: VisitSignItem) => {
    const visibleLabel = isEnglish ? item.en : item.zh
    const carried = carriedLookup(`sign:${item.term}`)
    return <div key={item.term} className="flex flex-wrap items-center gap-2">
      <SideTag side={item.side} isEnglish={isEnglish} />
      <span className="min-w-0 flex-1 text-xs text-foreground">
        {visibleLabel}
        {carried ? (
          <span className="ml-1.5 inline-flex items-center rounded border border-primary/25 bg-primary/5 px-1 text-[11px] tabular-nums text-primary" data-carried-from={carried}>
            {carriedLabel(carried, isEnglish)}
          </span>
        ) : null}
      </span>
      <SegmentedControl<SignAnswerValue>
        label={visibleLabel}
        options={[
          { id: 'present', text: isEnglish ? 'Yes' : '有' },
          { id: 'absent', text: isEnglish ? 'No' : '無' },
          { id: NOT_ASSESSED, text: isEnglish ? 'Not assessed' : '未評估' },
        ]}
        value={clinicVitals?.signAnswers?.[item.term]?.value ?? null}
        onSelect={(next) => onAnswer(item.term, next)}
        testId={`cdss-hf-flow-sign-${item.term}`}
      />
    </div>
  }
  return (
    <div className="space-y-2" data-testid={`cdss-hf-sign-items-${questionId}`}>
      {showLegend || (onAnswerAll && !compact) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {showLegend ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-muted-foreground">
              {(['pulmonary', 'systemic', 'both'] as const).map((side) => (
                <span key={side} className="inline-flex items-center gap-1">
                  <SideTag side={side} isEnglish={isEnglish} />
                  {isEnglish ? VISIT_SIDE_LABELS[side].legendEn : VISIT_SIDE_LABELS[side].legendZh}
                </span>
              ))}
            </p>
          ) : null}
          {onAnswerAll && !compact ? noneButton : null}
        </div>
      ) : null}
      <div className="grid gap-x-6 gap-y-1.5 @min-[44rem]:grid-cols-2">
        {common.map(row)}
        {moreOpen ? more.map(row) : null}
      </div>
      {compact && (more.length > 0 || noneButton) ? (
        <div className="flex flex-wrap items-center gap-2">
          {more.length > 0 ? moreButton : null}
          {noneButton}
        </div>
      ) : more.length > 0 ? moreButton : null}
    </div>
  )
}

/**
 * Question ⑦: the HFpEF conclusion, with the three criteria beside it.
 *
 * Which button leads depends on what is missing. While criterion (i) is
 * undetermined the useful action is not 「確認」 but 「去答第 2 題」, because the
 * symptoms are what would settle it; a screen that led with the confirmation
 * invited a conclusion drawn over an unread criterion. 「暫不確認」 is the third
 * state and the reason this question can be finished at all: it says the
 * question was put and no diagnosis was made today, and it writes no fact —
 * 「先不確認」 is not a statement that the patient has no HFpEF.
 */
/**
 * The two scores, as the host's own calculator computed them.
 *
 * Printed from the calculator rather than waited for from the pack, because
 * the calculator is the only thing that scores: the pack reads the same
 * numbers off the facts this host wrote. A score with parameters missing is
 * never printed as a bare total — what is still unreported, and how much it
 * could still add, is on the line under it.
 */
function HfpEfScoreLine({
  reading,
  isEnglish,
  onComplete,
  compact = false,
}: {
  reading?: HfpefReading
  isEnglish: boolean
  onComplete?: (id?: HfpefScoreId) => void
  /**
   * The map's diagnosis card: no box, and the unreported parameters only
   * where they could still change a score, in the page's muted ink.
   */
  compact?: boolean
}) {
  const scores = [reading?.hfaPeff, reading?.h2fpef]
    .filter((score): score is HfpefScoreReading => Boolean(score))
  const date = scores.map((score) => score.date).filter(Boolean).sort().at(-1)
  const missing = scores.find((score) => score.missing.length > 0 && (!compact || score.upper > score.score))
  return (
    <div
      className={compact ? 'pt-0.5' : 'rounded-md border border-border bg-muted/[0.12] px-2.5 py-2'}
      data-testid="cdss-hf-hfpef-scores"
    >
      {scores.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isEnglish
            ? 'The calculator has no score yet: the record does not carry enough of the parameters.'
            : '目前的輸入不足，計算機尚無分數。'}
        </p>
      ) : (
        <>
          {scores.map((score) => (
            <p
              key={score.id}
              className="flex flex-wrap items-baseline gap-x-2 text-xs"
              data-testid={`cdss-hf-hfpef-score-${score.id}`}
            >
              {onComplete ? <button type="button" className="min-h-8 w-[5.5rem] shrink-0 text-left font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary" aria-label={`${isEnglish ? 'Open' : '開啟'} ${score.name}`} onClick={() => onComplete(score.id)}>{score.name}</button> : <span className="w-[5.5rem] shrink-0 font-semibold text-foreground">{score.name}</span>}
              <span className="font-semibold tabular-nums text-foreground">
                {score.score}
                {isEnglish ? '/' : '／'}
                {score.maximum}
              </span>
              <span className="text-muted-foreground">
                {isEnglish ? score.bandEn : score.bandZh}
              </span>
            </p>
          ))}
          {/* One line (clinician feedback 2026-09-28): the calculator, the echo it
              read, and what it could not obtain — a report value or a record
              reading such as the antihypertensive count, hence 「未取得」. */}
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {isEnglish
              ? `By calculator ${HFPEF_CALCULATOR_VERSION}${date ? ` · echo ${date}` : ''}`
              : `依計算機 ${HFPEF_CALCULATOR_VERSION}${date ? ` · 心超 ${date}` : ''}`}
            {missing ? (
              <span
                className={cn(compact ? 'text-muted-foreground' : 'text-amber-800 dark:text-amber-300')}
                data-testid="cdss-hf-hfpef-score-missing"
              >
                {isEnglish
                  ? ` · not obtained: ${missing.missingEn.join(', ')} (at most +${missing.upper - missing.score})`
                  : ` · 未取得：${missing.missingZh.join('、')}（最多再 +${missing.upper - missing.score}）`}
              </span>
            ) : null}
          </p>
        </>
      )}

    </div>
  )
}

function HfpEfConfirmation({
  summary,
  isEnglish,
  now,
  answer,
  onAnswer,
  hfpefReading,
  onOpenCalculator,
  compact = false,
}: {
  summary: DiagnosticSummary | undefined
  isEnglish: boolean
  now: Date
  answer?: PhenotypeAnswer
  onAnswer: (answer: PhenotypeAnswer) => void
  hfpefReading?: HfpefReading
  onOpenCalculator?: (id?: HfpefScoreId) => void
  /** The map: the criteria, the score and the buttons; the guideline text and the storage note one press away. */
  compact?: boolean
}) {
  const symptomsState = summary?.criteria
    .find((criterion) => criterion.id === 'symptoms-signs')?.state
  const symptomsUndetermined = symptomsState === 'undetermined'
  // 「確認」 is the same diagnosis as question 1's 「HFpEF」, so it is written
  // the same way and question 1 then carries it.
  const record = (value: true | typeof HFPEF_NOT_CONFIRMED) => onAnswer(value === true
    ? diagnosisAnswer('hfpef', answer, now)!
    : { ...(answer ?? {}), answeredOn: todayIsoDate(now), hfpEfConfirmed: value })
  return (
    <div className="space-y-2" data-testid="cdss-hf-hfpef-confirmation">
      <DiagnosisReading summary={summary} isEnglish={isEnglish} showScores={false} showBasis={!compact} />
      <HfpEfScoreLine
        reading={hfpefReading}
        isEnglish={isEnglish}
        {...(onOpenCalculator ? { onComplete: onOpenCalculator } : {})}
      />
      <div className="flex flex-wrap items-center gap-2">
        {symptomsUndetermined ? (
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={() => focusVisitFlowTarget({ kind: 'question', questionId: 'symptoms' })}
            data-testid="cdss-hf-hfpef-go-to-symptoms"
          >
            {isEnglish ? 'Go to question 2' : '前往第 2 題'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={symptomsUndetermined ? 'outline' : 'default'}
          className="h-8"
          onClick={() => record(true)}
          data-testid="cdss-hf-hfpef-confirm"
        >
          {isEnglish ? 'Confirm the HFpEF diagnosis' : '確認 HFpEF 診斷'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => record(HFPEF_NOT_CONFIRMED)}
          data-testid="cdss-hf-hfpef-defer"
        >
          {isEnglish ? 'Not confirming today' : '暫不確認'}
        </Button>
      </div>
      {compact ? (
        <details className="text-[11px] leading-4 text-muted-foreground" data-testid="cdss-hf-hfpef-basis">
          <summary className="min-h-8 cursor-pointer py-1 font-medium">{isEnglish ? 'Basis and notes' : '依據與說明'}</summary>
          {summary?.basis ? <p className="mt-1">{summary.basis}</p> : null}
          <p className="mt-1">{storageNote(isEnglish)}</p>
        </details>
      ) : (
        <p className="text-[11px] leading-4 text-muted-foreground">{storageNote(isEnglish)}</p>
      )}
    </div>
  )
}

function storageNote(isEnglish: boolean): string {
  return isEnglish
    ? 'Encrypted and kept for this tab session only; carrying it to the next visit is phase 2, and nothing is written to the chart or to any claim. The HFpEF treatment recommendations appear under today’s actions once it is confirmed.'
    : '加密保存於本分頁的工作階段，跨次就診沿用為第二階段；不寫回病歷，也不做健保申報。確認後 HFpEF 治療建議才會出現在今日處置。'
}

function ListQuestionShell({
  question,
  isEnglish,
  now,
  onEdit,
  answerBadge,
  children,
}: {
  question: VisitQuestion
  isEnglish: boolean
  now: Date
  onEdit?: () => void
  /** Shown beside the folded answer — the side tally on question ④. */
  answerBadge?: ReactNode
  /** The map's box closes an open, answered question from its header; this layout does it below. */
  onCollapse?: () => void
  children?: ReactNode
}) {
  const stamp = formatStamp(question.modifiedAt, now, isEnglish)
  const open = question.state === 'open'
  const answered = question.state === 'answered'
  // An answer brought in from a saved record says so instead of 「最後修改」 today.
  const carriedLookup = useCarriedLookup()
  const carried = !answered ? null
    : question.id === 'nyha' || question.id === 'compensation' ? carriedLookup(question.id)
      : question.id === 'symptoms' || question.id === 'signs'
        ? (question.items ?? []).map((item) => carriedLookup(`sign:${item.term}`)).find(Boolean) ?? null
        : null
  const sideBySide = ['hf-suspicion', 'lvef-phenotype', 'nyha', 'compensation'].includes(question.id)
  const editingInline = sideBySide && Boolean(children)
  return (
    <li
      id={visitQuestionElementId(question.id)}
      className={cn(
        'flex min-h-11 gap-2.5 px-3 py-2.5',
        open && 'bg-primary/[0.04]',
      )}
      data-testid={`cdss-hf-question-${question.id}`}
      data-state={question.state}
      data-number={question.number}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
          open
            ? 'bg-primary/10 text-primary'
            : answered
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
              : 'border border-dashed border-border text-muted-foreground',
        )}
      >
        {answered ? <Check className="h-3 w-3" aria-hidden="true" /> : question.number}
      </span>
      <div className={cn("min-w-0 flex-1", sideBySide && "@min-[64rem]:grid @min-[64rem]:grid-cols-[minmax(0,34rem)_auto] @min-[64rem]:justify-start @min-[64rem]:items-center @min-[64rem]:gap-x-6")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 @min-[64rem]:col-start-1">
          <span className={cn(
            'text-sm font-semibold leading-5',
            question.state === 'locked' ? 'text-muted-foreground' : 'text-foreground',
          )}>
            {question.label}
          </span>
          {answered && !editingInline && question.answerText ? (
            <span
              className="inline-flex min-h-6 items-center rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-semibold leading-4 text-primary"
              data-testid={`cdss-hf-question-answer-${question.id}`}
            >
              {question.answerText}
            </span>
          ) : null}
          {answered && answerBadge ? answerBadge : null}
          {carried ? (
            <span className="inline-flex items-center rounded border border-primary/25 bg-primary/5 px-1.5 text-[11px] tabular-nums text-primary"
              data-carried-from={carried}>
              {carriedLabel(carried, isEnglish)}
            </span>
          ) : answered && stamp ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {isEnglish ? `last changed ${stamp}` : `最後修改 ${stamp}`}
            </span>
          ) : null}
          {answered && !editingInline && onEdit ? (
            <button
              type="button"
              className="ml-auto min-h-8 min-w-14 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onEdit}
              data-testid={`cdss-hf-question-edit-${question.id}`}
            >
              {isEnglish ? 'Edit' : '修改'}
            </button>
          ) : null}
        </div>
        {question.state === 'locked' ? (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {question.lockedReason}
          </p>
        ) : (
          <>
            {question.hint ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground @min-[64rem]:col-start-1">{question.hint}</p>
            ) : null}
            {children ? <div className={cn("mt-2", sideBySide && "@min-[64rem]:col-start-2 @min-[64rem]:row-start-1 @min-[64rem]:row-span-2 @min-[64rem]:mt-0 @min-[64rem]:max-w-[36rem]")}>{children}</div> : null}
          </>
        )}
      </div>
    </li>
  )
}

function QuestionsCard({
  flow,
  isEnglish,
  now,
  clinicVitals,
  onSaveClinicVitals,
  phenotypeAnswer,
  onAnswerPhenotype,
  board,
  hfpefReading,
  onOpenCalculator,
  compact = false,
  diagnosisPoint,
}: {
  flow: VisitFlowModel
  isEnglish: boolean
  now: Date
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  onClearClinicVitals?: () => void
  phenotypeAnswer?: PhenotypeAnswer
  onAnswerPhenotype?: (answer: PhenotypeAnswer) => void
  board: HeartFailureBoardModel
  hfpefReading?: HfpefReading
  onOpenCalculator?: (id?: HfpefScoreId) => void
  /**
   * The map's one card, numbered in reasoning order: no note explaining why
   * the HFpEF question comes last, and that question's guideline text folded.
   */
  compact?: boolean
  /**
   * On the map, the decision point the diagnosis question is (HF: DP-01): the
   * question is drawn as that point, beside the map's other points, rather
   * than as a row of this card.
   */
  diagnosisPoint?: { dp: string; label: string }
}) {
  // A question a clinician answered can be reopened; the row is otherwise one
  // line, which is the point — the same question is not asked twice.
  const [reopened, setReopened] = useState<ReadonlySet<VisitQuestionId>>(new Set())
  const [collapsedItems, setCollapsedItems] = useState<ReadonlySet<VisitQuestionId>>(new Set())
  const reopen = (id: VisitQuestionId) => {
    setReopened(current => new Set(current).add(id))
    setCollapsedItems(current => { const next = new Set(current); next.delete(id); return next })
  }
  const diagnosisCard = board.hfpEfDiagnosis
  const diagnosisSummary = diagnosisCard ? diagnosticSummaryOf(diagnosisCard) : undefined
  // 「還不確定」 on the map: question 1 stays open — the verdict is given there
  // once the evidence is in — and the HFpEF criteria come up right under it,
  // so what is still missing is read before the symptoms and signs below.
  const unsure = compact && phenotypeAnswer?.hfSuspicion === 'suspected' && !phenotypeAnswer?.diagnosis
  // Where the card still carries the HFpEF question, the criteria are drawn
  // there instead, once.
  const evidenceUnderDiagnosis = unsure && Boolean(diagnosisSummary)
    && !flow.questions.some((question) => question.id === 'hfpef-confirmation')
  const shows = (question: VisitQuestion) => (
    question.items
      ? !collapsedItems.has(question.id)
      : question.state === 'open' || reopened.has(question.id) || (question.id === 'hf-suspicion' && unsure)
  )

  const answerDiagnosis = (question: VisitQuestion) => (next: PhenotypeAnswer) => {
    setReopened((current) => { const rest = new Set(current); rest.delete(question.id); return rest })
    onAnswerPhenotype?.(next)
  }
  const pointQuestion = compact && diagnosisPoint
    ? flow.questions.find((question) => question.id === 'hf-suspicion')
    : undefined
  // Once HFpEF is the answer, what it rests on stays one press away under it:
  // DP-34 「HFpEF 證實」 says its criteria open in 01, and a diagnosis nobody
  // can re-read is one nobody can audit. Folded — the question is settled.
  const hfpEfAnswered = phenotypeAnswer?.diagnosis
    ? phenotypeAnswer.diagnosis === 'hfpEF'
    : pointQuestion?.request?.recordedOptionId === 'hfpef'
  const evidenceUnderAnswer = Boolean(pointQuestion && !shows(pointQuestion) && hfpEfAnswered && diagnosisSummary && diagnosisCard)
  // Drawn as DP-01, the diagnosis leaves the card; what stays numbers from 1.
  const listed = pointQuestion
    ? flow.questions.filter((question) => question !== pointQuestion).map((question, index) => ({ ...question, number: String(index + 1) }))
    : flow.questions

  return (
    <>
    {pointQuestion && diagnosisPoint ? (
      <MapDiagnosisPoint
        question={pointQuestion}
        point={diagnosisPoint}
        open={shows(pointQuestion)}
        isEnglish={isEnglish}
        now={now}
        answer={phenotypeAnswer}
        {...(onAnswerPhenotype && !flow.readOnly ? { onAnswer: answerDiagnosis(pointQuestion), onEdit: () => reopen(pointQuestion.id) } : {})}
        {...(reopened.has(pointQuestion.id) ? { onCollapse: () => setReopened((current) => { const rest = new Set(current); rest.delete(pointQuestion.id); return rest }) } : {})}
        evidence={evidenceUnderDiagnosis && diagnosisSummary && diagnosisCard ? (
          <div className="space-y-1.5" data-testid="cdss-hf-hfpef-evidence">
            <HfpEfCriteriaList
              summary={diagnosisSummary}
              card={diagnosisCard}
              isEnglish={isEnglish}
              symptomsHint={isEnglish ? 'tick them in the assessment below' : '在下方勾選'}
            />
            <HfpEfScoreLine
              compact
              reading={hfpefReading}
              isEnglish={isEnglish}
              {...(onOpenCalculator ? { onComplete: onOpenCalculator } : {})}
            />
          </div>
        ) : undefined}
        record={evidenceUnderAnswer && diagnosisSummary && diagnosisCard ? (
          <HfpEfEvidenceFold summary={diagnosisSummary} isEnglish={isEnglish}>
            <HfpEfCriteriaList
              summary={diagnosisSummary}
              card={diagnosisCard}
              isEnglish={isEnglish}
              symptomsHint={isEnglish ? 'record them under Follow-up' : '可在「追蹤」補記'}
            />
            <HfpEfScoreLine
              compact
              reading={hfpefReading}
              isEnglish={isEnglish}
              {...(onOpenCalculator ? { onComplete: onOpenCalculator } : {})}
            />
          </HfpEfEvidenceFold>
        ) : undefined}
      />
    ) : null}
    {listed.length > 0 ? (
    <section
      className={compact ? 'space-y-2' : 'overflow-hidden rounded-lg border border-border bg-card'}
      aria-label={isEnglish ? "This visit's assessment" : '本次評估'}
      data-testid="cdss-hf-questions"
    >
      {/* The map titles the card itself and counts in its section bar. */}
      {!compact ? (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-violet-700 dark:text-secondary-foreground/80">
          {isEnglish ? 'Your judgement' : '需要你判斷'}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {isEnglish ? "This visit's assessment" : '本次評估'}
        </span>
        <span
          className="ml-auto text-[11px] tabular-nums text-muted-foreground"
          data-testid="cdss-hf-questions-remaining"
        >
          {flow.openQuestionCount > 0
            ? (isEnglish ? `${flow.openQuestionCount} left` : `還有 ${flow.openQuestionCount} 題`)
            : (isEnglish ? 'Assessment complete' : '本次評估完成')}
        </span>
      </div>
      ) : null}
      {!compact && flow.questions.some((question) => question.id === 'hfpef-confirmation') ? (
        <p
          className="border-b border-border px-3 py-1.5 text-[11px] leading-4 text-muted-foreground"
          data-testid="cdss-hf-questions-hfpef-note"
        >
          {isEnglish
            ? 'A patient with an LVEF of 50% or more gets one more question at the end of this assessment. It reads the answers to questions 2 and 3 to judge criterion (i), which is why it comes last.'
            : 'LVEF ≥50% 的病人在本次評估最後多一題。它讀第 2、3 題的答案判條件 (i)，所以排在後面。'}
        </p>
      ) : null}
      {flow.readOnly ? (
        <p
          className="px-3 py-2 text-xs text-muted-foreground"
          data-testid="cdss-hf-questions-read-only"
        >
          {isEnglish ? 'Load a patient record to answer.' : '需載入病人才能作答。'}
        </p>
      ) : null}
      <ul className={compact ? 'space-y-2' : 'divide-y divide-border'}>
        {listed.map((question) => {
          const editable = !flow.readOnly
          const onEdit = editable ? () => reopen(question.id) : undefined
          // The map draws each question as it draws a point: a box of its own.
          const QuestionShell = compact ? MapQuestionBox : ListQuestionShell
          const onCollapse = !compact || question.state !== 'answered'
            ? undefined
            : question.items
              ? () => setCollapsedItems((current) => new Set(current).add(question.id))
              : reopened.has(question.id)
                ? () => setReopened((current) => { const rest = new Set(current); rest.delete(question.id); return rest })
                : undefined

          if (question.id === 'hf-suspicion' || question.id === 'lvef-phenotype') {
            const shell = (
              <QuestionShell
                key={question.id}
                question={question}
                isEnglish={isEnglish}
                now={now}
                onEdit={onEdit}
                onCollapse={onCollapse}
              >
                {shows(question) && question.request && onAnswerPhenotype && question.recommendationId ? (
                  <PhysicianInputRequestPanel
                    inline
                    requests={[question.request]}
                    recommendationId={question.recommendationId}
                    isEnglish={isEnglish}
                    answer={phenotypeAnswer}
                    onAnswer={answerDiagnosis(question)}
                    now={now}
                  />
                ) : null}
              </QuestionShell>
            )
            return shell
          }

          if (question.id === 'hfpef-confirmation') {
            return (
              <QuestionShell
                key={question.id}
                question={question}
                isEnglish={isEnglish}
                now={now}
                onEdit={onEdit}
                onCollapse={onCollapse}
              >
                {shows(question) && onAnswerPhenotype ? (
                  <HfpEfConfirmation
                    summary={diagnosisSummary}
                    isEnglish={isEnglish}
                    now={now}
                    answer={phenotypeAnswer}
                    onAnswer={onAnswerPhenotype}
                    hfpefReading={hfpefReading}
                    onOpenCalculator={onOpenCalculator}
                    compact={compact}
                  />
                ) : null}
              </QuestionShell>
            )
          }

          if (question.id === 'nyha') {
            const value = clinicVitals?.nyhaClass?.value ?? null
            return (
              <QuestionShell
                key={question.id}
                question={question}
                isEnglish={isEnglish}
                now={now}
                onEdit={onEdit}
                onCollapse={onCollapse}
              >
                {shows(question) && onSaveClinicVitals ? (
                  <SegmentedControl<NyhaAnswerValue>
                    equalWidth
                    label={question.label}
                    options={[
                      { id: 'I', text: 'I', description: isEnglish ? 'Activity is unrestricted; usual daily exertion does not provoke undue fatigue, palpitations or breathlessness.' : '日常活動不受限制；一般活動不會引起明顯疲倦、心悸或呼吸困難。' },
                      { id: 'II', text: 'II', description: isEnglish ? 'Mild activity restriction: comfortable at rest, but usual daily exertion brings on fatigue, palpitations or breathlessness.' : '活動輕度受限；休息時舒適，但一般日常活動會引起疲倦、心悸或呼吸困難。' },
                      { id: 'III', text: 'III', description: isEnglish ? 'Substantial activity restriction: comfortable at rest, but symptoms develop with lighter-than-usual daily exertion.' : '活動明顯受限；休息時舒適，但低於一般日常活動的程度就會引起症狀。' },
                      { id: 'IV', text: 'IV', description: isEnglish ? 'Heart failure symptoms occur at rest, and any physical exertion increases discomfort.' : '休息時也有心衰竭症狀，任何身體活動都會增加不適。' },
                      { id: NOT_ASSESSED, text: isEnglish ? 'Not assessed' : '未評估' },
                    ]}
                    value={value}
                    onSelect={(next) => onSaveClinicVitals({ nyhaClass: next })}
                    testId="cdss-hf-flow-nyha"
                  />
                ) : null}
              </QuestionShell>
            )
          }

          if (question.items) {
            return (
              <QuestionShell
                key={question.id}
                question={question}
                isEnglish={isEnglish}
                now={now}
                onEdit={onEdit}
                onCollapse={onCollapse}
                answerBadge={question.sideTally ? (
                  <SideTallyChip tally={question.sideTally} isEnglish={isEnglish} />
                ) : undefined}
              >
                {shows(question) && onSaveClinicVitals ? (
                  <div>
                  <SignItemRows
                    questionId={question.id}
                    items={question.items}
                    clinicVitals={clinicVitals}
                    isEnglish={isEnglish}
                    showLegend={question.id === 'symptoms'}
                    compact={compact}
                    onAnswer={(term, next) => {
                      reopen(question.id)
                      onSaveClinicVitals({ signAnswers: { [term]: next } })
                    }}
                    onAnswerAll={(answers) => {
                      reopen(question.id)
                      onSaveClinicVitals({ signAnswers: answers })
                    }}
                  />
                  {question.state === 'answered' && !compact ? <button type="button" className="mt-2 min-h-8 text-xs font-medium text-primary hover:underline" onClick={() => setCollapsedItems(current => new Set(current).add(question.id))}>{isEnglish ? 'Collapse' : '收合'}</button> : null}
                  </div>
                ) : null}
              </QuestionShell>
            )
          }

          if (question.id === 'compensation') {
            return (
              <QuestionShell
                key={question.id}
                question={question}
                isEnglish={isEnglish}
                now={now}
                onEdit={onEdit}
                onCollapse={onCollapse}
              >
                {shows(question) && onSaveClinicVitals ? (
                  <SegmentedControl<CompensationAnswerValue>
                    equalWidth
                    label={question.label}
                    options={[
                      { id: 'compensated', text: isEnglish ? 'Compensated' : '代償' },
                      { id: 'decompensated', text: isEnglish ? 'Decompensated' : '失代償' },
                      { id: NOT_ASSESSED, text: isEnglish ? 'Not assessed' : '未評估' },
                    ]}
                    value={clinicVitals?.compensationStatus?.value ?? null}
                    onSelect={(next) => onSaveClinicVitals({ compensationStatus: next })}
                    testId="cdss-hf-flow-compensation"
                  />
                ) : null}
              </QuestionShell>
            )
          }

          return null
        })}
      </ul>
    </section>
    ) : null}
    </>
  )
}

/**
 * A question on the map, drawn as the map draws a point (clinician feedback
 * 2026-09-28: 「排版醜醜，而且 UI 一樣不太符合決策地圖風格」): a box of its
 * own, the question's number where a point has its code, its name, and —
 * folded — the answer in one line with 修改; open, its controls under a
 * header that carries 收合. No green tick, no stamp, no pill of 「：−」s.
 *
 * Answered, the question steps back to a grey label and the answer reads as
 * the result: bolder, on a rule of its own (clinician feedback 2026-09-28:
 * 「結果跟標題可以有一點 UI 上的區隔嗎」).
 */
function MapQuestionBox({
  question,
  isEnglish,
  onEdit,
  onCollapse,
  answerBadge,
  children,
}: {
  question: VisitQuestion
  isEnglish: boolean
  now: Date
  onEdit?: () => void
  answerBadge?: ReactNode
  onCollapse?: () => void
  children?: ReactNode
}) {
  const answered = question.state === 'answered'
  const open = Boolean(children)
  const settled = answered && !open
  const action = 'min-h-8 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <li
      id={visitQuestionElementId(question.id)}
      className="scroll-mt-2 rounded-md border border-border bg-background px-2.5 py-2"
      data-testid={`cdss-hf-question-${question.id}`}
      data-state={question.state}
      data-number={question.number}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">{question.number}</span>
        <span className={cn('text-sm font-medium', question.state === 'locked' || settled ? 'text-muted-foreground' : 'text-foreground')}>{question.label}</span>
        {settled && answerBadge ? answerBadge : null}
        {open && onCollapse ? (
          <button type="button" className={cn('ml-auto', action)} onClick={onCollapse} data-testid={`cdss-hf-question-collapse-${question.id}`}>
            {isEnglish ? 'Collapse' : '收合'}
          </button>
        ) : null}
        {settled && onEdit ? (
          <button type="button" className={cn('ml-auto', action)} onClick={onEdit} data-testid={`cdss-hf-question-edit-${question.id}`}>
            {isEnglish ? 'Edit' : '修改'}
          </button>
        ) : null}
      </div>
      {settled && question.answerText ? (
        <p className="mt-1.5 border-l-2 border-primary/50 pl-2 text-sm font-semibold leading-snug text-foreground" data-testid={`cdss-hf-question-answer-${question.id}`}>{question.answerText}</p>
      ) : null}
      {question.state === 'locked' ? (
        <p className="mt-1 text-xs text-muted-foreground">{question.lockedReason}</p>
      ) : open ? (
        <div className="mt-2 space-y-1.5">
          {question.hint ? <p className="text-xs text-muted-foreground">{question.hint}</p> : null}
          {children}
        </div>
      ) : null}
    </li>
  )
}

/**
 * The diagnosis question on the map, drawn as the map draws a decision point
 * (clinician feedback 2026-09-28: 「這個 UI 在決策地圖的畫面中有點不搭」): the
 * DP code and name, the state in the map's own pill, the answer with the
 * record's line beside it and 修改 — and, while it is being answered, its
 * choices and (on 還不確定) the HFpEF criteria in the same box.
 */
function MapDiagnosisPoint({
  question,
  point,
  open,
  isEnglish,
  now,
  answer,
  onAnswer,
  onEdit,
  onCollapse,
  evidence,
  record,
}: {
  question: VisitQuestion
  point: { dp: string; label: string }
  open: boolean
  isEnglish: boolean
  now: Date
  answer?: PhenotypeAnswer
  onAnswer?: (answer: PhenotypeAnswer) => void
  onEdit?: () => void
  /** Closes an answer reopened by 修改 without changing it. */
  onCollapse?: () => void
  evidence?: ReactNode
  /** What the answer rests on, folded under it once it is given. */
  record?: ReactNode
}) {
  const ask = question.label.replace(/^診斷：|^Diagnosis:\s*/, '')
  const state: DecisionPointState = !open ? 'done' : question.state === 'answered' ? 'confirm' : 'act'
  return (
    <div
      id={visitQuestionElementId(question.id)}
      className={cn('scroll-mt-2 rounded-md border bg-background px-2.5 py-2', open ? 'border-foreground' : 'border-border')}
      data-testid={`cdss-hf-question-${question.id}`}
      data-state={question.state}
      data-dp={point.dp}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">{point.dp}</span>
        <span className="text-sm font-medium text-foreground">
          {point.label}
          {open ? <span className="font-normal">{isEnglish ? `: ${ask}` : `：${ask}`}</span> : null}
        </span>
        {open && onCollapse ? (
          <button
            type="button"
            className="ml-auto min-h-8 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCollapse}
            data-testid={`cdss-hf-question-collapse-${question.id}`}
          >
            {isEnglish ? 'Keep' : '不修改'}
          </button>
        ) : null}
        {!open && onEdit ? (
          <button
            type="button"
            className="ml-auto min-h-8 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onEdit}
            data-testid={`cdss-hf-question-edit-${question.id}`}
          >
            {isEnglish ? 'Edit' : '修改'}
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <StatePill state={state} isEnglish={isEnglish} />
        {!open && question.answerText ? (
          <span className="text-sm font-medium text-foreground" data-testid={`cdss-hf-question-answer-${question.id}`}>{question.answerText}</span>
        ) : null}
        {question.hint ? <span className="min-w-0 text-xs text-muted-foreground">{!open && question.answerText ? '· ' : ''}{question.hint}</span> : null}
      </div>
      {open && question.request && question.recommendationId && onAnswer ? (
        <div className="mt-2">
          <PhysicianInputRequestPanel
            inline
            requests={[question.request]}
            recommendationId={question.recommendationId}
            isEnglish={isEnglish}
            answer={answer}
            onAnswer={onAnswer}
            now={now}
          />
        </div>
      ) : null}
      {open && evidence ? <div className="mt-2 border-t border-border/60 pt-2">{evidence}</div> : null}
      {!open && record ? <div className="mt-1.5">{record}</div> : null}
    </div>
  )
}

/**
 * The HFpEF criteria and scores under an answered 「HFpEF」, folded: its line
 * says how many criteria hold, and DP-34 — the confirmation it answers — is
 * where a press on that point lands and opens it.
 */
function HfpEfEvidenceFold({ summary, isEnglish, children }: {
  summary: DiagnosticSummary
  isEnglish: boolean
  children: ReactNode
}) {
  const met = summary.criteria.filter((criterion) => criterion.state === 'met').length
  return (
    <details className="group rounded-md border border-border/60" data-dp="DP-34" data-testid="cdss-hf-hfpef-evidence-fold">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-2 text-xs font-medium text-foreground pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">DP-34</span>
        <span>{isEnglish ? 'HFpEF criteria' : 'HFpEF 診斷依據'}</span>
        <span className="tabular-nums text-muted-foreground">
          {isEnglish ? `${met}/${summary.criteria.length} met` : `${met}/${summary.criteria.length} 成立`}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-1.5 border-t border-border/60 px-2 pb-2 pt-1.5">{children}</div>
    </details>
  )
}

/* --------------------------------------------------- 區塊 4 今日處置 */

const DOSE_EXPRESSION = '\\d+(?:\\.\\d+)?(?:/\\d+(?:\\.\\d+)?)?'

export function doseAdjustmentDefaults(medications?: string): {
  medication: string
  previous: string
  unit: string
} {
  const medication = medications?.split(/[、,;]/)[0]?.trim() ?? ''
  const hasStrength = new RegExp(
    `^.+?\\s+${DOSE_EXPRESSION}\\s*(?:mg|mcg|g|mL|units|錠)(?:\\b|$)`,
    'i',
  ).test(medication)
  return {
    medication,
    previous: hasStrength ? '1' : '',
    unit: hasStrength ? '錠' : 'mg',
  }
}

function DoseAdjustmentEditor({ initialNote, medications, defaultMedication, isEnglish, onSave }: {
  initialNote: string
  medications?: string
  defaultMedication?: string
  isEnglish: boolean
  onSave: (note: string) => void
}) {
  const dosePattern = DOSE_EXPRESSION
  const parsed = new RegExp(`^(?:(.+?)[：:])?(${dosePattern}) → (${dosePattern}) (mg|mcg|g|mL|units|錠)(?:(?: · | )(PO|IV|IM|SC))?(?:(?: · | )(QD|BID|TID|QID|QAM|QHS|PRN))?(?:；([\\s\\S]*))?$`).exec(initialNote)
  const inferred = doseAdjustmentDefaults(medications)
  // Keep the dispensed strength with the drug name. The editable numbers are
  // units per administration, so combination strengths such as 49/51 mg stay
  // intact and a change can read 1 → 0.5 tablet.
  const [medication, setMedication] = useState(parsed?.[1]?.trim() || inferred.medication || defaultMedication || '')
  const [previous, setPrevious] = useState(parsed?.[2] ?? inferred.previous)
  const [next, setNext] = useState(parsed?.[3] ?? '')
  const [unit, setUnit] = useState(parsed?.[4] ?? inferred.unit)
  const [route, setRoute] = useState(parsed?.[5] ?? 'PO')
  const [frequency, setFrequency] = useState(parsed?.[6] ?? 'QD')
  const [extra, setExtra] = useState(parsed ? parsed[7] ?? '' : initialNote)
  const validDose = (value: string, allowZero: boolean) => {
    if (!new RegExp(`^${dosePattern}$`).test(value.trim())) return false
    return value.split('/').every((part) => allowZero ? Number(part) >= 0 : Number(part) > 0)
  }
  const valid = medication.trim() !== '' && route !== '' && frequency !== ''
    && validDose(previous, true) && validDose(next, false)
    && previous.trim() !== next.trim()
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {isEnglish ? 'Medication / strength' : '藥品規格'}
            <Input value={medication} onChange={event => setMedication(event.target.value)}
              className="h-8 w-40 px-2 text-sm" placeholder={isEnglish ? 'Drug and strength' : '藥名＋規格'} />
          </label>
          <label className="flex w-14 flex-col gap-1 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{isEnglish ? 'Previous' : '原用量'}</span>
            <Input type="text" inputMode="decimal" value={previous}
              aria-label={isEnglish ? 'Previous amount' : '原每次用量'}
              onChange={event => setPrevious(event.target.value)} className="h-8 w-14 px-2 text-sm"
              placeholder="1" />
          </label>
          <span className="pb-1.5 text-sm text-muted-foreground" aria-hidden="true">→</span>
          <label className="flex w-14 flex-col gap-1 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{isEnglish ? 'New' : '新用量'}</span>
            <Input type="text" inputMode="decimal" value={next}
              aria-label={isEnglish ? 'New amount' : '新每次用量'}
              onChange={event => setNext(event.target.value)} className="h-8 w-14 px-2 text-sm" placeholder="0.5" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {isEnglish ? 'Unit' : '單位'}
            <select value={unit} onChange={event => setUnit(event.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {['錠', '顆', '包', 'mg', 'mcg', 'g', 'mL', 'units'].map(value => <option key={value} value={value}>{value === '錠' && isEnglish ? 'tablets' : value === '顆' && isEnglish ? 'capsules' : value === '包' && isEnglish ? 'packets' : value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {isEnglish ? 'Route' : '途徑'}
            <select value={route} onChange={event => setRoute(event.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {['PO', 'IV', 'IM', 'SC'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {isEnglish ? 'Frequency' : '頻次'}
            <select value={frequency} onChange={event => setFrequency(event.target.value)}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">{isEnglish ? 'Select' : '選擇'}</option>
              {['QD', 'BID', 'TID', 'QID', 'QAM', 'QHS', 'PRN'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <Button type="button" size="sm" className="h-8 shrink-0 px-3 text-sm" disabled={!valid}
          onClick={() => onSave([`${medication.trim()}：${previous.trim()} → ${next.trim()} ${unit} · ${route} · ${frequency}`, extra.trim()].filter(Boolean).join('；'))}>
          {isEnglish ? 'Record' : '記錄'}
        </Button>
      </div>
      {extra ? <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {isEnglish ? 'Existing note' : '原有備註'}
        <Input value={extra} onChange={event => setExtra(event.target.value)} className="h-9 text-sm" />
      </label> : null}
    </div>
  )
}

function DecisionControls({
  row,
  isEnglish,
  now,
  editing,
  onEdit,
  onRecordDecision,
  onClearDecision,
  packVersion,
  readOnly,
}: {
  row: VisitActionRow
  isEnglish: boolean
  now: Date
  editing: boolean
  onEdit: (editing: boolean) => void
  onRecordDecision?: (moduleId: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (moduleId: string) => void
  packVersion: string
  readOnly: boolean
}) {
  const [note, setNote] = useState(row.decision?.note ?? '')
  if (row.decisionKind === 'none' || readOnly || !onRecordDecision) return null
  const moduleId = row.recommendation.id
  const options = VISIT_DECISIONS[row.decisionKind]
  const decision = row.decision
  const recordedStamp = formatStamp(decision?.recordedAt, now, isEnglish)

  const record = (next: Partial<PhysicianDecisionInput> & { decision: PhysicianDecisionKind }) => {
    onRecordDecision(moduleId, {
      decision: next.decision,
      reasons: next.reasons ?? decision?.reasons ?? [],
      ...(next.note !== undefined ? { note: next.note } : decision?.note ? { note: decision.note } : {}),
      packVersion,
    })
  }

  if (decision && !editing) {
    return (
      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
        data-testid={`cdss-hf-decision-recorded-${moduleId}`}
        data-decision={decision.decision}
      >
        <Badge className="h-5 bg-primary/10 px-1.5 text-[11px] text-primary hover:bg-primary/10">
          {decisionLabel(decision.decision, isEnglish)}
        </Badge>
        {decision.reasons.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {decision.reasons.map((reason) => decisionReasonLabel(reason, isEnglish)).join(' · ')}
          </span>
        ) : null}
        {decision.note ? (
          <span className="text-[11px] text-foreground">{decision.note}</span>
        ) : null}
        {row.decisionSource === 'medication-record' ? (
          <span className="text-[11px] text-muted-foreground">
            {isEnglish ? 'From current medication record' : '依目前用藥紀錄帶入'}
          </span>
        ) : null}
        {recordedStamp ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">{recordedStamp}</span>
        ) : null}
        <button
          type="button"
          className="min-h-8 min-w-14 shrink-0 rounded-md px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onEdit(true)}
          data-testid={`cdss-hf-decision-edit-${moduleId}`}
        >
          {isEnglish ? 'Edit' : '修改'}
        </button>
      </div>
    )
  }

  const needsReasons = decision?.decision === 'contraindicated' || decision?.decision === 'deferred'
  const needsNote = decision?.decision === 'dose-adjusted'
  const reasonIds = decisionReasonIds(moduleId, row.decisionKind, decision?.decision)

  return (
    <div className="mt-1.5 space-y-1.5" data-testid={`cdss-hf-decision-${moduleId}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {isEnglish ? 'Your decision' : '你的處置'}
        </span>
        {options.map((option) => {
          const selected = decision?.decision === option
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              className={cn(
                'inline-flex min-h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground hover:bg-muted/40',
              )}
              onClick={() => {
                const allowedReasons = decisionReasonIds(moduleId, row.decisionKind, option)
                const sameDecision = decision?.decision === option
                const reasons = sameDecision
                  ? (decision?.reasons ?? []).filter((reason) => allowedReasons.includes(reason))
                  : []
                record({
                  decision: option,
                  reasons,
                  note: sameDecision && reasons.includes('other') ? decision?.note ?? '' : '',
                })
                // A refusal and a deferral are only half a record without the
                // reason, and a dose change without the new dose says nothing,
                // so those three keep the editor open for the second half.
                onEdit(option === 'contraindicated' || option === 'deferred' || option === 'dose-adjusted')
              }}
              data-testid={`cdss-hf-decision-${moduleId}-${option}`}
            >
              {decisionLabel(option, isEnglish)}
            </button>
          )
        })}
        {decision && onClearDecision ? (
          <button
            type="button"
            className="min-h-7 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => { onClearDecision(moduleId); onEdit(false) }}
            data-testid={`cdss-hf-decision-clear-${moduleId}`}
          >
            {isEnglish ? 'Clear' : '清除'}
          </button>
        ) : null}
      </div>

      {needsReasons ? (
        <div className="flex items-end gap-2" data-testid={`cdss-hf-decision-reasons-${moduleId}`}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {DECISION_REASONS.filter((reason) => reasonIds.includes(reason.id)).map((reason) => {
              const selected = decision?.reasons.includes(reason.id) ?? false
              return (
                <button
                  key={reason.id}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    'inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                  )}
                  onClick={() => {
                    const current = (decision?.reasons ?? []).filter((item) => reasonIds.includes(item))
                    const reasons = selected
                      ? current.filter((item) => item !== reason.id)
                      : [...current, reason.id]
                    if (decision) {
                      if (reason.id === 'other' && selected) {
                        setNote('')
                        record({ decision: decision.decision, reasons, note: '' })
                      } else {
                        record({ decision: decision.decision, reasons })
                      }
                    }
                  }}
                  data-testid={`cdss-hf-decision-reason-${moduleId}-${reason.id}`}
                >
                  {isEnglish ? reason.en : reason.zh}
                </button>
              )
            })}
            {decision?.reasons.includes('other') ? (
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={isEnglish ? 'Specify other reason' : '其他想記的一行'}
                className="h-8 w-56 px-2 text-sm md:text-sm"
                aria-label={isEnglish ? 'Other decision reason' : '其他處置原因'}
                data-testid={`cdss-hf-decision-note-${moduleId}`}
              />
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3 text-sm"
            disabled={!decision || (decision.reasons.includes('other') && !note.trim())}
            onClick={() => {
              if (!decision) return
              record({ decision: decision.decision, note: decision.reasons.includes('other') ? note.trim() : '' })
              onEdit(false)
            }}
            data-testid={`cdss-hf-decision-save-${moduleId}`}
          >
            {isEnglish ? 'Record' : '記錄'}
          </Button>
        </div>
      ) : null}

      {needsNote ? (
        <DoseAdjustmentEditor
          initialNote={decision?.note ?? ''}
          medications={row.medications}
          defaultMedication={moduleId === 'heart-failure-congestion-diuretic' ? 'Furosemide' : undefined}
          isEnglish={isEnglish}
          onSave={doseNote => { record({ decision: 'dose-adjusted', note: doseNote }); onEdit(false) }} />
      ) : null}
    </div>
  )
}

function conciseActionBasis(row: VisitActionRow): string | undefined {
  let basis = row.basis?.trim()
  if (!basis) return undefined

  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  if (row.medications && normalize(basis).includes(normalize(row.medications))) return undefined

  const topic = row.moduleName.replace(/\s*(?:治療|策略|treatment|therapy|strategy)$/i, '').trim()
  for (const separator of ['：', ':']) {
    const prefix = `${topic}${separator}`
    if (topic && normalize(basis).startsWith(normalize(prefix))) {
      basis = basis.slice(prefix.length).trim()
      break
    }
  }

  const repeatedSource = /^([^：:]+)[：:]\s*(.+)$/.exec(basis)
  if (repeatedSource && normalize(repeatedSource[2]).startsWith(`${normalize(repeatedSource[1])} `)) {
    basis = repeatedSource[2]
  }
  return basis
}

function actionCategory(row: VisitActionRow, isEnglish: boolean): { label: string; headline: string } | undefined {
  const safetyAssessment = heartFailureMedicationSafetyAssessment(row.recommendation)
  const safetyHeadline = safetyAssessment
    ? (isEnglish ? safetyAssessment.headlineEn : safetyAssessment.headlineZh)
    : undefined
  if (row.recommendation.id === 'heart-failure-ras-inhibition') {
    return {
      label: isEnglish ? 'ARNI / ACEI / ARB' : 'ARNI／ACEI／ARB',
      headline: safetyHeadline ?? (isEnglish ? 'Assess initiation or optimization.' : '評估建立或最佳化。'),
    }
  }
  if (row.recommendation.id === 'heart-failure-beta-blocker') {
    return {
      label: isEnglish ? 'Beta-blocker' : 'β 阻斷劑',
      headline: safetyHeadline ?? (isEnglish ? 'Assess initiation or optimization.' : '評估建立或最佳化。'),
    }
  }
  if (row.recommendation.id === 'heart-failure-mra') {
    return { label: 'MRA', headline: safetyHeadline ?? (isEnglish ? 'Assess initiation.' : '評估啟用。') }
  }
  if (row.recommendation.id === 'heart-failure-sglt2') {
    return {
      label: 'SGLT2i',
      headline: safetyHeadline ?? (isEnglish
        ? 'Continue at the highest tolerated dose with follow-up data.'
        : '依最高耐受劑量與追蹤資料持續治療。'),
    }
  }
  if (row.recommendation.id === 'heart-failure-congestion-diuretic') {
    return {
      label: isEnglish ? 'Loop diuretic' : 'Loop 利尿劑',
      headline: isEnglish
        ? 'When congestion signs or symptoms are present, adjust to volume status.'
        : '有鬱血症狀或徵象時，依容量狀態調整。',
    }
  }
  return undefined
}

function ActionsCard({
  flow,
  isEnglish,
  now,
  expandedId,
  onToggle,
  renderDetail,
  collapsedGroups,
  onToggleGroup,
  editingDecisions,
  onEditDecision,
  onRecordDecision,
  onClearDecision,
  packVersion,
}: {
  flow: VisitFlowModel
  isEnglish: boolean
  now: Date
  expandedId: string | null
  onToggle: (id: string) => void
  renderDetail: (recommendation: CdssRecommendation) => ReactNode
  collapsedGroups: ReadonlySet<VisitActionGroupId>
  onToggleGroup: (id: VisitActionGroupId) => void
  editingDecisions: ReadonlySet<string>
  onEditDecision: (moduleId: string, editing: boolean) => void
  onRecordDecision?: (moduleId: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (moduleId: string) => void
  packVersion: string
}) {
  const pillarIds = new Set([
    'heart-failure-ras-inhibition',
    'heart-failure-beta-blocker',
    'heart-failure-mra',
    'heart-failure-sglt2',
  ])

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label={isEnglish ? "Today's actions" : '今日處置'}
      data-testid="cdss-hf-actions"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-3 py-1.5">
        <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">
          {isEnglish ? "Today's actions" : '今日處置'}
        </span>
        <span
          className="ml-auto text-[11px] tabular-nums text-muted-foreground"
          data-testid="cdss-hf-actions-decided"
        >
          {isEnglish
            ? `${flow.decidedCount} / ${flow.decidableCount} decided`
            : `已決定 ${flow.decidedCount} / ${flow.decidableCount}`}
        </span>
      </div>
      {flow.actionGroups.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground" data-testid="cdss-hf-actions-empty">
          {isEnglish ? 'Nothing to decide this visit.' : '本次無需處理。'}
        </p>
      ) : null}

      {flow.actionGroups.map((group) => {
        const collapsed = collapsedGroups.has(group.id)
        const tone = GROUP_PRESENTATION[group.id]
        const pillarRows = group.id === 'actionable'
          ? group.rows.filter((row) => pillarIds.has(row.recommendation.id))
          : []
        const showFourPillars = pillarRows.length === 4
        const decidedPillars = pillarRows.filter((row) => row.decision).length
        return (
          <div key={group.id} data-testid={`cdss-hf-action-group-${group.id}`}>
            <button
              type="button"
              className="flex h-7 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-expanded={!collapsed}
              onClick={() => onToggleGroup(group.id)}
              data-testid={`cdss-hf-action-group-trigger-${group.id}`}
            >
              <span className={cn('flex min-w-0 shrink items-center gap-1.5', tone.toneClass)}>
                <span className="text-[11px] font-semibold leading-none">{group.label}</span>
                <span className="text-[10px] leading-none opacity-75">· {group.rows.length}</span>
                {collapsed && group.summary ? (
                  <span
                    className="min-w-0 truncate text-[11px] font-normal leading-none text-muted-foreground"
                    title={group.summary}
                    data-testid={`cdss-hf-action-group-summary-${group.id}`}
                  >
                    {group.summary}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn('h-3 w-3 opacity-75 transition-transform', !collapsed && 'rotate-180')}
                  aria-hidden="true"
                />
              </span>
              <span className={cn('h-px min-w-4 flex-1', tone.dividerClass)} aria-hidden="true" />
            </button>

            {collapsed ? null : group.rows.map((row) => {
              const moduleId = row.recommendation.id
              const expanded = expandedId === moduleId
              const basis = conciseActionBasis(row)
              const category = actionCategory(row, isEnglish)
              return (
                <Fragment key={moduleId}>
                  {showFourPillars && moduleId === pillarRows[0]?.recommendation.id ? (
                    <div
                      className="flex items-center gap-2 border-y border-violet-200 bg-violet-50/80 px-4 py-1.5 dark:border-violet-500/30 dark:bg-violet-500/10"
                      data-testid="cdss-hf-action-subgroup-pillars"
                    >
                      <span className="text-xs font-bold text-violet-800 dark:text-violet-200">
                        {isEnglish ? 'Four pillars of HFrEF' : 'HFrEF 四大支柱'}
                      </span>
                      <span className="flex gap-1" aria-hidden="true">
                        {pillarRows.map((pillar) => (
                          <span
                            key={pillar.recommendation.id}
                            className={cn(
                              'h-1.5 w-5 rounded-full',
                              pillar.decision ? 'bg-violet-600' : 'bg-violet-200 dark:bg-violet-400/30',
                            )}
                          />
                        ))}
                      </span>
                      <span className="ml-auto text-[11px] tabular-nums text-violet-700 dark:text-violet-300">
                        {isEnglish
                          ? `${decidedPillars} / 4 decided`
                          : `已決定 ${decidedPillars} / 4`}
                      </span>
                    </div>
                  ) : null}
                  {moduleId === 'heart-failure-congestion-diuretic' ? (
                    <div
                      className="border-y border-border bg-muted/25 px-4 py-1.5 text-xs font-semibold text-muted-foreground"
                      data-testid="cdss-hf-action-subgroup-symptom-control"
                    >
                      {isEnglish ? 'Symptom control' : '症狀控制'}
                    </div>
                  ) : null}
                  <article
                    id={visitActionElementId(moduleId)}
                    className={cn(
                      'border-b border-border last:border-b-0',
                      showFourPillars && pillarIds.has(moduleId) && 'bg-violet-50/20 dark:bg-violet-500/[0.03]',
                    )}
                    data-testid={`cdss-hf-action-row-${moduleId}`}
                    data-decided={row.decision ? 'true' : undefined}
                  >
                  <div className="flex">
                    <span
                      className={cn('w-[3px] shrink-0', ROW_BAR_CLASS[group.id])}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 px-3 py-2.5">
                      <div className="flex min-w-0 items-start gap-2">
                        {row.index !== undefined ? (
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                            {row.index}
                          </span>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge className={cn('h-5 shrink-0 px-1.5 text-[11px]', statusStyle[row.status])}>
                              <StatusIcon status={row.status} />
                              {row.isSafety
                                ? (isEnglish ? 'Safety alert' : '安全警訊')
                                : statusLabel(row.status, isEnglish)}
                            </Badge>
                            {category ? (
                              <span
                                className="inline-flex h-5 shrink-0 items-center rounded-md bg-violet-100 px-2 text-xs font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200"
                                data-testid={`cdss-hf-action-category-${moduleId}`}
                              >
                                {category.label}
                              </span>
                            ) : null}
                            <span
                              className="min-w-0 text-sm font-semibold leading-snug text-foreground"
                              data-testid={`cdss-hf-action-headline-${moduleId}`}
                            >
                              {category?.headline ?? row.headline}
                            </span>
                          </div>
                          {row.medications ? (
                            <p
                              className="mt-0.5 text-xs leading-relaxed text-muted-foreground"
                              data-testid={`cdss-hf-action-medications-${moduleId}`}
                            >
                              <span className="font-medium text-foreground">
                                {isEnglish ? 'Currently taking' : '目前用藥'}：
                              </span>
                              {row.medications}
                            </p>
                          ) : null}
                          {basis ? (
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {isEnglish ? 'Basis' : '依據'}：
                              </span>
                              {basis}
                            </p>
                          ) : null}
                          <DecisionControls
                            key={`${moduleId}-${row.decision?.recordedAt ?? 'none'}`}
                            row={row}
                            isEnglish={isEnglish}
                            now={now}
                            editing={editingDecisions.has(moduleId)}
                            onEdit={(editing) => onEditDecision(moduleId, editing)}
                            onRecordDecision={onRecordDecision}
                            onClearDecision={onClearDecision}
                            packVersion={packVersion}
                            readOnly={flow.readOnly}
                          />
                        </div>
                        <button
                          type="button"
                          className="flex min-h-8 shrink-0 items-center rounded-md px-1 text-primary transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={expanded}
                          aria-label={isEnglish ? 'Show decision details' : '展開決策詳情'}
                          onClick={() => onToggle(moduleId)}
                          data-testid={`cdss-hf-action-expand-${moduleId}`}
                        >
                          <ChevronDown
                            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  {expanded ? (
                    <div
                      role="region"
                      className="border-t border-border bg-background"
                      data-testid={`cdss-hf-action-detail-${moduleId}`}
                    >
                      {renderDetail(row.recommendation)}
                    </div>
                  ) : null}
                  </article>
                </Fragment>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}

/* ------------------------------------------------- 區塊 5 紀錄與追蹤 */

function FollowUpCard({
  flow,
  board,
  isEnglish,
  now,
}: {
  flow: VisitFlowModel
  board: HeartFailureBoardModel
  isEnglish: boolean
  now: Date
}) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label={isEnglish ? 'Record and follow-up' : '紀錄與追蹤'}
      data-testid="cdss-hf-follow-up"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-3 py-1.5">
        <ClipboardList className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-teal-700 dark:text-secondary-foreground/80">
          {isEnglish ? 'Record and follow-up' : '紀錄與追蹤'}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {isEnglish ? "This visit's summary and what was carried in" : '本次摘要與過往紀錄'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-8"
          onClick={() => {
            void copy(flow.englishSummaryText).then((ok) => {
              if (!ok) {
                toast.error(isEnglish
                  ? 'Could not copy — the clipboard is unavailable in this context.'
                  : '無法複製，此環境無法使用剪貼簿。')
              }
            })
          }}
          data-testid="cdss-hf-copy-summary"
        >
          {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          <span aria-live="polite">
            {copied
              ? (isEnglish ? 'Copied' : '已複製')
              : (isEnglish ? "Copy English summary" : '複製英文摘要')}
          </span>
        </Button>
      </div>

      {flow.handoff ? (
        <div className="px-3 py-2.5">
          <ClinicalHandoffCard handoff={flow.handoff} />
        </div>
      ) : null}

      <pre
        className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-xs leading-relaxed text-foreground"
        data-testid="cdss-hf-summary-text"
      >
        {flow.englishSummaryText}
      </pre>

      {flow.carriedFields.length > 0 ? (
        <div className="border-t border-border px-3 py-2">
          <h4 className="text-[11px] font-semibold text-foreground">
            {isEnglish
              ? 'Answers carried in, with each field’s own date'
              : '上次就診帶入的答案（逐欄位日期）'}
          </h4>
          <table className="mt-1 w-full table-fixed text-[11px]">
            <thead className="sr-only">
              <tr>
                <th>{isEnglish ? 'Field' : '欄位'}</th>
                <th>{isEnglish ? 'Value' : '值'}</th>
                <th>{isEnglish ? 'Date' : '日期'}</th>
              </tr>
            </thead>
            <tbody data-testid="cdss-hf-carried-fields">
              {flow.carriedFields.map((field) => (
                <tr key={`${field.label}-${field.value}`} className="align-top">
                  <td className="w-[9rem] py-0.5 pr-2 text-muted-foreground">{field.label}</td>
                  <td className="py-0.5 pr-2 text-foreground">{field.value}</td>
                  <td className="w-[9rem] py-0.5 tabular-nums text-muted-foreground">{field.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span data-testid="cdss-hf-storage-note">
          {isEnglish
            ? `Encrypted for this tab session ${formatStamp(now.toISOString(), now, isEnglish) ?? ''} · carrying answers across visits is phase 2`
            : `本分頁工作階段已加密保存 ${formatStamp(now.toISOString(), now, isEnglish) ?? ''} · 跨次就診沿用（第二階段）`}
        </span>
      </div>

      {board.timeline ? (
        <div className="border-t border-border px-3 py-2">
          <CareTimeline timeline={board.timeline} isEnglish={isEnglish} />
        </div>
      ) : null}
    </section>
  )
}
