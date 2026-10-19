"use client"

import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Copy,
  ExternalLink,
  FileSearch,
  Gauge,
  PanelLeftOpen,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { DIABETES_FACT_KEYS, clinicalModuleLabel, getClinicalModuleDefinition } from '@voho0000/personalized-care'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/src/shared/utils/cn.utils'
import { GROUP_TONES } from '@/src/shared/constants/group-tones'
import {
  leftTabForResourceType,
  NAV_CLAIM_TIMEOUT_MS,
  type ResourceNavTarget,
  useResourceNavigationStore,
} from '@/src/application/stores/resource-navigation.store'
import type {
  CdssFactSource,
  CdssAutomatedCheck,
  CdssLocale,
  CdssModuleGroupId,
  CdssRecommendation,
  CdssResult,
  CdssSourceAssessmentStatus,
  CdssStatus,
  DcsiSummary,
  GuidelineReference,
} from '../types'
import { buildPhysicianSemanticCard } from '../utils/build-physician-semantic-card'
import { buildRationaleCopyText, type RationaleCopyProvenance } from '../utils/build-rationale-copy-text'
import { dedupeFactSources } from '../utils/dedupe-fact-sources'
import { EvidenceTablePanel } from './EvidenceTablePanel'
import { PreventRiskSummary } from './PreventRiskSummary'
import { NhiLipidCoverageSummary } from './NhiLipidCoverageSummary'
import { NhiTable1Panel } from './NhiTable1Panel'
import {
  useNhiLipidReviewStore,
  type NhiLipidAnswerProvenanceById,
} from '../stores/nhi-lipid-review.store'
import type { NhiLipidAiAssist } from '../hooks/use-nhi-lipid-ai-assist.hook'
import {
  buildHeartFailureBoard,
  HEART_FAILURE_LIST_STATUS_ORDER,
  HEART_FAILURE_PACK_ID,
} from './heart-failure-board'
import { HeartRhythmPanel } from './HeartRhythmPanel'
import { CdssModuleSections } from './CdssModuleSections'
import { LipidModuleSections } from './LipidModuleSections'
import { HfPrognosisModels } from '@/features/medical-calculator/prognosis/HfPrognosisModels'
import { useTodayNow } from '../hooks/use-local-day.hook'
import { hfPrognosisEvidence } from '../utils/hf-prognosis-evidence'
import { AtrialFibrillationVisitFlow } from './AtrialFibrillationVisitFlow'
import { buildDiseaseBoard, AF_BOARD_CONFIG } from './disease-board'
import type { AfAnswers } from '../stores/af-answers.store'
import { buildHeartFailureVisitFlow } from './heart-failure-visit-flow'
import type { HfpefInputsPatch } from '../stores/hfpef-inputs.store'
import type { HfpefReading } from '../utils/hfpef-scores'
import { HeartFailureStatusBoard } from './HeartFailureStatusBoard'
import { focusVisitFlowTarget, HeartFailureVisitFlow } from './HeartFailureVisitFlow'
import type { HfFollowUpHistory } from '../utils/hf-follow-up'
import { PhysicianInputRequestPanel } from './PhysicianInputRequestPanel'
import { physicianInputRequestsOf } from '../physician-input-contract'
import { isCongestionGroupPresent } from '../utils/apply-clinic-vitals'
import {
  congestionGroupPatch,
  type ClinicVitals,
  type ClinicVitalsPatch,
  type CongestionSignsAnswer,
} from '../stores/clinic-vitals.store'
import type { PhenotypeAnswer } from '../stores/phenotype-answer.store'
import type {
  PhysicianDecisionInput,
  PhysicianDecisionMap,
} from '../stores/physician-decisions.store'
import type { CdssLayout } from '../stores/layout-preference.store'
import type { CdssPatientProfile } from '../types'
import { statusStyle, StatusIcon } from './status-presentation'
import { VisitDecisionScreen } from './visit/VisitDecisionScreen'
import type { VisitAnswers, VisitAsk, VisitDecisionModel } from '../types'
import { afAnswersForInput, coronaryPhaseForInput, phenotypeAnswerForInput } from './visit/physician-input'
import type { CoronaryPhaseAnswer } from '../stores/coronary-phase.store'
import type { VisitAnswerProvenance } from './visit/VisitAsks'

