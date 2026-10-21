/**
 * The heart-failure visit, as a model: where the clinician is, what is left to
 * judge, and what is left to decide.
 *
 * The board this reads from answers 「這位病人的狀態是什麼」. It did not answer
 * 「我現在在哪一步」, and the screen said 「今天要做的事」 three times in three
 * different places while the congestion question was asked in three more. This
 * model turns the same pack output into one pass through a visit: confirm the
 * diagnosis, answer what only a person can answer, decide each recommendation,
 * record it.
 *
 * Nothing here is a clinical rule. Every headline, module name, option label
 * and evidence value is the pack's; this file decides order, grouping and what
 * counts as done. The question labels the pack does not supply (the symptoms,
 * the NYHA grade, the signs, the clinic measurements, the compensation
 * judgement) are the host's, and are the questions the previous screen already
 * asked in its own words.
 *
 * Pure and React-free on purpose: the ordering rules — which next step wins,
 * when a step is done, what a locked question says — are the part worth
 * testing, and a test should not have to mount a tree to ask.
 */
import { clinicalModuleLabel } from '@voho0000/personalized-care'
import type { PhysicianInputRequest } from '../physician-input-contract'
import { physicianInputRequestsOf } from '../physician-input-contract'
import { diagnosisContextOf } from './cdss-sections'
import type {
  CdssClinicalHandoff,
  CdssRecommendation,
  CdssResult,
  CdssStatus,
} from '../types'
import {
  NOT_ASSESSED,
  type ClinicVitals,
  type ClinicVitalsEntryKey,
  type SignAnswerValue,
} from '../stores/clinic-vitals.store'
import { HFPEF_NOT_CONFIRMED, type PhenotypeAnswer } from '../stores/phenotype-answer.store'
import type { PhysicianDecision, PhysicianDecisionMap } from '../stores/physician-decisions.store'
import type { HeartFailureBoardModel, HeartFailureMetric } from './heart-failure-board'
import {
  applyHeartFailureMedicationSafety,
  heartFailureMedicationSafetyAssessment,
} from './heart-failure-medication-safety'

const PHENOTYPE_MODULE_ID = 'heart-failure-phenotype'
const HFPEF_DIAGNOSIS_MODULE_ID = 'heart-failure-hfpef-diagnosis'
const GDMT_MODULE_ID = 'heart-failure-hfref-gdmt'

/** The four foundational classes, in the order the guideline lists them. */
const PILLAR_MODULE_IDS: readonly string[] = [
  'heart-failure-ras-inhibition',
  'heart-failure-beta-blocker',
  'heart-failure-mra',
  'heart-failure-sglt2',
]

/* ------------------------------------------------------------------ dates */

/**
 * Clinic time, in the calendar the clinic keeps.
 *
 * A visit is dated by the room it happened in, so every stamp on this screen
 * is read in Asia/Taipei whatever the browser is set to — a value saved at
 * 00:30 in Taipei must not read as yesterday because the machine is on UTC.
 */
const CLINIC_TIME_ZONE = 'Asia/Taipei'

function zonedParts(iso: string): { date: string; time: string } | undefined {
  const at = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(at.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}/${value('month')}/${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  }
}

/**
 * A stamp as a clinician reads it: `今日 14:07` for something recorded in this
 * visit, `2026/08/14` for anything carried in from an earlier one.
 */
export function formatStamp(
  iso: string | undefined,
  now: Date,
  isEnglish: boolean,
): string | undefined {
  if (!iso) return undefined
  const stamp = zonedParts(iso)
  const today = zonedParts(now.toISOString())
  if (!stamp || !today) return undefined
  if (stamp.date !== today.date) return stamp.date
  // A date-only value recorded today has no clock to show.
  if (iso.length === 10) return isEnglish ? 'Today' : '今日'
  return isEnglish ? `Today ${stamp.time}` : `今日 ${stamp.time}`
}

/** A plain day, `2026/08/14`, with no 「今日」 shorthand. */
export function formatDay(iso: string | undefined): string | undefined {
  return iso ? zonedParts(iso)?.date : undefined
}

/* ------------------------------------------------------------------ steps */

export type VisitStepId = 'confirm' | 'assess' | 'act' | 'record'
export type VisitStepState = 'done' | 'current' | 'todo' | 'na'

export interface VisitStep {
  id: VisitStepId
  /** 1–4, as shown in the circle. */
  index: number
  label: string
  state: VisitStepState
  /** One line under the label, counted from the pack's own result. */
  detail: string
}

/* -------------------------------------------------------------- questions */

export type VisitQuestionId =
  | 'hf-suspicion'
  | 'lvef-phenotype'
  | 'hfpef-confirmation'
  | 'nyha'
  | 'symptoms'
  | 'signs'
  | 'compensation'

export type VisitQuestionState = 'open' | 'answered' | 'locked'

export interface VisitQuestion {
  id: VisitQuestionId
  /** What the circle shows: `1`, `1b`, `2`… */
  number: string
  /** The pack's own label where the pack asks; the host's for the rest. */
  label: string
  state: VisitQuestionState
  /** One line stating the answer, on an answered question. */
  answerText?: string
  /** When that answer was last changed, as an ISO timestamp. */
  modifiedAt?: string
  /** The one-line note under the question. */
  hint?: string
  /**
   * The per-term rows this question asks, where it asks any. Question ② and
   * question ④ are the same control over two different lists: what the patient
   * reported, and what the clinician found.
   */
  items?: readonly VisitSignItem[]
  /**
   * 「肺鬱血 2 · 體循環 2」 on the folded line: how many terms were answered
   * 「有」 on each side, counted across both questions because congestion is
   * one finding whoever noticed it. Present on question ④ only.
   */
  sideTally?: { pulmonary: number; systemic: number }
  /** Why a locked question is locked, in the words the reader needs. */
  lockedReason?: string
  /**
   * Whether this question is part of 「本次評估」's count. The two the pack
   * raises conditionally — the LVEF gate, the HFpEF confirmation — are not:
   * they belong to step ①, and a count that moved when a card appeared would
   * make 「還有 n 題」 mean something different on every patient.
   */
  counted: boolean
  /** The pack's request, where this question is one the pack raised. */
  request?: PhysicianInputRequest
  /** The recommendation the request came from, for the panel that renders it. */
  recommendationId?: string
}

/* ---------------------------------------------------------------- actions */

export type VisitActionGroupId = 'safety' | 'actionable' | 'needs-data' | 'review' | 'no-action'

/** Which set of decision buttons a row offers. */
export type VisitDecisionKind = 'medication' | 'test' | 'measurement' | 'follow-up' | 'rehabilitation' | 'exercise-safety' | 'review' | 'none'

export interface VisitActionRow {
  /** Continuous across the groups that carry a decision; absent on 目前無需處理. */
  index?: number
  recommendation: CdssRecommendation
  /** The pack's own next step, which is the sentence a clinician acts on. */
  headline: string
  moduleName: string
  status: CdssStatus
  isSafety: boolean
  /** 「valsartan 80 mg」 — what the patient is on, on a foundational row. */
  medications?: string
  /** The overview evidence, and the first missing input where there is one. */
  basis?: string
  decisionKind: VisitDecisionKind
  decision?: PhysicianDecision
  /** Derived from current therapy, never persisted as a physician action. */
  decisionSource?: 'medication-record'
}

export interface VisitActionGroup {
  id: VisitActionGroupId
  label: string
  rows: readonly VisitActionRow[]
  /** 目前無需處理 opens folded, with the module names on the folded line. */
  collapsedByDefault: boolean
  summary?: string
}

/* -------------------------------------------------------------- next step */

export type VisitNextStepTone = 'safety' | 'primary' | 'ok'

export type VisitNextStepTarget =
  | { kind: 'question'; questionId: VisitQuestionId }
  | { kind: 'action'; moduleId: string; index: number }
  | { kind: 'copy' }

export interface VisitNextStep {
  tone: VisitNextStepTone
  message: string
  actionLabel: string
  target: VisitNextStepTarget
  /** A second line, used on the first open to say what the record already holds. */
  hint?: string
}

/* ------------------------------------------------------------ carried-in */

export interface CarriedField {
  label: string
  value: string
  /** Already formatted for reading: `量測 2026/08/25` or `今日 14:02`. */
  date: string
}

export interface HeartFailureVisitFlow {
  steps: readonly VisitStep[]
  nextStep: VisitNextStep
  /** LVEF and the seven safety inputs, in the order the board reads them. */
  metrics: readonly HeartFailureMetric[]
  questions: readonly VisitQuestion[]
  openQuestionCount: number
  answeredQuestionCount: number
  countedQuestionCount: number
  actionGroups: readonly VisitActionGroup[]
  decidedCount: number
  decidableCount: number
  summaryText: string
  englishSummaryText: string
  carriedFields: readonly CarriedField[]
  handoff?: CdssClinicalHandoff
  /** The pack's own follow-up sentence, where a monitoring module wrote one. */
  followUpNote?: string
  /** No patient loaded: every control is withheld and the rows say so. */
  readOnly: boolean
}

export interface HeartFailureVisitFlowInput {
  /** Three-section layout keeps all module decisions reachable. */
  includeAllModules?: boolean
  /**
   * The layout lets the pack's diagnosis mode settle 「is this heart
   * failure?」 (三區塊, 決策地圖): when the phenotype card is in follow-up, the
   * questions about a heart-failure patient open without asking again. Defaults
   * to `includeAllModules`.
   */
  trustsPackFollowUp?: boolean
  board: HeartFailureBoardModel
  result: CdssResult
  isEnglish: boolean
  now: Date
  clinicVitals?: ClinicVitals
  phenotypeAnswer?: PhenotypeAnswer
  decisions: PhysicianDecisionMap
  /** Absent while no patient is loaded. */
  patientId?: string
}

