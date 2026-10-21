/**
 * The host's own summary and plan — kept here verbatim as they stood at
 * master edfbc1d9 — against the pack's `visitSummaryText` and `visitPlan`
 * that now replace them (owner decision 2026-09-30: 決策狀態邏輯移到 pack,
 * step 2).
 *
 * Over the eleven scenario bundles on each page they open, in 繁中 and
 * English, with no answers, each ask answered, and many sets of recorded
 * decisions — each action alone with its recheck, every chain opened and
 * chosen, a recheck with an interval or a stored day count, last visit's —
 * the copied text and the plan must be the same, character for character.
 */
import {
  decisionPointSteps,
  pointsDecidedBy,
  visitPlan,
  visitSummaryText,
  type DecisionPointView,
  type VisitAction,
  type VisitAnswers,
  type VisitDecisionModel,
} from '@voho0000/personalized-care'
import type { PhysicianDecision, PhysicianDecisionMap } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { SCENARIO_NOW, scenarioRun, type ScenarioId } from './scenario-models'

// ---------------------------------------------------------------- the host's text, as it was

const legacy = (() => {
  // Its steps and its 「which points a step answers」 were the host's too; step 1
  // proved them equal to the pack's, which they read here.
  const pointSteps = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date) => decisionPointSteps(point, decisions, now)
  const effectiveAnswer = (ask: VisitDecisionModel['asks'][number], answers: VisitAnswers): { value?: string; prefilled: boolean } => {
    const given = answers[ask.id]
    if (given) return { value: given, prefilled: false }
    if (ask.prefill) return { value: ask.prefill.value, prefilled: true }
    return { prefilled: false }
  }
  const checkIntervalSuffix = (check: { interval?: string; withinDays?: number } | undefined, isEnglish: boolean): string => {
    const sep = isEnglish ? ', ' : '，'
    if (check?.interval) return isEnglish ? `${sep}within ${check.interval}` : `${sep}${check.interval}內`
    if (typeof check?.withinDays === 'number') return isEnglish ? `${sep}within ${check.withinDays} days` : `${sep}${check.withinDays} 天內`
    return ''
  }
  type PlanItem = { key: string; point: DecisionPointView; actionLabel: string; check: { text: string; interval?: string; withinDays?: number }; reopenWhen?: string }
  const buildVisitPlan = (model: VisitDecisionModel, decisions: PhysicianDecisionMap | undefined, now: Date) => {
    const items: PlanItem[] = []
    for (const point of model.points) {
      for (const step of pointSteps(point, decisions, now)) {
        const decision = step.decision
        const check = decision?.record.responseCheck
        if (!decision || !check) continue
        items.push({
          key: decision.key,
          point: step.point,
          actionLabel: decision.record.actionLabel ?? decision.action.label,
          check,
          ...(decision.record.reopenWhen ? { reopenWhen: decision.record.reopenWhen } : {}),
        })
      }
    }
    const timed = (item: PlanItem) => (item.check.interval || typeof item.check.withinDays === 'number' ? 0 : 1)
    items.sort((a, b) => timed(a) - timed(b))
    return { items, notes: (model.planNotes ?? []).map((note) => ({ text: note.text })) }
  }
  const buildVisitSummaryText = (input: { model: VisitDecisionModel; answers: VisitAnswers; decisions: PhysicianDecisionMap | undefined; now: Date; isEnglish: boolean }): string => {
    const { model, answers, decisions, now, isEnglish } = input
    const lines: string[] = [model.headline]
    const values = model.keyValues.map((item) => (
      `${item.label} ${item.value}${item.date ? `（${item.date}）` : ''}`
    ))
    if (values.length) lines.push(values.join(isEnglish ? '; ' : '；'))
    if (model.triggers.length) {
      lines.push(`${isEnglish ? 'Reassessment' : '重新評估'}：${model.triggers.map((trigger) => trigger.text).join(isEnglish ? '; ' : '；')}`)
    }
    const answered = model.asks.flatMap((ask) => {
      const { value, prefilled } = effectiveAnswer(ask, answers)
      const option = ask.options.find((candidate) => candidate.value === value)
      if (!option) return []
      return [`${ask.label}${isEnglish ? ': ' : '：'}${option.label}${prefilled && ask.prefill ? `（${ask.prefill.basis}）` : ''}`]
    })
    if (answered.length) lines.push(answered.join(isEnglish ? '; ' : '；'))
    const decided = model.points.flatMap((point) => pointSteps(point, decisions, now).flatMap((step, index) => {
      const decision = step.decision
      if (!decision) return []
      const check = decision.record.responseCheck
      const answeredPoints = index > 0 ? pointsDecidedBy(point, model.points) : []
      const name = answeredPoints.length
        ? `${answeredPoints.map((item) => item.dp).join('／')} ${answeredPoints.map((item) => item.label).join('／')}`
        : `${point.dp} ${point.label}`
      return [`- ${name}${isEnglish ? ': ' : '：'}${decision.record.actionLabel ?? decision.action.label}${
        check ? `（${isEnglish ? 'check' : '回應檢查'}：${check.text}${checkIntervalSuffix(check, isEnglish)}）` : ''
      }`]
    }))
    lines.push(isEnglish ? "Today's decisions:" : '今天的決定：')
    lines.push(...(decided.length ? decided : [isEnglish ? '- none recorded' : '- 尚未記錄']))
    const plan = buildVisitPlan(model, decisions, now)
    lines.push(...plan.notes.map((note) => note.text))
    return lines.join('\n')
  }
  return { buildVisitSummaryText, buildVisitPlan }
})()

