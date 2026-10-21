/**
 * Placement arithmetic for the visit decision map: how the queue rows advance
 * along a chain, what the plan lists and what the summary copies. Every
 * clinical word comes from the model; the only words written here are the
 * host's own chrome.
 *
 * What today's recorded decisions settle — which record still answers a
 * point, which step it reveals, which point another row's step decides, which
 * chain is still open — is the pack's (`settleVisitDecisions` and its parts,
 * personalized-care 2.12.0; owner decision 2026-09-30: 決策狀態邏輯移到 pack,
 * step 1). So are the summary the note copies and the plan's rechecks
 * (`visitSummaryText`, `visitPlan`; step 2), and today's queue rows — their
 * order, the chain each walks and what follows from a decision
 * (`visitQueueRows`, `queuedPointDps`, `dependentDecisionKeys`; step 3). The
 * host keeps its names for them so its callers and tests stand unchanged, and
 * reads the pack's rules through them.
 */
import {
  decisionPointSteps,
  dependentDecisionKeys as packDependentDecisionKeys,
  effectiveVisitAnswer,
  isSameLocalDay,
  nextStepDecisionKey,
  nextStepView,
  queuedPointDps as packQueuedPointDps,
  recheckIntervalText,
  recordLabelOf,
  settledDecisionFor,
  settleVisitDecisions,
  visitDecisionKey,
  visitPlan,
  visitQueueRows,
  visitSummaryText,
  type SettledDecisionPoint,
  type VisitDecisionSettlement,
  type VisitPlan,
  type VisitPlanItem,
  type VisitQueueRow,
  type VisitQueueStep,
} from '@voho0000/personalized-care'
import type {
  PhysicianDecision,
  PhysicianDecisionInput,
  PhysicianDecisionMap,
} from '../../stores/physician-decisions.store'
import type {
  CdssRecommendation,
  DecisionPointState,
  DecisionPointView,
  VisitAction,
  VisitAnswers,
  VisitBlock,
  VisitDecisionModel,
} from '../../types'

/**
 * The store key a decision point's decision lives under — the pack's
 * `decisionId`, so a question two pages show is one decision — and the key of
 * the step its decision reveals. The pack's own keys, unchanged from the ones
 * the host has always stored under.
 */
export { nextStepDecisionKey, visitDecisionKey }

/**
 * What a pack's `next` may add (personalized-care after 2.8.1, #47): the
 * points the step answers where they are not the row's own (AF DP-07's
 * DOAC choice answers DP-08 and DP-09), and whether its actions are equals
 * with none recommended (ESC names no preferred DOAC). Read defensively: an
 * older pack sends neither, and nothing changes.
 */
export interface NextStepExtras {
  decides?: readonly string[]
  unranked?: boolean
}

export function nextStepExtras(point: Pick<DecisionPointView, 'next'>): NextStepExtras {
  const next = point.next as (NextStepExtras & object) | undefined
  return {
    ...(next?.decides?.length ? { decides: next.decides } : {}),
    ...(next?.unranked ? { unranked: true } : {}),
  }
}

/** A step drawn from a point's `next`, carrying whether its actions are unranked. */
export type VisitStepPoint = DecisionPointView & { unranked?: boolean }

/** One criterion a decision turns on, with this patient's value; `met` absent is unknown. */
export interface DecisionCriterionView {
  label: string
  value?: string
  met?: boolean
}

/** The criteria for one option (ESC 2024 Table 11's for one DOAC). */
export interface DecisionCriteriaGroupView {
  title: string
  items: DecisionCriterionView[]
}

/**
 * The criteria a point's decision turns on, as the pack wrote them
 * (personalized-care after 2.10.0: each DOAC's Table 11 dose-reduction
 * criteria with the patient's value). Read defensively: an older pack sends
 * none, and anything malformed is dropped rather than drawn.
 */
