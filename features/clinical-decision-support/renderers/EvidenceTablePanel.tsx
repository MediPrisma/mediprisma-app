"use client"

import { ChevronDown, ListChecks, Quote } from 'lucide-react'
import { isEvidenceItemEnabled } from '@voho0000/personalized-care'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { EVIDENCE_ROW_SIGN_TERMS } from '../utils/apply-clinic-vitals'
import { visitQuestionForSignTerm } from './heart-failure-visit-flow'
import {
  NOT_ASSESSED,
  type ClinicVitals,
  type ClinicVitalsPatch,
  type NyhaClass,
  type SignAnswerValue,
} from '../stores/clinic-vitals.store'

/** The row the published congestion table carries the NYHA class on. */
const NYHA_ROW_ID = 'congestion:nyha'
const NYHA_CLASSES: readonly NyhaClass[] = ['I', 'II', 'III', 'IV']

/** What a clinician can say about one sign in the room. */
export type SignAnswer = 'present' | 'absent'

/**
 * 有／無／未評估 for a sign the record cannot settle.
 *
 * It replaces the include-or-exclude switch on these rows because the switch
 * answered the wrong question: it decided whether an *undetermined* row was
 * counted, so a clinician who turned on 「Orthopnea」 to say they had seen it
 * still read 「紀錄中沒有這一項 · 無法判定」 next to their own answer. 「無」 is a
 * finding too — the pack keeps it apart from 「沒問」 — and an answer here
 * recomputes the module rather than nudging a count.
 */
function SignAnswerControl({
  itemId,
  label,
  isEnglish,
  answer,
  onAnswer,
}: {
  itemId: string
  label: string
  isEnglish: boolean
  answer?: SignAnswer
  onAnswer: (answer: SignAnswer | undefined) => void
}) {
  const options: readonly { id: SignAnswer | 'unassessed'; text: string }[] = [
    { id: 'present', text: isEnglish ? 'Yes' : '有' },
    { id: 'absent', text: isEnglish ? 'No' : '無' },
    { id: 'unassessed', text: isEnglish ? 'Not assessed' : '未評估' },
  ]
  const selected: SignAnswer | 'unassessed' = answer ?? 'unassessed'
  return (
    <div
      className="mt-0.5 flex shrink-0 overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={isEnglish ? `${label}: seen in the room?` : `「${label}」：門診是否看到？`}
      data-testid={`cdss-evidence-answer-${itemId}`}
    >
      {options.map((option) => {
        const isSelected = selected === option.id
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isSelected}
            className={cn(
              'min-h-8 min-w-[2.5rem] px-2 text-[11px] font-medium transition-colors',
              'border-r border-border last:border-r-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isSelected
                ? 'bg-primary/10 text-primary'
                : 'bg-card text-muted-foreground hover:bg-muted/40',
            )}
            onClick={() => onAnswer(option.id === 'unassessed' ? undefined : option.id)}
            data-testid={`cdss-evidence-answer-${itemId}-${option.id}`}
          >
            {option.text}
          </button>
        )
      })}
    </div>
  )
}
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { carriedLabel, useCarriedLookup } from './visit/carried-answer-context'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  leftTabForResourceType,
  type ResourceNavTarget,
} from '@/src/application/stores/resource-navigation.store'
import type {
  CdssFactSource,
  CdssLocale,
  EvidenceDirection,
  EvidenceItem,
  EvidenceItemCategory,
  EvidenceTable,
} from '../types'
import {
  useEvidenceOverrides,
  useEvidenceOverridesStore,
} from '../stores/evidence-overrides.store'

/**
 * The rows a concept-level conclusion was drawn from, each with its own switch.
 *
 * 「有沒有鬱血」 is not a question the record answers; it is a list of items —
 * an NT-proBNP against an age-adjusted threshold, a weight that moved, a
 * sentence in a chest film, a sign only an examination can settle. Showing the
 * word without the list gives the physician nothing to disagree with, so this
 * renders the list and lets a row be switched off. Switching writes to the
 * override store, which feeds `CdssPatientProfile.evidenceOverrides` back into
 * the pack: the module recomputes and its counts change. Nothing here edits the
 * card it is sitting in.
 */

/**
 * A visit reads the numbers first, then the tracings and the pictures, then the
 * bedside, then what is already on the prescription, and the background last.
 */
