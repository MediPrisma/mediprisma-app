/**
 * The host's own queue rules — kept here verbatim as they stood at master
 * 2674ae24, with the step-1 rules they read as they stood at edfbc1d9 —
 * against the pack's `visitQueueRows`, `queuedPointDps` and
 * `dependentDecisionKeys` that now replace them (owner decision 2026-09-30:
 * 決策狀態邏輯移到 pack, step 3).
 *
 * The inputs reach every branch, including the fallback no current scenario
 * exercises: the eleven scenario bundles on each page they open; the host's
 * hand-built fixture models, whose AF DP-07 has no `next` so its row walks on
 * to the dose; the P3 map rebuilt as a pack before `next` would build it; a
 * queue naming a number no point carries, and one two maps share. The records
 * are every primary, each action alone, every chain opened and chosen, the
 * fallback chain walked and decided, kinds that stop a chain, last visit's,
 * one whose dose moved, one whose action the pack withdrew, and module-keyed
 * records from another layout. Rows, the points they cover and the decisions
 * following each recorded key must be the same.
 */
import {
  dependentDecisionKeys,
  queuedPointDps,
  visitQueueRows,
  type DecisionPointView,
  type VisitAction,
  type VisitDecisionModel,
} from '@voho0000/personalized-care'
import type { PhysicianDecision, PhysicianDecisionMap } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { p1Model, p2Model, p3Model, p4Model, p5Model, p6Model, p7Model, p9Model } from './visit-model.fixtures'
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
  type QueueStep = { key: string; point: DecisionPointView; decision?: PointDecision; decides?: readonly string[] }
  type QueueRow = { key: string; steps: QueueStep[]; current?: QueueStep; safety: boolean }
  const pointSteps = (point: DecisionPointView, decisions: PhysicianDecisionMap | undefined, now: Date): QueueStep[] => {
    const first: QueueStep = { key: visitDecisionKey(point), point, decision: decisionFor(point, decisions, now) }
    const next = nextStepPoint(point)
    if (!next || first.decision?.action.id !== point.next?.afterActionId) return [first]
    const key = nextStepDecisionKey(point)
    return [first, { key, point: next, decision: decisionFor(next, decisions, now, key) }]
  }
  const pointsDecidedBy = (owner: DecisionPointView, points: readonly DecisionPointView[]) => (
    (owner.next?.decides ?? []).flatMap((dp) => points.filter((point) => point !== owner && point.dp === dp && point.source === owner.source))
  )
  const PROCEEDING_KINDS: ReadonlySet<PhysicianDecision['decision']> = new Set(['prescribed', 'dose-adjusted', 'ordered'])
  const nextWaitingPoint = (points: readonly DecisionPointView[], after: DecisionPointView, used: ReadonlySet<string>) => {
    const index = points.indexOf(after)
    return points.slice(index + 1).find((point) => (
      point.state === 'waiting'
      && point.group === after.group
      && point.source === after.source
      && point.actions.length > 0
      && !used.has(point.dp)
    ))
  }
  const buildQueueRows = (model: VisitDecisionModel, decisions: PhysicianDecisionMap | undefined, now: Date): QueueRow[] => {
    const byDp = new Map(model.points.map((point) => [point.dp, point]))
    const used = new Set<string>(model.queue)
    const rows: QueueRow[] = []
    for (const dp of model.queue) {
      const head = byDp.get(dp)
      if (!head) continue
      const steps: QueueStep[] = pointSteps(head, decisions, now)
      const decides = steps.length > 1 ? pointsDecidedBy(head, model.points).map((point) => point.dp) : []
      if (decides.length) steps[1] = { ...steps[1], decides }
      let last = steps[steps.length - 1]
      while (!head.next && last.decision && PROCEEDING_KINDS.has(last.decision.record.decision)) {
        const next = nextWaitingPoint(model.points, last.point, used)
        if (!next) break
        used.add(next.dp)
        last = { key: visitDecisionKey(next), point: next, decision: decisionFor(next, decisions, now) }
        steps.push(last)
      }
      rows.push({ key: visitDecisionKey(head), steps, current: steps.find((step) => !step.decision), safety: head.state === 'safety' })
    }
    return rows
  }
  const queuedPointDpsLegacy = (rows: readonly QueueRow[]): ReadonlySet<string> => new Set(rows.flatMap((row) => row.steps.flatMap((step) => [step.point.dp, ...(step.decides ?? [])])))
  const dependentDecisionKeysLegacy = (key: string, rows: readonly QueueRow[], decisions: PhysicianDecisionMap | undefined): string[] => {
    const dependents = new Set<string>()
    for (const row of rows) {
      const index = row.steps.findIndex((step) => step.key === key)
      if (index < 0) continue
      for (const step of row.steps.slice(index + 1)) dependents.add(step.key)
    }
    for (const stored of Object.keys(decisions ?? {})) {
      if (stored.startsWith(`${key}:`)) dependents.add(stored)
    }
    dependents.delete(key)
    return [...dependents].filter((dependent) => decisions?.[dependent])
  }
  return { visitDecisionKey, nextStepDecisionKey, recordLabelOf, buildQueueRows, queuedPointDps: queuedPointDpsLegacy, dependentDecisionKeys: dependentDecisionKeysLegacy }
})()