export function criteriaOf(point: object | undefined): DecisionCriteriaGroupView[] {
  const raw = (point as { criteria?: unknown } | undefined)?.criteria
  if (!Array.isArray(raw)) return []
  return raw.flatMap((group): DecisionCriteriaGroupView[] => {
    if (!group || typeof group !== 'object') return []
    const { title, items } = group as { title?: unknown; items?: unknown }
    if (typeof title !== 'string' || !Array.isArray(items)) return []
    const criteria = items.flatMap((item): DecisionCriterionView[] => {
      if (!item || typeof item !== 'object') return []
      const { label, value, met } = item as { label?: unknown; value?: unknown; met?: unknown }
      if (typeof label !== 'string') return []
      return [{ label, ...(typeof value === 'string' ? { value } : {}), ...(typeof met === 'boolean' ? { met } : {}) }]
    })
    return criteria.length ? [{ title, items: criteria }] : []
  })
}

/** Whether a point's actions are equals, none of them the recommendation. */
export function isUnranked(point: DecisionPointView): boolean {
  return Boolean((point as VisitStepPoint).unranked)
}

/**
 * The step a point's `next` describes, as a point of its own: same decision
 * point, the pack's next question, reason, actions and criteria (the pack's
 * `nextStepView`).
 */
export function nextStepPoint(point: DecisionPointView): VisitStepPoint | undefined {
  return nextStepView(point)
}

/** The states that carry decision buttons. */
export const DECISION_STATES: ReadonlySet<DecisionPointState> = new Set(['safety', 'act', 'confirm'])

/** The states folded to the foot of a column until 「顯示全部」. */
export const ABSENT_STATES: ReadonlySet<DecisionPointState> = new Set(['not-applicable', 'not-included'])

export { isSameLocalDay, recordLabelOf }

/** What was decided today about one point, and which of its actions it was. */
export interface PointDecision {
  key: string
  record: PhysicianDecision
  action: VisitAction
}

/**
 * Today's decision on a point, when it still answers one of the point's
 * actions — the pack's `settledDecisionFor`: a record from another day is
 * last visit's; one whose action the pack no longer offers, or whose action
 * now names another dose (its numbers differ from the words kept), answered a
 * question that has since changed. A language switch is not a new decision.
 */
export function decisionFor(
  point: DecisionPointView,
  decisions: PhysicianDecisionMap | undefined,
  now: Date,
  key: string = visitDecisionKey(point),
): PointDecision | undefined {
  return settledDecisionFor(point, decisions, now, key)
}

/**
 * The recorded decisions that followed from the one under `key` — the later
 * steps of any queue row it heads or walks through, and the steps stored under
 * `key:…` — which go with it when it is taken back or decided anew (#166
 * review). The pack's `dependentDecisionKeys`.
 */
export function dependentDecisionKeys(
  key: string,
  rows: readonly QueueRow[],
  decisions: PhysicianDecisionMap | undefined,
): string[] {
  return packDependentDecisionKeys(key, rows, decisions)
}

/** What recording `action` on `point` writes to the decisions store. */
export function decisionInputFor(
  point: DecisionPointView,
  action: VisitAction,
  packVersion: string,
): PhysicianDecisionInput {
  return {
    decision: action.decisionKind,
    packVersion,
    dp: point.dp,
    actionId: action.id,
    actionLabel: recordLabelOf(action),
    ...(action.responseCheck ? { responseCheck: { ...action.responseCheck } } : {}),
    ...(action.reopenWhen ? { reopenWhen: action.reopenWhen } : {}),
  }
}

/** One step of a queue row, and the points of the page it answers besides its own (the pack's). */
export type QueueStep = VisitQueueStep<PhysicianDecision>

/**
 * A point's steps as far as today's decisions reach: the point itself, then —
 * when the pack described one and the action that reveals it was recorded —
 * its next step (the pack's `decisionPointSteps`).
 */