/* ------------------------------------------------------------------ build */

/**
 * Which side of the heart a finding speaks for.
 *
 * A one-character tag, and nothing more: it tells a reader why 腳腫 and 端坐
 * 呼吸 are not the same question, and it never reaches the data model. Every
 * answer travels as its own term whatever the tag says.
 */
export type VisitSignSide = 'pulmonary' | 'systemic' | 'both'

export const VISIT_SIDE_LABELS: Readonly<Record<VisitSignSide, {
  tagZh: string
  tagEn: string
  legendZh: string
  legendEn: string
}>> = {
  pulmonary: {
    tagZh: '肺',
    tagEn: 'P',
    legendZh: '肺 = 左心衰竭／肺鬱血',
    legendEn: 'P = left-sided / pulmonary congestion',
  },
  systemic: {
    tagZh: '體',
    tagEn: 'S',
    legendZh: '體 = 右心衰竭／體循環鬱血',
    legendEn: 'S = right-sided / systemic congestion',
  },
  both: {
    tagZh: '兩',
    tagEn: 'B',
    legendZh: '兩 = 兩側皆可',
    legendEn: 'B = either side',
  },
}

/**
 * One row of question ② or question ④.
 *
 * `term` is the canonical id the evidence table matches on, so an answer given
 * here lands on the pack's own row; the labels are the screen's. `common`
 * rows are open by default and are what 「本題已答」 is counted from — the rest
 * fold behind 「更多 n 項」, because a list of sixteen findings asked in full at
 * every visit is a list nobody answers.
 */
export interface VisitSignItem {
  term: string
  zh: string
  en: string
  /** The short form used on the folded one-line answer. */
  shortZh: string
  shortEn: string
  side: VisitSignSide
  common: boolean
}

/**
 * Question ②: what the patient describes. ESC 2026 Table 7 (PDF p.22): the
 * five typical symptoms are asked on every visit (reduced exercise tolerance
 * and fatigue as one row); three less typical ones tied to congestion wait
 * under 更多. Clinician feedback 2026-09-28 (「病人描述的症狀真的需要那麼多
 * 嗎？」): reported weight gain is not asked here — ESC lists weight gain as a
 * sign, and 「體重比上次」 is asked at every visit already.
 */
export const VISIT_SYMPTOM_ITEMS: readonly VisitSignItem[] = [
  { term: 'exertional-dyspnea', zh: '勞力性呼吸困難（exertional dyspnea）', en: 'Exertional dyspnoea', shortZh: '勞力性喘', shortEn: 'Exertional dyspnoea', side: 'pulmonary', common: true },
  { term: 'orthopnea', zh: '端坐呼吸（orthopnea）', en: 'Orthopnoea', shortZh: '端坐呼吸', shortEn: 'Orthopnoea', side: 'pulmonary', common: true },
  { term: 'paroxysmal-nocturnal-dyspnea', zh: '夜間陣發性呼吸困難（paroxysmal nocturnal dyspnea，PND）', en: 'Paroxysmal nocturnal dyspnoea (PND)', shortZh: 'PND', shortEn: 'PND', side: 'pulmonary', common: true },
  { term: 'fatigue-exercise-intolerance', zh: '疲倦／運動耐受下降（fatigue／exercise intolerance）', en: 'Fatigue / reduced exercise tolerance', shortZh: '疲倦', shortEn: 'Fatigue', side: 'pulmonary', common: true },
  { term: 'reported-ankle-swelling', zh: '腳腫（ankle swelling，自述）', en: 'Ankle swelling (reported)', shortZh: '腳腫', shortEn: 'Ankle swelling', side: 'systemic', common: true },
  { term: 'abdominal-bloating', zh: '腹脹／吃一點就飽（abdominal bloating／early satiety）', en: 'Abdominal bloating / early satiety', shortZh: '腹脹', shortEn: 'Bloating', side: 'systemic', common: false },
  { term: 'nocturnal-cough', zh: '夜咳／喘鳴（nocturnal cough／wheeze）', en: 'Nocturnal cough / wheeze', shortZh: '夜咳', shortEn: 'Nocturnal cough', side: 'pulmonary', common: false },
  { term: 'bendopnea', zh: '彎腰呼吸困難（bendopnea）', en: 'Bendopnea', shortZh: '彎腰喘', shortEn: 'Bendopnea', side: 'both', common: false },
]

/** Question ④: what the clinician finds. */
export const VISIT_EXAM_ITEMS: readonly VisitSignItem[] = [
  { term: 'rales', zh: '肺部濕囉音（rales）', en: 'Pulmonary rales', shortZh: 'Rales', shortEn: 'Rales', side: 'pulmonary', common: true },
  { term: 'jvp', zh: '頸靜脈怒張（JVP）', en: 'Raised JVP', shortZh: 'JVP', shortEn: 'JVP', side: 'systemic', common: true },
  { term: 'pitting-edema', zh: '凹陷性水腫（pitting edema）', en: 'Pitting edema', shortZh: 'Pitting edema', shortEn: 'Pitting edema', side: 'systemic', common: true },
  { term: 'third-heart-sound', zh: '第三心音（S3）', en: 'Third heart sound (S3)', shortZh: 'S3', shortEn: 'S3', side: 'pulmonary', common: false },
  { term: 'hepatojugular-reflux', zh: '肝頸反流（HJR）', en: 'Hepatojugular reflux', shortZh: 'HJR', shortEn: 'HJR', side: 'systemic', common: false },
  { term: 'ascites', zh: '腹水（ascites）', en: 'Ascites', shortZh: 'Ascites', shortEn: 'Ascites', side: 'systemic', common: false },
  // Hepatomegaly left out (clinician feedback 2026-09-28): a less specific sign
  // in ESC 2026 Table 7 (PDF p.22), unreliable to palpate in clinic, and HJR
  // and ascites already carry right-sided congestion. The pack's evidence row
  // stays answerable where a card still shows it.
]

/** Which of the two questions a term is asked in, for a link back to it. */
export function visitQuestionForSignTerm(term: string): 'symptoms' | 'signs' {
  return VISIT_SYMPTOM_ITEMS.some((item) => item.term === term) ? 'symptoms' : 'signs'
}

function requestOf(
  recommendation: CdssRecommendation | undefined,
  kind: PhysicianInputRequest['kind'],
): PhysicianInputRequest | undefined {
  if (!recommendation) return undefined
  return physicianInputRequestsOf(recommendation).find((request) => request.kind === kind)
}

function signText(value: SignAnswerValue | null, isEnglish: boolean): string {
  if (value === 'present') return isEnglish ? 'yes' : '有'
  if (value === 'absent') return isEnglish ? 'no' : '無'
  if (value === NOT_ASSESSED) return isEnglish ? 'not assessed' : '未評估'
  return isEnglish ? 'not answered' : '尚未回答'
}

/** Chart notation preserves the distinction between absent and unassessed. */
function chartSignsText(items: readonly VisitSignItem[], vitals: ClinicVitals | undefined): string {
  const assessed = items.flatMap(item => {
    const value = vitals?.signAnswers?.[item.term]?.value
    return value === 'present' || value === 'absent'
      ? [`  ${item.shortEn} (${value === 'present' ? '+' : '-'})`] : []
  })
  const unassessed = items.filter(item => !['present', 'absent'].includes(vitals?.signAnswers?.[item.term]?.value ?? ''))
  if (unassessed.length) assessed.push(`  Not assessed: ${unassessed.map(item => item.shortEn).join(', ')}`)
  return assessed.join('\n')
}

/** What one question's rows were answered, on one folded line. */
function signItemsText(
  items: readonly VisitSignItem[],
  vitals: ClinicVitals | undefined,
  isEnglish: boolean,
): string | undefined {
  // Grouped by answer, the finding first — 「有：勞力性喘、腳腫；其餘皆無」,
  // 「全部皆無（6 項）」 — rather than a list of 「Rales：−・JVP：−・…」 that
  // hides the one row that matters.
  const sep = isEnglish ? ', ' : '、'
  const named = (value: SignAnswerValue) => items
    .filter((item) => vitals?.signAnswers?.[item.term]?.value === value)
    .map((item) => (isEnglish ? item.shortEn : item.shortZh))
  const present = named('present')
  const absent = named('absent')
  const notAssessed = named(NOT_ASSESSED)
  const unanswered = items.length - present.length - absent.length - notAssessed.length
  if (present.length + absent.length + notAssessed.length === 0) return undefined
  const restAbsent = notAssessed.length === 0 && unanswered === 0
  const parts = [
    present.length ? (isEnglish ? `Yes: ${present.join(sep)}` : `有：${present.join(sep)}`) : undefined,
    absent.length === 0
      ? undefined
      : restAbsent && present.length === 0
        ? (isEnglish ? `None of ${absent.length}` : `全部皆無（${absent.length} 項）`)
        : restAbsent
          ? (isEnglish ? 'the rest none' : '其餘皆無')
          : (isEnglish ? `No: ${absent.join(sep)}` : `無：${absent.join(sep)}`),
    notAssessed.length ? (isEnglish ? `Not assessed: ${notAssessed.join(sep)}` : `未評估：${notAssessed.join(sep)}`) : undefined,
    unanswered ? (isEnglish ? `${unanswered} not answered` : `${unanswered} 項未答`) : undefined,
  ].filter(Boolean)
  return parts.join(isEnglish ? '; ' : '；')
}

/** A question is answered once every 常見 row in it has an answer. */
function signItemsAnswered(
  items: readonly VisitSignItem[],
  vitals: ClinicVitals | undefined,
): boolean {
  return items
    .filter((item) => item.common)
    .every((item) => Boolean(vitals?.signAnswers?.[item.term]?.value))
}