const CATEGORY_ORDER: readonly EvidenceItemCategory[] = [
  'biomarker',
  'weight',
  'imaging',
  'ecg',
  'examination',
  'medication',
  'context',
]

const CATEGORY_LABELS: Record<EvidenceItemCategory, { zh: string; en: string }> = {
  biomarker: { zh: '生物標記與檢驗', en: 'Biomarkers and laboratory' },
  weight: { zh: '體重', en: 'Weight' },
  imaging: { zh: '影像與心超', en: 'Imaging and echocardiography' },
  ecg: { zh: '心電圖', en: 'Electrocardiogram' },
  examination: { zh: '理學檢查徵象', en: 'Examination signs' },
  medication: { zh: '處方與用藥', en: 'Prescriptions and medications' },
  context: { zh: '臨床背景', en: 'Clinical context' },
}

const CONCEPT_LABELS: Record<EvidenceTable['concept'] | 'lipid-very-high-risk', { zh: string; en: string }> = {
  'lipid-very-high-risk': { zh: 'ASCVD 極高風險：主要事件與高風險條件', en: 'Very-high-risk ASCVD: major events and high-risk conditions' },
  'af-diagnosis': { zh: 'AF 診斷', en: 'AF diagnosis' },
  'af-stroke-risk': { zh: '血栓風險計分依據', en: 'Stroke risk components' },
  'af-anticoagulation': { zh: '抗凝與抗栓依據', en: 'Anticoagulation evidence' },
  'af-drug-safety': { zh: 'AF 用藥安全', en: 'AF medication safety' },
  'af-rate-rhythm': { zh: '心率與節律依據', en: 'Rate and rhythm evidence' },
  'af-monitoring': { zh: 'AF 追蹤資料', en: 'AF monitoring' },
  'af-comorbidity': { zh: '共病與風險因子', en: 'Comorbidities and risk factors' },
  'hf-diagnosis': { zh: '心衰竭診斷證據', en: 'Heart-failure diagnosis evidence' },
  'ckd-diagnosis': { zh: '慢性腎臟病診斷證據', en: 'CKD diagnosis evidence' },
  'ccd-diagnosis': { zh: '冠心病診斷證據', en: 'Coronary disease evidence' },
  'ascvd-very-high-risk': { zh: 'ASCVD 極高風險條件', en: 'Very-high-risk ASCVD criteria' },
  'ccd-medication-safety': { zh: '冠心病用藥安全', en: 'Coronary medication safety' },
  congestion: { zh: '鬱血證據', en: 'Congestion evidence' },
  'lv-filling-pressure': {
    zh: 'LV filling pressure 證據',
    en: 'LV filling pressure evidence',
  },
  'amt-ivabradine': { zh: 'AMT · ivabradine', en: 'AMT: ivabradine' },
  'amt-vericiguat': { zh: 'AMT · vericiguat', en: 'AMT: vericiguat' },
  'amt-hydralazine-isdn': {
    zh: 'AMT · hydralazine/ISDN',
    en: 'AMT: hydralazine/ISDN',
  },
  'amt-digoxin': { zh: 'AMT · digoxin', en: 'AMT: digoxin' },
  'hf-harmful-medication': {
    zh: 'HF 應避免的藥物',
    en: 'Medications to avoid in heart failure',
  },
  // The three ESC 2026 section 5.2.2 criteria, each read on its own.
  'hfpef-symptoms-signs': {
    zh: 'HFpEF (i) 症狀／徵象',
    en: 'HFpEF (i) symptoms and signs',
  },
  'hfpef-lvef-criterion': {
    zh: 'HFpEF (ii) LVEF 條件',
    en: 'HFpEF (ii) LVEF criterion',
  },
  'hfpef-objective-abnormality': {
    zh: 'HFpEF (iii) 客觀結構／功能異常',
    en: 'HFpEF (iii) objective structural or functional abnormality',
  },
  // Concepts the package declares for pathways this host does not list. They
  // are here because the map is exhaustive over the package's union, not
  // because a reader can reach them.
  'htn-treatment-threshold-risk': {
    zh: '高血壓治療門檻與風險',
    en: 'Hypertension treatment threshold and risk',
  },
  'htn-resistant-pseudoresistance': {
    zh: '頑固性高血壓與假性頑固',
    en: 'Resistant hypertension and pseudoresistance',
  },
  'htn-secondary-screening-indication': {
    zh: '次發性高血壓篩檢指徵',
    en: 'Secondary hypertension screening indication',
  },
  'htn-target-individualization': {
    zh: '血壓目標個人化',
    en: 'Blood-pressure target individualization',
  },
  'htn-sleep-apnea': { zh: '睡眠呼吸中止', en: 'Sleep apnea' },
}