export function pointSteps(
  point: DecisionPointView,
  decisions: PhysicianDecisionMap | undefined,
  now: Date,
): QueueStep[] {
  return decisionPointSteps(point, decisions, now)
}

/** Everything today's decisions settle on the map, point by point, from the pack. */
export type VisitSettlement = VisitDecisionSettlement<PhysicianDecision>
export type SettledPoint = SettledDecisionPoint<PhysicianDecision>

export function settleDecisions(
  model: Pick<VisitDecisionModel, 'points'>,
  decisions: PhysicianDecisionMap | undefined,
  now: Date,
): VisitSettlement {
  return settleVisitDecisions(model, decisions, now)
}

/**
 * A point's entry in a settlement: by the point itself, or — for a copy the
 * page drew from it — by its map and number.
 */
export function settledPointOf(settlement: VisitSettlement, point: Pick<DecisionPointView, 'source' | 'dp'>): SettledPoint | undefined {
  return settlement.points.find((item) => item.point === point)
    ?? settlement.points.find((item) => item.point.dp === point.dp && item.point.source === point.source)
}

/** One record value a decision reads, as its row prints it. */
export interface DecisionBasisItem {
  label: string
  value: string
  /** The value's date, as the page prints dates (「09-20」). */
  date?: string
}

const TRAILING_DATE = /\s*[（(](\d{4}-\d{2}-\d{2})[）)]$/

/**
 * What a decision reads from this patient's record, for its row: the
 * 「本病人依據」 of the modules behind the point — 年齡 80 歲, 體重 58 kg,
 * Cr 1.3 mg/dL — each with its date, in the pack's own words and order.
 * The same values sit folded inside the module's card; a decision row shows
 * them so the choice is made with them in view (owner feedback 2026-09-29:
 * 「空白空間還那麼多…而不是 user 要自己點開」). Values whose fact the page
 * already heads with (`skip`: LVEF) are left out; one value named by two
 * modules is shown once.
 */
export function decisionBasis(
  point: Pick<DecisionPointView, 'moduleIds'>,
  modules: ReadonlyMap<string, CdssRecommendation>,
  skip: ReadonlySet<string>,
  formatDate: (date: string) => string | undefined,
): DecisionBasisItem[] {
  const items: DecisionBasisItem[] = []
  const seen = new Set<string>()
  for (const id of point.moduleIds) {
    for (const evidence of modules.get(id)?.patientEvidence ?? []) {
      if (evidence.factKeys.length > 0 && evidence.factKeys.every((key) => skip.has(key))) continue
      const match = TRAILING_DATE.exec(evidence.value)
      const value = match ? evidence.value.slice(0, match.index) : evidence.value
      const seenKey = `${evidence.label}|${value}`
      if (!value.trim() || seen.has(seenKey)) continue
      seen.add(seenKey)
      const date = match ? formatDate(match[1]) : undefined
      items.push({ label: evidence.label, value, ...(date ? { date } : {}) })
    }
  }
  return items
}

/** A queue row: the chain it walks, its first undecided step, whether it is a safety row (the pack's). */
export type QueueRow = VisitQueueRow<PhysicianDecision>

/**
 * Today's queue, one row per queued point, in the model's order — a revealed
 * step answering the points it decides on the same map, and, for a pack that
 * describes no `next`, the row walking on to its chain's next waiting point
 * after a decision that carries the chain on. The pack's `visitQueueRows`.
 */
export function buildQueueRows(
  model: VisitDecisionModel,
  decisions: PhysicianDecisionMap | undefined,
  now: Date,
): QueueRow[] {
  return visitQueueRows(model, decisions, now)
}

/** The decision points the queue rows currently cover, by dp (the pack's `queuedPointDps`). */
export function queuedPointDps(rows: readonly QueueRow[]): ReadonlySet<string> {
  return packQueuedPointDps(rows)
}

/** One recheck a decision recorded today asked for (the pack's). */
export type PlanItem = VisitPlanItem
export type VisitPlanModel = VisitPlan

