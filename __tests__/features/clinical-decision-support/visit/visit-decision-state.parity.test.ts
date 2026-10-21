/**
 * The host's own decision-state rules — kept here verbatim as they stood at
 * master edfbc1d9 — against the pack's `settleVisitDecisions` that now
 * replaces them (owner decision 2026-09-30: 決策狀態邏輯移到 pack, step 1).
 *
 * Over the eleven scenario bundles, built by the real pack on each page they
 * open, and many sets of recorded decisions — none, every point's primary,
 * each action alone, every chain revealed and chosen, last visit's, a label
 * whose numbers moved, a module-keyed record from another layout — the two
 * must say the same for every point: today's decision, its steps, the
 * furthest decided, the step on another row that decides it, the chain still
 * open, what it stands settled by, and how many were recorded today.
 */
import {
  decisionPointSteps,
  settledDecisionFor,
  settleVisitDecisions,
  type DecisionPointView,
  type VisitAction,
  type VisitDecisionModel,
} from '@voho0000/personalized-care'
import type { PhysicianDecision, PhysicianDecisionMap } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { SCENARIO_NOW, scenarioRun, type ScenarioId } from './scenario-models'

// ---------------------------------------------------------------- the host's rules, as they were

const legacy = (() => {
  const visitDecisionKey = (point: Pick<DecisionPointView, 'source' | 'dp' | 'decisionId'>) => (point.decisionId ? `visit:${point.decisionId}` : `visit:${point.source}:${point.dp}`)
  const nextStepDecisionKey = (point: Pick<DecisionPointView, 'source' | 'dp' | 'decisionId'>) => `${visitDecisionKey(point)}:next`
  const nextStepExtras = (point: Pick<DecisionPointView, 'next'>) => {
    const next = point.next as ({ decides?: readonly string[]; unranked?: boolean } & object) | undefined
    return { ...(next?.decides?.length ? { decides: next.decides } : {}), ...(next?.unranked ? { unranked: true } : {}) }
  }
  const nextStepPoint = (point: DecisionPointView): DecisionPointView | undefined => {
    if (!point.next) return undefined
    const { next } = point
    return { ...point, headline: next.headline, why: next.why, chain: next.chain, actions: next.actions, next: undefined, criteria: (next as { criteria?: DecisionPointView['criteria'] }).criteria, ...(nextStepExtras(point).unranked ? { unranked: true } : {}) } as DecisionPointView
  }
  const localDay = (value: Date) => `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`
  const isSameLocalDay = (iso: string, now: Date) => {
    const at = new Date(iso)
    return !Number.isNaN(at.getTime()) && localDay(at) === localDay(now)
  }
  const recordLabelOf = (action: VisitAction) => {
    const recordLabel = (action as VisitAction & { recordLabel?: unknown }).recordLabel
    return typeof recordLabel === 'string' && recordLabel ? recordLabel : action.label
  }
  const labelNumbers = (label: string) => (label.match(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*/g) ?? []).join(' ')
  type PointDecision = { key: string; record: PhysicianDecision; action: VisitAction }
  const decisionFor = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date, key: string = visitDecisionKey(point)): PointDecision | undefined => {
    const record = decisions?.[key]
    if (!record || !record.actionId || !isSameLocalDay(record.recordedAt, now)) return undefined
    const action = point.actions.find((candidate) => candidate.id === record.actionId)
    if (!action) return undefined
    const numbers = record.actionLabel === undefined ? undefined : labelNumbers(record.actionLabel)
    if (numbers !== undefined && numbers !== labelNumbers(recordLabelOf(action)) && numbers !== labelNumbers(action.label)) return undefined
    return { key, record, action }
  }
  type Step = { key: string; point: DecisionPointView; decision?: PointDecision }
  const pointSteps = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date): Step[] => {
    const first: Step = { key: visitDecisionKey(point), point, decision: decisionFor(point, decisions, now) }
    const next = nextStepPoint(point)
    if (!next || first.decision?.action.id !== point.next?.afterActionId) return [first]
    const key = nextStepDecisionKey(point)
    return [first, { key, point: next, decision: decisionFor(next, decisions, now, key) }]
  }
  const latestDecisionFor = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date) => (
    [...pointSteps(point, decisions, now)].reverse().find((step) => step.decision)?.decision
  )
  const decidingStep = (point: DecisionPointView, points: readonly DecisionPointView[], decisions: PhysicianDecisionMap | undefined, now: Date) => {
    for (const owner of points) {
      if (owner === point || owner.source !== point.source) continue
      if (!nextStepExtras(owner).decides?.includes(point.dp)) continue
      const step = pointSteps(owner, decisions, now)[1]
      if (step) return { owner, step }
    }
    return undefined
  }
  // VisitDecisionScreen's, as they were.
  const openStepOf = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date) => {
    const steps = pointSteps(point, decisions, now)
    const last = steps[steps.length - 1]
    return steps.length > 1 && !last.decision && steps[0].decision ? { recorded: steps[0].decision, step: last } : undefined
  }
  const decisionOf = (point: DecisionPointView, points: readonly DecisionPointView[], decisions: PhysicianDecisionMap | undefined, now: Date) => (
    openStepOf(point, decisions, now) ? undefined : latestDecisionFor(point, decisions, now) ?? decidingStep(point, points, decisions, now)?.step.decision
  )
  return { visitDecisionKey, nextStepDecisionKey, decisionFor, pointSteps, latestDecisionFor, decidingStep, openStepOf, decisionOf, recordLabelOf }
})()