// ---------------------------------------------------------------- the maps

/** P3's AF map as a pack before `next` would build it: DP-07 walks on to DP-09's doses. */
function olderPack(model: VisitDecisionModel): VisitDecisionModel | undefined {
  const dp07 = model.points.find((point) => point.dp === 'DP-07' && point.next)
  if (!dp07) return undefined
  return {
    ...model,
    points: model.points.map((point): DecisionPointView => {
      if (point === dp07) return { ...point, next: undefined }
      if (point.dp === 'DP-08' && point.source === dp07.source) return { ...point, state: 'waiting', actions: [] }
      if (point.dp === 'DP-09' && point.source === dp07.source) return { ...point, state: 'waiting', group: dp07.group, actions: dp07.next!.actions }
      return point
    }),
  }
}

const SCENARIOS: { id: ScenarioId; page: 'hf' | 'af' }[] = [
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
  { id: 'p9-hfpef-af-dose', page: 'af' },
  { id: 'p10-improved-ef', page: 'hf' },
  { id: 'p11-af-dabigatran-renal', page: 'af' },
]

function maps(): { name: string; model: VisitDecisionModel }[] {
  const out: { name: string; model: VisitDecisionModel }[] = []
  for (const run of SCENARIOS) {
    const { model } = scenarioRun(run.id, { page: run.page })
    out.push({ name: `${run.id} ${run.page}`, model })
    const older = olderPack(model)
    if (older) out.push({ name: `${run.id} ${run.page}, older pack`, model: older })
  }
  const fixtures: [string, () => VisitDecisionModel][] = [
    ['fixture p1', p1Model], ['fixture p2', p2Model], ['fixture p3', () => p3Model()], ['fixture p3 symptoms', () => p3Model({ symptoms: 'yes' })],
    ['fixture p4', p4Model], ['fixture p5', p5Model], ['fixture p6', p6Model], ['fixture p7', p7Model], ['fixture p9', p9Model],
  ]
  for (const [name, build] of fixtures) out.push({ name, model: build() })
  // A queued number with no point, and one two maps share.
  const p3 = scenarioRun('p3-new-af', { page: 'af' }).model
  const dp07 = p3.points.find((point) => point.dp === 'DP-07')!
  out.push({ name: 'unknown queued number', model: { ...p3, queue: ['DP-99', ...p3.queue] } })
  out.push({ name: 'a number two maps share', model: { ...p3, points: [...p3.points, { ...dp07, source: 'hf', decisionId: 'hf-twin', next: undefined }] } })
  return out
}

// ---------------------------------------------------------------- the records

const TODAY = '2026-09-27T08:30:00+08:00'
const LAST_VISIT = '2026-06-26T10:00:00+08:00'

function recorded(action: VisitAction, extra: Partial<PhysicianDecision> = {}): PhysicianDecision {
  return { decision: action.decisionKind, reasons: [], recordedAt: TODAY, packVersion: 'parity', actionId: action.id, actionLabel: legacy.recordLabelOf(action), ...extra }
}