/**
 * 「肺鬱血 n · 體循環 n」: how many terms were seen on each side.
 *
 * Counted across the symptoms and the examination together, because a patient
 * whose only pulmonary finding is 勞力性呼吸困難 has pulmonary congestion the
 * clinician reported rather than found. 「兩」 is counted on neither side: a
 * finding that could be either cannot settle which.
 */
function sideTallyOf(vitals: ClinicVitals | undefined): { pulmonary: number; systemic: number } {
  let pulmonary = 0
  let systemic = 0
  for (const item of [...VISIT_SYMPTOM_ITEMS, ...VISIT_EXAM_ITEMS]) {
    if (vitals?.signAnswers?.[item.term]?.value !== 'present') continue
    if (item.side === 'pulmonary') pulmonary += 1
    if (item.side === 'systemic') systemic += 1
  }
  return { pulmonary, systemic }
}

/** Positive bedside congestion findings belong beside the imported evidence. */
function congestionAssessmentBasis(
  vitals: ClinicVitals | undefined,
  isEnglish: boolean,
): string[] {
  const positiveLabels = (items: readonly VisitSignItem[]) => items
    .filter((item) => vitals?.signAnswers?.[item.term]?.value === 'present')
    .map((item) => isEnglish ? item.shortEn : item.shortZh)
  const symptoms = positiveLabels(VISIT_SYMPTOM_ITEMS)
  const exam = positiveLabels(VISIT_EXAM_ITEMS)
  return [
    ...(symptoms.length > 0
      ? [`${isEnglish ? 'Symptoms: ' : '症狀：'}${symptoms.join(isEnglish ? ', ' : '、')}`]
      : []),
    ...(exam.length > 0
      ? [`PE${isEnglish ? ': ' : '：'}${exam.join(isEnglish ? ', ' : '、')}`]
      : []),
  ]
}

function entryText(
  vitals: ClinicVitals | undefined,
  isEnglish: boolean,
): string | undefined {
  const value = (key: ClinicVitalsEntryKey) => vitals?.entries?.[key]?.value
  const parts: string[] = []
  const systolic = value('systolic')
  const diastolic = value('diastolic')
  if (systolic !== undefined && diastolic !== undefined) parts.push(`${systolic}/${diastolic}`)
  const heartRate = value('heartRate')
  if (heartRate !== undefined) parts.push(`${heartRate} bpm`)
  const oxygenSaturation = value('oxygenSaturation')
  if (oxygenSaturation !== undefined) parts.push(`SpO₂ ${oxygenSaturation}%`)
  const bodyWeight = value('bodyWeight')
  if (bodyWeight !== undefined) parts.push(`${bodyWeight} kg`)
  const bodyHeight = value('bodyHeight')
  if (bodyHeight !== undefined) parts.push(`${bodyHeight} cm`)
  if (parts.length === 0) return undefined
  return parts.join(isEnglish ? ' · ' : ' · ')
}

/** The most recent stamp across the fields one question writes. */
function latestStamp(...stamps: (string | undefined)[]): string | undefined {
  return stamps.filter((stamp): stamp is string => Boolean(stamp)).sort().at(-1)
}