// ---------------------------------------------------------------- the decisions recorded

const TODAY = '2026-09-27T08:30:00+08:00'
const LAST_VISIT = '2026-06-26T10:00:00+08:00'

function recorded(action: VisitAction, options: { at?: string; label?: string | null } = {}): PhysicianDecision {
  return {
    decision: action.decisionKind,
    reasons: [],
    recordedAt: options.at ?? TODAY,
    packVersion: 'parity',
    actionId: action.id,
    ...(options.label === null ? {} : { actionLabel: options.label ?? legacy.recordLabelOf(action) }),
  }
}

/** Sets of recorded decisions that walk every rule the two read. */
function decisionSets(model: VisitDecisionModel): { name: string; decisions: PhysicianDecisionMap }[] {
  const decided = model.points.filter((point) => point.actions.length > 0)
  const primary = (point: DecisionPointView) => point.actions.find((action) => action.primary) ?? point.actions[0]
  const all = (make: (point: DecisionPointView) => [string, PhysicianDecision][]) => Object.fromEntries(decided.flatMap(make))
  const sets: { name: string; decisions: PhysicianDecisionMap }[] = [
    { name: 'none', decisions: {} },
    { name: 'every primary', decisions: all((point) => [[legacy.visitDecisionKey(point), recorded(primary(point))]]) },
    { name: 'every primary, without words', decisions: all((point) => [[legacy.visitDecisionKey(point), recorded(primary(point), { label: null })]]) },
    { name: 'every primary, last visit', decisions: all((point) => [[legacy.visitDecisionKey(point), recorded(primary(point), { at: LAST_VISIT })]]) },
    { name: 'every primary, its numbers moved', decisions: all((point) => [[legacy.visitDecisionKey(point), recorded(primary(point), { label: `${legacy.recordLabelOf(primary(point))} 99 mg` })]]) },
    { name: 'a module-keyed record', decisions: Object.fromEntries(decided.map((point) => [point.moduleIds[0] ?? point.dp, recorded(primary(point))])) },
  ]
  for (const point of decided) {
    for (const action of point.actions) {
      sets.push({ name: `${point.source}:${point.dp} ${action.id}`, decisions: { [legacy.visitDecisionKey(point)]: recorded(action) } })
    }
    if (!point.next) continue
    const opener = point.actions.find((action) => action.id === point.next!.afterActionId)
    if (!opener) continue
    const revealed = { [legacy.visitDecisionKey(point)]: recorded(opener) }
    sets.push({ name: `${point.source}:${point.dp} opened`, decisions: revealed })
    for (const choice of point.next.actions) {
      sets.push({ name: `${point.source}:${point.dp} → ${choice.id}`, decisions: { ...revealed, [legacy.nextStepDecisionKey(point)]: recorded(choice) } })
    }
    // A choice kept while its opener was taken back.
    sets.push({ name: `${point.source}:${point.dp} choice alone`, decisions: { [legacy.nextStepDecisionKey(point)]: recorded(point.next.actions[0]) } })
  }
  return sets
}

// ---------------------------------------------------------------- what each says

const decisionView = (decision?: { key: string; action: VisitAction; record: PhysicianDecision }) => (
  decision ? { key: decision.key, action: decision.action.id, at: decision.record.recordedAt } : undefined
)
const stepView = (step?: { key: string; point: DecisionPointView; decision?: { key: string; action: VisitAction; record: PhysicianDecision } }) => (
  step ? { key: step.key, dp: step.point.dp, headline: step.point.headline, actions: step.point.actions.map((action) => action.id), decision: decisionView(step.decision) } : undefined
)