const DIRECTION_LABELS: Record<EvidenceDirection, { zh: string; en: string }> = {
  supports: { zh: '支持', en: 'Supports' },
  against: { zh: '不支持', en: 'Against' },
  unknown: { zh: '無法判定', en: 'Undetermined' },
}

/**
 * The chip palette this file already uses for a source assessment: a finding
 * that argues for the concept reads like an abnormal result, one that argues
 * against it reads like a cleared one, and an absent input stays muted so it is
 * never mistaken for a weak negative.
 */
const DIRECTION_CHIP_STYLE: Record<EvidenceDirection, string> = {
  supports: 'bg-rose-100 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200',
  against: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
  unknown: 'bg-muted text-muted-foreground',
}

const RESOURCE_TYPE_LABELS: Record<CdssFactSource['resourceType'], { zh: string; en: string }> = {
  Patient: { zh: '病人資料', en: 'Patient' },
  Condition: { zh: '診斷', en: 'Condition' },
  Encounter: { zh: '就醫紀錄', en: 'Encounter' },
  Observation: { zh: '檢驗／量測', en: 'Observation' },
  MedicationRequest: { zh: '處方', en: 'Medication order' },
  MedicationStatement: { zh: '用藥紀錄', en: 'Medication statement' },
  AllergyIntolerance: { zh: '過敏紀錄', en: 'Allergy' },
  Procedure: { zh: '處置', en: 'Procedure' },
  Immunization: { zh: '疫苗', en: 'Immunization' },
  CarePlan: { zh: '照護計畫', en: 'Care plan' },
  DiagnosticReport: { zh: '檢查報告', en: 'Diagnostic report' },
  DocumentReference: { zh: '病歷文件', en: 'Clinical document' },
}

/**
 * NYHA class on its own row.
 *
 * 有／無 is the wrong question for a grade, which is why this row carried a
 * switch that could not be answered at all. The clinician picks the class; what
 * it means for the symptoms criterion is the pack's reading — II to IV is a
 * patient with current symptoms, and class I argues nothing, because ESC 2026
 * §5.2.2 asks for 「current **or prior**」 symptoms.
 */