function basisOf(recommendation: CdssRecommendation, isEnglish: boolean): string | undefined {
  const keys = recommendation.overviewEvidenceFactKeys
    ?? (recommendation.overviewEvidenceFactKey ? [recommendation.overviewEvidenceFactKey] : [])
  const seen = new Set<string>()
  const parts = keys.flatMap((factKey) => {
    const evidence = recommendation.patientEvidence.find((item) => item.factKeys.includes(factKey))
    if (!evidence) return []
    const label = evidence.label.trim()
    const value = evidence.value.trim()
    const repeatsLabel = value.toLocaleLowerCase().startsWith(`${label.toLocaleLowerCase()} `)
    const text = repeatsLabel ? value : `${label}${isEnglish ? ': ' : '：'}${value}`
    if (seen.has(text)) return []
    seen.add(text)
    return [text]
  })
  const missing = recommendation.missingData?.[0]
  if (missing) {
    const conciseMissing = conciseMissingLabel(missing)
    parts.push(isEnglish ? `Missing: ${conciseMissing}` : `缺：${conciseMissing}`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function conciseMissingLabel(label: string): string {
  return label
    .replace(/^此決策可用的\s*/, '')
    .replace(/（目前資料完全沒有這一項）/g, '')
    .trim()
}

/**
 * Reads the visit out of the board, the pack result and what this browser has
 * recorded. `undefined` for anything that is not the heart-failure pack.
 */
export function buildHeartFailureVisitFlow(
  input: HeartFailureVisitFlowInput,
): HeartFailureVisitFlow {
  const { board, result, isEnglish, now, clinicVitals, phenotypeAnswer, decisions } = input
  const readOnly = !input.patientId

  const recommendations = [
    ...result.recommendations,
    ...(result.automatedChecks ?? [])
      .map((check) => check.recommendation)
      .filter((item): item is CdssRecommendation => Boolean(item)),
  ].map(applyHeartFailureMedicationSafety)
  const byId = new Map(recommendations.map((item) => [item.id, item]))
  const phenotypeCard = byId.get(PHENOTYPE_MODULE_ID)
  const diagnosisCard = byId.get(HFPEF_DIAGNOSIS_MODULE_ID)

  /* ---------------------------------------------------------- questions */

  // The visit always starts with this answer, even when the pack already
  // knows the phenotype and therefore has no diagnostic question to ask.
  // Keep that visit input usable without changing the pack's clinical gates:
  // the same three answers the pack's DP-00 offers, HFpEF left out where the
  // record's LVEF is below 50%.
  const recordLvef = Number.parseFloat(board.lvef?.value ?? '')
  const suspicionRequest: PhysicianInputRequest = requestOf(phenotypeCard, 'hf-suspicion') ?? {
    kind: 'hf-suspicion',
    label: isEnglish ? 'Diagnosis: HFrEF or HFpEF?' : '診斷：HFrEF 還是 HFpEF？',
    selection: 'single',
    options: [
      { id: 'hfref', label: isEnglish ? 'HFrEF (LVEF <50%)' : 'HFrEF（LVEF <50%）' },
      ...(Number.isFinite(recordLvef) && recordLvef < 50
        ? []
        : [{ id: 'hfpef', label: isEnglish ? 'HFpEF (LVEF ≥50%)' : 'HFpEF（LVEF ≥50%）' }]),
      { id: 'suspected', label: isEnglish ? 'Not sure yet' : '還不確定' },
    ],
  }
  const lvefRequest = requestOf(phenotypeCard, 'lvef-phenotype')
  const hfpEfRequest = requestOf(diagnosisCard, 'hfpef-diagnosis-confirmation')

  const establishedHeartFailure = recommendations
    .flatMap((recommendation) => recommendation.patientEvidence)
    .some((evidence) => evidence.factKeys.includes('heartFailureDiagnosis'))
  const lvefValue = Number.parseFloat(board.lvef?.value ?? '')
  const establishedHfrEF = Boolean(phenotypeAnswer?.diagnosisConfirmation) || phenotypeAnswer?.hfpEfConfirmed === true || ((input.trustsPackFollowUp ?? input.includeAllModules) && diagnosisContextOf(phenotypeCard)?.mode === 'follow-up') || (establishedHeartFailure
    && Number.isFinite(lvefValue)
    && lvefValue < 50)
  const suspicion = establishedHfrEF ? 'suspected' : phenotypeAnswer?.hfSuspicion
  const suspected = suspicion === 'suspected'
  const notSuspected = suspicion === 'not-suspected'
  // The phenotype chosen on question 1 is the diagnosis; the question stays,
  // answered, so the choice can be changed where it was made.
  const diagnosedHere = phenotypeAnswer?.diagnosis
  // The pack asks DP-01 on every chart, answered from the record where it can
  // be (clinician feedback 2026-09-28: 「診斷留著讓人修改的空間，才不會每個病人
  // 進來的畫面不一樣」). Without the pack's question the host asks only before a
  // diagnosis, as before.
  const packAsksDiagnosis = Boolean(requestOf(phenotypeCard, 'hf-suspicion'))
  const asksDiagnosis = packAsksDiagnosis || !establishedHfrEF || Boolean(diagnosedHere)
  const recorded = suspicionRequest.recordedOptionId
  const phenotypeName = (id: string | undefined) => (id === 'hfref' || id === 'hfrEF' ? 'HFrEF' : 'HFpEF')
  const ownChoice = diagnosedHere ? undefined : phenotypeAnswer?.hfSuspicion
  const ownChoiceStands = Boolean(ownChoice && (
    suspicionRequest.options?.some((option) => option.id === ownChoice)
    || (ownChoice === 'not-suspected' && !establishedHfrEF)
  ))

  const suspicionLabel = suspicionRequest?.label
    ?? (isEnglish ? 'Diagnosis: HFrEF or HFpEF?' : '診斷：HFrEF 還是 HFpEF？')
  const suspicionAnswerText = diagnosedHere
    ? (isEnglish ? `${phenotypeName(diagnosedHere)} (your judgement)` : `${phenotypeName(diagnosedHere)}（醫師判斷）`)
    : recorded
    ? (isEnglish ? `${phenotypeName(recorded)} (record)` : `${phenotypeName(recorded)}（紀錄）`)
    : ownChoiceStands
    ? suspicionRequest.options?.find((option) => option.id === ownChoice)?.label
      ?? (ownChoice === 'suspected'
        ? (isEnglish ? 'Not sure yet' : '還不確定')
        : (isEnglish ? 'Not suspected' : '本次不懷疑'))
    : !packAsksDiagnosis && establishedHfrEF
    ? (isEnglish ? 'Established heart failure in the record' : '病歷已有心衰竭診斷')
    : undefined

  const questions: VisitQuestion[] = []

  if (asksDiagnosis) {
    const detail = suspicionRequest.detail
    questions.push({
      id: 'hf-suspicion',
      number: '1',
      label: suspicionLabel,
      state: suspicionAnswerText ? 'answered' : 'open',
      ...(suspicionAnswerText ? { answerText: suspicionAnswerText } : {}),
      ...(phenotypeAnswer?.modifiedAt?.hfSuspicion
        ? { modifiedAt: phenotypeAnswer.modifiedAt.hfSuspicion }
        : {}),
      // The record's LVEF is what the choice weighs; before an answer, say
      // what a phenotype does, so one press is not a surprise.
      ...(suspicionAnswerText
        ? (detail ? { hint: detail } : {})
        : {
          hint: [
            detail,
            establishedHfrEF
              ? (isEnglish ? 'A phenotype is recorded as your judgement.' : '選分型即記為醫師判斷。')
              : (isEnglish
                ? 'A phenotype is recorded as your judgement and opens treatment; symptoms and signs can be added later.'
                : '選分型即記為醫師判斷並進入治療；症狀／徵象可之後補記。'),
          ].filter(Boolean).join(isEnglish ? ' · ' : '・'),
        }),
      counted: true,
      request: suspicionRequest,
      recommendationId: PHENOTYPE_MODULE_ID,
    })
  }
  // Question 1 is the diagnosis where it is asked; everything after it
  // numbers on from there.
  const numberAfter = (position: number) => String(position + (asksDiagnosis ? 1 : 0))

  // 1b and 1c appear only where the pack actually raised them. The host does
  // not decide that a phenotype is missing — the pack does, by asking.
  if (lvefRequest && phenotypeCard) {
    questions.push({
      id: 'lvef-phenotype',
      number: '1b',
      label: lvefRequest.label,
      state: phenotypeAnswer?.choice ? 'answered' : 'open',
      ...(phenotypeAnswer?.choice
        ? {
          answerText: [
            lvefRequest.options?.find((option) => option.id === phenotypeAnswer.choice)?.label
              ?? phenotypeAnswer.choice,
            phenotypeAnswer.lvef === undefined ? undefined : `LVEF ${phenotypeAnswer.lvef}%`,
            formatDay(phenotypeAnswer.measuredOn),
          ].filter(Boolean).join(' · '),
        }
        : {}),
      ...(phenotypeAnswer?.modifiedAt?.phenotype
        ? { modifiedAt: phenotypeAnswer.modifiedAt.phenotype }
        : {}),
      counted: false,
      request: lvefRequest,
      recommendationId: phenotypeCard.id,
    })
  }
  // 2–6 are questions about a heart-failure patient. Until someone says this
  // is one they are a form put to the wrong person, and once someone says it
  // is not, they are a form nobody has to fill in.
  const lockedReason = notSuspected
    ? (isEnglish
      ? 'Heart failure is not suspected this visit; the remaining questions are skipped.'
      : '本次不懷疑心衰竭，其餘題目略過。')
    // Named, not numbered: on the map the question sits in 01, not above.
    : (isEnglish ? 'Opens once 「HFrEF or HFpEF?」 is answered' : '先回答「HFrEF 還是 HFpEF？」後開放')
  const gated = (state: VisitQuestionState): VisitQuestionState => (
    suspected ? state : 'locked'
  )

  // ② 症狀 — what the patient says, before anything the clinician looks for.
  const symptomsStamp = latestStamp(...VISIT_SYMPTOM_ITEMS.map(
    (item) => clinicVitals?.signAnswers?.[item.term]?.modifiedAt,
  ))
  const symptomsText = signItemsText(VISIT_SYMPTOM_ITEMS, clinicVitals, isEnglish)
  const symptomsAnswered = signItemsAnswered(VISIT_SYMPTOM_ITEMS, clinicVitals)
  questions.push({
    id: 'symptoms',
    number: numberAfter(1),
    label: isEnglish ? 'Symptoms the patient describes' : '病人描述的症狀',
    state: gated(symptomsAnswered ? 'answered' : 'open'),
    ...(symptomsAnswered && symptomsText
      ? {
        answerText: symptomsText,
        ...(symptomsStamp ? { modifiedAt: symptomsStamp } : {}),
      }
      : {}),
    ...(suspected ? {} : { lockedReason }),
    counted: true,
    items: VISIT_SYMPTOM_ITEMS,
  })

  const nyha = clinicVitals?.nyhaClass
  const nyhaQuestion: VisitQuestion = {
    id: 'nyha',
    number: numberAfter(3),
    label: isEnglish ? "Today's NYHA class?" : '今天的 NYHA 分級？',
    state: gated(nyha ? 'answered' : 'open'),
    ...(nyha
      ? {
        answerText: nyha.value === NOT_ASSESSED
          ? (isEnglish ? 'Not assessed' : '未評估')
          : `NYHA ${nyha.value}`,
        modifiedAt: nyha.modifiedAt,
      }
      : {}),
    hint: isEnglish
      ? `Graded from the symptoms in question ${numberAfter(1)} and the activity limitation; never inferred from LVEF or a diagnosis code.`
      : `依第 ${numberAfter(1)} 題的症狀與活動限制選擇；不由 LVEF 或診斷碼推定。`,
    ...(suspected ? {} : { lockedReason }),
    counted: true,
  }

  // ③ 徵象 — what the clinician examined for. Kept apart from ② because the
  // source differs and so does what 「無」 means: 「問了說沒有」 is not 「看了
  // 沒有」, and a rule that cannot tell them apart cannot weigh either.
  const signsStamp = latestStamp(...VISIT_EXAM_ITEMS.map(
    (item) => clinicVitals?.signAnswers?.[item.term]?.modifiedAt,
  ))
  const signsText = signItemsText(VISIT_EXAM_ITEMS, clinicVitals, isEnglish)
  const signsAnswered = signItemsAnswered(VISIT_EXAM_ITEMS, clinicVitals)
  questions.push({
    id: 'signs',
    number: numberAfter(2),
    label: isEnglish ? 'Signs you found on examination' : '你檢查到的徵象',
    state: gated(signsAnswered ? 'answered' : 'open'),
    ...(signsAnswered && signsText
      ? {
        answerText: signsText,
        ...(signsStamp ? { modifiedAt: signsStamp } : {}),
      }
      : {}),
    ...(suspected ? {} : { lockedReason }),
    counted: true,
    items: VISIT_EXAM_ITEMS,
    sideTally: sideTallyOf(clinicVitals),
  })
  questions.push(nyhaQuestion)

  const compensation = clinicVitals?.compensationStatus
  const compensationQuestion: VisitQuestion = {
    id: 'compensation',
    number: numberAfter(4),
    label: isEnglish
      ? 'Compensated or decompensated today?'
      : '今天是代償還是失代償？',
    state: gated(compensation ? 'answered' : 'open'),
    ...(compensation
      ? {
        answerText: compensation.value === NOT_ASSESSED
          ? (isEnglish ? 'Not assessed' : '未評估')
          : compensation.value === 'decompensated'
            ? (isEnglish ? 'Decompensated' : '失代償')
            : (isEnglish ? 'Compensated' : '代償'),
        modifiedAt: compensation.modifiedAt,
      }
      : {}),
    hint: isEnglish
      ? 'Kept apart from any admission in the record; the current rules do not read this answer yet.'
      : '與紀錄中的住院史分開存放；目前規則尚未讀取此答案。',
    ...(suspected ? {} : { lockedReason }),
    counted: true,
  }

  const vitalsText = entryText(clinicVitals, isEnglish)
  questions.push(compensationQuestion)

  // ⑥ The HFpEF confirmation, last because it reads questions ② and ③ to judge
  // criterion (i): a card that asked for the conclusion before the findings
  // were in sent the clinician back up the page to answer them. Not asked once
  // question 1 carries a phenotype — that answer is the diagnosis.
  if (hfpEfRequest && diagnosisCard && !diagnosedHere) {
    const confirmation = phenotypeAnswer?.hfpEfConfirmed
    // `false` is the original board's 「取消確認」, which returns the question
    // to unanswered. Only 「暫不確認」 is an answer with no finding in it.
    const answered = confirmation === true || confirmation === HFPEF_NOT_CONFIRMED
    questions.push({
      id: 'hfpef-confirmation',
      number: numberAfter(5),
      label: hfpEfRequest.label,
      state: gated(answered ? 'answered' : 'open'),
      ...(!answered
        ? {}
        : {
          answerText: confirmation === true
            ? (isEnglish ? 'HFpEF confirmed' : 'HFpEF 已確認')
            : (isEnglish ? 'Not confirmed this visit' : '暫不確認'),
          ...(phenotypeAnswer?.modifiedAt?.hfpEfConfirmed
            ? { modifiedAt: phenotypeAnswer.modifiedAt.hfpEfConfirmed }
            : {}),
        }),
      ...(suspected ? {} : { lockedReason }),
      counted: true,
      request: hfpEfRequest,
      recommendationId: diagnosisCard.id,
    })
  }

  const countedQuestions = questions.filter((question) => question.counted)
  const openQuestionCount = countedQuestions.filter((question) => question.state === 'open').length
  const answeredQuestionCount = countedQuestions
    .filter((question) => question.state === 'answered').length

  /* ------------------------------------------------------------ actions */

  const alertIds = new Set(board.alerts.map((item) => item.id))
  const pillarIds = new Set<string>(PILLAR_MODULE_IDS.filter((id) => byId.has(id)))
  const priorityRank: Readonly<Record<CdssRecommendation['priority'], number>> = {
    high: 0,
    medium: 1,
    routine: 2,
  }
  const pillarRank = (id: string): number => {
    const index = PILLAR_MODULE_IDS.indexOf(id)
    return index === -1 ? PILLAR_MODULE_IDS.length : index
  }

  const groupOf = (recommendation: CdssRecommendation): VisitActionGroupId => {
    if (alertIds.has(recommendation.id)) return 'safety'
    if (pillarIds.has(recommendation.id)) return 'actionable'
    return recommendation.status
  }

  const pillarMedications = new Map(
    board.pillars.map((pillar) => [pillar.id, pillar.medicationNames]),
  )

  const listed = recommendations.filter((item) => (
    // The phenotype gate and the HFpEF confirmation are questions 1, 1b and 1c;
    // listing them again as things to do is the duplication this screen removes.
    item.id !== PHENOTYPE_MODULE_ID && item.id !== HFPEF_DIAGNOSIS_MODULE_ID
    // The four medication-class rows already ask for the concrete decisions.
    // A separate generic medication-reconciliation row repeats that work.
    && item.id !== GDMT_MODULE_ID
    // The diagnosis question and HFpEF calculator already present the same
    // eligibility evidence; a second read-only treatment card adds no action.
    && (input.includeAllModules || item.id !== 'heart-failure-hfpef-treatment')
    // Each additional therapy already has its own evidence table and physician
    // fields. The umbrella card only asks the clinician to repeat that work.
    && (input.includeAllModules || item.id !== 'heart-failure-additional-medical-therapy')
    && (input.includeAllModules || !isGenericMonitoringReminder(item))
    // Exercise clearance belongs to the rehabilitation assessment, not this HF visit.
    && (input.includeAllModules || item.id !== 'cardiac-rehabilitation-safety')
  ))

  const groupOrder: readonly VisitActionGroupId[] = [
    'safety',
    'actionable',
    'needs-data',
    'review',
    'no-action',
  ]
  const groupLabels: Readonly<Record<VisitActionGroupId, { zh: string; en: string }>> = {
    safety: { zh: '安全警訊', en: 'Safety alerts' },
    actionable: { zh: '藥物與處置', en: 'Medication & actions' },
    'needs-data': { zh: '檢驗與量測', en: 'Tests & measurements' },
    review: { zh: '需判斷', en: 'Judgement' },
    'no-action': { zh: '目前無需處理', en: 'No action needed' },
  }

  // Answering 「不懷疑心衰竭」 closes the visit down to what is dangerous
  // whatever the diagnosis: a prescription the record already holds does not
  // stop being an interaction because this clinician is not asking about HF.
  const visible = notSuspected
    ? listed.filter((item) => alertIds.has(item.id))
    : listed

  let index = 0
  const actionGroups: VisitActionGroup[] = groupOrder.flatMap((groupId) => {
    const rows = visible
      .filter((item) => groupOf(item) === groupId)
      .sort((a, b) => (
        // The four pillars lead 藥物與處置 in the guideline's own order; the
        // GDMT umbrella and anything else follow on the pack's priority.
        (groupId === 'actionable' ? pillarRank(a.id) - pillarRank(b.id) : 0)
        || priorityRank[a.priority] - priorityRank[b.priority]
        || (a.moduleOrder ?? Number.MAX_SAFE_INTEGER) - (b.moduleOrder ?? Number.MAX_SAFE_INTEGER)
      ))
      .map((recommendation): VisitActionRow => {
        const decisionKind = visitDecisionKind(recommendation, groupId)
        if (decisionKind !== 'none') index += 1
        const medications = pillarMedications.get(recommendation.id)
        const recordedDecision = decisions[recommendation.id]
        // An existing drug does not fulfil a recommendation to switch or adjust it.
        const defaultPrescribed = !recordedDecision && decisionKind === 'medication'
          && recommendation.status === 'no-action'
          && board.pillars.some((pillar) => pillar.id === recommendation.id && pillar.taking)
        const packBasis = basisOf(recommendation, isEnglish)
        const basis = [
          ...(recommendation.id === 'heart-failure-congestion-diuretic'
            ? congestionAssessmentBasis(clinicVitals, isEnglish)
            : []),
          ...(packBasis ? [packBasis] : []),
        ].join(' · ')
        return {
          ...(decisionKind === 'none' ? {} : { index }),
          recommendation,
          headline: visitActionHeadline(recommendation, isEnglish),
          moduleName: recommendation.moduleName ?? recommendation.id,
          status: recommendation.status,
          isSafety: groupId === 'safety',
          ...(medications ? { medications } : {}),
          ...(basis ? { basis } : {}),
          decisionKind,
          ...(recordedDecision ? { decision: recordedDecision } : defaultPrescribed ? {
            decision: { decision: 'prescribed', reasons: [], recordedAt: '', packVersion: result.packVersion },
            decisionSource: 'medication-record',
          } : {}),
        }
      })
    if (rows.length === 0) return []
    return [{
      id: groupId,
      label: isEnglish ? groupLabels[groupId].en : groupLabels[groupId].zh,
      rows,
      collapsedByDefault: groupId === 'no-action',
      ...(groupId === 'no-action'
        ? { summary: rows.map((row) => row.moduleName).join(' · ') }
        : {}),
    }]
  })

  const decidableRows = actionGroups
    .flatMap((group) => group.rows)
    .filter((row) => row.decisionKind !== 'none')
  const decidableCount = decidableRows.length
  const decidedCount = decidableRows.filter((row) => row.decision).length
  const undecidedSafety = actionGroups
    .find((group) => group.id === 'safety')?.rows
    .find((row) => !row.decision)
  const firstUndecided = decidableRows.find((row) => !row.decision)

  /* -------------------------------------------------------------- steps */

  // ① is done once the clinician has said they suspect heart failure and the
  // LVEF gate the pack raised has an answer. The HFpEF confirmation is not part
  // of it: it reads this visit's symptoms and signs, so it belongs to ② and a
  // step bar that waited for it left ① 「進行中」 for the whole consultation.
  // `na` is the other settled state: a patient this clinician is not asking
  // about.
  const phenotypeSettled = suspected
    && (!lvefRequest || Boolean(phenotypeAnswer?.choice))
  const confirmState: VisitStepState = notSuspected
    ? 'na'
    : phenotypeSettled
      ? 'done'
      : 'current'
  const phenotypeTitle = board.phenotype?.title
  const confirmDetail = establishedHfrEF
    ? [
      'HFrEF',
      board.lvef?.value ? `LVEF ${board.lvef.value}` : undefined,
      isEnglish ? 'established HF diagnosis in record' : '病歷已有心衰竭診斷',
    ].filter(Boolean).join(' · ')
    : notSuspected
    ? (isEnglish ? 'Not suspected this visit' : '本次不懷疑')
    : suspected
      ? [isEnglish ? 'Yes' : '是', phenotypeTitle, board.lvef?.value ? `LVEF ${board.lvef.value}` : undefined]
        .filter(Boolean).join(' · ')
      : (isEnglish ? 'Not answered' : '尚未回答')

  const assessDone = suspected && openQuestionCount === 0
  const assessState: VisitStepState = notSuspected
    ? 'na'
    : !suspected
      ? 'todo'
      : assessDone
        ? 'done'
        : 'current'
  const assessDetail = notSuspected
    ? (isEnglish ? 'Skipped' : '已略過')
    : !suspected
      ? (isEnglish ? 'Opens after 「yes」' : '答「是」後開放')
      : assessDone
        ? (isEnglish ? `${answeredQuestionCount} answered` : `${countedQuestions.length} 題已答`)
        : (isEnglish ? `${openQuestionCount} left` : `還有 ${openQuestionCount} 題`)

  const actDone = decidableCount > 0 && decidedCount === decidableCount
  // There is something to decide from the moment a row carries a decision —
  // a safety alert is decidable before anyone has answered question 1 — so
  // this step is 「進行中」 whenever a row is still undecided.
  const actState: VisitStepState = decidableCount === 0
    ? (suspicion ? 'done' : 'todo')
    : actDone
      ? 'done'
      : 'current'
  const safetyCount = actionGroups.find((group) => group.id === 'safety')?.rows.length ?? 0
  const actDetail = decidableCount === 0
    ? (suspicion
      ? (isEnglish ? 'Nothing to decide' : '本次無需處理')
      : (isEnglish ? 'Waiting on question 1' : '等待第 1 題'))
    : actDone
      ? (isEnglish ? `${decidedCount} decided` : `${decidedCount} 項已決定`)
      : [
        isEnglish ? `${decidableCount} recommendations` : `${decidableCount} 項建議`,
        safetyCount > 0
          ? (isEnglish ? `${safetyCount} safety alerts` : `${safetyCount} 項安全警訊`)
          : undefined,
      ].filter(Boolean).join(' · ')

  const followUpNote = recommendations
    .filter((item) => item.domain === 'monitoring' || item.domain === 'safety')
    .flatMap((item) => item.nextActions)
    .find((action) => /追蹤|回診|週後|個月後|follow[- ]up|recheck/i.test(action))

  const everythingDone = actDone && assessDone && confirmState !== 'current'
  const recordState: VisitStepState = everythingDone ? 'current' : 'todo'
  const recordDetail = everythingDone
    ? [isEnglish ? 'Copy the summary' : '複製摘要', followUpNote].filter(Boolean).join(' · ')
    : (isEnglish ? 'Copy the summary once answered' : '答完後可複製摘要')

  const steps: readonly VisitStep[] = [
    {
      id: 'confirm',
      index: 1,
      label: isEnglish ? 'Confirm heart failure' : '確認心衰竭',
      state: confirmState,
      detail: confirmDetail,
    },
    {
      id: 'assess',
      index: 2,
      label: isEnglish ? "This visit's assessment" : '本次評估',
      state: assessState,
      detail: assessDetail,
    },
    {
      id: 'act',
      index: 3,
      label: isEnglish ? "Today's actions" : '今日處置',
      state: actState,
      detail: actDetail,
    },
    {
      id: 'record',
      index: 4,
      label: isEnglish ? 'Record and follow-up' : '紀錄與追蹤',
      state: recordState,
      detail: recordDetail,
    },
  ]

  /* ---------------------------------------------------------- next step */

  const firstOpenQuestion = questions.find((question) => (
    question.state === 'open' && (question.counted || !notSuspected)
  ))
  const nextStep: VisitNextStep = ((): VisitNextStep => {
    // A safety alert nobody has answered outranks everything, including an
    // unanswered question 1: a harmful prescription is harmful whether or not
    // this clinician is asking about heart failure today.
    if (undecidedSafety) {
      return {
        tone: 'safety',
        message: isEnglish
          ? `Handle the safety alert first: ${undecidedSafety.recommendation.title}`
          : `先處理安全警訊：${undecidedSafety.recommendation.title}`,
        actionLabel: isEnglish
          ? `Go to row ${undecidedSafety.index}`
          : `看第 ${undecidedSafety.index} 列`,
        target: {
          kind: 'action',
          moduleId: undecidedSafety.recommendation.id,
          index: undecidedSafety.index ?? 1,
        },
      }
    }
    if (firstOpenQuestion) {
      const first = firstOpenQuestion.id === 'hf-suspicion' && !suspicion
      return {
        tone: 'primary',
        message: isEnglish
          ? `Next: ${firstOpenQuestion.label}`
          : `接下來：${firstOpenQuestion.label}`,
        actionLabel: isEnglish
          ? `Go to question ${firstOpenQuestion.number}`
          : `前往第 ${firstOpenQuestion.number} 題`,
        target: { kind: 'question', questionId: firstOpenQuestion.id },
        // On the first open, say what the record already holds that bears on
        // the question — the reader should not have to hunt for it to answer.
        ...(first ? { hint: firstOpenHint(board, isEnglish) } : {}),
      }
    }
    if (firstUndecided) {
      return {
        tone: 'primary',
        message: isEnglish
          ? `Next: ${firstUndecided.headline}`
          : `接下來：${firstUndecided.headline}`,
        actionLabel: isEnglish ? `Go to row ${firstUndecided.index}` : `看第 ${firstUndecided.index} 列`,
        target: {
          kind: 'action',
          moduleId: firstUndecided.recommendation.id,
          index: firstUndecided.index ?? 1,
        },
      }
    }
    return {
      tone: 'ok',
      message: isEnglish
        ? `This visit is complete: copy the summary into the chart${followUpNote ? `, ${followUpNote}` : ''}`
        : `本次完成：複製摘要到病歷${followUpNote ? `，${followUpNote}` : ''}`,
      actionLabel: isEnglish ? "Copy English summary" : '複製英文摘要',
      target: { kind: 'copy' },
    }
  })()

  /* ------------------------------------------------------- record card */

  const carriedFields: CarriedField[] = []
  const pushCarried = (label: string, value: string, iso: string | undefined, measuredOn?: string) => {
    const stamp = measuredOn
      ? `${isEnglish ? 'measured' : '量測'} ${formatDay(measuredOn)}`
      : formatStamp(iso, now, isEnglish)
    carriedFields.push({ label, value, date: stamp ?? '' })
  }
  if (suspicionAnswerText) {
    pushCarried(
      isEnglish ? 'Diagnosis' : '診斷',
      suspicionAnswerText,
      phenotypeAnswer?.modifiedAt?.hfSuspicion,
    )
  }
  if (nyha) {
    pushCarried(
      'NYHA',
      nyha.value === NOT_ASSESSED ? (isEnglish ? 'Not assessed' : '未評估') : nyha.value,
      nyha.modifiedAt,
    )
  }
  for (const item of [...VISIT_SYMPTOM_ITEMS, ...VISIT_EXAM_ITEMS]) {
    const answer = clinicVitals?.signAnswers?.[item.term]
    if (!answer) continue
    pushCarried(
      isEnglish ? item.en : item.zh,
      signText(answer.value, isEnglish),
      answer.modifiedAt,
    )
  }
  const hfpEfAnswerText = questions
    .find((question) => question.id === 'hfpef-confirmation')?.answerText
  if (hfpEfAnswerText) {
    pushCarried(
      'HFpEF',
      hfpEfAnswerText,
      phenotypeAnswer?.modifiedAt?.hfpEfConfirmed,
    )
  }
  if (compensation) {
    pushCarried(
      isEnglish ? 'Compensation' : '代償狀態',
      compensation.value === NOT_ASSESSED
        ? (isEnglish ? 'Not assessed' : '未評估')
        : compensation.value === 'decompensated'
          ? (isEnglish ? 'Decompensated' : '失代償')
          : (isEnglish ? 'Compensated' : '代償'),
      compensation.modifiedAt,
    )
  }
  const entryLabels: Readonly<Record<ClinicVitalsEntryKey, { zh: string; en: string; unit: string }>> = {
    systolic: { zh: '收縮壓', en: 'Systolic', unit: 'mmHg' },
    diastolic: { zh: '舒張壓', en: 'Diastolic', unit: 'mmHg' },
    heartRate: { zh: '心率', en: 'Heart rate', unit: 'bpm' },
    oxygenSaturation: { zh: 'SpO₂', en: 'SpO₂', unit: '%' },
    bodyWeight: { zh: '體重', en: 'Weight', unit: 'kg' },
    bodyHeight: { zh: '身高', en: 'Height', unit: 'cm' },
    potassium: { zh: 'K', en: 'K', unit: 'mmol/L' },
    eGFR: { zh: 'eGFR', en: 'eGFR', unit: 'mL/min/1.73m²' },
    sodium: { zh: 'Na', en: 'Na', unit: 'mmol/L' },
    NTproBNP: { zh: 'NT-proBNP', en: 'NT-proBNP', unit: 'pg/mL' },
    hemoglobin: { zh: 'Hb', en: 'Hb', unit: 'g/dL' },
  }
  for (const [key, entry] of Object.entries(clinicVitals?.entries ?? {})) {
    if (!entry) continue
    const meta = entryLabels[key as ClinicVitalsEntryKey]
    pushCarried(
      isEnglish ? meta.en : meta.zh,
      `${entry.value} ${meta.unit}`,
      entry.modifiedAt,
      entry.measuredOn,
    )
  }
  for (const row of decidableRows) {
    const decision = row.decision
    if (!decision || row.decisionSource === 'medication-record') continue
    pushCarried(
      row.moduleName,
      decisionLabel(decision.decision, isEnglish),
      decision.recordedAt,
    )
  }

  const summaryText = buildVisitSummaryText({
    board,
    isEnglish,
    now,
    phenotypeTitle,
    suspicionAnswerText,
    suspicionModifiedAt: phenotypeAnswer?.modifiedAt?.hfSuspicion,
    nyhaText: nyha
      ? (nyha.value === NOT_ASSESSED ? (isEnglish ? 'not assessed' : '未評估') : `NYHA ${nyha.value}`)
      : (isEnglish ? 'not answered' : '尚未回答'),
    symptomsText: symptomsText ?? (isEnglish ? 'not answered' : '尚未回答'),
    signsText: signsText ?? (isEnglish ? 'not answered' : '尚未回答'),
    ...(hfpEfAnswerText ? { hfpEfText: hfpEfAnswerText } : {}),
    compensationText: compensation
      ? (compensation.value === NOT_ASSESSED
        ? (isEnglish ? 'not assessed' : '未評估')
        : compensation.value === 'decompensated'
          ? (isEnglish ? 'decompensated' : '失代償')
          : (isEnglish ? 'compensated' : '代償'))
      : (isEnglish ? 'not answered' : '尚未回答'),
    vitalsText,
    decidableRows,
    decidedCount,
    followUpNote,
  })

  // Build chart text from structured answers, independently of the UI/pack language.
  const englishSummaryText = buildVisitSummaryText({
    chartLayout: true,
    board,
    isEnglish: true,
    now,
    phenotypeTitle: phenotypeTitle?.match(/HF(?:imp|mr|p|r)EF/i)?.[0]
      ? `${phenotypeTitle.match(/HF(?:imp|mr|p|r)EF/i)![0]} pathway` : undefined,
    suspicionAnswerText: suspicion ? (suspected ? 'Yes' : 'No, not suspected at this visit') : 'Not assessed',
    suspicionModifiedAt: phenotypeAnswer?.modifiedAt?.hfSuspicion,
    nyhaText: nyha && nyha.value !== NOT_ASSESSED ? String(nyha.value) : 'not assessed',
    symptomsText: chartSignsText(VISIT_SYMPTOM_ITEMS, clinicVitals),
    signsText: chartSignsText(VISIT_EXAM_ITEMS, clinicVitals),
    hfpEfText: phenotypeAnswer?.hfpEfConfirmed === true ? 'HFpEF confirmed'
      : phenotypeAnswer?.hfpEfConfirmed === HFPEF_NOT_CONFIRMED ? 'HFpEF not confirmed this visit' : undefined,
    compensationText: compensation && compensation.value !== NOT_ASSESSED ? compensation.value : 'not assessed',
    vitalsText: entryText(clinicVitals, true),
    decidableRows: decidableRows.map(row => ({
      ...row,
      moduleName: clinicalModuleLabel(row.recommendation.id, 'en', row.recommendation.id),
    })),
    decidedCount,
  }).replace(/：/g, ': ').replace(/（/g, ' (').replace(/）/g, ')')

  return {
    steps,
    nextStep,
    metrics: [...(board.lvef ? [board.lvef] : []), ...board.metrics],
    questions,
    openQuestionCount,
    answeredQuestionCount,
    countedQuestionCount: countedQuestions.length,
    actionGroups,
    decidedCount,
    decidableCount,
    summaryText,
    englishSummaryText,
    carriedFields,
    ...(result.clinicalHandoff ? { handoff: result.clinicalHandoff } : {}),
    ...(followUpNote ? { followUpNote } : {}),
    readOnly,
  }
}

/** State the result of a negative medication-safety scan instead of when to scan again. */
function visitActionHeadline(recommendation: CdssRecommendation, isEnglish: boolean): string {
  if (recommendation.id === 'heart-failure-fmt-safety') {
    const missing = (recommendation.missingData ?? []).map(conciseMissingLabel)
    const stale = recommendation.patientEvidence
      .filter((item) => /超過\s*\d+\s*天窗|stale|exceeds?.*window|out(?:side| of).*window/i.test(item.value))
      .map((item) => item.label)
    const uniqueMissing = [...new Set(missing)]
    const uniqueStale = [...new Set(stale)]
    if (isEnglish) {
      const actions = [
        ...(uniqueMissing.length > 0 ? [`complete ${uniqueMissing.join(', ')}`] : []),
        ...(uniqueStale.length > 0 ? [`repeat ${uniqueStale.join(', ')}`] : []),
      ]
      return actions.length > 0
        ? `${actions.join(' and ')}, then reassess medication adjustment.`
        : 'Review symptoms, vital signs, and laboratory results before adjusting medication.'
    }
    const actions = [
      ...(uniqueMissing.length > 0 ? [`補齊${uniqueMissing.join('、')}`] : []),
      ...(uniqueStale.length > 0 ? [`複驗${uniqueStale.join('、')}`] : []),
    ]
    return actions.length > 0
      ? `${actions.join('並')}，再評估藥物調整。`
      : '確認症狀、生命徵象與檢驗後，再評估藥物調整。'
  }
  if (recommendation.id === 'heart-failure-mra') {
    return isEnglish ? 'Assess starting MRA.' : '評估啟用 MRA。'
  }
  if (recommendation.id === 'heart-failure-congestion-diuretic') {
    return isEnglish
      ? 'For HF with signs or symptoms of congestion, adjust loop diuretics to volume status.'
      : '有鬱血症狀或徵象時，依容量狀態調整 loop 利尿劑。'
  }
  if (recommendation.id === 'heart-failure-medication-safety' && recommendation.status === 'no-action') {
    return isEnglish
      ? 'Medication review found no recorded NSAID or COX-2 inhibitor use.'
      : '本次用藥掃描未發現 NSAID 或 COX-2 抑制劑使用紀錄。'
  }
  return recommendation.nextActions[0] ?? recommendation.title
}

/**
 * What the record already holds that bears on question 1.
 *
 * Read off the board rather than computed: an LVEF the pack printed and a
 * phenotype card it built are the two clues a clinician uses to decide whether
 * to open the pathway, and neither is a new judgement by the host.
 */
function firstOpenHint(board: HeartFailureBoardModel, isEnglish: boolean): string | undefined {
  const clues: string[] = []
  if (board.lvef?.value) {
    clues.push(`LVEF ${board.lvef.value}${board.lvef.date ? `（${formatDay(board.lvef.date)}）` : ''}`)
  }
  if (board.phenotype?.title) clues.push(board.phenotype.title)
  if (clues.length === 0) return undefined
  return isEnglish
    ? `The record holds ${clues.join(' · ')}, which may help; only you can decide whether to open the heart-failure pathway.`
    : `紀錄有 ${clues.join(' · ')}，可協助判斷；但只有你能決定是否啟動心衰竭路徑。`
}


/** This generic record-retrieval reminder is not a decision for today's visit. */
function isGenericMonitoringReminder(item: CdssRecommendation): boolean {
  return item.id === 'heart-failure-monitoring' && [
    '先查找院內近期病歷與出院計畫，再補齊病人自述與量測資料。',
    'Retrieve recent institutional notes and the discharge plan first, then complete patient-reported and measured data.',
  ].includes(item.nextActions[0] ?? '')
}

/** Match the task itself, not the severity/group in which it happens to appear. */
function visitDecisionKind(recommendation: CdssRecommendation, group: VisitActionGroupId): VisitDecisionKind {
  if (group === 'no-action') return 'none'
  if (recommendation.id === 'cardiac-rehabilitation-safety') return 'exercise-safety'
  if (recommendation.id === 'cardiac-rehabilitation') return 'rehabilitation'
  if (recommendation.id === 'heart-failure-fmt-safety') return 'measurement'
  if (group === 'needs-data') return 'test'
  if (recommendation.id === 'heart-failure-monitoring' || recommendation.id === 'cardiac-rehabilitation-response') return 'follow-up'
  if (
    recommendation.id === 'heart-failure-hfimpEF-therapy'
  ) return 'review'
  if (recommendation.domain === 'medication') return 'medication'
  return 'review'
}

export const VISIT_DECISIONS: Readonly<Record<VisitDecisionKind, readonly PhysicianDecision['decision'][]>> = {
  medication: ['prescribed', 'dose-adjusted', 'contraindicated', 'deferred', 'patient-preference'],
  test: ['ordered', 'deferred'],
  measurement: ['measurements-completed', 'deferred'],
  'follow-up': ['follow-up-arranged', 'reviewed', 'deferred', 'patient-preference'],
  rehabilitation: ['referred', 'deferred', 'patient-preference'],
  'exercise-safety': ['exercise-cleared', 'supervised-exercise', 'deferred'],
  review: ['reviewed', 'deferred', 'patient-preference'],
  none: [],
}

export const DECISION_LABELS: Readonly<Record<PhysicianDecision['decision'], { zh: string; en: string }>> = {
  prescribed: { zh: '已開立', en: 'Prescribed' },
  'dose-adjusted': { zh: '劑量調整', en: 'Dose adjusted' },
  contraindicated: { zh: '禁忌', en: 'Contraindicated' },
  deferred: { zh: '暫緩', en: 'Deferred' },
  'patient-preference': { zh: '病人意願', en: "Patient's preference" },
  ordered: { zh: '已開單', en: 'Ordered' },
  'measurements-completed': { zh: '已量測', en: 'Measured' },
  'follow-up-arranged': { zh: '已安排追蹤', en: 'Follow-up arranged' },
  referred: { zh: '已轉介', en: 'Referred' },
  'exercise-cleared': { zh: '可運動', en: 'Cleared for exercise' },
  'supervised-exercise': { zh: '需監測下運動', en: 'Supervised exercise' },
  reviewed: { zh: '已評估', en: 'Reviewed' },
  held: { zh: '暫停', en: 'Held' },
  'at-max-tolerated': { zh: '已達耐受上限', en: 'At maximum tolerated dose' },
}

export function decisionLabel(
  decision: PhysicianDecision['decision'],
  isEnglish: boolean,
): string {
  return isEnglish ? DECISION_LABELS[decision].en : DECISION_LABELS[decision].zh
}

/** The reasons a deferral or a contraindication can be recorded under. */
export const DECISION_REASONS: readonly { id: string; zh: string; en: string }[] = [
  { id: 'high-potassium', zh: 'K 偏高', en: 'Potassium high' },
  { id: 'mra-hyperkalemia', zh: 'K ≥ 5.0 mmol/L', en: 'Potassium ≥ 5.0 mmol/L' },
  { id: 'mra-renal-threshold', zh: 'eGFR ≤ 30 mL/min/1.73m²', en: 'eGFR ≤ 30 mL/min/1.73m²' },
  { id: 'addison-disease', zh: 'Addison disease', en: 'Addison disease' },
  { id: 'duplicate-mra', zh: '重複使用 MRA（如併用 eplerenone）', en: 'Duplicate MRA therapy (e.g. concomitant eplerenone)' },
  { id: 'symptomatic-hypotension', zh: '症狀性低血壓', en: 'Symptomatic hypotension' },
  { id: 'low-egfr', zh: 'eGFR 不足', en: 'eGFR too low' },
  { id: 'bradycardia', zh: '心率過慢', en: 'Heart rate too low' },
  { id: 'drug-hypersensitivity', zh: '對本藥嚴重過敏', en: 'Serious drug hypersensitivity' },
  { id: 'angioedema-history', zh: 'ACEI／ARB 相關血管性水腫史', en: 'History of ACEI/ARB-related angioedema' },
  { id: 'pregnancy', zh: '懷孕', en: 'Pregnancy' },
  { id: 'acei-arni-overlap', zh: 'ACEI 併用／停藥未滿 36 小時', en: 'Concomitant ACEI or washout under 36 hours' },
  { id: 'arni-aliskiren-diabetes', zh: 'ARNI 併用 aliskiren（糖尿病）', en: 'ARNI with aliskiren in diabetes' },
  { id: 'high-grade-av-block', zh: '二／三度 AV block（無節律器）', en: 'Second-/third-degree AV block without a pacemaker' },
  { id: 'severe-bradycardia', zh: '嚴重心搏過緩', en: 'Severe bradycardia' },
  { id: 'cardiogenic-shock', zh: '心因性休克／需靜脈強心劑', en: 'Cardiogenic shock / IV inotrope required' },
  { id: 'bronchial-asthma', zh: '支氣管氣喘／嚴重支氣管痙攣', en: 'Bronchial asthma / severe bronchospasm' },
  { id: 'acute-decompensation', zh: '急性失代償／尚未穩定', en: 'Acute decompensation / not yet stable' },
  { id: 'anuria', zh: '無尿', en: 'Anuria' },
  { id: 'no-congestion', zh: '無鬱血／已達乾體重', en: 'No congestion / at dry weight' },
  { id: 'electrolyte-depletion', zh: '低血鉀／低血鈉', en: 'Hypokalaemia / hyponatraemia' },
  { id: 'worsening-renal-function', zh: '腎功能惡化／少尿', en: 'Worsening renal function / oliguria' },
  { id: 'drug-intolerance', zh: '不耐受', en: 'Intolerance' },
  { id: 'volume-depletion', zh: '容量不足／症狀性低血壓', en: 'Volume depletion / symptomatic hypotension' },
  { id: 'ketoacidosis', zh: '酮酸中毒／疑似 DKA', en: 'Ketoacidosis / suspected DKA' },
  { id: 'acute-illness-fasting-surgery', zh: '急性病／禁食／手術', en: 'Acute illness / fasting / surgery' },
  { id: 'low-egfr-initiation', zh: 'eGFR 低於起始門檻', en: 'eGFR below initiation threshold' },
  { id: 'patient-refused', zh: '病人拒絕', en: 'Patient declined' },
  { id: 'cost', zh: '費用／給付', en: 'Cost / coverage' },
  { id: 'other', zh: '其他', en: 'Other' },
]

/** Reasons shown for this decision; diuretics use volume-status and renal safety reasons. */
export function decisionReasonIds(
  moduleId: string,
  decisionKind: VisitDecisionKind,
  decision: PhysicianDecision['decision'] | undefined,
): readonly string[] {
  if (moduleId === 'heart-failure-ras-inhibition') {
    return decision === 'contraindicated'
      ? [
          'angioedema-history',
          'pregnancy',
          'acei-arni-overlap',
          'arni-aliskiren-diabetes',
          'drug-hypersensitivity',
          'other',
        ]
      : [
          'symptomatic-hypotension',
          'high-potassium',
          'worsening-renal-function',
          'drug-intolerance',
          'patient-refused',
          'cost',
          'other',
        ]
  }
  if (moduleId === 'heart-failure-beta-blocker') {
    return decision === 'contraindicated'
      ? [
          'high-grade-av-block',
          'severe-bradycardia',
          'cardiogenic-shock',
          'bronchial-asthma',
          'drug-hypersensitivity',
          'other',
        ]
      : [
          'acute-decompensation',
          'bradycardia',
          'symptomatic-hypotension',
          'drug-intolerance',
          'patient-refused',
          'cost',
          'other',
        ]
  }
  if (moduleId === 'heart-failure-mra') {
    return decision === 'contraindicated'
      ? [
          'mra-hyperkalemia',
          'mra-renal-threshold',
          'addison-disease',
          'duplicate-mra',
          'drug-hypersensitivity',
          'other',
        ]
      : [
          'symptomatic-hypotension',
          'worsening-renal-function',
          'acute-illness-fasting-surgery',
          'drug-intolerance',
          'patient-refused',
          'cost',
          'other',
        ]
  }
  if (moduleId === 'heart-failure-congestion-diuretic') {
    return decision === 'contraindicated'
      ? ['anuria', 'drug-hypersensitivity', 'other']
      : [
          'no-congestion',
          'volume-depletion',
          'electrolyte-depletion',
          'worsening-renal-function',
          'drug-intolerance',
          'patient-refused',
          'other',
        ]
  }
  if (moduleId === 'heart-failure-sglt2') {
    return decision === 'contraindicated'
      ? ['drug-hypersensitivity', 'other']
      : [
          'volume-depletion',
          'ketoacidosis',
          'acute-illness-fasting-surgery',
          'low-egfr-initiation',
          'drug-intolerance',
          'patient-refused',
          'cost',
          'other',
        ]
  }
  return decisionKind === 'medication'
    ? (decision === 'contraindicated'
        ? ['drug-hypersensitivity', 'other']
        : ['drug-intolerance', 'patient-refused', 'cost', 'other'])
    : ['patient-refused', 'cost', 'other']
}

export function decisionReasonLabel(id: string, isEnglish: boolean): string {
  const reason = DECISION_REASONS.find((item) => item.id === id)
  if (!reason) return id
  return isEnglish ? reason.en : reason.zh
}

/**
 * The four lines a clinician pastes into the note: what the phenotype is, what
 * was judged in the room, what was measured, and what was decided.
 *
 * Plain text on purpose — it is going into a chart field, not a document — and
 * every clinical phrase in it is one the screen already showed.
 */
function buildVisitSummaryText(input: {
  chartLayout?: boolean
  board: HeartFailureBoardModel
  isEnglish: boolean
  now: Date
  phenotypeTitle?: string
  suspicionAnswerText?: string
  suspicionModifiedAt?: string
  nyhaText: string
  symptomsText: string
  signsText: string
  hfpEfText?: string
  compensationText: string
  vitalsText?: string
  decidableRows: readonly VisitActionRow[]
  decidedCount: number
  followUpNote?: string
}): string {
  const {
    board, isEnglish, now, phenotypeTitle, suspicionAnswerText, suspicionModifiedAt,
    nyhaText, symptomsText, signsText, hfpEfText, compensationText, vitalsText,
    decidableRows, decidedCount, followUpNote,
  } = input
  const recordedStamp = suspicionModifiedAt ? zonedParts(suspicionModifiedAt) : undefined
  const suspicionStamp = input.chartLayout
    ? (recordedStamp ? `${recordedStamp.date}${suspicionModifiedAt!.length > 10 ? ` ${recordedStamp.time}` : ''}` : undefined)
    : formatStamp(suspicionModifiedAt, now, isEnglish)
  const lines: string[] = []

  lines.push([
    suspicionAnswerText
      ? `${isEnglish ? 'Heart-failure suspicion' : '懷疑心衰竭'}：${suspicionAnswerText}${suspicionStamp ? `（${suspicionStamp}）` : ''}`
      : undefined,
    phenotypeTitle,
    board.lvef?.value
      ? `LVEF ${board.lvef.value}${board.lvef.date ? `（${formatDay(board.lvef.date)}）` : ''}`
      : undefined,
    hfpEfText,
  ].filter(Boolean).join(' · '))

  lines.push([
    `NYHA${isEnglish ? ': ' : '：'}${nyhaText}`,
    `${isEnglish ? 'Symptoms' : '症狀'}${isEnglish ? ': ' : '：'}${symptomsText}`,
    `${isEnglish ? 'Signs' : '徵象'}${isEnglish ? ': ' : '：'}${signsText}`,
    `${isEnglish ? 'Compensation' : '代償狀態'}${isEnglish ? ': ' : '：'}${compensationText}`,
  ].join(' · '))

  lines.push(vitalsText
    ? `${isEnglish ? 'Clinic measurements' : '門診量測'}：${vitalsText}`
    : `${isEnglish ? 'Clinic measurements' : '門診量測'}：${isEnglish ? 'none entered' : '未輸入'}`)

  const decided = decidableRows.flatMap((row) => {
    if (!row.decision) return []
    const safety = ['dose-adjusted', 'deferred'].includes(row.decision.decision)
      ? heartFailureMedicationSafetyAssessment(row.recommendation)
      : undefined
    const details = [
      safety ? (isEnglish ? safety.summaryReasonEn : safety.summaryReasonZh) : undefined,
      ...row.decision.reasons.map(reason => decisionReasonLabel(reason, isEnglish)),
      row.decision.note,
    ].filter((value): value is string => Boolean(value))
    return [`${row.moduleName}${input.chartLayout ? ': ' : ' '}${decisionLabel(row.decision.decision, isEnglish)}${details.length ? ` (${details.join('; ')})` : ''}${row.decisionSource === 'medication-record' ? (isEnglish ? ' (from current medication record)' : '（依目前用藥紀錄）') : ''}`]
  })
  const undecided = decidableRows.length - decidedCount
  lines.push([
    decided.length > 0
      ? `${isEnglish ? 'Decisions' : '處置'}：${decided.join(isEnglish ? '; ' : '、')}`
      : `${isEnglish ? 'Decisions' : '處置'}：${isEnglish ? 'none recorded' : '尚未記錄'}`,
    undecided > 0
      ? (isEnglish ? `${undecided} still undecided` : `其餘 ${undecided} 項待決定`)
      : undefined,
    followUpNote,
  ].filter(Boolean).join(isEnglish ? ' · ' : ' · '))

  if (input.chartLayout) {
    return [
      [
        'Assessment',
        suspicionAnswerText ? `Heart-failure suspicion: ${suspicionAnswerText}${suspicionStamp ? ` (${suspicionStamp})` : ''}` : undefined,
        phenotypeTitle,
        board.lvef?.value ? `LVEF ${board.lvef.value}${board.lvef.date ? ` (${formatDay(board.lvef.date)})` : ''}` : undefined,
        hfpEfText,
        `NYHA: ${nyhaText}`,
        `Compensation: ${compensationText}`,
      ].filter(Boolean).join('\n'),
      `Symptoms\n${symptomsText}`,
      `Signs\n${signsText}`,
      `Clinic measurements\n${vitalsText ? vitalsText.split(' · ').map(value => `  ${value}`).join('\n') : '  None entered'}`,
      ['Management', ...(decided.length ? decided.map(value => `- ${value}`) : ['- No decisions recorded']),
        ...(undecided > 0 ? [`- Pending decisions: ${undecided}`] : []),
      ].join('\n'),
    ].join('\n\n')
  }
  return lines.join('\n')
}
