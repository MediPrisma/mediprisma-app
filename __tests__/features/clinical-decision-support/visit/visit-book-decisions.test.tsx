/**
 * What 決策地圖 v2 records, drawn by the real pack for the scenario bundles:
 * the logic behind the buttons that the first decision map's tests used to
 * carry (retired 2026-10-01) — a chain walked again rather than restored, a
 * deferral that ends a chain, the decision timing, an action's structured
 * answer handed back, the pack's decided headline, another day's record, and
 * the points a DOAC choice settles. Same harness as the layout's tests.
 */
import { useMemo, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { VisitDecisionScreen } from '@/features/clinical-decision-support/renderers/visit/VisitDecisionScreen'
import { nextStepDecisionKey, visitDecisionKey } from '@/features/clinical-decision-support/renderers/visit/visit-decisions'
import type { VisitDecisionModel } from '@/features/clinical-decision-support/types'
import { getPhysicianDecisions, usePhysicianDecisions, usePhysicianDecisionsStore } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useVisitAnswerRecord, useVisitAnswersStore, visitAnswersOf } from '@/features/clinical-decision-support/stores/visit-answers.store'
import { useAfAnswers, useAfAnswersStore } from '@/features/clinical-decision-support/stores/af-answers.store'
import type { PhenotypeAnswer } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import { useClinicVitals, useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { getCdssDecisionTimings, useCdssDecisionTimingStore } from '@/features/clinical-decision-support/stores/cdss-decision-timing.store'
import { scenarioRun, type ScenarioId } from './scenario-models'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webStreams = require('node:stream/web')
for (const name of ['TransformStream', 'ReadableStream', 'WritableStream'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = webStreams[name]
  }
}

const PATIENT = 'book-decisions-patient'

/** The page in the CDSS panel, as `visit-book-layout`'s harness draws it. */
function BookPage({ id, page, patch }: { id: ScenarioId; page: 'hf' | 'af'; patch?: (model: VisitDecisionModel) => VisitDecisionModel }) {
  const decisions = usePhysicianDecisions(PATIENT)
  const record = useVisitAnswerRecord(PATIENT)
  const answers = useMemo(() => visitAnswersOf(record), [record])
  const afAnswers = useAfAnswers(PATIENT)
  const [phenotype, setPhenotype] = useState<PhenotypeAnswer>()
  const clinicVitals = useClinicVitals(PATIENT)
  const run = useMemo(() => scenarioRun(id, { page, answers, afAnswers, phenotype, clinicVitals }), [afAnswers, answers, clinicVitals, id, page, phenotype])
  return (
    <ClinicalDecisionSupportView
      result={run.result}
      locale="zh-TW"
      layout="map"
      patientId={PATIENT}
      visitModel={patch ? patch(run.model) : run.model}
      companionResults={run.companion ? [run.companion] : undefined}
      profileFacts={run.profile.facts}
      physicianDecisions={decisions}
      onRecordDecision={(key, input) => usePhysicianDecisionsStore.getState().recordDecision(PATIENT, key, input)}
      onClearDecision={(key) => usePhysicianDecisionsStore.getState().clearDecision(PATIENT, key)}
      visitAnswers={answers}
      onVisitAnswer={(ask, value) => useVisitAnswersStore.getState().answer(PATIENT, ask, value)}
      afAnswers={afAnswers}
      onAfAnswer={(questionId, value) => useAfAnswersStore.getState().answer(PATIENT, questionId, value)}
      phenotypeAnswer={phenotype}
      onAnswerPhenotype={setPhenotype}
      clinicVitals={clinicVitals}
      onSaveClinicVitals={(patch) => useClinicVitalsStore.getState().setVitals(PATIENT, patch)}
    />
  )
}

/** The screen alone, for what it hands back to the page around it. */
function Screen({ model, onPhysicianInput }: { model: VisitDecisionModel; onPhysicianInput: jest.Mock }) {
  const decisions = usePhysicianDecisions(PATIENT)
  const now = useMemo(() => new Date(), [])
  return (
    <VisitDecisionScreen
      model={model}
      isEnglish={false}
      now={now}
      packVersion="test-1"
      screenKey={`${PATIENT}:${model.packId}`}
      decisions={decisions}
      onRecordDecision={(key, input) => usePhysicianDecisionsStore.getState().recordDecision(PATIENT, key, input)}
      onClearDecision={(key) => usePhysicianDecisionsStore.getState().clearDecision(PATIENT, key)}
      answers={{}}
      modules={new Map()}
      onPhysicianInput={onPhysicianInput}
    />
  )
}

const entry = (dp: string) => document.querySelector<HTMLElement>(`[data-book-dp="${dp}"]`)!
const mapLine = (dp: string) => document.querySelector<HTMLElement>(`[data-book-map-dp="${dp}"]`)!
/** AF DP-07's decision box, where its chain is walked (要不要 → 用哪個／多少). */
const anticoagulation = () => document.querySelector<HTMLElement>('[data-book-box="DP-07"]')!
const primaryIn = (element: HTMLElement) => element.querySelector<HTMLButtonElement>('[data-visit-primary]')
const headline = () => document.getElementById('cdss-visit-headline')

/** A scenario's point, as the pack builds it on its own page. */
function pointOf(id: ScenarioId, page: 'hf' | 'af', dp: string) {
  const point = scenarioRun(id, { page }).model.points.find((item) => item.dp === dp && item.source === page)
  if (!point) throw new Error(`${id}: no ${page}:${dp}`)
  return point
}

/** The store key a scenario's point decides under. */
const keyOf = (id: ScenarioId, page: 'hf' | 'af', dp: string) => visitDecisionKey(pointOf(id, page, dp))

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  usePhysicianDecisionsStore.getState().clearDecisions(PATIENT)
  useAfAnswersStore.getState().clear(PATIENT)
  useVisitAnswersStore.getState().clearAnswers(PATIENT)
  useClinicVitalsStore.getState().clearVitals(PATIENT)
  useCdssDecisionTimingStore.getState().reset()
})