interface ClinicalDecisionSupportViewProps {
  afAnswers?: AfAnswers
  onAfAnswer?: (id: string, value: boolean | undefined) => void
  /** CAD DP-01's class, pressed on the decision map, and the answer as kept. */
  onCoronaryPhase?: (answer: CoronaryPhaseAnswer) => void
  coronaryPhaseAnswer?: CoronaryPhaseAnswer
  result: CdssResult
  englishResult?: CdssResult
  locale: CdssLocale
  /**
   * Whose chart this is. The evidence switches are a clinical judgement about
   * one person, so they are stored per patient and never carried across.
   */
  patientId?: string
  nhiLipidAiAssist?: NhiLipidAiAssist
  nhiLipidAnswerProvenance?: NhiLipidAnswerProvenanceById
  /**
   * The facts the pack read. The heart-failure board shows a pillar's
   * prescription state from them when the pack produced no module for it.
   */
  profileFacts?: CdssPatientProfile['facts']
  followUpHistory?: HfFollowUpHistory
  /**
   * `classic` renders every pack the module-first way, board or not; `board`
   * (the default) lets the heart-failure pack open with its status board.
   */
  layout?: CdssLayout
  /** Vitals the clinician measured in the room this visit; heart-failure board only. */
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  onClearClinicVitals?: () => void
  /**
   * What the clinician answered on a card's structured question — the DP-01
   * phenotype gate, the HFpEF confirmation. Absent while the card is still
   * asking; `onAnswerPhenotype` absent means the controls are not offered,
   * which is the read-only case (no patient loaded).
   */
  phenotypeAnswer?: PhenotypeAnswer
  onAnswerPhenotype?: (answer: PhenotypeAnswer) => void
  /**
   * What this physician decided about each recommendation. The visit flow puts
   * a decision on every row; nothing re-enters the pack, so the other layouts
   * neither read nor need them.
   */
  physicianDecisions?: PhysicianDecisionMap
  onRecordDecision?: (moduleId: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (moduleId: string) => void
  /**
   * The HFpEF scores the host's own calculator produced, and the way to
   * complete the echo values behind them. Only the visit flow reads them; the
   * original board shows the pack's own reading of the same facts.
   */
  hfpefReading?: HfpefReading
  onSaveHfpefInputs?: (patch: HfpefInputsPatch) => void
  /** Changes when the NHI page returns to its record-only default state. */
  nhiPageResetKey?: number
  /**
   * The pack's visit decision model. With `layout="map"` it draws the decision
   * map; without one the map is not available and the page falls back to the
   * three sections.
   */
  visitModel?: VisitDecisionModel
  /**
   * The other packs' results the map reads (the pack's
   * `VisitMapDefinition.companions` — on the heart-failure page, atrial
   * fibrillation's), so the cards behind their decision points open from the map.
   */
  companionResults?: readonly CdssResult[]
  visitAnswers?: VisitAnswers
  /** Where each of today's answers was given, so another page can say so. */
  visitAnswerSources?: VisitAnswerProvenance
  onVisitAnswer?: (id: VisitAsk['id'], value: string | null) => void
  /** The companions' English builds, so their cards' rationale copies in English too. */
  englishCompanionResults?: readonly CdssResult[]
}

const NHI_RECORD_FACT_KEYS: Readonly<Record<string, readonly string[]>> = {
  hypertension: ['hypertensionDiagnosis'],
  age: ['age'],
  'low-hdl': ['HDL'],
  'met-bp': ['bloodPressure'],
  'met-glucose': ['diabetesGlucoseLoweringTherapy'],
  'met-tg': ['triglycerides'],
  cad: ['coronaryArteryDiagnosis'],
  'recent-mi': ['myocardialInfarctionEventDate'],
  pad: ['peripheralArteryDiagnosis'],
  carotid: ['carotidStenosisDiagnosis'],
  acs: ['acuteCoronarySyndromeDiagnosis', 'myocardialInfarctionDiagnosis'],
  'stroke-atherosclerosis': ['ischemicStrokeDiagnosis'],
  // The pack's own list: E10, E11, E08/E09/E13, then current glucose-lowering
  // therapy, which is often the only trace when a visit was billed as I10.
  diabetes: DIABETES_FACT_KEYS,
  'predialysis-ckd': ['ckdChronicity', 'ckdDiagnosis'],
  'severe-ldl': ['LDL'],
}

export function buildNhiRecordSources(
  facts: CdssPatientProfile['facts'] | undefined,
): Readonly<Record<string, readonly CdssFactSource[]>> | undefined {
  if (!facts) return undefined
  const result: Record<string, CdssFactSource[]> = {}
  for (const [criterionId, factKeys] of Object.entries(NHI_RECORD_FACT_KEYS)) {
    const seen = new Set<string>()
    const sources = factKeys.flatMap((factKey) => facts[factKey]?.sources ?? []).filter((source) => {
      const key = `${source.resourceType}/${source.resourceId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (sources.length > 0) result[criterionId] = sources
  }
  return result
}

const sourceStatusStyle: Record<CdssSourceAssessmentStatus, string> = {
  recommended: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
  consider: 'bg-blue-100 text-blue-900 dark:bg-blue-500/10 dark:text-blue-200',
  covered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
  'not-covered': 'bg-rose-100 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200',
  'needs-data': 'bg-amber-100 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
  'no-special-rule': 'bg-blue-100 text-blue-900 dark:bg-blue-500/10 dark:text-blue-200',
  'not-applicable': 'bg-muted text-muted-foreground',
}


// Ordered the way a visit runs: what can be ordered now, what is measured in
// the room, and what has to be asked or looked up.
const MISSING_INPUT_GROUPS: readonly {
  id: MissingInputGroup
  zh: string
  en: string
}[] = [
  { id: 'lab', zh: '可開單檢驗', en: 'Laboratory orders' },
  { id: 'measure', zh: '診間量測', en: 'Measured in clinic' },
  { id: 'ask', zh: '需問診或查紀錄', en: 'Ask or look up' },
]

const MODULE_GROUPS: readonly {
  id: CdssModuleGroupId
  zh: string
  en: string
  toneClass: string
  dividerClass: string
}[] = ([
  { id: 'assessment', zh: '評估與分層', en: 'Assessment & stratification', tone: 'blue' },
  { id: 'treatment', zh: '治療決策', en: 'Treatment decisions', tone: 'violet' },
  { id: 'monitoring', zh: '監測與安全', en: 'Monitoring & safety', tone: 'teal' },
  { id: 'care', zh: '照護安排', en: 'Care planning', tone: 'orange' },
] as const).map((group) => ({ ...group, ...GROUP_TONES[group.tone] }))

interface ModuleGroupPresentation {
  id: string
  zh: string
  en: string
  toneClass: string
  dividerClass: string
}

/**
 * The heart-failure list groups by what the clinician has to do rather than
 * by workflow stage: the board above it already carries the treatment
 * decisions, so what remains is ordered do → fetch → judge → done.
 */
/**
 * Direction C groups the remaining rows by the kind of work, in the words of
 * the mockup: 藥物 (an actionable prescribing or safety decision), 檢驗與量測
 * (data to fetch), 需判斷 (a judgement the record cannot make), and the done
 * rows folded. Same four statuses as the board, named for the desk they land on.
 */
const HEART_FAILURE_C_GROUPS: Readonly<Record<CdssStatus, ModuleGroupPresentation>> = {
  actionable: { id: 'actionable', zh: '藥物與處置', en: 'Medication & actions', ...GROUP_TONES.indigo },
  'needs-data': { id: 'needs-data', zh: '檢驗與量測', en: 'Tests & measurements', ...GROUP_TONES.orange },
  review: { id: 'review', zh: '需判斷', en: 'Judgement', ...GROUP_TONES.blue },
  'no-action': { id: 'no-action', zh: '目前無需處理', en: 'No action needed', ...GROUP_TONES.teal },
}

const HEART_FAILURE_STATUS_GROUPS: Readonly<Record<CdssStatus, ModuleGroupPresentation>> = {
  actionable: { id: 'actionable', zh: '可立即處理', en: 'Actionable now', ...GROUP_TONES.indigo },
  'needs-data': { id: 'needs-data', zh: '需先補資料', en: 'Data needed', ...GROUP_TONES.orange },
  review: { id: 'review', zh: '需臨床確認', en: 'Clinical review', ...GROUP_TONES.blue },
  'no-action': { id: 'no-action', zh: '目前無需處理', en: 'No action needed', ...GROUP_TONES.teal },
}

type ModuleDisplayRow =
  | {
    kind: 'group'
    group: ModuleGroupPresentation
    count: number
    isCollapsed: boolean
    /** The module names a collapsed group hides, so nothing disappears silently. */
    summary?: string
  }
  | {
    kind: 'recommendation'
    recommendation: CdssRecommendation
  }

const missingAssessmentCue = /(缺少|仍缺|待補|補做|未取得|無法使用|missing|unusable|not available)/i
const missingConcepts = [
  /uacr|尿(?:中)?白蛋白(?:[／/]?(?:肌酸酐|creatinine))?|urine albumin(?:-to-creatinine|[ /]creatinine)?/i,
  /血壓|blood pressure/i,
  /體液狀態|volume status/i,
  /egfr|腎絲球過濾率/i,
  /性別|\bsex\b/i,
  /年齡|\bage\b/i,
  /血鉀|potassium/i,
  /碳酸氫鹽|bicarbonate/i,
  /\bpth\b|副甲狀腺素/i,
  /ldl(?:-c)?|低密度脂蛋白/i,
] as const

/**
 * Collapsed rows should not repeat the same missing concept twice. The full,
 * precise missing input remains available in the expanded decision detail.
 */
function isMissingPreviewRedundant(title: string, missingInput: string): boolean {
  const normalizedTitle = title.normalize('NFKC')
  if (!missingAssessmentCue.test(normalizedTitle)) return false

  const normalizedMissingInput = missingInput.normalize('NFKC')
  return missingConcepts.some((concept) => (
    concept.test(normalizedTitle) && concept.test(normalizedMissingInput)
  ))
}

function normalizedDisplayText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function characterBigrams(value: string): Set<string> {
  const normalized = normalizedDisplayText(value)
  const bigrams = new Set<string>()
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2))
  }
  return bigrams
}

/**
 * Keeps the more specific evidence sentence when the assessment is mostly a
 * paraphrase of it (for example, the same historical medication status).
 */
function isAssessmentPreviewRedundant(title: string, evidenceValue?: string): boolean {
  if (!evidenceValue) return false
  const titleBigrams = characterBigrams(title)
  const evidenceBigrams = characterBigrams(evidenceValue)
  const smallerSize = Math.min(titleBigrams.size, evidenceBigrams.size)
  if (smallerSize < 8) return false

  let sharedCount = 0
  titleBigrams.forEach((bigram) => {
    if (evidenceBigrams.has(bigram)) sharedCount += 1
  })
  return sharedCount / smallerSize >= 0.7
}

function compactOverviewEvidenceValue(evidence: {
  label: string
  value: string
  factKeys: readonly string[]
}): string {
  const isEgfr = evidence.factKeys.some((factKey) => /^egfr$/i.test(factKey))
    || /\begfr\b|腎絲球過濾率/i.test(evidence.label)
  if (!isEgfr) return evidence.value

  return evidence.value
    .replace(/\s*mL\s*\/\s*min\s*\/\s*1\.73\s*m(?:²|\^?2)/gi, '')
    .replace(/\s+(?=[（(])/gu, '')
    .trim()
}

function overviewEvidenceItems(
  recommendation: CdssRecommendation,
): CdssRecommendation['patientEvidence'] {
  // Which facts head a card is a clinical decision owned by the care pack. The
  // host previously kept a module-id lookup table here, which meant adding a
  // multi-fact headline required editing this repo.
  const explicitKeys = recommendation.overviewEvidenceFactKeys
  const keys = explicitKeys && explicitKeys.length > 0
    ? explicitKeys
    : recommendation.overviewEvidenceFactKey
      ? [recommendation.overviewEvidenceFactKey]
      : []
  const seen = new Set<string>()

  return keys.flatMap((factKey) => {
    const evidence = recommendation.patientEvidence.find((item) => (
      item.factKeys.includes(factKey)
    ))
    if (!evidence) return []
    const key = `${evidence.label}\u0000${evidence.value}`
    if (seen.has(key)) return []
    seen.add(key)
    return [evidence]
  })
}

function directGuidelineSourceLabel(
  reference: GuidelineReference,
  isEnglish: boolean,
): string {
  if (/\bKDIGO\b/i.test(reference.title) && /CKD-MBD/i.test(reference.title)) {
    return isEnglish ? 'KDIGO CKD-MBD guideline' : 'KDIGO CKD-MBD 指引'
  }
  return reference.title.trim() || reference.publisher
}

const clinicalReviewBoilerplateZh = /(?:視臨床情境|適切性|適用性|耐受性|治療|用藥|使用|確認|核對|檢視|評估|是否|需要|建議|目前|狀態|原因|計畫|先|再|與|及|和|或)/gu
const clinicalReviewBoilerplateEn = /\b(?:appropriateness|applicability|tolerability|treatment|therapy|medication|use|confirm|reconcile|review|assess(?:ing|ment)?|whether|need(?:ed|s)?|recommend(?:ed|ation)?|current|status|reason|plan|before|then|and|or|the)\b/gu

function clinicalReviewInformationCore(value: string): string {
  return normalizedDisplayText(
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(clinicalReviewBoilerplateZh, '')
      .replace(clinicalReviewBoilerplateEn, ''),
  )
}

/**
 * Clinical context belongs in the next step rather than a second task block.
 * When only part of an item is new, keep the new concepts and omit the words
 * already present in the action.
 */
function joinClinicalConcepts(concepts: readonly string[], isEnglish: boolean): string {
  if (concepts.length < 2) return concepts[0] ?? ''
  if (concepts.length === 2) return concepts.join(isEnglish ? ' and ' : '與')
  return isEnglish
    ? `${concepts.slice(0, -1).join(', ')}, and ${concepts.at(-1)}`
    : `${concepts.slice(0, -1).join('、')}與${concepts.at(-1)}`
}

function clinicalReviewInformationGain(
  item: string,
  actionText: string,
  isEnglish: boolean,
): string | null {
  const actionCore = clinicalReviewInformationCore(actionText)
  const itemCore = clinicalReviewInformationCore(item)
  if (itemCore.length >= 2 && actionCore.includes(itemCore)) return null

  const concepts = item
    .split(isEnglish ? /\s+(?:and|or)\s+|[,;]/i : /[、，,；;]|(?:與|及|和|或)/u)
    .map((concept) => concept.trim())
    .filter(Boolean)
  if (concepts.length < 2) return item

  const uncoveredConcepts = concepts.filter((concept) => {
    const conceptCore = clinicalReviewInformationCore(concept)
    return conceptCore.length < 2 || !actionCore.includes(conceptCore)
  })
  if (uncoveredConcepts.length === 0) return null
  if (uncoveredConcepts.length === concepts.length) return item
  return joinClinicalConcepts(uncoveredConcepts, isEnglish)
}

function integrateClinicalReviewIntoNextSteps(
  items: readonly string[] | undefined,
  nextActions: readonly string[],
  isEnglish: boolean,
): string[] {
  if (!items || items.length === 0) return [...nextActions]

  const actionText = nextActions.join(' ')
  const contexts = items
    .map((item) => clinicalReviewInformationGain(item, actionText, isEnglish))
    .filter((item): item is string => Boolean(item))
    .filter((item, index, allItems) => (
      allItems.findIndex((candidate) => (
        normalizedDisplayText(candidate) === normalizedDisplayText(item)
      )) === index
    ))
  if (contexts.length === 0) return [...nextActions]

  const contextLabel = contexts.join(isEnglish ? '; ' : '、')
  if (nextActions.length === 0) {
    return [isEnglish ? `Confirm: ${contextLabel}.` : `確認：${contextLabel}。`]
  }

  const actions = [...nextActions]
  const lastIndex = actions.length - 1
  const lastAction = actions[lastIndex].replace(/[。.!；;\s]+$/u, '')
  actions[lastIndex] = isEnglish
    ? `${lastAction}; also confirm ${contextLabel}.`
    : `${lastAction}；並確認${contextLabel}。`
  return actions
}

function integratedNextStepActions(
  missingData: readonly string[] | undefined,
  nextActions: readonly string[],
  isEnglish: boolean,
): string[] {
  const missingItems = (missingData ?? []).map((item) => item
    .replace(/^此決策可用的\s*/, '')
    .replace(/（目前資料完全沒有這一項）/g, '')
    .trim())
  if (missingItems.length === 0) return [...nextActions]

  const missingLabel = missingItems.join(isEnglish ? ', ' : '、')
  let actions = [...nextActions]
  let replacedGenericInput = false
  const genericInputPattern = isEnglish
    ? /\b(?:required|necessary) (?:inputs?|data)\b/i
    : /必要(?:輸入|資料)/

  actions = actions.map((action) => {
    if (replacedGenericInput || !genericInputPattern.test(action)) return action
    replacedGenericInput = true
    return action.replace(genericInputPattern, missingLabel)
  })

  const combinedActionText = normalizedDisplayText(actions.join(' '))
  const uncoveredItems = missingItems.filter((item) => (
    !combinedActionText.includes(normalizedDisplayText(item))
  ))
  if (uncoveredItems.length === 0) return actions

  const uncoveredLabel = uncoveredItems.join(isEnglish ? ', ' : '、')
  if (actions.length === 0) {
    return [isEnglish ? `Complete: ${uncoveredLabel}.` : `補齊：${uncoveredLabel}。`]
  }

  const [firstAction, ...remainingActions] = actions
  return [
    isEnglish
      ? `Complete ${uncoveredLabel}; ${firstAction}`
      : `補齊：${uncoveredLabel}；${firstAction}`,
    ...remainingActions,
  ]
}

function modulePresentationCopy(
  recommendation: CdssRecommendation,
  isEnglish: boolean,
): { guidelineHeading: string } {
  const kind = recommendationPresentationType(recommendation)

  switch (kind) {
    case 'classification':
      return {
        guidelineHeading: isEnglish ? 'Classification / risk basis' : '分級／風險依據',
      }
    case 'medication':
      return {
        guidelineHeading: isEnglish ? 'Guideline treatment criteria' : '指引用藥條件',
      }
    case 'monitoring':
      return {
        guidelineHeading: isEnglish ? 'Monitoring basis / threshold' : '監測依據／門檻',
      }
    case 'recommendation':
      return {
        guidelineHeading: isEnglish ? 'Guideline recommendation' : '指引建議',
      }
  }
}

function recommendationPresentationType(
  recommendation: CdssRecommendation,
) {
  return recommendation.presentationType ?? getClinicalModuleDefinition(
    recommendation.id,
    {
      zh: recommendation.title,
      en: recommendation.title,
      domain: recommendation.domain,
    },
  ).presentationType
}

function restoreCompletedModules(result: CdssResult): {
  recommendations: CdssRecommendation[]
  standaloneChecks: CdssAutomatedCheck[]
} {
  const completedModules = (result.automatedChecks ?? []).filter(
    (check): check is CdssAutomatedCheck & { recommendation: CdssRecommendation } => (
      Boolean(check.recommendation)
    ),
  )
  const standaloneChecks = (result.automatedChecks ?? []).filter(
    (check) => !check.recommendation,
  )
  if (completedModules.length === 0) {
    return {
      recommendations: [...result.recommendations],
      standaloneChecks,
    }
  }

  const completedByPosition = new Map<number, typeof completedModules[number]>()
  completedModules.forEach((check) => {
    if (
      typeof check.displayOrder === 'number'
      && Number.isInteger(check.displayOrder)
      && check.displayOrder >= 0
    ) {
      completedByPosition.set(check.displayOrder, check)
    }
  })

  const restored: CdssRecommendation[] = []
  const usedIds = new Set<string>()
  let decisionIndex = 0
  const slotCount = result.recommendations.length + completedModules.length
  for (let position = 0; position < slotCount; position += 1) {
    const completed = completedByPosition.get(position)
    if (completed) {
      restored.push(completed.recommendation)
      usedIds.add(completed.id)
      continue
    }
    const decision = result.recommendations[decisionIndex]
    if (decision) {
      restored.push(decision)
      decisionIndex += 1
    }
  }
  restored.push(...result.recommendations.slice(decisionIndex))
  completedModules.forEach((check) => {
    if (!usedIds.has(check.id)) restored.push(check.recommendation)
  })

  return { recommendations: restored, standaloneChecks }
}

function summarizeMissingInput(input: string, locale: CdssLocale) {
  const normalized = input.normalize('NFKC').toLocaleLowerCase()
  if (
    normalized.includes('uacr')
    || normalized.includes('urine albumin-to-creatinine')
    || normalized.includes('urine albumin/creatinine')
  ) {
    return {
      key: 'quantitative-uacr',
      label: locale === 'en'
        ? 'Quantitative UACR (mg/g; valid value above 0)'
        : '定量 UACR（mg/g；需為有效正值）',
    }
  }

  return {
    key: normalized
      .replace(/[、，,；;：:（）()[\]\s]/g, '')
      .replace(/[><=≥≤]/g, ''),
    label: input,
  }
}

/**
 * Which kind of work closes the gap.
 *
 * Ten outstanding inputs in one list read as ten identical chores, when in
 * practice they are three: a laboratory order, something measured in the room,
 * and something you have to go and ask or look up. Splitting them lets a
 * clinician do all of one kind at once.
 *
 * Anything unrecognised falls to `ask`, which is the honest default: if the
 * text does not name a test or a vital sign, assume it takes a conversation.
 */
export type MissingInputGroup = 'lab' | 'measure' | 'ask'

const LAB_INPUT_PATTERN = /uacr|acr\b|egfr|creatinine|肌酸酐|白蛋白尿|尿白蛋白|尿沉渣|ferritin|tsat|pth|reticulocyte|網狀紅血球|mcv|cbc|血鉀|potassium|bicarbonate|碳酸氫|血紅素|hemoglobin|hb\b|calcium|phosphate|鈣|磷|albumin|白蛋白|hba1c|ldl|hdl|triglyceride|膽固醇|lipid|血脂|tsh|b12|folate|葉酸|vitamin ?d|維生素 ?d|檢驗|lab(?:oratory)? (?:test|value|result)/i
const MEASURE_INPUT_PATTERN = /血壓|blood pressure|\bbp\b|體重|body weight|身高|height|bmi|心率|heart rate|腰圍|waist|量測|measurement/i

function missingInputGroup(label: string): MissingInputGroup {
  // Blood pressure names a measurement even though the sentence around it may
  // mention a date or a standardization method, so it is tested first.
  if (MEASURE_INPUT_PATTERN.test(label)) return 'measure'
  if (LAB_INPUT_PATTERN.test(label)) return 'lab'
  return 'ask'
}

export function buildClinicalDecisionSummary(
  result: CdssResult,
  locale: CdssLocale,
) {
  const priorityOrder: Readonly<Record<CdssRecommendation['priority'], number>> = {
    high: 0,
    medium: 1,
    routine: 2,
  }
  // Status leads the sort, priority breaks the tie. Priority alone could not
  // order this list: a pack that applies the time-to-harm rule honestly leaves
  // almost everything at `medium` — a CKD G3b patient produces twelve mediums
  // out of thirteen cards — so the comparator returned 0 for nearly every pair
  // and the three summary slots went to whichever cards the pack happened to
  // build first. That is how a risk score with nothing to do displaced a statin
  // the same run had marked actionable.
  const statusOrder: Readonly<Record<string, number>> = { actionable: 0, review: 1 }
  // Everything the pack asked a clinician to act on or check, in one place.
  // This is a consolidation of a dozen module states, not a top-N: cutting it
  // to three meant an actionable card could sit below the fold with nothing
  // saying so, which is worse than a longer list.
  const actionRecommendations = result.recommendations.filter(
    (recommendation) => (
      recommendation.status === 'actionable'
      || recommendation.status === 'review'
    ),
  ).sort((a, b) => (
    (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
    || priorityOrder[a.priority] - priorityOrder[b.priority]
  ))
  // What is missing matters less than what it blocks. An absent UACR that
  // holds up a RASi decision belongs above one that only defers a monitoring
  // interval, so each input inherits the most decision-bearing module that
  // asked for it.
  const domainUrgency: Readonly<Record<CdssRecommendation['domain'], number>> = {
    medication: 0,
    target: 1,
    safety: 2,
    diagnosis: 3,
    complication: 4,
    monitoring: 5,
    'care-gap': 6,
  }
  const missingInputByKey = new Map<string, {
    label: string
    recommendationIds: Set<string>
    // Names, not ids: the count answers "how much does this hold up", and the
    // obvious next question is "which ones" — a reader should not have to open
    // every module to find out.
    moduleNames: string[]
    urgency: number
  }>()
  result.recommendations.forEach((recommendation) => {
    const urgency = domainUrgency[recommendation.domain] ?? 7
    const moduleName = recommendation.moduleName ?? clinicalModuleLabel(
      recommendation.id,
      locale,
      recommendation.title,
      recommendation.domain,
    )
    recommendation.missingData?.forEach((input) => {
      const summarized = summarizeMissingInput(input, locale)
      const existing = missingInputByKey.get(summarized.key)
      if (existing) {
        if (!existing.recommendationIds.has(recommendation.id)) {
          existing.recommendationIds.add(recommendation.id)
          existing.moduleNames.push(moduleName)
        }
        existing.urgency = Math.min(existing.urgency, urgency)
        return
      }
      missingInputByKey.set(summarized.key, {
        label: summarized.label,
        recommendationIds: new Set([recommendation.id]),
        moduleNames: [moduleName],
        urgency,
      })
    })
  })
  const allMissingInputs = Array.from(missingInputByKey.values())
    .sort((a, b) => (
      a.urgency - b.urgency
      || b.recommendationIds.size - a.recommendationIds.size
    ))
    .map((item) => ({
      label: item.label,
      relatedRecommendationCount: item.recommendationIds.size,
      relatedModuleNames: item.moduleNames,
      group: missingInputGroup(item.label),
    }))

  return {
    actionRecommendations,
    // Every one of them. Capping the list at four turned the rest into "另有 6
    // 項，請見下方模組" — a number with no way to act on it, in the one place
    // meant to spare the reader a walk through a dozen modules. The whole
    // point of consolidating is that nothing has to be hunted for.
    missingInputs: allMissingInputs,
    missingInputCount: allMissingInputs.length,
    automatedCheckCount: result.automatedChecks?.length ?? 0,
  }
}

function isMedicationFactSource(source: CdssFactSource): boolean {
  return source.resourceType === 'MedicationRequest'
    || source.resourceType === 'MedicationStatement'
}

function compactSourceMetadata(source: CdssFactSource): string {
  const metadata = [
    source.date,
    source.facility,
  ].filter(Boolean).join(' · ')
  const medicationName = isMedicationFactSource(source) && typeof source.value === 'string'
    ? source.value.trim()
    : ''
  if (!medicationName) return metadata
  return metadata ? `${metadata} ｜ ${medicationName}` : medicationName
}

function isIcd10System(system?: string): boolean {
  const normalized = system?.toLowerCase() ?? ''
  return (
    normalized.includes('icd-10')
    || normalized.includes('icd10')
    || normalized === 'urn:oid:2.16.840.1.113883.6.90'
  )
}

function sourceIcdCodings(source: CdssFactSource): readonly {
  code: string
  display?: string
}[] {
  const seen = new Set<string>()
  return (source.coding ?? []).flatMap((coding) => {
    if (!coding.code || !isIcd10System(coding.system)) return []
    const code = coding.code.toUpperCase()
    const key = `${code}|${coding.display ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ code, display: coding.display }]
  })
}

function EvidenceSources({
  sources,
  isEnglish,
  evidenceLabel,
  evidenceValue,
  onNavigate,
  compact = false,
  compactLabel,
  popover = false,
}: {
  sources: readonly CdssFactSource[]
  isEnglish: boolean
  evidenceLabel: string
  evidenceValue: string
  onNavigate: (target: ResourceNavTarget) => void
  compact?: boolean
  compactLabel?: string
  popover?: boolean
}) {
  const navigableSources = dedupeFactSources(sources)
    .filter((source) => Boolean(
      source.resourceId && leftTabForResourceType(source.resourceType),
    ))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  if (navigableSources.length === 0) return null

  const facilities = new Set(navigableSources.map((source) => source.facility).filter(Boolean))
  const dates = navigableSources.map((source) => source.date).filter((date): date is string => Boolean(date)).sort()
  const dateRange = dates.length > 1 && dates[0] !== dates.at(-1)
    ? `${dates[0]}–${dates.at(-1)}`
    : dates[0]
  const isMedicationHistory = navigableSources.every((source) => (
    source.resourceType === 'MedicationRequest'
    || source.resourceType === 'MedicationStatement'
  ))
  const summary = [
    isMedicationHistory
      ? isEnglish
        ? `${navigableSources.length} medication record${navigableSources.length === 1 ? '' : 's'}`
        : `${navigableSources.length} 筆用藥歷程`
      : isEnglish
        ? `${navigableSources.length} source record${navigableSources.length === 1 ? '' : 's'}`
        : `${navigableSources.length} 筆原始資料`,
    facilities.size > 0
      ? (isEnglish ? `${facilities.size} facilit${facilities.size === 1 ? 'y' : 'ies'}` : `${facilities.size} 家院所`)
      : undefined,
    dateRange,
  ].filter(Boolean).join(' · ')
  const compactSummary = [
    isMedicationHistory
      ? isEnglish
        ? `Medication history ${navigableSources.length}`
        : `用藥歷程 ${navigableSources.length} 筆`
      : isEnglish
        ? `Sources ${navigableSources.length}`
        : `來源 ${navigableSources.length}`,
  ].filter(Boolean).join(' · ')

  if (compact && navigableSources.length === 1) {
    const source = navigableSources[0]
    const sourceValue = source.value !== undefined
      ? `${source.value}${source.unit ? ` ${source.unit}` : ''}`
      : undefined

    return (
      <button
        type="button"
        onClick={() => onNavigate({
          resourceType: source.resourceType,
          resourceId: source.resourceId,
          display: `${evidenceLabel} ${sourceValue ?? evidenceValue}`,
          date: source.date,
        })}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={isEnglish ? 'Locate this record in the left panel' : '在左側資料中定位此筆紀錄'}
        aria-label={isEnglish ? 'Open source record in the left panel' : '在左側開啟來源紀錄'}
      >
        <PanelLeftOpen className="h-3.5 w-3.5" />
        {compactLabel ?? (isEnglish ? 'View source' : '查看來源')}
      </button>
    )
  }

  return (
    <details
      className={cn(
        'group rounded-md',
        compact
          ? cn(
              'w-fit max-w-full text-muted-foreground',
              popover && 'relative',
            )
          : 'mt-2 border border-border/70 bg-muted/15',
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          compact
            ? 'min-h-7 rounded-md px-1.5 text-[11px] transition-colors hover:bg-primary/5 hover:text-primary'
            : 'min-h-9 px-2.5 py-1.5 text-xs',
        )}
      >
        <FileSearch className={cn('shrink-0', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className="min-w-0 break-words">
          {compact ? (compactLabel ?? compactSummary) : summary}
        </span>
        <ChevronDown className={cn(
          'ml-auto shrink-0 transition-transform group-open:rotate-180',
          compact ? 'h-3 w-3' : 'h-3.5 w-3.5',
        )} />
      </summary>
      <ul
        className={cn(
          'divide-y divide-border/60 px-2.5',
          compact
            ? cn(
                'overflow-hidden rounded-md border border-border/70 bg-background',
                popover
                  ? 'absolute right-0 top-full z-30 mt-1 w-[36rem] max-w-[calc(100vw-2rem)] shadow-lg'
                  : 'mt-1 min-w-[18rem] shadow-sm',
              )
            : 'border-t border-border/70',
        )}
      >
        {navigableSources.map((source) => {
          const isMedicationSource = isMedicationFactSource(source)
          const sourceRecordValue = source.value !== undefined
            ? `${source.value}${source.unit ? ` ${source.unit}` : ''}`
            : undefined
          const sourceValue = isMedicationSource ? undefined : sourceRecordValue
          const sourceMetadata = compactSourceMetadata(source)
          const icdCodings = sourceIcdCodings(source)
          return (
          <li
            key={`${source.resourceType}-${source.resourceId}`}
            className={cn(compact ? 'py-0' : 'py-1.5')}
          >
            <div className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md',
              compact ? 'min-h-8 px-1 py-0.5' : 'min-h-10 px-1.5 py-1',
            )}>
              <span className={cn(
                'min-w-0 select-text',
                compact && 'flex flex-wrap items-center gap-x-2 gap-y-0.5',
              )}>
                <span className={cn(
                  'font-medium text-foreground',
                  compact ? 'truncate text-xs leading-5' : 'block break-words text-sm',
                )}
                title={compact ? sourceMetadata : undefined}
                >
                  {sourceMetadata || (isEnglish ? 'Clinical source record' : '臨床來源紀錄')}
                </span>
                {icdCodings.length > 0 ? (
                  <span className={cn(
                    compact
                      ? 'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5'
                      : 'mt-1 block space-y-1',
                  )}>
                    {icdCodings.map((coding) => (
                      <span
                        key={`${coding.code}-${coding.display ?? ''}`}
                        className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5"
                      >
                        <span className={cn(
                          'rounded bg-primary/10 font-mono font-semibold text-primary',
                          compact ? 'px-1 py-0 text-[11px]' : 'px-1.5 py-0.5 text-xs',
                        )}>
                          {coding.code}
                        </span>
                        {coding.display ? (
                          <span className={cn(
                            'min-w-0 break-words text-muted-foreground',
                            compact ? 'text-[11px]' : 'text-xs',
                          )}>
                            {coding.display}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {sourceValue ? (
                <span className={cn(
                  'whitespace-nowrap font-semibold tabular-nums text-foreground',
                  compact ? 'text-xs' : 'text-sm',
                )}>
                  {sourceValue}
                </span>
              ) : <span aria-hidden="true" />}
              <button
                type="button"
                onClick={() => onNavigate({
                  resourceType: source.resourceType,
                  resourceId: source.resourceId,
                  display: `${evidenceLabel} ${sourceRecordValue ?? evidenceValue}`,
                  date: source.date,
                })}
                className={cn(
                  'group inline-flex shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compact ? 'h-7 w-7' : 'h-9 w-9',
                )}
                title={isEnglish ? 'Locate this record in the left panel' : '在左側資料中定位此筆紀錄'}
                aria-label={isEnglish ? 'Open this record in the left panel' : '在左側開啟此筆紀錄'}
              >
                <PanelLeftOpen className={cn(
                  'transition-transform group-hover:-translate-x-0.5',
                  compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
                )} />
              </button>
            </div>
          </li>
          )
        })}
      </ul>
    </details>
  )
}

function evidenceDisplayRank(
  evidence: CdssRecommendation['patientEvidence'][number],
): number {
  const factKeys = evidence.factKeys.map((key) => key.toLowerCase())
  if (factKeys.includes('age')) return 0
  if (factKeys.some((key) => key.includes('diagnosis'))) return 1
  if (
    factKeys.some((key) => key.includes('therapy') || key.includes('medication'))
    || /^(?:系統核對|system check)/i.test(evidence.label)
  ) return 3
  return 2
}

type PatientEvidence = CdssRecommendation['patientEvidence'][number]

function evidenceWithFactKey(
  evidence: readonly PatientEvidence[],
  factKey: string,
): PatientEvidence | undefined {
  return evidence.find((item) => (
    item.factKeys.length === 1 && item.factKeys.includes(factKey)
  )) ?? evidence.find((item) => item.factKeys.includes(factKey))
}

function inlineEvidenceValue(value: string): string {
  return value
    .replace(/（(\d{4}-\d{2}-\d{2})）$/, ' · $1')
    .replace(/\s+\((\d{4}-\d{2}-\d{2})\)$/, ' · $1')
}

function compactChronicityValue(evidence: PatientEvidence, isEnglish: boolean): string {
  const points = dedupeFactSources(evidence.sources ?? [])
    .filter((source): source is CdssFactSource & { date: string; value: number } => (
      Boolean(source.date)
      && typeof source.value === 'number'
      && Number.isFinite(source.value)
    ))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (points.length < 2) return inlineEvidenceValue(evidence.value)

  const earliest = points[0]
  const latest = points.at(-1)!
  return isEnglish
    ? `Confirmed: ${earliest.value} → ${latest.value} (${earliest.date} → ${latest.date}; ≥3 months)`
    : `已確認：${earliest.value} → ${latest.value}（${earliest.date} → ${latest.date}；間隔至少 3 個月）`
}

type CompactPatientEvidenceRow = {
  label: string
  value: string
  evidence: PatientEvidence
}

function CompactPatientEvidenceSection({
  recommendation,
  rows,
  sourceEvidence = rows.map((row) => row.evidence),
  headingLabel,
  isEnglish,
  onNavigate,
}: {
  recommendation: CdssRecommendation
  rows: readonly CompactPatientEvidenceRow[]
  sourceEvidence?: readonly PatientEvidence[]
  headingLabel: string
  isEnglish: boolean
  onNavigate: (target: ResourceNavTarget) => void
}) {
  const allSources = dedupeFactSources(sourceEvidence.flatMap((item) => item.sources ?? []))

  if (rows.length === 0) return null

  return (
    <section
      aria-labelledby={`patient-evidence-${recommendation.id}`}
      data-testid={`cdss-patient-evidence-${recommendation.id}`}
    >
      <div
        className="flex min-h-7 items-center justify-between gap-2"
        data-testid={`cdss-patient-evidence-heading-${recommendation.id}`}
      >
        <h5
          id={`patient-evidence-${recommendation.id}`}
          className="text-xs font-semibold text-foreground"
        >
          {headingLabel}
        </h5>
        {allSources.length > 0 ? (
          <EvidenceSources
            sources={allSources}
            isEnglish={isEnglish}
            evidenceLabel={headingLabel}
            evidenceValue={recommendation.title}
            onNavigate={onNavigate}
            compact
            compactLabel={allSources.length > 1
              ? (isEnglish ? 'View all sources' : '查看全部資料來源')
              : (isEnglish ? 'View source' : '查看資料來源')}
            popover
          />
        ) : null}
      </div>
      <div
        className="mt-1 overflow-hidden rounded-md border border-border/70 bg-background"
        data-testid={`cdss-patient-evidence-rows-${recommendation.id}`}
      >
        <dl className="divide-y divide-border/60">
          {rows.map((row, index) => (
            <div
              key={`${recommendation.id}-${row.label}-${row.evidence.factKeys.join('-')}-${index}`}
              className="grid min-w-0 gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-xs leading-5 @min-[32rem]:grid-cols-[minmax(5rem,0.16fr)_minmax(0,1fr)] @min-[32rem]:items-baseline"
            >
              <dt className="font-medium text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function ClassificationEvidence({
  recommendation,
  isEnglish,
  onNavigate,
}: {
  recommendation: CdssRecommendation
  isEnglish: boolean
  onNavigate: (target: ResourceNavTarget) => void
}) {
  const evidence = recommendation.patientEvidence
  const diagnosis = evidenceWithFactKey(evidence, 'ckdDiagnosis')
  const eGfr = evidenceWithFactKey(evidence, 'eGFR')
  const chronicity = evidenceWithFactKey(evidence, 'ckdChronicity')
  const urineAlbumin = evidenceWithFactKey(evidence, 'urineAlbuminOverview')
  const usedEvidence = new Set([diagnosis, eGfr, chronicity, urineAlbumin].filter(Boolean))
  const stageEvidence = evidence.find((item) => (
    (
      item.factKeys.includes('eGFR')
      && item.factKeys.some((key) => key.toLowerCase().includes('urinealbumin'))
    )
    || (
      /(?:分期|classification|category)/i.test(item.label)
      && /G(?:[1-5][ab]?|\?)(?:\s*\/\s*A(?:[1-3]|\?))?/i.test(item.value)
    )
  ))
  if (stageEvidence) usedEvidence.add(stageEvidence)

  const rows: CompactPatientEvidenceRow[] = [
    ...(diagnosis ? [{
      label: isEnglish ? 'Diagnosis' : '診斷',
      value: inlineEvidenceValue(diagnosis.value),
      evidence: diagnosis,
    }] : []),
    ...(eGfr ? [{
      label: isEnglish ? 'Kidney function' : '腎功能',
      value: inlineEvidenceValue(eGfr.value),
      evidence: eGfr,
    }] : []),
    ...(chronicity ? [{
      label: isEnglish ? 'Chronicity' : '慢性化',
      value: compactChronicityValue(chronicity, isEnglish),
      evidence: chronicity,
    }] : []),
    ...(urineAlbumin ? [{
      label: isEnglish ? 'Albuminuria' : '白蛋白尿',
      value: inlineEvidenceValue(urineAlbumin.value),
      evidence: urineAlbumin,
    }] : []),
    ...evidence
      .filter((item) => !usedEvidence.has(item))
      .map((item) => ({
        label: item.label,
        value: inlineEvidenceValue(item.value),
        evidence: item,
      })),
  ]
  return (
    <CompactPatientEvidenceSection
      recommendation={recommendation}
      rows={rows}
      sourceEvidence={evidence}
      headingLabel={isEnglish ? 'Patient evidence' : '本病人依據'}
      isEnglish={isEnglish}
      onNavigate={onNavigate}
    />
  )
}

function ClassificationActionPlan({
  recommendation,
  isEnglish,
  nextStepLabel,
  mergeWithSupporting,
}: {
  recommendation: CdssRecommendation
  isEnglish: boolean
  nextStepLabel: string
  mergeWithSupporting: boolean
}) {
  const primaryAction = integratedNextStepActions(
    recommendation.missingData,
    [recommendation.nextActions[0] ?? recommendation.recommendation],
    isEnglish,
  )
  const integratedPrimaryAction = integrateClinicalReviewIntoNextSteps(
    recommendation.clinicalReviewItems,
    primaryAction,
    isEnglish,
  )[0]

  return (
    <section
      className={cn(
        'overflow-hidden border border-border/70 bg-muted/[0.08]',
        mergeWithSupporting ? 'rounded-t-md' : 'rounded-md',
      )}
      aria-label={isEnglish ? 'Next step' : '建議下一步'}
      data-testid={`cdss-action-plan-${recommendation.id}`}
    >
      <div className="grid min-w-0 gap-x-3 gap-y-1 px-3 py-2.5 text-xs leading-relaxed @min-[32rem]:grid-cols-[minmax(6rem,0.2fr)_minmax(0,1fr)]">
        <h5 className="flex items-center gap-1.5 font-semibold text-primary">
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          {nextStepLabel}
        </h5>
        <p data-cdss-action="" className="min-w-0 font-medium text-foreground">{integratedPrimaryAction}</p>
      </div>

    </section>
  )
}

function PreviewTextTooltip({
  text,
  children,
  className,
  triggerTestId,
  contentTestId,
}: {
  text: string
  children: ReactNode
  className?: string
  triggerTestId?: string
  contentTestId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            className,
          )}
          data-testid={triggerTestId}
          tabIndex={0}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={6}
        className="max-w-[min(90vw,30rem)] whitespace-normal text-left text-xs leading-relaxed"
        data-testid={contentTestId}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function DcsiModuleDetail({
  dcsi,
  isEnglish,
  onNavigate,
}: {
  dcsi: DcsiSummary
  isEnglish: boolean
  onNavigate: (target: ResourceNavTarget) => void
}) {
  const assessedLabel = isEnglish
    ? `${dcsi.assessedDomainCount}/${dcsi.totalDomainCount} domains evaluable`
    : `${dcsi.assessedDomainCount}/${dcsi.totalDomainCount} 類可判讀`
  const assessedDomains = dcsi.domains.filter((domain) => domain.state === 'assessed')
  const affectedDomains = assessedDomains.filter((domain) => (domain.score ?? 0) > 0)
  const unavailableCount = dcsi.totalDomainCount - dcsi.assessedDomainCount

  return (
    <div className="space-y-3 px-3 py-3 @min-[36rem]:px-4" data-testid="dcsi-module-detail">
      <section className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/30 px-2.5 py-2">
        <div className="text-base font-semibold tabular-nums text-foreground">
          {dcsi.headline}
        </div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          {affectedDomains.length > 0
            ? affectedDomains.map((domain) => `${domain.label} ${domain.score}`).join(isEnglish ? ', ' : '、')
            : (isEnglish ? 'No points in currently evaluable domains' : '目前可判讀構面未計分')}
        </div>
        <Badge
          className={cn(
            'ml-auto h-6 w-fit px-2 text-xs',
            dcsi.isComplete
              ? 'bg-slate-100 text-slate-800 hover:bg-slate-100 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary'
              : 'bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200',
          )}
        >
          {assessedLabel}
        </Badge>
      </section>

      <section aria-label={isEnglish ? 'Complete DCSI score map' : '完整 DCSI 計分地圖'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-foreground">
            {isEnglish ? 'Complete 13-point score map' : '完整 13 分構成'}
          </h5>
          <span className="text-xs tabular-nums text-muted-foreground">
            {isEnglish
              ? 'Eye 2 + kidney 2 + nerve 1 + four other domains 2 each'
              : '眼 2＋腎 2＋神經 1＋腦血管 2＋心血管 2＋周邊血管 2＋代謝 2'}
          </span>
        </div>
        <div className="mt-1.5 divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
          {dcsi.domains.map((domain) => (
            <details
              key={domain.id}
              className="group bg-background text-xs leading-relaxed"
              data-testid={`dcsi-domain-${domain.id}`}
            >
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                <span className="min-w-0 flex-1 font-semibold text-foreground">{domain.label}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'h-6 whitespace-nowrap px-2 text-xs',
                    domain.state === 'assessed'
                      ? 'border-primary/30 bg-primary/5 text-primary'
                      : 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  {domain.state === 'assessed'
                    ? (isEnglish
                        ? `${domain.score}/${domain.maxScore}`
                        : `${domain.score}/${domain.maxScore} 分`)
                    : (isEnglish ? `Unknown · max ${domain.maxScore}` : `未判定 · 最高 ${domain.maxScore}`)}
                </Badge>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>

              <div className="border-t border-border/60 px-2.5 py-2">
                <div className="space-y-0.5 text-muted-foreground">
                    {domain.scoreCriteria.map((criterion) => (
                      <div key={`${domain.id}-${criterion.score}`}>
                        <strong className="font-medium text-foreground">
                          {criterion.score} {isEnglish ? 'pt' : '分'}：
                        </strong>
                        {criterion.summary}
                      </div>
                    ))}
                </div>

                {domain.state === 'assessed' && domain.evidence.length > 0 ? (
                  <div className="mt-2 rounded-md bg-muted/25 px-2.5 py-2">
                    <div className="font-medium text-foreground">
                      {isEnglish ? 'Patient evidence' : '本病人依據'}
                    </div>
                    {domain.evidence.map((evidence) => (
                      <div key={`${domain.id}-${evidence.label}`} className="mt-0.5 text-muted-foreground">
                        {evidence.value}
                        {evidence.sources && evidence.sources.length > 0 ? (
                          <EvidenceSources
                            sources={evidence.sources}
                            isEnglish={isEnglish}
                            evidenceLabel={evidence.label}
                            evidenceValue={evidence.value}
                            onNavigate={onNavigate}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </section>

      {unavailableCount > 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {isEnglish
            ? `${unavailableCount} domains are not available in the current data and are not counted as zero.`
            : `其餘 ${unavailableCount} 類目前無可判讀資料，不列為 0 分。`}
        </p>
      ) : null}

      <details className="group rounded-md border border-border/70 bg-background">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <BookOpenCheck className="h-4 w-4 text-primary" />
          {isEnglish ? 'Scoring method and evidence' : '計分方法與研究依據'}
          <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-border/70 px-3 py-2.5">
          {dcsi.evidenceReferences.map((reference) => (
            <a
              key={reference.id}
              href={reference.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-1 text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{reference.title} · {reference.version}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            </a>
          ))}
        </div>
      </details>

      <section className="flex gap-2 border-t border-border/70 pt-2.5 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {isEnglish
            ? 'Use DCSI to summarize burden and prioritize review; do not use it alone to change treatment.'
            : 'DCSI 僅摘要併發症負荷與安排檢視順序，不單獨用來調整治療。'}
        </p>
      </section>
    </div>
  )
}

function SourceGuidelineReference({
  reference,
  isEnglish,
}: {
  reference: GuidelineReference
  isEnglish: boolean
}) {
  const citedStatements = reference.citedStatements ?? []
  const sourceLinkLabel = reference.page
    ? isEnglish
      ? `Open official page ${reference.page}`
      : `開啟官方原文第 ${reference.page} 頁`
    : isEnglish
      ? 'Open official recommendation'
      : '開啟官方原文條文'

  if (citedStatements.length > 0) {
    return (
      <details
        className="group/reference border-t border-border/60 first:border-t-0"
        data-testid={`guideline-statement-toggle-${reference.id}`}
      >
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 py-1.5 text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">
            {reference.recommendationId ?? reference.title}
            {reference.page
              ? isEnglish
                ? ` · p. ${reference.page}`
                : ` · 第 ${reference.page} 頁`
              : ''}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/reference:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-border/60 py-2">
          <dl className="space-y-2">
            {citedStatements.map((statement) => (
              <div key={`${reference.id}-${statement.label}`}>
                <dt className="font-semibold text-foreground">{statement.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line leading-relaxed text-foreground">
                  {statement.text}
                </dd>
              </div>
            ))}
          </dl>
          <a
            href={reference.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-8 items-center gap-1 font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sourceLinkLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </details>
    )
  }

  if (reference.page || reference.directLink) {
    return (
      <a
        href={reference.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-8 items-center gap-1.5 border-t border-border/60 py-1.5 font-medium text-primary transition-colors first:border-t-0 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {reference.recommendationId ?? reference.title}
          {reference.page
            ? isEnglish
              ? ` · p. ${reference.page}`
              : ` · 第 ${reference.page} 頁`
            : ''}
        </span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </a>
    )
  }

  return (
    <details className="group/reference border-t border-border/60 first:border-t-0">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 py-1.5 font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <BookOpenCheck className="h-3.5 w-3.5" />
        {reference.recommendationId ?? reference.title}
        <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open/reference:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border/60 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {reference.recommendationId ? (
            <Badge variant="outline" className="h-6 bg-muted/30 px-2 text-xs">
              {isEnglish ? 'Recommendation' : '建議條號'} {reference.recommendationId}
            </Badge>
          ) : null}
          {reference.evidenceGrade ? (
            <Badge variant="outline" className="h-6 bg-muted/30 px-2 text-xs">
              {isEnglish ? 'Evidence' : '證據等級'} {reference.evidenceGrade}
            </Badge>
          ) : null}
        </div>
        {reference.locator ? (
          <p className="font-medium text-foreground">{reference.locator}</p>
        ) : null}
        <p className="leading-relaxed text-foreground">{reference.summary}</p>
        <a
          href={reference.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
        >
          {isEnglish ? 'Open official source' : '開啟官方原文'}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </details>
  )
}

function RecommendationDetail({
  recommendation,
  englishRecommendation,
  isEnglish,
  onNavigate,
  label,
  patientId,
  copyProvenance,
  phenotypeAnswer,
  onAnswerPhenotype,
  clinicVitals,
  onSaveClinicVitals,
  physicianRowsReadOnly = false,
  hideEvidenceTables = false,
  onEditPhysicianRow,
}: {
  recommendation: CdssRecommendation
  englishRecommendation?: CdssRecommendation
  isEnglish: boolean
  onNavigate: (target: ResourceNavTarget) => void
  patientId?: string
  /** The clinician's answers to this card's structured questions, if any. */
  phenotypeAnswer?: PhenotypeAnswer
  onAnswerPhenotype?: (answer: PhenotypeAnswer) => void
  /** Today's examination, so a sign ticked here is the one the pack reads. */
  clinicVitals?: ClinicVitals
  onSaveClinicVitals?: (patch: ClinicVitalsPatch) => void
  /**
   * The visit flow owns the congestion and NYHA questions, so the evidence
   * rows inside a detail echo the answer instead of offering a second control.
   */
  physicianRowsReadOnly?: boolean
  /** Hides evidence tables already collected elsewhere in the visit flow. */
  hideEvidenceTables?: boolean
  onEditPhysicianRow?: (question: 'nyha' | 'symptoms' | 'signs') => void
  /** Names the pack in the copied rationale; absent when the result has no version. */
  copyProvenance?: RationaleCopyProvenance
  label: {
    evidence: string
    missing: string
    missingShort: string
    next: string
    nextStep: string
    guidelines: string
    safety: string
    sourceComparison: string
    supporting: string
  }
}) {
  const [isSupportingOpen, setIsSupportingOpen] = useState(false)
  // A question and an action read in different places. 「這位病人的 LVEF 是
  // 多少？」 is why the rows below cannot conclude, so it sits above them;
  // 「確認 HFpEF 診斷」 is what a clinician does after reading them, so it sits
  // at the foot of the card.
  const physicianInputRequests = physicianInputRequestsOf(recommendation)
  const questionRequests = physicianInputRequests.filter(
    (request) => request.kind === 'lvef-phenotype',
  )
  const actionRequests = physicianInputRequests.filter(
    (request) => request.kind === 'hfpef-diagnosis-confirmation',
  )
  // A sign ticked on this card is the same examination the congestion card and
  // the board's chips offer, so all three read and write one record.
  const selectedSymptoms = (['edema', 'orthopnea-pnd', 'jvp-rales'] as const)
    .filter((group) => isCongestionGroupPresent(clinicVitals, group))
  // The visit flow asks this once, in 本次評估; a second tick-list inside a
  // card is the duplication this restructure removed.
  const toggleSymptom = onSaveClinicVitals && !physicianRowsReadOnly
    ? (id: string, selected: boolean) => {
        onSaveClinicVitals(congestionGroupPatch(
          id as CongestionSignsAnswer,
          selected ? 'present' : null,
        ))
      }
    : undefined
  const { copied: rationaleCopied, copy: copyToClipboard } = useCopyToClipboard()
  const copyRationale = async () => {
    const source = englishRecommendation ?? (isEnglish ? recommendation : undefined)
    if (!source) {
      toast.error(isEnglish ? 'English rationale is unavailable.' : '英文理由尚未取得，請重新載入病人資料。')
      return
    }
    const ok = await copyToClipboard(buildRationaleCopyText(
      source,
      'en',
      copyProvenance,
    ))
    if (!ok) {
      toast.error(isEnglish
        ? 'Could not copy — the clipboard is unavailable in this context.'
        : '無法複製，此環境無法使用剪貼簿。')
    }
  }
  const orderedPatientEvidence = recommendation.patientEvidence
    .map((evidence, originalIndex) => ({ evidence, originalIndex }))
    .sort((a, b) => (
      evidenceDisplayRank(a.evidence) - evidenceDisplayRank(b.evidence)
      || a.originalIndex - b.originalIndex
    ))
    .map(({ evidence }) => evidence)
  const compactPatientEvidenceRows: CompactPatientEvidenceRow[] = orderedPatientEvidence.map((evidence) => ({
    label: evidence.label,
    value: inlineEvidenceValue(evidence.value),
    evidence,
  }))

  if (recommendation.dcsi) {
    return (
      <DcsiModuleDetail
        dcsi={recommendation.dcsi}
        isEnglish={isEnglish}
        onNavigate={onNavigate}
      />
    )
  }

  const semanticCard = buildPhysicianSemanticCard(
    recommendation,
    isEnglish ? 'en' : 'zh-TW',
  )
  const englishSemanticCard = englishRecommendation
    ? buildPhysicianSemanticCard(englishRecommendation, 'en')
    : undefined
  const sourceAssessmentsWithContent = (recommendation.sourceAssessments ?? []).filter((source) => (
    !(
      recommendation.domain !== 'medication'
      && source.sourceKind === 'coverage'
      && source.status === 'not-applicable'
    )
    && (source.sourceKind === 'coverage' || source.references.length > 0)
  ))
  const assessedReferenceIds = new Set(
    sourceAssessmentsWithContent.flatMap((source) => (
      source.references.map((reference) => reference.id)
    )),
  )
  const directGuidelineStatus: CdssSourceAssessmentStatus = recommendation.status === 'needs-data'
    ? 'needs-data'
    : recommendation.status === 'actionable'
      ? 'recommended'
      : 'consider'
  const directGuidelineSources = recommendation.guidelineReferences
    .filter((reference) => !assessedReferenceIds.has(reference.id))
    .map((reference) => ({
      sourceId: `guideline-reference:${reference.id}`,
      sourceKind: 'guideline' as const,
      sourceLabel: directGuidelineSourceLabel(reference, isEnglish),
      version: reference.version,
      effectiveFrom: reference.version,
      status: directGuidelineStatus,
      summary: reference.summary,
      references: [reference],
    }))
  const visibleSourceAssessments = [
    ...sourceAssessmentsWithContent,
    ...directGuidelineSources,
  ]
  const sourceStatusesByKind = new Map<string, Set<CdssSourceAssessmentStatus>>()
  visibleSourceAssessments.forEach((source) => {
    const statuses = sourceStatusesByKind.get(source.sourceKind) ?? new Set<CdssSourceAssessmentStatus>()
    statuses.add(source.status)
    sourceStatusesByKind.set(source.sourceKind, statuses)
  })
  const isCompactClassification = recommendationPresentationType(recommendation) === 'classification'
  const presentationCopy = modulePresentationCopy(recommendation, isEnglish)
  const primaryGuidelineRule = semanticCard.guidelineRules.find(
    (rule) => rule.sourceKind === 'guideline',
  ) ?? semanticCard.guidelineRules[0]
  const primaryGuidelineSummary = englishSemanticCard?.guidelineRecommendation
    ?? semanticCard.guidelineRecommendation
  const displayNextActions = integrateClinicalReviewIntoNextSteps(
    recommendation.clinicalReviewItems,
    integratedNextStepActions(
      recommendation.missingData,
      recommendation.nextActions,
      isEnglish,
    ),
    isEnglish,
  )
  const hasActionPlan = displayNextActions.length > 0
  const classificationThresholds = isCompactClassification
    ? recommendation.nextActions.slice(1)
    : []
  const hasGuidelineSource = visibleSourceAssessments.some(
    (source) => source.sourceKind === 'guideline' && source.references.length > 0,
  ) || semanticCard.guidelineRules.some((rule) => rule.sourceKind === 'guideline')
  const showDecisionMethod = !hasGuidelineSource
    && semanticCard.decisionLogic.trim().length > 0
    && semanticCard.decisionLogic.trim() !== semanticCard.clinicalConclusion.trim()
  const sourceSectionLabel = visibleSourceAssessments.some(
    (source) => source.sourceKind === 'coverage',
  )
    ? isEnglish ? 'Guideline and coverage sources' : '指引與給付來源'
    : label.sourceComparison
  const sourceColumnCount = Math.min(Math.max(visibleSourceAssessments.length, 1), 3)

  const sourceStatusLabel: Record<CdssSourceAssessmentStatus, string> = {
    recommended: isEnglish ? 'Recommended' : '建議',
    consider: isEnglish ? 'Consider' : '可考慮',
    covered: isEnglish ? 'Covered' : '符合給付',
    'not-covered': isEnglish ? 'Not covered' : '不符合給付',
    'needs-data': isEnglish ? 'Verify data' : '待補資料',
    'no-special-rule': isEnglish ? 'No special rule' : '無專款門檻',
    'not-applicable': isEnglish ? 'Not applicable' : '不適用',
  }

  return (
    <div className="space-y-2 px-3 py-2.5 @min-[36rem]:px-4">
      <section
        className="rounded-md border border-primary/20 bg-primary/[0.025] px-3 py-2.5"
        aria-label={isEnglish ? 'Automatically generated physician semantic card' : '自動產生的醫師語意卡片'}
        data-testid={`cdss-semantic-card-${recommendation.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <BookOpenCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            <h5 className="text-xs font-semibold text-foreground">
              {presentationCopy.guidelineHeading}
            </h5>
            {primaryGuidelineRule ? (
              <>
                <Badge variant="outline" className="h-5 bg-background px-1.5 text-[11px]">
                  {primaryGuidelineRule.sourceLabel} · {primaryGuidelineRule.sourceVersion}
                </Badge>
                {primaryGuidelineRule.reference.evidenceGrade ? (
                  <Badge variant="outline" className="h-5 bg-background px-1.5 text-[11px]">
                    {primaryGuidelineRule.reference.evidenceGrade}
                  </Badge>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void copyRationale()}
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={isEnglish
              ? 'Copy the assessment, patient data, guideline citations and limits as plain text'
              : '把判定、病人資料、指引出處與限制複製成純文字，可貼進病歷或申覆'}
            data-testid={`cdss-copy-rationale-${recommendation.id}`}
          >
            {rationaleCopied
              ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
              : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {rationaleCopied
              ? (isEnglish ? 'Copied' : '已複製')
              : (isEnglish ? 'Copy' : '複製')}
          </button>
          {primaryGuidelineRule ? (
            <a
              href={primaryGuidelineRule.reference.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline underline-offset-2"
            >
              {isEnglish ? 'Open guideline source' : '查看指引原文'}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          </div>
        </div>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-foreground">
          {primaryGuidelineSummary}
        </p>

      </section>

      {isCompactClassification ? (
        <ClassificationEvidence
          recommendation={recommendation}
          isEnglish={isEnglish}
          onNavigate={onNavigate}
        />
      ) : orderedPatientEvidence.length > 0 ? (
        <CompactPatientEvidenceSection
          recommendation={recommendation}
          rows={compactPatientEvidenceRows}
          headingLabel={label.evidence}
          isEnglish={isEnglish}
          onNavigate={onNavigate}
        />
      ) : null}

      {/*
        A question the card cannot answer from the record goes above the rows,
        because it is the reason the rows are inconclusive: the phenotype gate
        asks for an LVEF the cloud record never held. An answer is written to
        the store and handed back as a fact, so the pack recomputes.
      */}
      {onAnswerPhenotype && questionRequests.length > 0 ? (
        <PhysicianInputRequestPanel
          requests={questionRequests}
          recommendationId={recommendation.id}
          isEnglish={isEnglish}
          answer={phenotypeAnswer}
          onAnswer={onAnswerPhenotype}
          selectedSymptoms={selectedSymptoms}
          onToggleSymptom={toggleSymptom}
        />
      ) : null}

      {/*
        Evidence tables remain available in the original board. The visit flow
        can hide a table when its questions already live in the assessment step.
      */}
      {hideEvidenceTables ? null : (recommendation.evidenceTables ?? []).map((table) => (
        <EvidenceTablePanel
          key={`${recommendation.id}-${table.concept}`}
          table={table}
          recommendationId={recommendation.id}
          locale={isEnglish ? 'en' : 'zh-TW'}
          patientId={patientId}
          onNavigate={onNavigate}
          clinicVitals={clinicVitals}
          onSaveClinicVitals={onSaveClinicVitals}
          physicianRowsReadOnly={physicianRowsReadOnly}
          onEditPhysicianRow={onEditPhysicianRow}
        />
      ))}

      {isCompactClassification ? (
        <ClassificationActionPlan
          recommendation={recommendation}
          isEnglish={isEnglish}
          nextStepLabel={label.nextStep}
          mergeWithSupporting
        />
      ) : hasActionPlan ? (
        <section
          className="overflow-hidden rounded-md border border-border/70 bg-muted/[0.08]"
          aria-label={isEnglish ? 'Items to confirm and next steps' : '待確認與建議下一步'}
          data-testid={`cdss-action-plan-${recommendation.id}`}
        >
          {displayNextActions.length > 0 ? (
            <div className="grid min-w-0 gap-x-3 gap-y-1 px-3 py-2.5 text-xs leading-relaxed @min-[32rem]:grid-cols-[minmax(7rem,0.28fr)_minmax(0,1fr)]">
              <h5 className="flex items-center gap-1.5 font-semibold text-primary">
                <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                {label.nextStep}
              </h5>
              <div data-cdss-action="" className="min-w-0 text-foreground">
                {displayNextActions.length === 1 ? (
                  <span>{displayNextActions[0]}</span>
                ) : (
                  <ol className="list-decimal space-y-1 pl-4 marker:font-semibold">
                    {displayNextActions.map((action) => <li key={action}>{action}</li>)}
                  </ol>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Read the rows first, then act: the confirmation sits at the foot. */}
      {onAnswerPhenotype && actionRequests.length > 0 ? (
        <PhysicianInputRequestPanel
          requests={actionRequests}
          recommendationId={recommendation.id}
          isEnglish={isEnglish}
          answer={phenotypeAnswer}
          onAnswer={onAnswerPhenotype}
        />
      ) : null}

      <details
        open={isSupportingOpen}
        className={cn(
          'group border border-border/70 bg-background',
          isCompactClassification
            ? '-mt-2 rounded-b-md border-t-0'
            : 'rounded-md',
        )}
        data-testid={`cdss-supporting-context-${recommendation.id}`}
      >
        <summary
          className={cn(
            'flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            isCompactClassification && 'border-t border-border/60',
          )}
          onClick={(event) => {
            event.preventDefault()
            setIsSupportingOpen((open) => !open)
          }}
        >
          <CircleHelp className="h-3.5 w-3.5 shrink-0" />
          {isCompactClassification && classificationThresholds.length > 0
            ? isEnglish ? 'Follow-up, sources, and limits' : '追蹤、來源與限制'
            : label.supporting}
          <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-border/60 border-t border-border/70 px-3 text-xs leading-relaxed">
          {classificationThresholds.length > 0 ? (
            <section
              className="py-2.5"
              data-testid={`cdss-classification-thresholds-${recommendation.id}`}
            >
              <h5 className="font-semibold text-foreground">
                {isEnglish ? 'Follow-up and alert thresholds' : '追蹤與警示門檻'}
              </h5>
              <ul className="mt-1.5 space-y-1.5 text-muted-foreground">
                {classificationThresholds.map((action) => (
                  <li key={action} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {showDecisionMethod ? (
            <section className="py-2.5">
              <h5 className="font-semibold text-foreground">
                {isEnglish ? 'Additional decision context' : '判斷補充'}
              </h5>
              <p className="mt-1 text-muted-foreground">{semanticCard.decisionLogic}</p>
            </section>
          ) : null}

          {visibleSourceAssessments.length > 0 ? (
            <section className="py-2.5" aria-label={sourceSectionLabel}>
              <h5 className="font-semibold text-foreground">{sourceSectionLabel}</h5>
              <div
                className={cn(
                  'mt-1.5 grid',
                  sourceColumnCount === 2 && '@min-[38rem]:grid-cols-2',
                  sourceColumnCount === 3 && '@min-[38rem]:grid-cols-3',
                )}
                data-testid={`cdss-source-comparison-${recommendation.id}`}
              >
                {visibleSourceAssessments.map((item, index) => {
                  const showSourceStatus = item.sourceKind === 'coverage'
                    || (sourceStatusesByKind.get(item.sourceKind)?.size ?? 0) > 1
                  const showSourceSummary = item.references.length === 0
                    && item.summary.trim().length > 0

                  return (
                    <div
                      key={`${recommendation.id}-${item.sourceId}`}
                      className={cn(
                        'min-w-0 py-1',
                        index > 0 && 'border-t border-border pt-2.5',
                        index > 0
                          && index < sourceColumnCount
                          && '@min-[38rem]:border-t-0 @min-[38rem]:pt-1',
                        index % sourceColumnCount !== 0
                          && '@min-[38rem]:border-l @min-[38rem]:border-border @min-[38rem]:pl-3',
                        index % sourceColumnCount !== sourceColumnCount - 1
                          && '@min-[38rem]:pr-3',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-1.5">
                        <div>
                          <div className="font-semibold text-foreground">{item.sourceLabel}</div>
                          <div className="text-muted-foreground">{item.version}</div>
                        </div>
                        {showSourceStatus ? (
                          <Badge className={cn('h-5 px-1.5 text-[11px]', sourceStatusStyle[item.status])}>
                            {sourceStatusLabel[item.status]}
                          </Badge>
                        ) : null}
                      </div>
                      {showSourceSummary ? (
                        <p className="mt-1.5 text-foreground">{item.summary}</p>
                      ) : null}
                      {item.references.length > 0 ? (
                        <div className="mt-1.5">
                          {item.references.map((reference) => (
                            <SourceGuidelineReference
                              key={reference.id}
                              reference={reference}
                              isEnglish={isEnglish}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : semanticCard.guidelineRules.length > 0 ? (
            <section className="py-2.5">
              <h5 className="font-semibold text-foreground">{label.guidelines}</h5>
              <div className="mt-1.5 space-y-2">
                {semanticCard.guidelineRules.map((rule) => (
                  <div key={`${rule.sourceId ?? rule.sourceLabel}-${rule.reference.id}`}>
                    <p className="font-medium text-foreground">
                      {rule.sourceLabel} · {rule.sourceVersion}
                      {rule.reference.recommendationId ? ` · ${rule.reference.recommendationId}` : ''}
                      {rule.reference.evidenceGrade
                        ? ` · ${isEnglish ? 'Grade' : '等級'} ${rule.reference.evidenceGrade}`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{rule.reference.summary}</p>
                    <a
                      href={rule.reference.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                    >
                      {isEnglish ? 'Open source' : '查看原文'}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="py-2.5">
            <h5 className="flex items-center gap-1.5 font-semibold text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {label.safety}
            </h5>
            {semanticCard.limitations.length === 1 ? (
              <p className="mt-1 select-text text-muted-foreground">
                {semanticCard.limitations[0]}
              </p>
            ) : (
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {semanticCard.limitations.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span aria-hidden="true">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </div>
  )
}

export function ClinicalDecisionSupportView({
  afAnswers,
  onAfAnswer,
  onCoronaryPhase,
  coronaryPhaseAnswer,
  result,
  englishResult,
  locale,
  patientId,
  nhiLipidAiAssist,
  nhiLipidAnswerProvenance,
  profileFacts,
  followUpHistory,
  layout: requestedLayout = 'flow',
  clinicVitals,
  onSaveClinicVitals,
  onClearClinicVitals,
  phenotypeAnswer,
  onAnswerPhenotype,
  physicianDecisions,
  onRecordDecision,
  onClearDecision,
  hfpefReading,
  onSaveHfpefInputs,
  nhiPageResetKey = 0,
  visitModel,
  companionResults,
  visitAnswers,
  visitAnswerSources,
  onVisitAnswer,
  englishCompanionResults,
}: ClinicalDecisionSupportViewProps) {
  // The decision map exists only with a model; asked for without one, the page
  // is the three sections it always was.
  const layout: CdssLayout = requestedLayout === 'map' && !visitModel ? 'sections' : requestedLayout
  const englishRecommendations = new Map([
    ...(englishCompanionResults ?? []).flatMap(companion => [
      ...companion.recommendations,
      ...(companion.automatedChecks ?? []).flatMap(check => check.recommendation ? [check.recommendation] : []),
    ]),
    ...(englishResult?.recommendations ?? []),
    ...(englishResult?.automatedChecks ?? []).flatMap(check => check.recommendation ? [check.recommendation] : []),
  ].map(item => [item.id, item]))
  const isEnglish = locale === 'en'
  const label = {
    high: isEnglish ? 'High priority' : '優先處理',
    medium: isEnglish ? 'Review next' : '接續檢視',
    routine: isEnglish ? 'Routine' : '例行盤點',
    actionable: isEnglish ? 'Actionable now' : '可立即處理',
    'needs-data': isEnglish ? 'Data needed' : '需先補資料',
    review: isEnglish ? 'Clinical review' : '需臨床確認',
    'no-action': isEnglish ? 'No action needed' : '目前無需處理',
    decision: isEnglish ? 'Module / current assessment' : '模組／本次判斷',
    statusAndEvidence: isEnglish ? 'Key evidence' : '關鍵依據',
    nextStep: isEnglish ? 'Next step' : '下一步',
    evidence: isEnglish ? 'Patient evidence' : '本病人依據',
    missing: isEnglish ? 'Missing for this decision' : '這項決策還缺',
    missingShort: isEnglish ? 'Missing' : '缺',
    next: isEnglish ? 'Suggested next actions' : '建議下一步',
    guidelines: isEnglish ? 'Guideline summary and location' : '指引摘要與章節定位',
    safety: isEnglish ? 'Decision boundary' : '決策邊界',
    sourceComparison: isEnglish ? 'Guideline sources' : '指引來源',
    supporting: isEnglish ? 'Guideline sources and limits' : '指引來源與限制',
    notEvaluated: isEnglish ? 'Not evaluated in this POC' : '本次未評估',
    limitations: isEnglish ? 'Scope and limitations' : '使用限制',
    showDetails: isEnglish ? 'Show decision details' : '展開決策詳情',
    hideDetails: isEnglish ? 'Hide decision details' : '收合決策詳情',
    automatedChecks: isEnglish ? 'No action needed' : '目前無需處理',
  } as const

  const [requestedExpandedId, setRequestedExpandedId] = useState<string | null>(null)
  // One clock per day: the board prints how old each safety input is, and a
  // clock read on every render would make the same value drift across ticks —
  // but a page left open past midnight reads it again, so yesterday's answers
  // and decisions stop counting as today's (#166 review).
  const now = useTodayNow()
  const board = useMemo(
    () => (layout === 'classic' ? undefined : buildHeartFailureBoard(result, locale, now, profileFacts)),
    [layout, locale, now, profileFacts, result],
  )
  // The decision map replaces every other face of the page while it is chosen,
  // and exists only when the pack produced a model for it.
  const isMap = layout === 'map' && Boolean(visitModel)
  const afBoard = useMemo(() => layout === 'classic' ? undefined : buildDiseaseBoard(result, AF_BOARD_CONFIG, locale, profileFacts), [result, locale, profileFacts, layout])
  // The visit flow is the heart-failure default. Every other pack, and the
  // original board, take the paths they always took — not a line of them moves.
  const isSections = layout === 'sections' && !afBoard
  const isNhiTable = layout === 'nhi' && result.packId === 'hyperlipidemia-cdss'
  const nhiSummary = isNhiTable
    ? result.recommendations.find((item) => item.id === 'dyslipidemia-risk-and-target')?.coverageSummary
    : undefined
  const nhiRecordSources = useMemo(
    () => isNhiTable ? buildNhiRecordSources(profileFacts) : undefined,
    [isNhiTable, profileFacts],
  )
  const ModuleSections = result.packId === 'hyperlipidemia-cdss' ? LipidModuleSections : CdssModuleSections
  const isVisitFlow = (layout === 'flow' || isSections) && result.packId === HEART_FAILURE_PACK_ID && Boolean(board)
  const visitFlow = useMemo(() => (
    isVisitFlow && board
      ? buildHeartFailureVisitFlow({
        board,
        result,
        isEnglish,
        now,
        clinicVitals,
        phenotypeAnswer,
        decisions: physicianDecisions ?? {},
        patientId,
        includeAllModules: isSections,
        trustsPackFollowUp: isSections,
      })
      : undefined
  ), [
    board, clinicVitals, isEnglish, isVisitFlow, isSections, now, patientId, phenotypeAnswer,
    physicianDecisions, result,
  ])
  // 照護安排 holds the standing reminders — nutrition targets, immunisation —
  // whose wording is the same at every visit for every patient of this age and
  // stage. Left open they are read once and skipped thereafter, and they teach
  // the eye to skip the section, which matters because specialist referral
  // lives there too. So the section starts folded, and unfolds itself the moment
  // it holds something to do.
  const [collapsedModuleGroups, setCollapsedModuleGroups] = useState<Set<string>>(
    () => new Set<string>(
      board
        // On the heart-failure board the done modules fold into one line that
        // names them; the rest of the list is what still needs the clinician.
        // When nothing else is listed — a patient the pathway did not open
        // for produces the phenotype card alone — the line is the whole list,
        // so it stays open rather than hiding the one thing there is to read.
        ? (result.recommendations.some((item) => (
            !board.consumedIds.has(item.id) && item.status !== 'no-action'
          ))
            ? ['no-action']
            : [])
        : result.recommendations.some((item) => (
          item.moduleGroup === 'care'
          && (item.status === 'actionable' || item.priority === 'high')
        ))
          ? []
          : ['care'],
    ),
  )
  const pointerGestureRef = useRef<{
    recommendationId: string
    startX: number
    startY: number
    dragged: boolean
  } | null>(null)
  const navigateToResource = useCallback((target: ResourceNavTarget) => {
    const store = useResourceNavigationStore.getState()
    store.navigate(target)
    const requestSequence = useResourceNavigationStore.getState().seq
    window.setTimeout(() => {
      const latest = useResourceNavigationStore.getState()
      if (!latest.pending || latest.seq !== requestSequence) return
      latest.consume()
      toast.warning(
        isEnglish
          ? 'The data section opened, but the exact record could not be located.'
          : '已切換至左側資料，但目前無法定位到確切紀錄。',
        { duration: 5000 },
      )
    }, NAV_CLAIM_TIMEOUT_MS)
  }, [isEnglish])
  const restoredModules = restoreCompletedModules(result)
  const displayRecommendations = [...restoredModules.recommendations].sort((a, b) => (
    (a.moduleOrder ?? Number.MAX_SAFE_INTEGER)
    - (b.moduleOrder ?? Number.MAX_SAFE_INTEGER)
  ))
  const standaloneAutomatedChecks = restoredModules.standaloneChecks
  const hasCompleteModuleGrouping = displayRecommendations.length > 0
    && displayRecommendations.every((item) => item.moduleGroup !== undefined)
  const moduleNameOf = (recommendation: CdssRecommendation): string => (
    recommendation.moduleName ?? clinicalModuleLabel(
      recommendation.id,
      locale,
      recommendation.title,
      recommendation.domain,
    )
  )
  const priorityRank: Readonly<Record<CdssRecommendation['priority'], number>> = {
    high: 0,
    medium: 1,
    routine: 2,
  }
  const heartFailureRows: ModuleDisplayRow[] = board
    ? HEART_FAILURE_LIST_STATUS_ORDER.flatMap((status): ModuleDisplayRow[] => {
      const items = displayRecommendations
        .filter((item) => !board.consumedIds.has(item.id) && item.status === status)
        .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
      if (items.length === 0) return []
      const isCollapsed = collapsedModuleGroups.has(status)
      return [
        {
          kind: 'group',
          group: (layout === 'c' ? HEART_FAILURE_C_GROUPS : HEART_FAILURE_STATUS_GROUPS)[status],
          count: items.length,
          isCollapsed,
          summary: isCollapsed ? items.map(moduleNameOf).join(' · ') : undefined,
        },
        ...(isCollapsed
          ? []
          : items.map((recommendation): ModuleDisplayRow => ({
            kind: 'recommendation',
            recommendation,
          }))),
      ]
    })
    : []
  const moduleDisplayRows: ModuleDisplayRow[] = board
    ? heartFailureRows
    : hasCompleteModuleGrouping
    ? MODULE_GROUPS.flatMap((group): ModuleDisplayRow[] => {
      const groupRecommendations = displayRecommendations.filter(
        (item) => item.moduleGroup === group.id,
      )
      if (groupRecommendations.length === 0) return []
      const isCollapsed = collapsedModuleGroups.has(group.id)
      return [
        {
          kind: 'group',
          group,
          count: groupRecommendations.length,
          isCollapsed,
        },
        ...(isCollapsed
          ? []
          : groupRecommendations.map((recommendation): ModuleDisplayRow => ({
            kind: 'recommendation',
            recommendation,
          }))),
      ]
    })
    : displayRecommendations.map((recommendation): ModuleDisplayRow => ({
      kind: 'recommendation',
      recommendation,
    }))
  const expandedId = requestedExpandedId === null
    ? null
    : displayRecommendations.some((item) => item.id === requestedExpandedId)
      ? requestedExpandedId
      // The visit flow manages its own rows: an id that is no longer in the
      // result means the row is gone, and opening the first row instead would
      // be the screen answering a question nobody asked.
      : isVisitFlow
        ? null
        : (displayRecommendations[0]?.id ?? null)
  const clinicalSummary = buildClinicalDecisionSummary(result, locale)
  const copyProvenance: RationaleCopyProvenance | undefined = result.packId && result.packVersion
    ? { packId: result.packId, packVersion: result.packVersion }
    : undefined
  // The board answers what the clinical summary consolidates — what to do and
  // what is missing — so the two never show together.
  const showClinicalSummary = !board && !isSections && !isNhiTable && !afBoard && !isMap && (
    clinicalSummary.missingInputs.length > 0
    || clinicalSummary.actionRecommendations.length > 0
  )

  // Every card a decision point reads: this pack's (completed checks restored,
  // as the sections show them) and its companions' — on the heart-failure
  // page, the atrial-fibrillation cards behind DP-14 and DP-28.
  if (isMap && visitModel) {
    const companionModules = (companionResults ?? []).flatMap((companion) => restoreCompletedModules(companion).recommendations)
    const visitModules = new Map<string, CdssRecommendation>([
      ...companionModules.map((item): [string, CdssRecommendation] => [item.id, item]),
      ...displayRecommendations.map((item): [string, CdssRecommendation] => [item.id, item]),
    ])
    return (
      <div className="space-y-3" data-testid="clinical-decision-support-view">
        <VisitDecisionScreen
          key={`${patientId ?? 'no-patient'}:${result.packId}`}
          model={visitModel}
          isEnglish={isEnglish}
          now={now}
          packVersion={result.packVersion}
          screenKey={`${patientId ?? 'no-patient'}:${result.packId}`}
          decisions={physicianDecisions}
          onRecordDecision={onRecordDecision}
          onClearDecision={onClearDecision}
          answers={visitAnswers ?? {}}
          {...(visitAnswerSources ? { answerSources: visitAnswerSources } : {})}
          onAnswer={onVisitAnswer}
          {...(coronaryPhaseAnswer ? { coronaryPhase: coronaryPhaseAnswer } : {})}
          onPhysicianInput={onAnswerPhenotype || onAfAnswer || onCoronaryPhase ? (input) => {
            // CAD DP-01 answers the coronary phase; AF DP-01 the AF diagnosis
            // and its type; the rest are the heart-failure phenotype gate's.
            const coronary = coronaryPhaseForInput(input, new Date())
            if (coronary) {
              onCoronaryPhase?.(coronary)
              return
            }
            const af = afAnswersForInput(input)
            if (af) {
              for (const answer of af) onAfAnswer?.(answer.id, answer.value)
              return
            }
            const next = onAnswerPhenotype ? phenotypeAnswerForInput(input, phenotypeAnswer, new Date()) : undefined
            if (next) onAnswerPhenotype?.(next)
          } : undefined}
          // A point's own questions go back to the answer set the pack names:
          // AF DP-08's valves are AF answers, HF DP-06's triggers today's
          // visit answers, its signs the clinic examination (each term of the
          // row, so the congestion table and the HFpEF criteria read them too).
          onPointAnswer={(answers: string, id: string, value: boolean | undefined, terms?: readonly string[]) => {
            if (answers === 'af-clinical') onAfAnswer?.(id, value)
            else if (answers === 'visit') onVisitAnswer?.(id as VisitAsk['id'], value === undefined ? null : value ? 'yes' : 'no')
            else if (answers === 'clinic-exam' && terms?.length) {
              onSaveClinicVitals?.({ signAnswers: Object.fromEntries(terms.map((term) => [term, value === undefined ? null : value ? 'present' : 'absent'])) })
            }
          }}
          // Today's NYHA class, graded beside DP-03's asks, is the clinic
          // examination's (`nyhaClass`, the physicianNyhaClass fact the pack reads).
          onGrade={(id: string, value: string | null) => {
            if (id === 'nyha' && (value === null || value === 'I' || value === 'II' || value === 'III' || value === 'IV')) {
              onSaveClinicVitals?.({ nyhaClass: value })
            }
          }}
          modules={visitModules}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="clinical-decision-support-view">
      {showClinicalSummary ? (
        <details
        className="group overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.035]"
        aria-labelledby="cdss-clinical-summary-title"
        data-testid="cdss-clinical-summary"
      >
        <summary
          className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          data-testid="cdss-clinical-summary-trigger"
        >
          <ClipboardList className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h3
            id="cdss-clinical-summary-title"
            className="text-sm font-semibold text-foreground"
          >
            {isEnglish ? 'Clinical summary' : '臨床摘要'}
          </h3>
          {/* The stage the guidance was written against, on the row a reader
              sees before opening anything. Supplied by the pack; absent when the
              record cannot establish it. */}
          {result.patientContext ? (
            <span
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
              data-testid="cdss-patient-context"
            >
              {result.patientContext}
            </span>
          ) : null}
          <ChevronDown
            className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="border-t border-primary/15 px-3 pb-3 pt-2">

          {/* Two columns as soon as they fit, three when the gaps have room to
              split. The old single 42rem step sat almost exactly where this
              panel usually sits, so the card kept collapsing to one column at
              the width it was designed for. */}
          <div className="grid gap-3 @min-[32rem]:grid-cols-[minmax(0,1.3fr)_minmax(11rem,1fr)] @min-[60rem]:grid-cols-[minmax(0,1.2fr)_minmax(11rem,0.9fr)_minmax(11rem,0.9fr)]">
            <div className={cn(clinicalSummary.actionRecommendations.length === 0 && 'hidden')}>
            <h4 className="text-xs font-semibold text-foreground">
              {isEnglish ? 'Recommended actions' : '建議處理'}
            </h4>
            {clinicalSummary.actionRecommendations.length > 0 ? (
              <ul className="mt-1.5 space-y-2">
                {clinicalSummary.actionRecommendations.map((recommendation) => {
                  const moduleName = recommendation.moduleName ?? clinicalModuleLabel(
                    recommendation.id,
                    locale,
                    recommendation.title,
                    recommendation.domain,
                  )
                  return (
                    <li key={recommendation.id} className="text-xs">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold leading-relaxed text-foreground">
                          {moduleName}
                        </span>
                        <Badge className={cn('h-5 px-1.5 text-[11px]', statusStyle[recommendation.status])}>
                          <StatusIcon status={recommendation.status} />
                          {label[recommendation.status]}
                        </Badge>
                      </span>
                      {recommendation.title !== moduleName ? (
                        <span className="mt-0.5 block leading-relaxed text-foreground">
                          {recommendation.title}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                        {recommendation.nextActions[0]}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            </div>

            <div className={cn(
              '@min-[32rem]:border-l @min-[32rem]:border-border @min-[32rem]:pl-3',
              '@min-[60rem]:col-span-2',
              clinicalSummary.missingInputs.length === 0 && 'hidden',
            )}>
            <h4 className="text-xs font-semibold text-foreground">
              {isEnglish ? 'Data to complete' : '需補資料'}
            </h4>
            <div className="@min-[60rem]:grid @min-[60rem]:grid-cols-2 @min-[60rem]:gap-x-4 @min-[60rem]:items-start">
            {MISSING_INPUT_GROUPS.map((group) => {
              const items = clinicalSummary.missingInputs.filter(
                (item) => item.group === group.id,
              )
              if (items.length === 0) return null
              return (
                <div key={group.id} className="mt-1.5">
                  <p
                    className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    data-testid={`cdss-missing-group-${group.id}`}
                  >
                    {isEnglish ? group.en : group.zh}
                  </p>
                  <ul className="mt-1 space-y-2 text-xs">
                    {items.map((item) => (
                      <li key={item.label} className="flex gap-1.5">
                        <span className="text-amber-700 dark:text-amber-300" aria-hidden="true">•</span>
                        <span className="min-w-0">
                          <span className="font-medium leading-relaxed text-foreground">
                            {item.label}
                          </span>
                          {item.relatedRecommendationCount > 1 ? (
                            <PreviewTextTooltip
                              text={item.relatedModuleNames.join(isEnglish ? ', ' : '、')}
                              className="mt-0.5 block leading-relaxed text-muted-foreground underline decoration-dotted underline-offset-2"
                              triggerTestId={`cdss-missing-affects-${item.group}-${item.relatedRecommendationCount}`}
                            >
                              {isEnglish
                                ? `Affects ${item.relatedRecommendationCount} decision modules`
                                : `同時影響 ${item.relatedRecommendationCount} 個決策模組`}
                            </PreviewTextTooltip>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            </div>
          </div>
          </div>
        </div>
        </details>
      ) : null}

      {afBoard ? <AtrialFibrillationVisitFlow key={patientId}
        board={afBoard} result={result} isEnglish={isEnglish} now={now}
        expandedId={expandedId} onToggle={id => setRequestedExpandedId(expandedId === id ? null : id)}
        answers={afAnswers} onAnswer={onAfAnswer} clinicVitals={clinicVitals}
        onSaveClinicVitals={onSaveClinicVitals} onClearClinicVitals={onClearClinicVitals}
        decisions={physicianDecisions} onRecordDecision={onRecordDecision} onClearDecision={onClearDecision}
        renderDetail={recommendation => <RecommendationDetail recommendation={recommendation} isEnglish={isEnglish}
          onNavigate={navigateToResource} label={label} patientId={patientId} copyProvenance={copyProvenance} />}
      /> : null}
      {isVisitFlow && visitFlow && board ? (
        <HeartFailureVisitFlow
          followUpHistory={followUpHistory}
          key={patientId ?? 'no-patient'}
          sectionRecommendations={isSections ? displayRecommendations : undefined}
          prognosisContent={isSections ? <HfPrognosisModels key={patientId ?? 'no-patient'} locale={locale} evidence={hfPrognosisEvidence(profileFacts, isEnglish)} /> : undefined}
          visitAnswers={visitAnswers}
          onVisitAnswer={onVisitAnswer}
          rhythmPanel={<HeartRhythmPanel isEnglish={isEnglish} reading={hfpefReading?.inputs.find(input => input.key === 'rhythm')} onSave={onSaveHfpefInputs} />}
          flow={visitFlow}
          board={board}
          isEnglish={isEnglish}
          now={now}
          expandedId={expandedId}
          onToggle={(id) => setRequestedExpandedId(expandedId === id ? null : id)}
          clinicVitals={clinicVitals}
          onSaveClinicVitals={onSaveClinicVitals}
          onClearClinicVitals={onClearClinicVitals}
          phenotypeAnswer={phenotypeAnswer}
          onAnswerPhenotype={onAnswerPhenotype}
          onRecordDecision={onRecordDecision}
          onClearDecision={onClearDecision}
          hfpefReading={hfpefReading}
          onSaveHfpefInputs={onSaveHfpefInputs}
          packVersion={result.packVersion}
          renderDetail={(recommendation) => (
            <RecommendationDetail
              recommendation={recommendation}
              englishRecommendation={englishRecommendations.get(recommendation.id)}
              isEnglish={isEnglish}
              onNavigate={navigateToResource}
              label={label}
              patientId={patientId}
              copyProvenance={copyProvenance}
              phenotypeAnswer={phenotypeAnswer}
              onAnswerPhenotype={isSections ? undefined : onAnswerPhenotype}
              clinicVitals={clinicVitals}
              onSaveClinicVitals={onSaveClinicVitals}
              physicianRowsReadOnly
              hideEvidenceTables={!isSections && recommendation.id === 'heart-failure-congestion-diuretic'}
              onEditPhysicianRow={(question) => focusVisitFlowTarget({
                kind: 'question',
                questionId: question,
              })}
            />
          )}
        />
      ) : null}

      {isNhiTable ? (
        <div
          className="rounded-lg border border-border bg-card py-3"
          data-testid="nhi-table1-layout"
        >
          {nhiSummary ? (
            <NhiTable1Panel
              key={`${patientId ?? 'no-patient'}:${nhiPageResetKey}`}
              summary={nhiSummary}
              locale={locale}
              patientId={patientId}
              onAnswer={patientId
                ? (id, state, provenance) => useNhiLipidReviewStore.getState().answer(patientId, id, state, provenance)
                : undefined}
              aiAssist={nhiLipidAiAssist}
              answerProvenance={nhiLipidAnswerProvenance}
              recordSources={nhiRecordSources}
              onNavigate={navigateToResource}
            />
          ) : (
            <p className="px-3 text-sm text-muted-foreground" data-cdss-action="">
              {isEnglish
                ? 'NHI Table 1 assessment is not available for this record.'
                : '本次資料沒有可顯示的健保表一判讀。'}
            </p>
          )}
        </div>
      ) : null}

      {isSections && !isVisitFlow ? <ModuleSections
        key={`${patientId ?? 'no-patient'}-${result.packId}`}
        locale={locale}
        patientId={patientId}
        recommendations={displayRecommendations}
        isEnglish={isEnglish}
        sectionContent={result.packId === 'hyperlipidemia-cdss' ? {
          diagnosis: displayRecommendations.filter(item => item.id === 'dyslipidemia-risk-and-target').map(item => <NhiLipidCoverageSummary key={item.id} recommendation={item} locale={locale} patientId={patientId} presentation="diagnosis" />),
          prognosis: displayRecommendations.filter(item => item.id === 'dyslipidemia-risk-and-target').map(item => <div key={item.id}>
            <NhiLipidCoverageSummary recommendation={item} locale={locale} patientId={patientId} presentation="prognosis" />
            <div className="px-3 pb-4"><PreventRiskSummary recommendation={item} locale={locale} patientId={patientId} /></div>
          </div>),
        } : undefined}
        sectionSummary={result.packId === 'hyperlipidemia-cdss' ? { diagnosis: isEnglish ? 'Verify diagnoses and risk factors' : '逐項確認相關診斷與危險因子', prognosis: isEnglish ? 'Classification basis · PREVENT assessment' : '危險分層依據・PREVENT 評估' } : undefined}
        renderDetail={recommendation => <>
          <NhiLipidCoverageSummary recommendation={recommendation} locale={locale} patientId={patientId} presentation="treatment" />
          {result.packId !== 'hyperlipidemia-cdss' ? <PreventRiskSummary recommendation={recommendation} locale={locale} patientId={patientId} /> : null}
          <RecommendationDetail
          recommendation={recommendation} englishRecommendation={englishRecommendations.get(recommendation.id)}
          isEnglish={isEnglish} onNavigate={navigateToResource} label={label}
          patientId={patientId} copyProvenance={copyProvenance}
        /></>}
      /> : null}
      {isSections && standaloneAutomatedChecks.length > 0 ? <details className="rounded-lg border border-border bg-card">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm">{isEnglish ? 'Additional completed checks' : '其他已完成檢查'}</summary>
        <ul className="space-y-2 px-3 pb-3 text-sm">{standaloneAutomatedChecks.map(check => <li key={check.id}>
          <p className="font-medium">{check.label}</p>
          <p className="text-xs text-muted-foreground">{check.value}</p>
          {check.sources?.length ? <EvidenceSources sources={check.sources} isEnglish={isEnglish} evidenceLabel={check.label} evidenceValue={check.value} onNavigate={navigateToResource} compact /> : null}
        </li>)}</ul>
      </details> : null}

      {board && !isVisitFlow && !isSections ? (
        <HeartFailureStatusBoard
          board={board}
          isEnglish={isEnglish}
          now={now}
          expandedId={expandedId}
          onToggle={(id) => setRequestedExpandedId(expandedId === id ? null : id)}
          variant={layout === 'c' ? 'summary' : 'board'}
          clinicVitals={clinicVitals}
          onSaveClinicVitals={onSaveClinicVitals}
          onClearClinicVitals={onClearClinicVitals}
          phenotypeAnswer={phenotypeAnswer}
          onAnswerPhenotype={onAnswerPhenotype}
          renderDetail={(recommendation) => (
            <RecommendationDetail
              recommendation={recommendation}
              englishRecommendation={englishRecommendations.get(recommendation.id)}
              isEnglish={isEnglish}
              onNavigate={navigateToResource}
              label={label}
              patientId={patientId}
              copyProvenance={copyProvenance}
              phenotypeAnswer={phenotypeAnswer}
              onAnswerPhenotype={onAnswerPhenotype}
              clinicVitals={clinicVitals}
              onSaveClinicVitals={onSaveClinicVitals}
            />
          )}
        />
      ) : null}

      {/*
        The visit flow draws its own list, grouped by what the clinician has to
        do and carrying a decision on every row; a second copy of the same rows
        underneath is the duplication it removed.
      */}
      {isVisitFlow || isSections || isNhiTable || afBoard ? null : (
      <section
        className="overflow-hidden rounded-lg border border-border"
        aria-label={isEnglish ? 'Patient decision overview' : '個案決策總覽'}
      >
        {board ? (
          // Action first: the heart-failure list reads 處置 → 依據, the way the
          // board's headlines do, so a reader who came from a sentence above
          // lands on the same words.
          <div
            className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_2.75rem] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground @min-[40rem]:grid"
            aria-hidden="true"
          >
            <span>{isEnglish ? 'Action' : '處置'}</span>
            <span>{isEnglish ? 'Basis' : '依據'}</span>
            <span />
          </div>
        ) : (
        <div
          className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.9fr)_2.75rem] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground @min-[40rem]:grid"
          aria-hidden="true"
        >
          <span>{label.decision}</span>
          <span>{label.statusAndEvidence}</span>
          <span>{label.nextStep}</span>
          <span />
        </div>
        )}

        {moduleDisplayRows.map((row) => {
          if (row.kind === 'group') {
            const groupLabel = isEnglish ? row.group.en : row.group.zh
            return (
              <button
                key={`module-group-${row.group.id}`}
                type="button"
                className="flex h-6 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-expanded={!row.isCollapsed}
                data-testid={`cdss-module-group-trigger-${row.group.id}`}
                onClick={() => {
                  setCollapsedModuleGroups((current) => {
                    const next = new Set(current)
                    if (next.has(row.group.id)) next.delete(row.group.id)
                    else next.add(row.group.id)
                    return next
                  })
                }}
              >
                <span
                  className={cn('flex min-w-0 shrink items-center gap-1.5', row.group.toneClass)}
                  data-testid={`cdss-module-group-tone-${row.group.id}`}
                >
                  <span className="text-[11px] font-semibold leading-none">
                    {groupLabel}
                  </span>
                  <span
                    className="text-[10px] leading-none opacity-75"
                    aria-label={isEnglish
                      ? `${row.count} modules`
                      : `${row.count} 個模組`}
                  >
                    · {row.count}
                  </span>
                  {row.summary ? (
                    <span
                      className="min-w-0 truncate text-[11px] font-normal leading-none text-muted-foreground"
                      title={row.summary}
                      data-testid={`cdss-module-group-summary-${row.group.id}`}
                    >
                      {row.summary}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 opacity-75 transition-transform',
                      !row.isCollapsed && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </span>
                <span
                  className={cn('h-px min-w-4 flex-1', row.group.dividerClass)}
                  aria-hidden="true"
                  data-testid={`cdss-module-group-divider-${row.group.id}`}
                />
              </button>
            )
          }

          const recommendation = row.recommendation
          const isExpanded = expandedId === recommendation.id
          // Direction C numbers every listed row, continuing after the headline
          // sentences, so a 依據 entry can be read against its 處置 by number.
          const rowNumber = layout === 'c' && board
            ? board.headlines.length + heartFailureRows
              .filter((item): item is Extract<ModuleDisplayRow, { kind: 'recommendation' }> => item.kind === 'recommendation')
              .findIndex((item) => item.recommendation.id === recommendation.id) + 1
            : undefined
          const isRiskStratification = recommendation.kind === 'risk-stratification'
          const moduleName = recommendation.moduleName ?? clinicalModuleLabel(
            recommendation.id,
            locale,
            recommendation.title,
            recommendation.domain,
          )
          const triggerId = `cdss-trigger-${recommendation.id}`
          const detailId = `cdss-detail-${recommendation.id}`
          const overviewEvidence = overviewEvidenceItems(recommendation)
          const overviewMissing = recommendation.hideMissingDataPreview
            ? undefined
            : recommendation.missingData?.[0]
          const overviewMissingForPreview = overviewMissing
            && !isMissingPreviewRedundant(recommendation.title, overviewMissing)
            ? overviewMissing
            : undefined
          // The pack owns the heading. It no longer repeats a measurement the
          // key-evidence column already shows, so the host does not rewrite it.
          const conciseAssessment = recommendation.title
          const assessmentPreview = conciseAssessment !== moduleName
            && !isAssessmentPreviewRedundant(
              conciseAssessment,
              overviewEvidence.map((evidence) => evidence.value).join(' '),
            )
            ? conciseAssessment
            : undefined
          const hasCoverageSummary = 'coverageSummary' in recommendation && Boolean(recommendation.coverageSummary)
          const nextStepPreviewText = recommendation.nextActions[0]

          return (
            <article
              key={recommendation.id}
              className={cn(
                'border-b border-border last:border-b-0',
                recommendation.status === 'no-action'
                  && 'bg-emerald-50/50 dark:bg-emerald-500/[0.07]',
              )}
              data-testid={`cdss-recommendation-${recommendation.id}`}
            >
              <div
                id={triggerId}
                role="button"
                tabIndex={0}
                className={cn(
                  'grid min-h-11 w-full select-text gap-2 px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  recommendation.status === 'no-action'
                    ? 'hover:bg-emerald-100/50 dark:hover:bg-emerald-500/10'
                    : 'hover:bg-muted/30',
                  hasCoverageSummary ? 'grid-cols-[minmax(0,1fr)_auto] items-center' : board
                    ? '@min-[40rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_2.75rem] @min-[40rem]:items-start @min-[40rem]:gap-3'
                    : '@min-[40rem]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.9fr)_2.75rem] @min-[40rem]:items-start @min-[40rem]:gap-3',
                  isExpanded && 'bg-muted/25',
                )}
                aria-expanded={isExpanded}
                aria-controls={detailId}
                data-layout={board ? 'action-first' : 'module-first'}
                data-testid={`cdss-recommendation-trigger-${recommendation.id}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  pointerGestureRef.current = {
                    recommendationId: recommendation.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    dragged: false,
                  }
                }}
                onPointerMove={(event) => {
                  const gesture = pointerGestureRef.current
                  if (!gesture || gesture.recommendationId !== recommendation.id || gesture.dragged) return
                  if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 4) {
                    gesture.dragged = true
                  }
                }}
                onPointerCancel={() => {
                  pointerGestureRef.current = null
                }}
                onClick={() => {
                  const gesture = pointerGestureRef.current
                  pointerGestureRef.current = null
                  if (gesture?.recommendationId === recommendation.id && gesture.dragged) return
                  const selection = window.getSelection()
                  if (selection && !selection.isCollapsed) return
                  setRequestedExpandedId(isExpanded ? null : recommendation.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setRequestedExpandedId(isExpanded ? null : recommendation.id)
                }}
              >
                {hasCoverageSummary ? (
                  <span className="font-semibold text-foreground" data-testid={`cdss-module-cell-${recommendation.id}`}>{moduleName}</span>
                ) : board ? (
                  <>
                    <span
                      className="min-w-0 cursor-text"
                      data-testid={`cdss-module-cell-${recommendation.id}`}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        {!isRiskStratification ? (
                          <Badge className={cn('h-5 shrink-0 px-1.5 text-[11px]', statusStyle[recommendation.status])}>
                            <StatusIcon status={recommendation.status} />
                            {label[recommendation.status]}
                          </Badge>
                        ) : null}
                        {rowNumber !== undefined ? (
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary"
                            data-testid={`cdss-row-number-${recommendation.id}`}
                          >
                            {rowNumber}
                          </span>
                        ) : null}
                        <span
                          className="min-w-0 text-sm font-semibold leading-snug text-foreground"
                          data-testid={`cdss-action-headline-${recommendation.id}`}
                        >
                          {nextStepPreviewText ?? moduleName}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{moduleName}</span>
                        {assessmentPreview ? ` · ${assessmentPreview}` : ''}
                      </span>
                    </span>
                    <span
                      className="min-w-0 cursor-text"
                      data-testid={`cdss-evidence-preview-${recommendation.id}`}
                    >
                      {overviewEvidence.map((evidence, index) => (
                        <span
                          key={`${evidence.factKeys[0] ?? index}-${evidence.label}`}
                          className="block min-w-0 truncate text-xs leading-relaxed text-muted-foreground"
                          title={`${evidence.label}：${evidence.value}`}
                        >
                          <strong className="font-medium text-foreground">{evidence.label}：</strong>
                          {compactOverviewEvidenceValue(evidence)}
                        </span>
                      ))}
                      {overviewMissingForPreview ? (
                        <span className="block min-w-0 truncate text-xs leading-relaxed text-muted-foreground" title={overviewMissingForPreview}>
                          <strong className="font-medium text-foreground">{label.missingShort}：</strong>
                          {overviewMissingForPreview}
                        </span>
                      ) : null}
                      {recommendation.guidelineReferences[0] ? (
                        <span
                          className="mt-1 inline-flex max-w-full items-center rounded-md border border-border bg-background px-1.5 text-[11px] font-medium leading-5 text-foreground"
                          data-testid={`cdss-guideline-chip-${recommendation.id}`}
                        >
                          <span className="truncate">
                            {recommendation.guidelineReferences[0].title}
                            {recommendation.guidelineReferences[0].evidenceGrade
                              ? ` · ${recommendation.guidelineReferences[0].evidenceGrade}`
                              : ''}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : (
                <>
                <span
                  className="min-w-0 cursor-text"
                  data-testid={`cdss-module-cell-${recommendation.id}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PreviewTextTooltip
                      text={moduleName}
                      className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-foreground"
                      triggerTestId={`cdss-module-tooltip-trigger-${recommendation.id}`}
                    >
                      {moduleName}
                    </PreviewTextTooltip>
                    {isRiskStratification ? (
                      <Badge className="h-5 shrink-0 bg-violet-100 px-1.5 text-[11px] text-violet-900 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-200">
                        <Gauge className="mr-1 h-3.5 w-3.5" />
                        {isEnglish ? 'Risk stratification' : '風險分層'}
                      </Badge>
                    ) : null}
                  </span>
                  {assessmentPreview ? (
                    <PreviewTextTooltip
                      text={assessmentPreview}
                      className="mt-1 block min-w-0 max-w-full truncate whitespace-nowrap text-xs leading-relaxed text-muted-foreground"
                      triggerTestId={`cdss-assessment-tooltip-trigger-${recommendation.id}`}
                    >
                      {assessmentPreview}
                    </PreviewTextTooltip>
                  ) : null}
                </span>

                <span
                  className="min-w-0 cursor-text"
                  data-testid={`cdss-evidence-preview-${recommendation.id}`}
                >
                  {overviewEvidence.map((evidence, index) => {
                    const factKey = evidence.factKeys[0] ?? String(index)
                    return (
                      <PreviewTextTooltip
                        key={`${factKey}-${evidence.label}-${evidence.value}`}
                        text={`${evidence.label}：${evidence.value}`}
                        className={cn(
                          'block min-w-0 max-w-full text-xs leading-relaxed text-muted-foreground',
                          overviewMissingForPreview || overviewEvidence.length > 1
                            ? 'truncate whitespace-nowrap'
                            : 'line-clamp-2 break-words',
                          index > 0 && 'mt-0.5',
                        )}
                        triggerTestId={index === 0
                          ? `cdss-evidence-tooltip-trigger-${recommendation.id}`
                          : `cdss-evidence-tooltip-trigger-${recommendation.id}-${factKey}`}
                      >
                        <strong className="font-medium text-foreground">{evidence.label}：</strong>
                        {compactOverviewEvidenceValue(evidence)}
                      </PreviewTextTooltip>
                    )
                  })}
                  {overviewMissingForPreview ? (
                    <PreviewTextTooltip
                      text={`${label.missingShort}：${overviewMissingForPreview}`}
                      className="mt-0.5 block min-w-0 max-w-full truncate whitespace-nowrap text-xs leading-relaxed text-muted-foreground"
                      triggerTestId={`cdss-missing-tooltip-trigger-${recommendation.id}`}
                    >
                      <strong className="font-medium text-foreground">{label.missingShort}：</strong>
                      {overviewMissingForPreview}
                    </PreviewTextTooltip>
                  ) : null}
                </span>

                <span
                  className="min-w-0 cursor-text"
                  data-testid={`cdss-next-step-preview-${recommendation.id}`}
                >
                  {nextStepPreviewText ? (
                    <PreviewTextTooltip
                      text={nextStepPreviewText}
                      className="block line-clamp-2 break-words text-xs leading-relaxed text-foreground"
                      triggerTestId={`cdss-next-step-tooltip-trigger-${recommendation.id}`}
                      contentTestId={`cdss-next-step-tooltip-${recommendation.id}`}
                    >
                      {!isRiskStratification ? (
                        <Badge
                          className={cn(
                            'mr-1 inline-flex h-5 px-1.5 align-middle text-[11px]',
                            statusStyle[recommendation.status],
                          )}
                        >
                          <StatusIcon status={recommendation.status} />
                          {label[recommendation.status]}
                        </Badge>
                      ) : null}
                      {nextStepPreviewText}
                    </PreviewTextTooltip>
                  ) : (
                    <span className="line-clamp-2 break-words text-xs leading-relaxed text-foreground">
                      {!isRiskStratification ? (
                        <Badge
                          className={cn(
                            'mr-1 inline-flex h-5 px-1.5 align-middle text-[11px]',
                            statusStyle[recommendation.status],
                          )}
                        >
                          <StatusIcon status={recommendation.status} />
                          {label[recommendation.status]}
                        </Badge>
                      ) : null}
                    </span>
                  )}
                </span>

                </>
                )}

                <span
                  className="flex min-h-8 select-none items-center justify-end gap-1 rounded-md px-1 text-xs font-medium text-primary @min-[40rem]:justify-center"
                  aria-hidden="true"
                >
                  <span className="@min-[40rem]:sr-only">
                    {isExpanded ? label.hideDetails : label.showDetails}
                  </span>
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                    aria-hidden="true"
                  />
                </span>
              </div>

              <NhiLipidCoverageSummary recommendation={recommendation} locale={locale} patientId={patientId} />
              <PreventRiskSummary recommendation={recommendation} locale={locale} patientId={patientId} />
              {isExpanded ? (
                <div
                  id={detailId}
                  role="region"
                  aria-labelledby={triggerId}
                  className="border-t border-border bg-background"
                  data-testid={`cdss-recommendation-detail-${recommendation.id}`}
                >
                  <RecommendationDetail
                    recommendation={recommendation}
              englishRecommendation={englishRecommendations.get(recommendation.id)}
                    isEnglish={isEnglish}
                    onNavigate={navigateToResource}
                    label={label}
                    patientId={patientId}
                    copyProvenance={copyProvenance}
                    phenotypeAnswer={phenotypeAnswer}
                    onAnswerPhenotype={onAnswerPhenotype}
                    clinicVitals={clinicVitals}
                    onSaveClinicVitals={onSaveClinicVitals}
                  />
                </div>
              ) : null}
            </article>
          )
        })}

        {standaloneAutomatedChecks.map((check) => {
          const moduleName = clinicalModuleLabel(check.id, locale, check.label)
          return (
            <article
              key={check.id}
              className="border-b border-border bg-emerald-50/50 last:border-b-0 dark:bg-emerald-500/[0.07]"
              data-testid={`cdss-automated-check-row-${check.id}`}
            >
              <div className="grid min-h-11 gap-2 px-3 py-2.5 text-left @min-[40rem]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.9fr)_2.75rem] @min-[40rem]:items-start @min-[40rem]:gap-3">
                <span className="min-w-0">
                  <PreviewTextTooltip
                    text={moduleName}
                    className="block min-w-0 truncate text-sm font-semibold leading-snug text-foreground"
                    triggerTestId={`cdss-check-module-tooltip-trigger-${check.id}`}
                  >
                    {moduleName}
                  </PreviewTextTooltip>
                  {check.label !== moduleName ? (
                    <PreviewTextTooltip
                      text={check.label}
                      className="mt-1 block min-w-0 max-w-full truncate whitespace-nowrap text-xs leading-relaxed text-muted-foreground"
                      triggerTestId={`cdss-check-label-tooltip-trigger-${check.id}`}
                    >
                      {check.label}
                    </PreviewTextTooltip>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <PreviewTextTooltip
                    text={check.value}
                    className="block line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground"
                    triggerTestId={`cdss-check-value-tooltip-trigger-${check.id}`}
                  >
                    {check.value}
                  </PreviewTextTooltip>
                  {check.sources && check.sources.length > 0 ? (
                    <EvidenceSources
                      sources={check.sources}
                      isEnglish={isEnglish}
                      evidenceLabel={check.label}
                      evidenceValue={check.value}
                      onNavigate={navigateToResource}
                      compact
                    />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <Badge className={cn('h-5 shrink-0 px-1.5 text-[11px]', statusStyle['no-action'])}>
                    <StatusIcon status="no-action" />
                    {label['no-action']}
                  </Badge>
                </span>
                <span aria-hidden="true" />
              </div>
            </article>
          )
        })}
      </section>
      )}

      <details
        className="group border-t border-border pt-1"
        data-testid="cdss-limitations"
      >
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CircleHelp className="h-3.5 w-3.5 shrink-0" />
          {label.limitations}
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 pb-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          {result.notEvaluated.length > 0 ? (
            <section>
              <h4 className="font-semibold text-foreground">{label.notEvaluated}</h4>
              <ul className="mt-1 grid gap-1 @min-[32rem]:grid-cols-3">
                {result.notEvaluated.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span aria-hidden="true">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p>{result.disclaimer}</p>
        </div>
      </details>
    </div>
  )
}