/**
 * Every decision recorded today that asked for a recheck, those with an
 * interval first, and the model's plan lines — the pack's `visitPlan`. A
 * recheck is not a return visit, so no return date is derived from one.
 */
export function buildVisitPlan(
  model: VisitDecisionModel,
  decisions: PhysicianDecisionMap | undefined,
  now: Date,
): VisitPlanModel {
  return visitPlan(model, decisions, now)
}

/** The answer each ask shows, and whether the record, not the clinician, gave it (the pack's). */
export function effectiveAnswer(
  ask: VisitDecisionModel['asks'][number],
  answers: VisitAnswers,
): { value?: string; prefilled: boolean } {
  return effectiveVisitAnswer(ask, answers)
}

export const BLOCK_ORDER: readonly VisitBlock[] = ['status', 'treatment', 'outlook']

/** The tag a point from another pack's map wears here (「AF」 on the HF map), as the pack names it. */
export function sourceTag(point: DecisionPointView): string {
  return point.sourceLabel ?? point.source.toUpperCase()
}

export function blockTitle(block: VisitBlock, isEnglish: boolean): string {
  switch (block) {
    case 'status': return isEnglish ? '01 Status · diagnosis / follow-up' : '01 現況 · 診斷／追蹤'
    case 'treatment': return isEnglish ? '02 Treatment' : '02 治療'
    case 'outlook': return isEnglish ? '03 Outlook and plan' : '03 預後與計畫'
  }
}

/** The state names a map cell prints beside its colour, so state never rests on colour. */
export function stateLabel(state: DecisionPointState, isEnglish: boolean): string {
  switch (state) {
    case 'safety': return isEnglish ? 'Safety' : '安全'
    case 'act': return isEnglish ? 'To decide' : '需處理'
    case 'confirm': return isEnglish ? 'Your call' : '需你確認'
    case 'ask': return isEnglish ? 'To answer' : '等你回答'
    case 'waiting': return isEnglish ? 'Waiting' : '等上一步'
    case 'done': return isEnglish ? 'Settled' : '已定'
    case 'info': return isEnglish ? 'Info' : '供參考'
    case 'not-applicable': return isEnglish ? 'N/A' : '不適用'
    case 'not-included': return isEnglish ? 'Not covered' : '尚未納入'
  }
}

/** 「，1–2 週內」 after a check's text, in the guideline's words, or nothing (the pack's). */
export function checkIntervalSuffix(check: { interval?: string; withinDays?: number } | undefined, isEnglish: boolean): string {
  return recheckIntervalText(check, isEnglish ? 'en' : 'zh-TW')
}

/**
 * The text 「複製本次摘要」 puts on the clipboard — the pack's
 * `visitSummaryText`: the status and values, the answers in the options'
 * words, today's decisions with their rechecks, and the plan lines.
 */
export function buildVisitSummaryText(input: {
  model: VisitDecisionModel
  answers: VisitAnswers
  decisions: PhysicianDecisionMap | undefined
  now: Date
  isEnglish: boolean
}): string {
  const { model, answers, decisions, now, isEnglish } = input
  return visitSummaryText({ model, answers, recorded: decisions, now, locale: isEnglish ? 'en' : 'zh-TW' })
}

/**
 * The FMT pillars whose 「不耐受」 the clinician recorded on the map, as DP
 * numbers (`DP-08`). The pack's action ids name them — `dp08-intolerant`, and
 * `dp07-arni-intolerant` for the ARNI — so nothing here reads the label.
 */
export function intolerantPillars(decisions: Readonly<Record<string, { actionId?: string; decision?: string }>>): string[] {
  const dps = new Set<string>()
  for (const decision of Object.values(decisions)) {
    const match = /^dp(07|08|09|10)-(?:arni-)?intolerant$/.exec(decision.actionId ?? '')
    if (match) dps.add(`DP-${match[1]}`)
  }
  return [...dps].sort()
}