// ---------------------------------------------------------------- what was recorded and answered

const TODAY = '2026-09-27T08:30:00+08:00'
const LAST_VISIT = '2026-06-26T10:00:00+08:00'
const key = (point: DecisionPointView) => (point.decisionId ? `visit:${point.decisionId}` : `visit:${point.source}:${point.dp}`)

function recorded(action: VisitAction, extra: Partial<PhysicianDecision> = {}): PhysicianDecision {
  return {
    decision: action.decisionKind,
    reasons: [],
    recordedAt: TODAY,
    packVersion: 'parity',
    actionId: action.id,
    actionLabel: action.recordLabel || action.label,
    ...(action.responseCheck ? { responseCheck: { ...action.responseCheck } } : {}),
    ...(action.reopenWhen ? { reopenWhen: action.reopenWhen } : {}),
    ...extra,
  }
}

function decisionSets(model: VisitDecisionModel): PhysicianDecisionMap[] {
  const decided = model.points.filter((point) => point.actions.length > 0)
  const primary = (point: DecisionPointView) => point.actions.find((action) => action.primary) ?? point.actions[0]
  const all = (extra: (point: DecisionPointView, index: number) => Partial<PhysicianDecision>) =>
    Object.fromEntries(decided.map((point, index) => [key(point), recorded(primary(point), extra(point, index))]))
  const sets: PhysicianDecisionMap[] = [
    {},
    all(() => ({})),
    all(() => ({ recordedAt: LAST_VISIT })),
    // Rechecks with and without an interval, and one stored as a day count, interleaved.
    all((point, index) => ({ responseCheck: index % 3 === 0 ? { text: 'K、Cr', interval: '1–2 週' } : index % 3 === 1 ? { text: 'Hb' } : { text: '體重', withinDays: 14 }, reopenWhen: index % 2 ? 'K 回到 <5.0 時重新開始' : undefined })),
  ]
  for (const point of decided) {
    for (const action of point.actions) sets.push({ [key(point)]: recorded(action) })
    if (!point.next) continue
    const opener = point.actions.find((action) => action.id === point.next!.afterActionId)
    if (!opener) continue
    for (const choice of point.next.actions) {
      sets.push({ [key(point)]: recorded(opener), [`${key(point)}:next`]: recorded(choice) })
    }
  }
  return sets
}

function answerSets(model: VisitDecisionModel): VisitAnswers[] {
  const sets: VisitAnswers[] = [{}]
  for (const ask of model.asks) {
    for (const option of ask.options) sets.push({ [ask.id]: option.value } as VisitAnswers)
  }
  sets.push(Object.fromEntries(model.asks.map((ask) => [ask.id, ask.options[0].value])) as VisitAnswers)
  return sets
}

const RUNS: { id: ScenarioId; page: 'hf' | 'af' }[] = [
  { id: 'p1-suspected-hfpef', page: 'hf' },
  { id: 'p2-new-hfref', page: 'hf' },
  { id: 'p3-new-af', page: 'af' },
  { id: 'p4-stable-optimised', page: 'hf' },
  { id: 'p5-titrating-af', page: 'hf' },
  { id: 'p5-titrating-af', page: 'af' },
  { id: 'p6-hyperkalaemia', page: 'hf' },
  { id: 'p7-worsening-congestion', page: 'hf' },
  { id: 'p8-post-discharge', page: 'hf' },
  { id: 'p9-hfpef-af-dose', page: 'hf' },
  { id: 'p10-improved-ef', page: 'hf' },
  { id: 'p11-af-dabigatran-renal', page: 'af' },
]

describe('the pack writes the summary and plan the host wrote', () => {
  for (const run of RUNS) {
    for (const isEnglish of [false, true]) {
      it(`${run.id} on the ${run.page.toUpperCase()} page (${isEnglish ? 'en' : 'zh-TW'})`, () => {
        const { model: built } = scenarioRun(run.id, { page: run.page })
        // A record prefill on the first ask, as a page with one would carry.
        const model: VisitDecisionModel = built.asks.length
          ? { ...built, asks: built.asks.map((ask, index) => (index === 0 ? { ...ask, prefill: { value: ask.options[0].value, basis: '紀錄' } } : ask)) }
          : built
        for (const answers of answerSets(model)) {
          for (const decisions of decisionSets(model)) {
            const input = { model, answers, decisions, now: SCENARIO_NOW, isEnglish }
            expect(visitSummaryText({ model, answers, recorded: decisions, now: SCENARIO_NOW, locale: isEnglish ? 'en' : 'zh-TW' })).toBe(legacy.buildVisitSummaryText(input))
          }
        }
        for (const decisions of decisionSets(model)) {
          const plan = visitPlan(model, decisions, SCENARIO_NOW)
          const was = legacy.buildVisitPlan(model, decisions, SCENARIO_NOW)
          expect(plan.notes).toEqual(was.notes)
          expect(plan.items.map((item) => ({ ...item, point: item.point.dp }))).toEqual(was.items.map((item) => ({ ...item, point: item.point.dp })))
        }
      })
    }
  }
})