function legacyReading(model: VisitDecisionModel, decisions: PhysicianDecisionMap) {
  return {
    points: model.points.map((point) => {
      const deciding = legacy.decidingStep(point, model.points, decisions, SCENARIO_NOW)
      const open = legacy.openStepOf(point, decisions, SCENARIO_NOW)
      return {
        dp: `${point.source}:${point.dp}`,
        today: decisionView(legacy.decisionFor(point, decisions, SCENARIO_NOW)),
        steps: legacy.pointSteps(point, decisions, SCENARIO_NOW).map(stepView),
        latest: decisionView(legacy.latestDecisionFor(point, decisions, SCENARIO_NOW)),
        decidedBy: deciding ? { owner: `${deciding.owner.source}:${deciding.owner.dp}`, step: stepView(deciding.step) } : undefined,
        open: open ? { recorded: decisionView(open.recorded), step: stepView(open.step) } : undefined,
        settled: decisionView(legacy.decisionOf(point, model.points, decisions, SCENARIO_NOW)),
      }
    }),
    recordedToday: model.points.filter((point) => legacy.latestDecisionFor(point, decisions, SCENARIO_NOW)).length,
  }
}

function packReading(model: VisitDecisionModel, decisions: PhysicianDecisionMap) {
  const settlement = settleVisitDecisions(model, decisions, SCENARIO_NOW)
  return {
    points: settlement.points.map((item) => ({
      dp: `${item.point.source}:${item.point.dp}`,
      today: decisionView(settledDecisionFor(item.point, decisions, SCENARIO_NOW)),
      steps: decisionPointSteps(item.point, decisions, SCENARIO_NOW).map(stepView),
      latest: decisionView(item.latest),
      decidedBy: item.decidedBy ? { owner: `${item.decidedBy.owner.source}:${item.decidedBy.owner.dp}`, step: stepView(item.decidedBy.step) } : undefined,
      open: item.open ? { recorded: decisionView(item.open.recorded), step: stepView(item.open.step) } : undefined,
      settled: decisionView(item.settled),
    })),
    recordedToday: settlement.recordedToday,
  }
}

// ---------------------------------------------------------------- the runs

const RUNS: { id: ScenarioId; page: 'hf' | 'af'; firstVisit?: boolean }[] = [
  { id: 'p1-suspected-hfpef', page: 'hf' },
  { id: 'p2-new-hfref', page: 'hf' },
  { id: 'p3-new-af', page: 'af' },
  { id: 'p4-stable-optimised', page: 'hf' },
  { id: 'p4-stable-optimised', page: 'hf', firstVisit: true },
  { id: 'p5-titrating-af', page: 'hf' },
  { id: 'p5-titrating-af', page: 'af' },
  { id: 'p6-hyperkalaemia', page: 'hf' },
  { id: 'p7-worsening-congestion', page: 'hf' },
  { id: 'p8-post-discharge', page: 'hf' },
  { id: 'p9-hfpef-af-dose', page: 'hf' },
  { id: 'p9-hfpef-af-dose', page: 'af' },
  { id: 'p10-improved-ef', page: 'hf' },
  { id: 'p11-af-dabigatran-renal', page: 'af' },
]

describe('the pack settles today’s decisions as the host did', () => {
  for (const run of RUNS) {
    it(`${run.id} on the ${run.page.toUpperCase()} page${run.firstVisit ? ', first visit' : ''}`, () => {
      const { model } = scenarioRun(run.id, { page: run.page, ...(run.firstVisit ? { firstVisit: true } : {}) })
      const sets = decisionSets(model)
      expect(sets.length).toBeGreaterThan(6)
      for (const { name, decisions } of sets) {
        expect({ name, ...packReading(model, decisions) }).toEqual({ name, ...legacyReading(model, decisions) })
      }
    })
  }

  it('walks a revealed step on a page that has one, so the chain rules are exercised', () => {
    const { model } = scenarioRun('p3-new-af', { page: 'af' })
    const dp07 = model.points.find((point) => point.dp === 'DP-07' && point.next)!
    const opener = dp07.actions.find((action) => action.id === dp07.next!.afterActionId)!
    const decisions = {
      [legacy.visitDecisionKey(dp07)]: recorded(opener),
      [legacy.nextStepDecisionKey(dp07)]: recorded(dp07.next!.actions[1]),
    }
    const reading = packReading(model, decisions)
    expect(reading.points.filter((point) => point.decidedBy).map((point) => point.dp)).toEqual(['af:DP-08', 'af:DP-09'])
    expect(reading).toEqual(legacyReading(model, decisions))
  })
})