function NyhaClassControl({
  itemId,
  label,
  isEnglish,
  value,
  onSelect,
}: {
  itemId: string
  label: string
  isEnglish: boolean
  value?: NyhaClass
  onSelect: (next: NyhaClass | undefined) => void
}) {
  return (
    <div
      className="mt-0.5 flex shrink-0 overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={isEnglish ? `${label}` : `「${label}」`}
      data-testid={`cdss-evidence-nyha-${itemId}`}
    >
      {NYHA_CLASSES.map((option) => {
        const isSelected = value === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isSelected}
            className={cn(
              'min-h-8 min-w-[2rem] px-1.5 text-[11px] font-medium tabular-nums transition-colors',
              'border-r border-border last:border-r-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isSelected
                ? 'bg-primary/10 text-primary'
                : 'bg-card text-muted-foreground hover:bg-muted/40',
            )}
            onClick={() => onSelect(isSelected ? undefined : option)}
            data-testid={`cdss-evidence-nyha-${itemId}-${option}`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function pick(label: { zh: string; en: string }, isEnglish: boolean): string {
  return isEnglish ? label.en : label.zh
}

/** The quoted sentence a text-matched source travels with. */
function sourceFragment(source: CdssFactSource): string | undefined {
  if (typeof source.value !== 'string') return undefined
  const fragment = source.value.trim()
  return fragment.length > 0 ? fragment : undefined
}

function EvidenceRowSources({
  item,
  isEnglish,
  onNavigate,
  testId,
}: {
  item: EvidenceItem
  isEnglish: boolean
  onNavigate: (target: ResourceNavTarget) => void
  testId: string
}) {
  const sources = item.sources ?? []
  const matchedTerms = item.matchedTerms ?? []
  if (sources.length === 0 && matchedTerms.length === 0) return null

  const summary = [
    sources.length > 0
      ? isEnglish
        ? `${sources.length} source record${sources.length === 1 ? '' : 's'}`
        : `${sources.length} 筆原始資料`
      : undefined,
    matchedTerms.length > 0
      ? isEnglish
        ? `${matchedTerms.length} matched term${matchedTerms.length === 1 ? '' : 's'}`
        : `比對到 ${matchedTerms.length} 個詞`
      : undefined,
  ].filter(Boolean).join(' · ')

  return (
    <details className="group/source mt-1" data-testid={testId}>
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open/source:rotate-180" />
      </summary>

      <div className="mt-1 space-y-1.5 border-l-2 border-border/70 pl-2">
        {matchedTerms.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-muted-foreground">
              {isEnglish ? 'Matched terms' : '比對詞'}
            </span>
            {matchedTerms.map((term) => (
              <Badge
                key={term}
                variant="outline"
                className="h-5 bg-background px-1.5 font-mono text-[10px] font-normal"
              >
                {term}
              </Badge>
            ))}
          </div>
        ) : null}

        {sources.map((source, index) => {
          const fragment = sourceFragment(source)
          const typeLabel = pick(RESOURCE_TYPE_LABELS[source.resourceType], isEnglish)
          const metadata = [typeLabel, source.date, source.facility].filter(Boolean).join(' · ')
          const navigable = Boolean(source.resourceId && leftTabForResourceType(source.resourceType))

          return (
            <div key={`${source.resourceType}-${source.resourceId}-${index}`} className="min-w-0">
              {navigable ? (
                <button
                  type="button"
                  onClick={() => onNavigate({
                    resourceType: source.resourceType,
                    resourceId: source.resourceId,
                    display: pick(item.label, isEnglish),
                    date: source.date,
                  })}
                  className="inline-flex min-h-6 items-center rounded-sm text-[11px] font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={isEnglish ? 'Locate this record in the left panel' : '在左側資料中定位此筆紀錄'}
                >
                  {metadata}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">{metadata}</span>
              )}

              {fragment ? (
                <p className="mt-0.5 flex gap-1 text-[11px] leading-relaxed text-foreground/80">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 break-words">{fragment}</span>
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </details>
  )
}

function EvidenceRow({
  item,
  isEnglish,
  enabled,
  onToggle,
  onNavigate,
  answer,
  onAnswer,
  nyhaClass,
  onSelectNyha,
  readOnlyAnswer,
}: {
  item: EvidenceItem
  isEnglish: boolean
  enabled: boolean
  onToggle: (enabled: boolean) => void
  onNavigate: (target: ResourceNavTarget) => void
  /** 「有」/「無」 already recorded for this sign, where the row takes one. */
  answer?: SignAnswer
  /** Absent where this row is not a sign a clinician can answer in the room. */
  onAnswer?: (answer: SignAnswer | undefined) => void
  /** The graded class, on the one row that carries a grade instead of a sign. */
  nyhaClass?: NyhaClass
  onSelectNyha?: (next: NyhaClass | undefined) => void
  /**
   * The visit flow asks each of these once, in 本次評估. Here the row echoes
   * that answer and links back to it, so the same question is never open in
   * two places with two controls that can disagree.
   */
  readOnlyAnswer?: { text: string; onEdit?: () => void }
}) {
  const physicianEntered = item.derivability === 'physician-entered'
  const label = pick(item.label, isEnglish)
  // A switch brought in from a saved record says so (its key in `carried-answers.store`).
  const carriedFrom = useCarriedLookup()(`evidence:${item.id}`)
  const value = item.value ?? (isEnglish ? 'Not recorded' : '紀錄中沒有這一項')

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 px-2.5 py-2',
        !enabled && 'opacity-60',
      )}
      data-testid={`cdss-evidence-row-${item.id}`}
      data-enabled={enabled ? 'true' : 'false'}
    >
      {readOnlyAnswer ? (
        <div
          className="mt-0.5 flex shrink-0 flex-col items-start gap-0.5"
          data-testid={`cdss-evidence-readonly-${item.id}`}
        >
          <span className="text-[11px] font-semibold leading-4 text-foreground">
            {readOnlyAnswer.text}
          </span>
          {readOnlyAnswer.onEdit ? (
            <button
              type="button"
              className="min-h-7 rounded-md px-1 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={readOnlyAnswer.onEdit}
              data-testid={`cdss-evidence-edit-in-flow-${item.id}`}
            >
              {isEnglish ? 'Edit in this visit' : '在本次評估修改'}
            </button>
          ) : null}
        </div>
      ) : onSelectNyha ? (
        <NyhaClassControl
          itemId={item.id}
          label={label}
          isEnglish={isEnglish}
          value={nyhaClass}
          onSelect={onSelectNyha}
        />
      ) : onAnswer ? (
        <SignAnswerControl
          itemId={item.id}
          label={label}
          isEnglish={isEnglish}
          answer={answer}
          onAnswer={onAnswer}
        />
      ) : (
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          // The track is dense on purpose; the thumb is not the touch target. The
          // pseudo-element grows the hit area into the row's own padding, so a
          // thumb tapped on a phone lands without loosening the table.
          className="relative mt-0.5 shrink-0 after:absolute after:-inset-2 after:content-['']"
          aria-label={isEnglish
            ? `Include ${label} in the reading`
            : `將「${label}」納入判定`}
          data-testid={`cdss-evidence-switch-${item.id}`}
        />
      )}

      <div className="min-w-0 flex-1 @min-[46rem]:flex @min-[46rem]:items-start @min-[46rem]:gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 @min-[46rem]:w-[13rem] @min-[46rem]:shrink-0">
          <span className="text-xs font-medium text-foreground">{label}</span>
          {carriedFrom ? (
            <span className="inline-flex h-5 items-center rounded border border-primary/25 bg-primary/5 px-1.5 text-[11px] tabular-nums text-primary"
              data-carried-from={carriedFrom} data-testid={`cdss-evidence-carried-${item.id}`}>
              {carriedLabel(carriedFrom, isEnglish)}
            </span>
          ) : null}
          {physicianEntered ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="h-5 cursor-help bg-background px-1.5 text-[10px] font-normal text-muted-foreground"
                  tabIndex={0}
                  data-testid={`cdss-evidence-physician-${item.id}`}
                >
                  {isEnglish ? 'Physician-entered' : '醫師填'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                sideOffset={6}
                className="max-w-[min(90vw,30rem)] whitespace-normal text-left text-xs leading-relaxed"
              >
                {isEnglish
                  ? 'Only an examination settles this sign, so nothing in the record switched it on.'
                  : '這一項只有理學檢查能確認，紀錄無法自動判定，因此預設不納入。'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="break-words">{value}</span>
            {item.date ? (
              <span className="ml-1.5 whitespace-nowrap tabular-nums text-[11px] text-muted-foreground/80">
                {item.date}
              </span>
            ) : null}
          </div>
          <EvidenceRowSources
            item={item}
            isEnglish={isEnglish}
            onNavigate={onNavigate}
            testId={`cdss-evidence-sources-${item.id}`}
          />
        </div>
      </div>

      <Badge
        className={cn(
          'h-5 shrink-0 whitespace-nowrap px-1.5 text-[11px] hover:bg-inherit',
          DIRECTION_CHIP_STYLE[item.direction],
        )}
        data-testid={`cdss-evidence-direction-${item.id}`}
      >
        {pick(DIRECTION_LABELS[item.direction], isEnglish)}
      </Badge>
    </div>
  )
}

export function EvidenceTablePanel({
  table,
  recommendationId,
  locale,
  patientId,
  onNavigate,
  clinicVitals,
  onSaveClinicVitals,
  physicianRowsReadOnly = false,
  onEditPhysicianRow,
}: {
  table: EvidenceTable
  recommendationId: string
  locale: CdssLocale
  patientId?: string
  onNavigate: (target: ResourceNavTarget) => void
  /** Today's examination. Absent leaves every row on the plain switch. */
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  /**
   * The visit flow asks the NYHA grade and the congestion signs once, in its
   * own 本次評估 card. Set there, so these rows read the answer back instead of
   * offering a second control for the same question. The original board leaves
   * it `false` and keeps the controls it has always had.
   */
  physicianRowsReadOnly?: boolean
  onEditPhysicianRow?: (question: 'nyha' | 'symptoms' | 'signs') => void
}) {
  const isEnglish = locale === 'en'
  const overrides = useEvidenceOverrides(patientId)
  const setOverride = useEvidenceOverridesStore((state) => state.setOverride)
  const signAnswers = clinicVitals?.signAnswers ?? {}
  const answerSign = onSaveClinicVitals
    ? (term: string, answer: SignAnswer | undefined) => {
        onSaveClinicVitals({ signAnswers: { [term]: answer ?? null } })
      }
    : undefined
  const signAnswerText = (value: SignAnswerValue | undefined): string => {
    if (value === 'present') return isEnglish ? 'Yes' : '有'
    if (value === 'absent') return isEnglish ? 'No' : '無'
    if (value === NOT_ASSESSED) return isEnglish ? 'Not assessed' : '未評估'
    return isEnglish ? 'Not answered' : '尚未回答'
  }

  const groups = CATEGORY_ORDER
    .map((category) => ({
      category,
      items: table.items.filter((item) => item.category === category),
    }))
    .filter((group) => group.items.length > 0)

  const conceptLabel = pick(CONCEPT_LABELS[table.concept], isEnglish)
  const counts = [
    isEnglish ? `Supports ${table.supportsCount}` : `支持 ${table.supportsCount}`,
    isEnglish ? `Against ${table.againstCount}` : `不支持 ${table.againstCount}`,
    isEnglish ? `Undetermined ${table.unknownCount}` : `無法判定 ${table.unknownCount}`,
  ].join(' · ')

  return (
    <section
      className="overflow-hidden rounded-md border border-border/70 bg-background"
      aria-label={conceptLabel}
      data-testid={`cdss-evidence-table-${recommendationId}-${table.concept}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 bg-muted/[0.12] px-2.5 py-2">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <h5 className="text-xs font-semibold text-foreground">{conceptLabel}</h5>
        <span
          className="ml-auto text-[11px] tabular-nums text-muted-foreground"
          data-testid={`cdss-evidence-counts-${table.concept}`}
        >
          {counts}
        </span>
      </header>

      <div className="divide-y divide-border/60">
        {groups.map((group) => (
          <div key={group.category} data-testid={`cdss-evidence-group-${group.category}`}>
            <h6 className="bg-muted/[0.06] px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {pick(CATEGORY_LABELS[group.category], isEnglish)}
            </h6>
            <div className="divide-y divide-border/40">
              {group.items.map((item) => {
                // A row the clinician can answer in the room takes the
                // 有／無／未評估 control; everything else keeps the switch.
                const term = EVIDENCE_ROW_SIGN_TERMS[item.id]
                const nyhaValue = clinicVitals?.nyhaClass?.value
                const signValue = term ? signAnswers[term]?.value : undefined
                const answerProps = physicianRowsReadOnly
                  ? item.id === NYHA_ROW_ID
                    ? {
                      readOnlyAnswer: {
                        text: nyhaValue && nyhaValue !== NOT_ASSESSED
                          ? `NYHA ${nyhaValue}`
                          : nyhaValue === NOT_ASSESSED
                            ? (isEnglish ? 'Not assessed' : '未評估')
                            : (isEnglish ? 'Not answered' : '尚未回答'),
                        ...(onEditPhysicianRow
                          ? { onEdit: () => onEditPhysicianRow('nyha') }
                          : {}),
                      },
                    }
                    : term
                      ? {
                        readOnlyAnswer: {
                          text: signAnswerText(signValue),
                          ...(onEditPhysicianRow
                            ? { onEdit: () => onEditPhysicianRow(visitQuestionForSignTerm(term)) }
                            : {}),
                        },
                      }
                      : {}
                  : item.id === NYHA_ROW_ID && onSaveClinicVitals
                    ? {
                      nyhaClass: nyhaValue === NOT_ASSESSED ? undefined : nyhaValue,
                      onSelectNyha: (next: NyhaClass | undefined) => {
                        onSaveClinicVitals({ nyhaClass: next ?? null })
                      },
                    }
                    : term && answerSign
                      ? {
                        answer: signValue === NOT_ASSESSED ? undefined : signValue,
                        onAnswer: (next: SignAnswer | undefined) => answerSign(term, next),
                      }
                      : {}
                return (
                  <EvidenceRow
                    key={item.id}
                    item={item}
                    isEnglish={isEnglish}
                    enabled={isEvidenceItemEnabled(item, overrides)}
                    onToggle={(enabled) => {
                      if (!patientId) return
                      setOverride(patientId, item.id, enabled)
                    }}
                    onNavigate={onNavigate}
                    {...answerProps}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {table.limitations.length > 0 ? (
        <ul
          className="space-y-1 border-t border-border/70 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground"
          data-testid={`cdss-evidence-limitations-${table.concept}`}
        >
          {table.limitations.map((limitation) => (
            <li key={limitation} className="flex gap-1.5">
              <span aria-hidden="true">•</span>
              <span className="min-w-0">{limitation}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