function decisionSets(model: VisitDecisionModel): PhysicianDecisionMap[] {
  const decided = model.points.filter((point) => point.actions.length > 0)
  const primary = (point: DecisionPointView) => point.actions.find((action) => action.primary) ?? point.actions[0]
  const key = legacy.visitDecisionKey
  const all = (extra: Partial<PhysicianDecision> = {}) => Object.fromEntries(decided.map((point) => [key(point), recorded(primary(point), extra)]))
  const sets: PhysicianDecisionMap[] = [
    {},
    all(),
    all({ recordedAt: LAST_VISIT }),
    all({ decision: 'deferred' }),
    all({ decision: 'ordered' }),
    all({ actionId: 'withdrawn-by-the-pack' }),
    Object.fromEntries(decided.map((point) => [key(point), recorded(primary(point), { actionLabel: `${legacy.recordLabelOf(primary(point))} 99 mg` })])),
    Object.fromEntries(decided.map((point) => [point.moduleIds[0] ?? point.dp, recorded(primary(point))])),
  ]
  for (const point of decided) {
    for (const action of point.actions) sets.push({ [key(point)]: recorded(action) })
    if (point.next) {
      const opener = point.actions.find((action) => action.id === point.next!.afterActionId)
      if (opener) {
        for (const choice of point.next.actions) {
          sets.push({ [key(point)]: recorded(opener), [legacy.nextStepDecisionKey(point)]: recorded(choice) })
        }
        sets.push({ [legacy.nextStepDecisionKey(point)]: recorded(point.next.actions[0]) })
      }
    }
  }
  // The fallback chain: each proceeding start with each waiting point's action decided too.
  const waiting = model.points.filter((point) => point.state === 'waiting' && point.actions.length > 0)
  for (const point of decided) {
    for (const action of point.actions) {
      for (const kind of ['prescribed', 'dose-adjusted', 'ordered', 'deferred', 'held'] as const) {
        const base = { [key(point)]: recorded(action, { decision: kind }) }
        sets.push(base)
        for (const next of waiting) {
          sets.push({ ...base, [key(next)]: recorded(next.actions[0], { decision: kind }) })
          sets.push({ ...base, [key(next)]: recorded(next.actions[0], { recordedAt: LAST_VISIT }) })
        }
      }
    }
  }
  return sets
}

// ---------------------------------------------------------------- what each says

type AnyRow = { key: string; steps: readonly { key: string; point: DecisionPointView; decision?: { key: string; action: VisitAction }; decides?: readonly string[] }[]; current?: { key: string }; safety: boolean }
const view = (rows: readonly AnyRow[]) => rows.map((row) => ({
  key: row.key,
  steps: row.steps.map((step) => ({ key: step.key, point: `${step.point.source}:${step.point.dp}`, headline: step.point.headline, decision: step.decision ? `${step.decision.key}=${step.decision.action.id}` : undefined, decides: step.decides })),
  current: row.current?.key,
  safety: row.safety,
}))

/** How many record sets and followed-from keys were compared, so a silent empty loop fails. */
const compared = { sets: 0, walked: 0, dependents: 0 }

describe('the pack builds today’s queue as the host did', () => {
  for (const { name, model } of maps()) {
    it(name, () => {
      for (const decisions of decisionSets(model)) {
        const was = legacy.buildQueueRows(model, decisions, SCENARIO_NOW)
        const now = visitQueueRows(model, decisions, SCENARIO_NOW)
        expect(view(now)).toEqual(view(was))
        expect([...queuedPointDps(now)]).toEqual([...legacy.queuedPointDps(was)])
        compared.sets += 1
        if (was.some((row) => !row.steps[0].point.next && row.steps.length > 1)) compared.walked += 1
        for (const recordedKey of Object.keys(decisions)) {
          expect(dependentDecisionKeys(recordedKey, now, decisions)).toEqual(legacy.dependentDecisionKeys(recordedKey, was, decisions))
          compared.dependents += 1
        }
      }
    })
  }

  it('compared many record sets, walked fallback chains among them, and the decisions following each key', () => {
    // At the time of writing: 2,179 record sets, 99 of them walking a
    // fallback chain, and 2,867 followed-from keys.
    expect(compared.sets).toBeGreaterThan(2000)
    expect(compared.walked).toBeGreaterThan(50)
    expect(compared.dependents).toBeGreaterThan(2500)
  })

  it('reaches the fallback: a row walks on to a waiting point in the older-pack maps', () => {
    const older = olderPack(scenarioRun('p3-new-af', { page: 'af' }).model)!
    const dp07 = older.points.find((point) => point.dp === 'DP-07')!
    const start = dp07.actions.find((action) => action.decisionKind === 'prescribed')!
    const rows = visitQueueRows(older, { [legacy.visitDecisionKey(dp07)]: recorded(start) }, SCENARIO_NOW)
    expect(rows.find((row) => row.steps[0].point === dp07)!.steps.map((step) => step.point.dp)).toEqual(['DP-07', 'DP-09'])
    const fixture = p3Model()
    const fixtureDp07 = fixture.points.find((point) => point.dp === 'DP-07')!
    expect(visitQueueRows(fixture, { [legacy.visitDecisionKey(fixtureDp07)]: recorded(fixtureDp07.actions[0], { decision: 'prescribed' }) }, SCENARIO_NOW)[0].steps.length).toBeGreaterThan(1)
  })
})