describe('決策地圖 v2 · a chain of steps (P3, AF page DP-07)', () => {
  // #166 review: 「開始抗凝 → apixaban」, then the first step changed and
  // 開始抗凝 pressed again, brought the old dose back as decided. A step
  // decided anew leaves the steps that followed from it without the decision
  // they answered: they go too (`dependentDecisionKeys`).
  it('walks the dose step again when its first step is decided anew, rather than restoring a dose left from before', () => {
    const whether = keyOf('p3-new-af', 'af', 'DP-07')
    const dose = nextStepDecisionKey(pointOf('p3-new-af', 'af', 'DP-07'))
    // The dose chosen under DP-07 before its first step was taken back.
    usePhysicianDecisionsStore.getState().recordDecision(PATIENT, dose, {
      decision: 'prescribed', packVersion: 'test-1', dp: 'DP-07', actionId: 'af-dp09-apixaban', actionLabel: 'apixaban 5 mg bid', responseCheck: { text: 'Hb、Cr' },
    })
    render(<BookPage id="p3-new-af" page="af" />)
    expect(primaryIn(anticoagulation())).toHaveTextContent('開始抗凝')
    fireEvent.click(primaryIn(anticoagulation())!)
    // 開始抗凝 again: the dose is asked again, not restored.
    expect(getPhysicianDecisions(PATIENT)[whether]).toMatchObject({ actionId: 'af-dp07-start' })
    expect(getPhysicianDecisions(PATIENT)[dose]).toBeUndefined()
    expect(within(anticoagulation()).queryByTestId('cdss-visit-decided')).toBeNull()
    expect(primaryIn(anticoagulation())).toHaveTextContent('apixaban 5 mg bid')
    expect(mapLine('DP-07')).toHaveAttribute('data-book-mark', 'act')
    // Chosen anew, it is recorded under the step's own key.
    fireEvent.click(primaryIn(anticoagulation())!)
    expect(getPhysicianDecisions(PATIENT)[dose]).toMatchObject({ actionId: 'af-dp09-apixaban' })
    expect(mapLine('DP-07')).toHaveAttribute('data-book-mark', 'done')
  })

  it('does not advance the chain on a deferral', () => {
    render(<BookPage id="p3-new-af" page="af" />)
    // Three alternatives or more fold behind 「其他」.
    fireEvent.click(within(anticoagulation()).getByRole('button', { name: '其他' }))
    fireEvent.click(within(anticoagulation()).getByRole('button', { name: '暫緩' }))
    expect(within(anticoagulation()).getByTestId('cdss-visit-decided')).toHaveTextContent('暫緩')
    expect(primaryIn(anticoagulation())).toBeNull()
    // The DOAC is not asked: nothing chosen, no table to choose it from.
    expect(within(anticoagulation()).queryByTestId('cdss-book-dose-table')).toBeNull()
    expect(Object.keys(getPhysicianDecisions(PATIENT))).toEqual([keyOf('p3-new-af', 'af', 'DP-07')])
    expect(mapLine('DP-07')).toHaveAttribute('data-book-mark', 'done')
  })

  // #196 review: a DOAC chosen at DP-07 is DP-08's agent and DP-09's dose (the
  // pack's `next.decides`), recorded once, under DP-07's key.
  it('settles DP-08／DP-09 with the DOAC chosen at DP-07, and 改 there opens them again', () => {
    const whether = keyOf('p3-new-af', 'af', 'DP-07')
    const dose = nextStepDecisionKey(pointOf('p3-new-af', 'af', 'DP-07'))
    render(<BookPage id="p3-new-af" page="af" />)
    fireEvent.click(primaryIn(anticoagulation())!)
    // The choice that decides DP-09 is open: DP-09 says it is decided there.
    expect(entry('DP-09')).toHaveTextContent('與 DP-07 需要抗凝嗎 一起決定')
    for (const dp of ['DP-08', 'DP-09']) expect(mapLine(dp)).not.toHaveAttribute('data-book-mark', 'done')
    fireEvent.click(within(anticoagulation()).getByRole('button', { name: 'rivaroxaban 15 mg qd' }))
    for (const dp of ['DP-08', 'DP-09']) expect(mapLine(dp)).toHaveAttribute('data-book-mark', 'done')
    // One choice, one record — DP-07's; none was written for DP-08 or DP-09.
    expect(Object.keys(getPhysicianDecisions(PATIENT)).sort()).toEqual([whether, dose])
    expect(screen.getByTestId('cdss-visit-plan')).toHaveTextContent('rivaroxaban 15 mg qd')
    // 改 on the choice clears it; DP-08／DP-09 are open again until chosen.
    fireEvent.click(within(anticoagulation()).getByRole('button', { name: '改 DP-07 的決定' }))
    expect(getPhysicianDecisions(PATIENT)[dose]).toBeUndefined()
    for (const dp of ['DP-08', 'DP-09']) expect(mapLine(dp)).not.toHaveAttribute('data-book-mark', 'done')
    // The first step stands; the choices are back in DP-07's box.
    expect(anticoagulation().querySelector('[data-visit-chain-done="DP-07"]')).toHaveTextContent('開始抗凝')
    fireEvent.click(within(anticoagulation()).getByRole('button', { name: 'edoxaban 30 mg qd' }))
    for (const dp of ['DP-08', 'DP-09']) expect(mapLine(dp)).toHaveAttribute('data-book-mark', 'done')
    expect(screen.getByTestId('cdss-visit-plan')).toHaveTextContent('edoxaban 30 mg qd')
  })
})

describe('決策地圖 v2 · what a decision records (P5)', () => {
  it('times each decision from the page appearing, in memory only — a queued point as the queue\'s, any other as the map\'s', () => {
    render(<BookPage id="p5-titrating-af" page="hf" />)
    // DP-07 is in the pack's queue; DP-08's dose is one to confirm.
    fireEvent.click(primaryIn(entry('DP-07'))!)
    fireEvent.click(primaryIn(entry('DP-08'))!)
    const timings = getCdssDecisionTimings()
    expect(timings).toHaveLength(2)
    expect(timings[0]).toMatchObject({ screen: `${PATIENT}:heart-failure-cdss`, decision: keyOf('p5-titrating-af', 'hf', 'DP-07'), surface: 'queue' })
    expect(timings[1]).toMatchObject({ screen: `${PATIENT}:heart-failure-cdss`, decision: keyOf('p5-titrating-af', 'hf', 'DP-08'), surface: 'map' })
    for (const timing of timings) expect(timing.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(Object.keys(localStorage).some((key) => key.includes('timing'))).toBe(false)
  })

  it('ignores a decision recorded on another day', () => {
    usePhysicianDecisionsStore.getState().recordDecision(PATIENT, keyOf('p5-titrating-af', 'hf', 'DP-07'), {
      decision: 'prescribed', packVersion: 'test-1', dp: 'DP-07', actionId: 'dp07-switch', actionLabel: '換 ARNI',
    }, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    render(<BookPage id="p5-titrating-af" page="hf" />)
    expect(within(entry('DP-07')).queryByTestId('cdss-visit-decided')).toBeNull()
    expect(primaryIn(entry('DP-07'))).toHaveTextContent('換 ARNI')
    expect(mapLine('DP-07')).toHaveAttribute('data-book-mark', 'act')
    expect(screen.getByTestId('cdss-visit-plan-empty')).toBeInTheDocument()
  })

  it('says the day is decided in the pack’s sentence once every decision row is recorded, with what still needs the clinician', () => {
    const decided = '今天的決定都記下了（pack）'
    render(<BookPage id="p5-titrating-af" page="hf" patch={(model) => ({ ...model, headlineWhenDecided: decided })} />)
    const before = headline()!.textContent
    for (const dp of ['DP-07', 'DP-09']) fireEvent.click(primaryIn(entry(dp))!)
    // A row still open: the pack's sentence for the patient stands.
    expect(headline()).toHaveTextContent(before!)
    expect(screen.queryByTestId('cdss-visit-decided-line')).toBeNull()
    fireEvent.click(primaryIn(entry('DP-10'))!)
    // The pack's words, then what still needs the clinician beyond the queue
    // (DP-08's dose, DP-12's iron screen, DP-16's devices).
    expect(screen.getByRole('heading', { level: 3, name: `${decided} · 還有 3 項需你確認` })).toBeInTheDocument()
    // Read on screen where the visit ends: at the foot of today's plan.
    expect(screen.getByTestId('cdss-book-end')).toContainElement(screen.getByTestId('cdss-visit-decided-line'))
    expect(screen.getByTestId('cdss-visit-decided-line')).toHaveTextContent(`${decided} · 還有 3 項需你確認`)
  })

  it('says it in the pack’s words alone once nothing else needs the clinician', () => {
    const decided = '今天的決定都記下了（pack）'
    render(<BookPage id="p5-titrating-af" page="hf" patch={(model) => ({
      ...model,
      queue: ['DP-10'],
      headlineWhenDecided: decided,
      points: model.points.map((point) => (point.dp === 'DP-10' || !['safety', 'act', 'confirm'].includes(point.state) ? point : { ...point, state: 'done' as const })),
    })} />)
    fireEvent.click(primaryIn(entry('DP-10'))!)
    expect(screen.getByRole('heading', { level: 3, name: decided })).toBeInTheDocument()
    expect(screen.getByTestId('cdss-visit-decided-line').textContent).toBe(decided)
  })
})

describe('決策地圖 v2 · an action that answers a question', () => {
  it('hands an action’s structured answer back when it is recorded (AF DP-01), as a class chosen in DP-01’s table (HF P1)', () => {
    const af = scenarioRun('p3-new-af', { page: 'af' }).model
    const answer = af.points.find((point) => point.dp === 'DP-01')!.actions.find((action) => action.id === 'af-dp01-flutter')!
    expect(answer.physicianInput).toBeDefined()
    const onAfInput = jest.fn()
    const { unmount } = render(<Screen model={af} onPhysicianInput={onAfInput} />)
    fireEvent.click(within(entry('DP-01')).getByRole('button', { name: 'AFL' }))
    expect(onAfInput).toHaveBeenCalledWith(answer.physicianInput)
    expect(getPhysicianDecisions(PATIENT)[keyOf('p3-new-af', 'af', 'DP-01')]).toMatchObject({ actionId: 'af-dp01-flutter' })
    unmount()

    const onHfInput = jest.fn()
    render(<Screen model={scenarioRun('p1-suspected-hfpef').model} onPhysicianInput={onHfInput} />)
    fireEvent.click(screen.getByTestId('cdss-book-class-hfpEF'))
    expect(onHfInput).toHaveBeenCalledWith(expect.objectContaining({ request: 'hf-suspicion', optionId: 'hfpef' }))
  })
})
