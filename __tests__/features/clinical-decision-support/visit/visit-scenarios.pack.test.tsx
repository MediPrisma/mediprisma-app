/**
 * The decision map built by the real pack for the eleven scenario bundles.
 *
 * Each bundle goes through the app's own import parser, the FHIR adapter, the
 * host's AF calculators and the pack's `applyVisitAnswers` /
 * `buildVisitDecisionModel` (see `scenario-models`), and the map is drawn by
 * the real view — 決策地圖 v2, the pocket-handbook page, since the first
 * decision map was retired (owner, 2026-10-01). What the three sections keep
 * that v2 does not ask (the AF question groups, the HF follow-up block) is
 * checked there, with `layout="sections"`. The assertions are brief §7's,
 * with the deviation the pack's author accepted:
 *
 * - R2 reads the previous weight up to 120 days back, not 90 (P4's basis is a
 *   06-20 weight).
 *
 * Words are the pack's, so the assertions quote the pack; the host's own words
 * are chrome. Which points are today's decisions is the pack's call too: its
 * queue is read off the model the page drew (`drawn`), the page's marks off
 * the map.
 */
import { useEffect, useMemo } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { intolerantPillars } from '@/features/clinical-decision-support/renderers/visit/visit-decisions'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import type { VisitAnswers, VisitDecisionModel } from '@/features/clinical-decision-support/types'
import { usePhysicianDecisions, usePhysicianDecisionsStore } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useVisitAnswerRecord, useVisitAnswersStore, visitAnswersOf } from '@/features/clinical-decision-support/stores/visit-answers.store'
import { buildClinicVitals, mergeClinicVitals, useClinicVitals, useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { usePhenotypeAnswer, usePhenotypeAnswerStore } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import { useAfAnswers, useAfAnswersStore } from '@/features/clinical-decision-support/stores/af-answers.store'
import { atScenarioDay, DP06_EXAM_TERMS, examToday, scenarioRun, type ScenarioId } from './scenario-models'

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

const PATIENT = 'scenario-patient'

/** The model the page last drew, as the pack rebuilt it from every answer given on it. */
let drawn: VisitDecisionModel | undefined

/** The map for a scenario, rebuilt by the pack from every answer given on it. */
function ScenarioMap({ id, page = 'hf', layout = 'map', firstVisit = false }: { id: ScenarioId; page?: 'hf' | 'af'; layout?: 'map' | 'sections'; firstVisit?: boolean }) {
  const decisions = usePhysicianDecisions(PATIENT)
  const record = useVisitAnswerRecord(PATIENT)
  const answers = useMemo(() => visitAnswersOf(record), [record])
  const phenotype = usePhenotypeAnswer(PATIENT)
  const intolerant = useMemo(() => intolerantPillars(decisions), [decisions])
  const afAnswers = useAfAnswers(PATIENT)
  // The signs examined in the room reach the pack as LiveFeature hands them.
  const clinicVitals = useClinicVitals(PATIENT)
  const run = useMemo(() => scenarioRun(id, { page, answers, phenotype, intolerant, firstVisit, afAnswers, clinicVitals }), [afAnswers, answers, clinicVitals, firstVisit, id, intolerant, page, phenotype])
  useEffect(() => {
    drawn = run.model
  }, [run])
  return (
    <ClinicalDecisionSupportView
      result={run.result}
      locale="zh-TW"
      layout={layout}
      patientId={PATIENT}
      visitModel={run.model}
      companionResults={run.companion ? [run.companion] : undefined}
      profileFacts={run.profile.facts}
      physicianDecisions={decisions}
      onRecordDecision={(key, input) => usePhysicianDecisionsStore.getState().recordDecision(PATIENT, key, input)}
      onClearDecision={(key) => usePhysicianDecisionsStore.getState().clearDecision(PATIENT, key)}
      visitAnswers={answers}
      onVisitAnswer={(ask, value) => useVisitAnswersStore.getState().answer(PATIENT, ask, value)}
      clinicVitals={clinicVitals}
      onSaveClinicVitals={(patch) => useClinicVitalsStore.getState().setVitals(PATIENT, patch)}
      phenotypeAnswer={phenotype}
      onAnswerPhenotype={(answer) => usePhenotypeAnswerStore.getState().setAnswer(PATIENT, answer)}
      afAnswers={afAnswers}
      onAfAnswer={(questionId, value) => useAfAnswersStore.getState().answer(PATIENT, questionId, value)}
    />
  )
}

/** Today's decisions as the pack queued them on the page last drawn. */
const queued = (): readonly string[] => drawn?.queue ?? []

/** A point of the page last drawn, as the pack graded it. */
function drawnPoint(dp: string) {
  const found = drawn?.points.find((item) => item.dp === dp)
  if (!found) throw new Error(`the page drew no ${dp}`)
  return found
}

/** A point's entry on the page: its row, line, block or table. */
function entry(dp: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-book-dp="${dp}"]`)
  if (!found) throw new Error(`no entry ${dp}`)
  return found
}

/** Where a point is decided: its box under a block (AF 抗凝, DP-06), else its entry. */
const decision = (dp: string): HTMLElement => document.querySelector<HTMLElement>(`[data-book-box="${dp}"]`) ?? entry(dp)

/** Where the map says a point stands today: act, safety, ask, wait, done, info or absent. */
function mapMark(dp: string): string | undefined {
  const line = document.querySelector<HTMLElement>(`[data-book-map-dp="${dp}"]`)
  if (!line) throw new Error(`no map line ${dp}`)
  return line.dataset.bookMark
}

/** A point's recommended button, wherever it is decided. */
function primaryOf(dp: string): HTMLButtonElement {
  const found = decision(dp).querySelector<HTMLButtonElement>('[data-visit-primary]')
  if (!found) throw new Error(`no primary button on ${dp}`)
  return found
}

/** One answer of an every-visit ask (DP-03). */
function askOption(ask: string, value: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-book-ask="${ask}"] [data-book-ask-option="${value}"]`)
  if (!found) throw new Error(`no answer ${ask}=${value}`)
  return found
}

/** The one table of a chapter (the medicines table, as the prototype draws it). */
function chapterTable(chapter: string): HTMLElement {
  const tables = document.querySelectorAll<HTMLElement>(`[data-book-section="${chapter}"] [role="group"]`)
  expect(tables).toHaveLength(1)
  return tables[0]!
}

const headline = () => document.getElementById('cdss-visit-headline')

function point(id: ScenarioId, dp: string, options: { page?: 'hf' | 'af'; answers?: VisitAnswers; source?: 'hf' | 'af'; clinicVitals?: ReturnType<typeof examToday>; now?: Date } = {}) {
  const { model } = scenarioRun(id, options)
  const found = model.points.find((item) => item.dp === dp && (!options.source || item.source === options.source))
  if (!found) throw new Error(`${id}: no ${dp}`)
  return found
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn()
  localStorage.clear()
  drawn = undefined
  usePhysicianDecisionsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useClinicVitalsStore.setState({ byPatientId: {} })
  usePhenotypeAnswerStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useAfAnswersStore.setState({ patientId: undefined, answers: {}, hydratedPatientId: undefined })
})

describe('real pack · P3 new AF (AF page)', () => {
  it('leads a first visit with the coded AF to confirm, as the HF page does', () => {
    render(<ScenarioMap id="p3-new-af" page="af" />)
    expect(queued()).toContain('DP-01')
    expect(mapMark('DP-01')).toBe('act')
    expect(primaryOf('DP-01')).toHaveTextContent('AF')
    // The diagnosis first, the every-visit questions after it, on one page.
    expect(entry('DP-01').compareDocumentPosition(screen.getByTestId('cdss-book-asks')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A question, not a recommendation: the answers alike, side by side.
    const controls = within(entry('DP-01')).getByTestId('cdss-visit-controls')
    expect(controls).toHaveAttribute('data-visit-question')
    expect([...controls.querySelectorAll('[data-visit-action]')].map((button) => button.textContent)).toEqual(['AF', 'AFL', '都有'])
    fireEvent.click(primaryOf('DP-01'))
    expect(useAfAnswersStore.getState().answers).toMatchObject({ diagnosisConfirmed: true, atrialFibrillation: true, atrialFlutter: false })
    expect(queued()).not.toContain('DP-01')
    // The point carries today's answer, as every decided point does.
    expect(mapMark('DP-01')).toBe('done')
    expect(within(entry('DP-01')).getByTestId('cdss-visit-decided').querySelector('[data-visit-decided]')).toHaveAttribute('data-visit-decided', 'af-dp01-af')
    // The follow-up asks are right after it.
    expect(document.querySelector('[data-book-ask="af-symptoms"]')).not.toBeNull()
  })

  it('「都有」 names both, and the answer can be changed with 改', () => {
    render(<ScenarioMap id="p3-new-af" page="af" />)
    fireEvent.click(entry('DP-01').querySelector<HTMLButtonElement>('[data-visit-action="af-dp01-both"]')!)
    expect(useAfAnswersStore.getState().answers).toMatchObject({ diagnosisConfirmed: true, atrialFibrillation: true, atrialFlutter: true })
    expect(headline()).toHaveTextContent(/^AF＋AFL 首次評估/)
    expect(queued()).toContain('DP-07')
    expect(primaryOf('DP-07')).toHaveTextContent('開始抗凝')
    // On its own entry, DP-01 says what was recorded and lets it change.
    fireEvent.click(entry('DP-01').querySelector<HTMLButtonElement>('[data-visit-change="DP-01"]')!)
    fireEvent.click(entry('DP-01').querySelector<HTMLButtonElement>('[data-visit-action="af-dp01-af"]')!)
    expect(useAfAnswersStore.getState().answers).toMatchObject({ atrialFibrillation: true, atrialFlutter: false })
    expect(headline()).toHaveTextContent(/^AF 首次評估/)
  })

  it('「AFL」 keeps the anticoagulation row and leaves AF\'s rate and rhythm rules out', () => {
    render(<ScenarioMap id="p3-new-af" page="af" />)
    fireEvent.click(entry('DP-01').querySelector<HTMLButtonElement>('[data-visit-action="af-dp01-flutter"]')!)
    expect(useAfAnswersStore.getState().answers).toMatchObject({ diagnosisConfirmed: true, atrialFibrillation: false, atrialFlutter: true })
    expect(headline()).toHaveTextContent(/^AFL 首次評估/)
    expect(queued()).toContain('DP-07')
    expect(mapMark('DP-07')).toBe('act')
    expect(primaryOf('DP-07')).toHaveTextContent('開始抗凝')
    // In the map, muted, and said for what it is.
    expect(drawnPoint('DP-18').headline).toContain('AFL：本 pack 未納入')
    expect(mapMark('DP-18')).toBe('absent')
    expect(document.querySelector('[data-book-map-dp="DP-18"]')).toHaveTextContent('未納入')
  })

  it('asks symptoms and bleeding and walks the anticoagulation chain in one row', () => {
    render(<ScenarioMap id="p3-new-af" page="af" />)
    expect(document.querySelector('[data-book-ask="af-symptoms"]')).not.toBeNull()
    expect(document.querySelector('[data-book-ask="bleeding"]')).not.toBeNull()
    expect(queued()).toContain('DP-07')
    const chain = () => decision('DP-07')
    expect(primaryOf('DP-07')).toHaveTextContent('開始抗凝')
    fireEvent.click(primaryOf('DP-07'))
    // Still one row: the dose step in the same box, under the step it follows;
    // DP-09 asks nothing of its own.
    expect(chain().querySelector('[data-visit-chain-done="DP-07"]')).toHaveTextContent('開始抗凝')
    expect(entry('DP-09').querySelector('[data-visit-primary]')).toBeNull()
    expect(chain().querySelector('[data-visit-decided]')).toBeNull()
    expect(primaryOf('DP-07')).toHaveTextContent('apixaban 5 mg bid')
    // 減量條件 0/3: none of apixaban's three reduction criteria is met.
    const apixaban = within(within(chain()).getByTestId('cdss-book-dose-table')).getAllByRole('row').find((row) => row.textContent?.startsWith('apixaban'))!
    expect(apixaban).toHaveTextContent('✗ 年齡 ≥80（78 歲） · ✗ 體重 ≤60 kg（68 kg） · ✗ Cr ≥1.5 mg/dL（1.2 mg/dL）')
    expect(apixaban).not.toHaveTextContent('✓')
    fireEvent.click(primaryOf('DP-07'))
    expect(within(chain()).getByTestId('cdss-visit-decided')).toHaveTextContent('apixaban 5 mg bid')
    // What to recheck, with no day count: ESC 2024 AF prints none, so the
    // plan names no return date of its own (clinician decision 2026-09-28).
    expect(screen.getByTestId('cdss-visit-plan')).toHaveTextContent('Hb、Cr')
    expect(screen.getByTestId('cdss-visit-plan')).not.toHaveTextContent(/\d+ 天/)
  })

  it('queues rhythm control once symptoms are answered 「有」, and keeps screening out of the queue', () => {
    render(<ScenarioMap id="p3-new-af" page="af" />)
    fireEvent.click(askOption('af-symptoms', 'yes'))
    expect(queued()).toContain('DP-18')
    expect(mapMark('DP-18')).toBe('act')
    expect(primaryOf('DP-18')).toHaveTextContent('討論節律控制')
    expect(drawnPoint('DP-13').state).toBe('confirm')
    expect(entry('DP-13')).toHaveTextContent('138/84')
    for (const dp of ['DP-04', 'DP-05', 'DP-06']) expect(queued()).not.toContain(dp)
  })
})

describe('real pack · P4 stable and optimised', () => {
  it('has an empty queue, an unprefilled weight and settled pillars (spironolactone 25 mg settled)', () => {
    const { model } = scenarioRun('p4-stable-optimised')
    expect(model.stage).toBe('follow-up')
    expect(model.queue).toEqual([])
    // The cloud record's weights are health-check weights: never prefilled.
    expect(model.asks.find((ask) => ask.id === 'weight-trend')?.prefill).toBeUndefined()
    expect(model.points.filter((item) => item.state === 'act' || item.state === 'safety')).toEqual([])
    for (const dp of ['DP-07', 'DP-08', 'DP-09', 'DP-10']) expect(point('p4-stable-optimised', dp).state).toBe('done')
    expect(point('p4-stable-optimised', 'DP-09').headline).toBe('spironolactone 25 mg：足量')

    render(<ScenarioMap id="p4-stable-optimised" />)
    expect(queued()).toEqual([])
    // Settled, the pillars carry no button; the map marks them settled.
    for (const dp of ['DP-07', 'DP-08', 'DP-09', 'DP-10']) {
      expect(mapMark(dp)).toBe('done')
      expect(entry(dp).querySelector('[data-visit-primary]')).toBeNull()
    }
    expect(entry('DP-09')).toHaveTextContent('spironolactone 25 mg：足量')
    // The one treatment item is DP-12's iron screen — the record has no
    // ferritin — which is a confirm, not a queued decision.
    expect(point('p4-stable-optimised', 'DP-12').state).toBe('confirm')
    expect(primaryOf('DP-12')).toHaveTextContent('驗 ferritin、TSAT')
    expect(document.querySelector('[data-prefilled="true"]')).toBeNull()
  })

  // Clinician feedback 2026-09-28: 「治療隨時 HFrEF 的四大支柱呢…都要出現」.
  it('keeps the four pillars together in the medicines table, settled ones too, each with its line in the map', () => {
    render(<ScenarioMap id="p4-stable-optimised" />)
    const drugs = document.querySelector<HTMLElement>('[data-book-section="drugs"]')!
    expect(within(drugs).getByRole('heading', { level: 2 })).toHaveTextContent('四支柱')
    const table = chapterTable('drugs')
    const rows = [...table.children].filter((row): row is HTMLElement => row instanceof HTMLElement && !row.hasAttribute('aria-hidden'))
    // The four, then the diuretic's row (DP-06, asked in 2).
    expect(rows.map((row) => row.dataset.bookDp ?? `ref ${row.dataset.bookRef}`)).toEqual(['DP-10', 'DP-09', 'DP-07', 'DP-08', 'ref DP-06'])
    for (const dp of ['DP-07', 'DP-08', 'DP-09', 'DP-10']) {
      expect(table).toContainElement(entry(dp))
      expect(entry(dp)).toHaveTextContent('已定')
      expect(mapMark(dp)).toBe('done')
    }
    // DP-26 joins them only while a pillar is paused; there is none here, so
    // it stands on its own line.
    expect(table).not.toContainElement(entry('DP-26'))
    expect(entry('DP-26')).toHaveTextContent('無暫停中的支柱')
  })

  it('reads the settled DP-09 with the 50 mg target in its reason, no button, and the guideline under 看依據', () => {
    render(<ScenarioMap id="p4-stable-optimised" />)
    const mra = entry('DP-09')
    expect(mra).toHaveTextContent('Table 11 目標 50 mg o.d.；RALES 試驗劑量 25 mg')
    expect(within(mra).queryByRole('button', { name: '上調至 50 mg' })).toBeNull()
    fireEvent.click(within(mra).getByRole('button', { name: /看依據/ }))
    const panel = within(mra).getByTestId('cdss-book-reasoning')
    expect(within(panel).getByRole('button', { name: '收起依據' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('DP-09MRA：依據')
    expect(within(panel).getByTestId('cdss-book-guideline-points')).toBeVisible()
    expect(within(mra).queryByRole('button', { name: '上調至 50 mg' })).toBeNull()
  })
})

describe('real pack · P5 titrating with AF', () => {
  it('queues ARNI, MRA and SGLT2i; confirms the beta-blocker dose; settles AF anticoagulation', () => {
    render(<ScenarioMap id="p5-titrating-af" />)
    expect(queued()).toEqual(['DP-07', 'DP-09', 'DP-10'])
    expect(['DP-07', 'DP-09', 'DP-10'].map((dp) => primaryOf(dp).textContent)).toEqual(['換 ARNI', '開始 MRA', '開始 SGLT2i'])
    expect(entry('DP-07')).toHaveTextContent('ramipril → 換 ARNI？')
    // All three decide on their rows of the medicines table — not as a
    // separate list; their lines in the map mark them as today's.
    const table = chapterTable('drugs')
    for (const dp of ['DP-07', 'DP-09', 'DP-10']) {
      expect(table).toContainElement(entry(dp))
      expect(mapMark(dp)).toBe('act')
    }
    // The beta-blocker's dose to confirm is decided on its own row.
    expect(drawnPoint('DP-08').state).toBe('confirm')
    expect(table).toContainElement(entry('DP-08'))
    expect(entry('DP-08')).toHaveTextContent('bisoprolol 2.5 mg／目標 10 mg')
    expect(within(entry('DP-08')).getByRole('button', { name: '上調至 5 mg' })).toBeInTheDocument()
    expect(mapMark('DP-14')).toBe('done')
    expect(entry('DP-14')).toHaveTextContent('apixaban 5 mg bid：劑量符合')
    expect(entry('DP-14')).toHaveTextContent('減量條件 0/3')
  })

  it('records the three primaries, plans their checks and says the day is decided', () => {
    render(<ScenarioMap id="p5-titrating-af" />)
    for (const dp of ['DP-07', 'DP-09', 'DP-10']) fireEvent.click(primaryOf(dp))
    const plan = screen.getByTestId('cdss-visit-plan')
    expect(plan).toHaveTextContent('K、Cr、血壓，1–2 週內')
    expect([...plan.querySelectorAll<HTMLElement>('[data-plan-item]')].map((item) => item.dataset.dp)).toEqual(['DP-07', 'DP-09', 'DP-10'])
    // Recorded — and what still needs the clinician beyond the queue (DP-08's
    // dose, DP-12's iron screen, DP-16's devices): the day is not done.
    expect(screen.getByRole('heading', { level: 3, name: '今天的決定都記下了 · 還有 3 項需你確認' })).toBeInTheDocument()
    expect(screen.getByTestId('cdss-visit-decided-line')).toHaveTextContent('今天的決定都記下了 · 還有 3 項需你確認')
    for (const dp of ['DP-08', 'DP-12', 'DP-16']) expect(mapMark(dp)).toBe('act')
  })
})

describe('real pack · P6 hyperkalaemia', () => {
  // ESC 2026 Supplementary Table S8: above 5.5 the MRA is halved and the
  // chemistry 「monitored closely」 — no interval, so the plan names what to
  // check and sets no return visit of its own.
  it('makes the MRA halving the page\'s one safety decision and does not titrate RAS', () => {
    render(<ScenarioMap id="p6-hyperkalaemia" />)
    expect(queued()).toEqual(['DP-09'])
    expect(mapMark('DP-09')).toBe('safety')
    expect(document.querySelectorAll('[data-book-map-dp][data-book-mark="safety"]')).toHaveLength(1)
    expect(entry('DP-09')).toHaveAttribute('data-tone', 'safety')
    expect(primaryOf('DP-09')).toHaveTextContent('減半劑量')
    expect(entry('DP-09')).toHaveTextContent('K 5.7 → MRA 減半？')
    expect(mapMark('DP-07')).toBe('info')
    fireEvent.click(primaryOf('DP-09'))
    expect(screen.getByTestId('cdss-visit-plan')).toHaveTextContent('K、Cr')
    expect(screen.getByTestId('cdss-visit-plan')).not.toHaveTextContent('天內')
  })

  it('shows the pack’s own status on each point, not the host re-grade', () => {
    render(<ScenarioMap id="p6-hyperkalaemia" />)
    // The flow layout's re-grade reads K ≥5.0 and would call both of these
    // 「需臨床確認」; the page marks what the pack said.
    expect(drawnPoint('DP-09').state).toBe('safety')
    expect(mapMark('DP-09')).toBe('safety')
    // K 5.7 on the ARNI: the pack's own words call for a temporary reduction
    // (ESC §6.1.6) beside the MRA hold, not 「維持現劑量」.
    expect(drawnPoint('DP-07').state).toBe('info')
    expect(mapMark('DP-07')).toBe('info')
    expect(entry('DP-07')).toHaveTextContent('先處理高血鉀')
    expect(entry('DP-07')).not.toHaveTextContent('維持現劑量')
    expect(entry('DP-07').querySelector('[data-visit-primary]')).toBeNull()
  })
})

// Clinician decision 2026-09-28: whether a diagnosis is new is not the
// record's to say (the cloud record covers about a year). With no stored CDSS
// visit the page is the system's first look: the clinician answers the
// diagnosis, and the baseline work-up is there.
describe('real pack · P4 at the system’s first visit', () => {
  it('leads with the diagnosis unanswered, the record beside it; one press answers it', () => {
    render(<ScenarioMap id="p4-stable-optimised" firstVisit />)
    expect(document.body.textContent).toContain('HFrEF（LVEF 35%，03-10）：首次評估')
    expect(document.body.textContent).not.toContain('新診斷')
    // The diagnosis heads the page, before the every-visit asks.
    expect(entry('DP-01').compareDocumentPosition(screen.getByTestId('cdss-book-asks')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mapMark('DP-01')).toBe('act')
    const table = within(entry('DP-01')).getByTestId('cdss-book-classification')
    expect(table).toHaveTextContent('I50.22')
    expect(table).toHaveTextContent('LVEF 35%（03-10）')
    expect(screen.getByTestId('cdss-book-class-hfrEF')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('cdss-book-class-hfrEF'))
    expect(usePhenotypeAnswerStore.getState().byPatientId[PATIENT]).toMatchObject({ diagnosis: 'hfrEF' })
    expect(screen.getByTestId('cdss-book-class-hfrEF')).toHaveAttribute('aria-pressed', 'true')
    expect(mapMark('DP-01')).toBe('done')
    // The baseline work-up is there for this first look.
    expect(drawnPoint('DP-02').state).toBe('confirm')
    expect(primaryOf('DP-02')).toHaveTextContent('安排基線檢驗')
  })
})

describe('real pack · P4’s diagnosis, held by the record', () => {
  // Clinician feedback 2026-09-28: 「補記診斷確認紀錄你覺得有需要留嗎？」 — a
  // diagnosis the record already carries is not confirmed a second time.
  it('offers no 補記診斷確認紀錄 for a diagnosis the record holds; DP-01 names it', () => {
    render(<ScenarioMap id="p4-stable-optimised" />)
    expect(screen.queryByTestId('cdss-diagnosis-confirmation')).toBeNull()
    expect(screen.queryByText('補記診斷確認紀錄')).toBeNull()
    // DP-01 is the diagnosis question on every chart (clinician feedback:
    // 「診斷留著讓人修改的空間」), drawn once, standing on the record.
    expect(document.querySelectorAll('[data-book-dp="DP-01"]')).toHaveLength(1)
    expect(within(entry('DP-01')).getByTestId('cdss-book-classification')).toHaveTextContent('I50.22')
    expect(mapMark('DP-01')).toBe('done')
    expect(screen.getByTestId('cdss-book-class-hfrEF')).toHaveAttribute('aria-pressed', 'true')
    // No HFpEF for an LVEF below 50%.
    expect(screen.queryByTestId('cdss-book-class-hfpEF')).toBeNull()
  })
})

describe('real pack · P7 worsening congestion', () => {
  // ESC 2026 p.73: an NT-proBNP rise reopens nothing; the worsening is the
  // clinician's 喘變差, which DP-04 reads as clinical deterioration.
  it('stays a follow-up on the NT-proBNP rise and queues the diuretic once the patient is examined wet, the weight asked rather than prefilled', () => atScenarioDay(() => {
    render(<ScenarioMap id="p7-worsening-congestion" />)
    expect(screen.getByTestId('cdss-visit-screen')).toHaveAttribute('data-stage', 'follow-up')
    expect(document.querySelector('[data-prefilled="true"]')).toBeNull()
    expect(queued()).toEqual([])
    act(() => {
      useVisitAnswersStore.getState().answer(PATIENT, 'dyspnoea-trend', 'worse')
      useVisitAnswersStore.getState().answer(PATIENT, 'weight-trend', 'up')
    })
    // 濕 by the weight, but 冷暖 unexamined: DP-06 waits for the examination.
    expect(queued()).toEqual([])
    expect(mapMark('DP-06')).toBe('ask')
    act(() => {
      useClinicVitalsStore.getState().setVitals(PATIENT, { signAnswers: Object.fromEntries(Object.entries(examToday(['pitting-edema']).signAnswers).map(([term, answer]) => [term, answer.value])) })
    })
    expect(queued()).toEqual(['DP-06'])
    expect(primaryOf('DP-06')).toHaveTextContent('利尿劑加量')
    // DP-04 (reassessment) is on the page all the same, to confirm.
    expect(drawnPoint('DP-04').state).toBe('confirm')
    expect(mapMark('DP-04')).toBe('act')
    fireEvent.click(primaryOf('DP-06'))
    expect(screen.getByTestId('cdss-visit-plan')).toHaveTextContent('體重、K、Cr，1–2 週內')
  }))
})

/**
 * PR #224 review (2026-10-01): DP-06 takes today's examination only, so the
 * examination the host hands it must be one day's. The patient examined on
 * 09-27 and seen again on 09-28, in a tab left open.
 */
describe('real pack · DP-06 reads the examination of the visit day, sign by sign', () => {
  const SEPT_27 = new Date('2026-09-27T10:00:00+08:00')
  const SEPT_28 = new Date('2026-09-28T10:00:00+08:00')
  const allAbsent = Object.fromEntries(DP06_EXAM_TERMS.map((term) => [term, 'absent' as const]))
  const yesterday = buildClinicVitals({ signAnswers: allAbsent }, SEPT_27)
  const examRows = (clinicVitals: ReturnType<typeof examToday>) => {
    const dp06 = point('p9-hfpef-af-dose', 'DP-06', { clinicVitals, now: new Date('2026-09-28T09:00:00+08:00') })
    return Object.fromEntries((dp06.questions?.rows ?? []).map((row) => [row.id, row.answer]))
  }

  it('a sign found the next day leaves perfusion and the other signs unanswered, not the day before\'s 無', () => {
    const today = mergeClinicVitals(yesterday, { signAnswers: { rales: 'present' } }, SEPT_28)
    expect(examRows(today)).toEqual({ 'orthopnea-pnd': undefined, jvp: undefined, rales: true, edema: undefined, hypoperfusion: undefined })
  })

  it('全部皆無 pressed again the next day is that day\'s examination', () => {
    expect(examRows(yesterday)).toEqual({ 'orthopnea-pnd': undefined, jvp: undefined, rales: undefined, edema: undefined, hypoperfusion: undefined })
    const today = mergeClinicVitals(yesterday, { signAnswers: allAbsent }, SEPT_28)
    expect(examRows(today)).toEqual({ 'orthopnea-pnd': false, jvp: false, rales: false, edema: false, hypoperfusion: false })
  })
})

describe('real pack · P8 first visit after an HF admission', () => {
  it('reassesses in the post-HFH window and queues MRA restart, ARNI and beta-blocker steps', () => {
    const { model } = scenarioRun('p8-post-discharge')
    expect(model.stage).toBe('reassess')
    expect(model.flags).toContain('post-hfh')
    render(<ScenarioMap id="p8-post-discharge" />)
    expect(screen.getByTestId('cdss-visit-triggers')).toHaveTextContent('09-05～09-12 HF 住院')
    // The pillars in their own rows (07, 08, 09), each deciding in place.
    expect([...queued()].sort()).toEqual(['DP-07', 'DP-08', 'DP-09'])
    expect(['DP-07', 'DP-08', 'DP-09'].map((dp) => primaryOf(dp).textContent)).toEqual(['上調至 49/51', '上調至 5 mg', '重新開始 MRA'])
    expect(entry('DP-07')).toHaveTextContent('ARNI 24/26 → 49/51 mg bid')
    expect(entry('DP-08')).toHaveTextContent('bisoprolol 2.5 mg → 5 mg')
    expect(screen.getByTestId('cdss-visit-plan-notes')).toHaveTextContent('6 週內密集回診')
  })

  it('settles or asks about the diuretic once breathlessness is better and weight unchanged', () => {
    expect(point('p8-post-discharge', 'DP-06', { answers: { 'dyspnoea-trend': 'better' }, clinicVitals: examToday() }).state).toBe('ask')
    // 喘、體重 alone no longer settle it: the signs and perfusion are examined too.
    expect(point('p8-post-discharge', 'DP-06', { answers: { 'dyspnoea-trend': 'better', 'weight-trend': 'same' } }).state).toBe('ask')
    const state = point('p8-post-discharge', 'DP-06', { answers: { 'dyspnoea-trend': 'better', 'weight-trend': 'same' }, clinicVitals: examToday() }).state
    expect(['done', 'confirm']).toContain(state)
  })
})

describe('real pack · P9 HFpEF with AF, apixaban due for reduction', () => {
  it('stays in follow-up and queues the apixaban reduction and the MRA start', () => atScenarioDay(() => {
    const { model } = scenarioRun('p9-hfpef-af-dose')
    expect(model.stage).toBe('follow-up')
    render(<ScenarioMap id="p9-hfpef-af-dose" />)
    expect(document.querySelector('[data-prefilled="true"]')).toBeNull()
    expect([...queued()].sort()).toEqual(['DP-09', 'DP-14'])
    expect(primaryOf('DP-09')).toHaveTextContent('開始 MRA')
    expect(primaryOf('DP-14')).toHaveTextContent('改 2.5 mg bid')
    expect(entry('DP-14')).toHaveTextContent('apixaban 5 → 2.5 mg bid？')
    expect(entry('DP-14')).toHaveTextContent('2/3')
    expect(entry('DP-14')).toHaveTextContent('AF')
    // Weight is the clinician's answer now; until it is given DP-06 waits,
    // and 「減少」 on a loop diuretic asks whether it can come down.
    expect(mapMark('DP-06')).toBe('ask')
    fireEvent.click(askOption('dyspnoea-trend', 'stable'))
    fireEvent.click(askOption('weight-trend', 'down'))
    // The signs and perfusion still to examine.
    expect(mapMark('DP-06')).toBe('ask')
    act(() => {
      useClinicVitalsStore.getState().setVitals(PATIENT, { signAnswers: Object.fromEntries(Object.entries(examToday().signAnswers).map(([term, answer]) => [term, answer.value])) })
    })
    expect(drawnPoint('DP-06').state).toBe('confirm')
    expect(mapMark('DP-06')).toBe('act')
    // The drug and its prescribed daily dose lead the question (「利尿劑加量沒顯示原本用什麼利尿劑跟原本劑量」).
    expect(decision('DP-06')).toHaveTextContent('furosemide 每日 20 mg：體重減少，是否減量？')
  }))

  // Owner feedback 2026-09-29: with room on the page, what a decision reads is
  // in view on its row — not three folds down in the module's card.
  it('prints on each open decision the record values it reads, dated, with the page’s LVEF left to the page', () => {
    render(<ScenarioMap id="p9-hfpef-af-dose" />)
    // Where the pack gives Table 11's criteria, each value is beside the
    // criterion that reads it — once.
    const criteria = [...entry('DP-14').querySelectorAll<HTMLElement>('[data-visit-criteria]')].map((element) => element.textContent).join(' ')
    for (const value of ['80 歲', '58 kg', '1.3 mg/dL']) {
      expect(criteria).toContain(value)
      expect(criteria.split(value).length - 1).toBe(1)
    }
    // Elsewhere the record line: each value with its date; LVEF heads the
    // page's values line and is not repeated on the pillar.
    const mra = [...entry('DP-09').querySelectorAll('li')].map((item) => item.textContent)
    expect(mra).toContain('K 4.4 mmol/L（09-20）')
    expect(mra.join(' ')).not.toContain('LVEF')
    expect(screen.getByTestId('cdss-book-values')).toHaveTextContent('LVEF 60%')
  })
})

describe('real pack · P11 dabigatran with CrCl under 30 (AF page)', () => {
  it('puts the contraindication first as a safety row', () => {
    render(<ScenarioMap id="p11-af-dabigatran-renal" page="af" />)
    expect(document.querySelector('[data-book-ask="af-symptoms"]')).not.toBeNull()
    expect(document.querySelector('[data-book-ask="bleeding"]')).not.toBeNull()
    expect(queued()).toEqual(['DP-09'])
    expect(mapMark('DP-09')).toBe('safety')
    expect(decision('DP-09')).toHaveAttribute('data-tone', 'safety')
    expect(primaryOf('DP-09')).toHaveTextContent('改用其他 DOAC')
    expect(entry('DP-09')).toHaveTextContent('dabigatran')
    expect(entry('DP-09')).toHaveTextContent('CrCl <30')
  })
})

describe('real pack · the other scenarios', () => {
  it('P1 suspected HFpEF: diagnosis first — 「HFrEF 還是 HFpEF？」 is DP-01’s table, answered there, not a second row', () => {
    const { model } = scenarioRun('p1-suspected-hfpef')
    expect(model.stage).toBe('suspected')
    expect(model.queue).toEqual(['DP-01'])
    expect(model.asks).toEqual([])
    render(<ScenarioMap id="p1-suspected-hfpef" />)
    // The treatment waits on the diagnosis.
    for (const dp of ['DP-07', 'DP-08', 'DP-09', 'DP-10']) expect(entry(dp)).toHaveTextContent('確診後開啟')
    // No 「比上次」 before a diagnosis.
    expect(document.querySelector('[data-book-ask]')).toBeNull()
    expect(screen.queryByTestId('cdss-book-asks')).toBeNull()
    // DP-01's table asks the diagnosis itself, beside the record: HFrEF,
    // HFpEF or 還不確定 — no 「否」.
    expect(mapMark('DP-01')).toBe('act')
    expect(within(entry('DP-01')).getByTestId('cdss-book-classification')).toHaveTextContent('LVEF 62%（09-20）')
    const choices = within(entry('DP-01')).getByTestId('cdss-book-class-choices')
    expect(within(choices).getAllByRole('button').map((button) => button.textContent)).toEqual(['HFrEF', 'HFpEF', '還不確定'])
    // …so nothing asks it a second time: one DP-01 on the page; DP-34 is the
    // table's other half, and DP-00 (folded into DP-01) has no entry.
    expect(document.querySelectorAll('[data-book-dp="DP-01"]')).toHaveLength(1)
    expect(document.querySelector('[data-book-dp="DP-34"]')).toBeNull()
    expect(document.querySelector('[data-book-dp="DP-00"]')).toBeNull()
    // The table is the only confirmation on the page.
    expect(screen.queryByTestId('cdss-diagnosis-confirmation')).toBeNull()
  })

  it('P1 one press on 「HFpEF」 is the diagnosis; the page stays put and asks 喘／體重比上次 after it', () => {
    render(<ScenarioMap id="p1-suspected-hfpef" />)
    fireEvent.click(screen.getByTestId('cdss-book-class-hfpEF'))
    expect(usePhenotypeAnswerStore.getState().byPatientId[PATIENT]).toMatchObject({ diagnosis: 'hfpEF', hfpEfConfirmed: true })
    // The answer stays where it was given, and can be changed there.
    expect(screen.getByTestId('cdss-book-class-hfpEF')).toHaveAttribute('aria-pressed', 'true')
    expect(mapMark('DP-01')).toBe('done')
    expect(mapMark('DP-34')).toBe('done')
    // A new diagnosis is still asked 喘／體重比上次 (many a first CDSS visit is
    // a returning patient): they follow the diagnosis, on the same page.
    expect(entry('DP-01').compareDocumentPosition(screen.getByTestId('cdss-book-asks')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(askOption('dyspnoea-trend', 'stable'))
    fireEvent.click(askOption('weight-trend', 'same'))
    expect(visitAnswersOf(useVisitAnswersStore.getState().byPatientId[PATIENT]!)).toMatchObject({ 'dyspnoea-trend': 'stable', 'weight-trend': 'same' })
  })

  it('P2 new HFrEF: baseline, four starts in the pack order, baseline labs named', () => {
    const { model } = scenarioRun('p2-new-hfref')
    expect(model.stage).toBe('baseline')
    // The system's first visit: the diagnosis is the clinician's to answer first.
    expect(model.queue).toEqual(['DP-01', 'DP-08', 'DP-07', 'DP-09', 'DP-10'])
    expect(point('p2-new-hfref', 'DP-08').headline).toContain('bisoprolol 1.25 mg')
    expect(point('p2-new-hfref', 'DP-02').headline).toMatch(/ferritin.*TSAT.*TSH.*HbA1c/)
  })

  it('P10 improved EF: continue FMT, nothing queued', () => {
    const { model } = scenarioRun('p10-improved-ef')
    expect(model.queue).toEqual([])
    expect(model.headline).toContain('LVEF 28→55%')
    expect(point('p10-improved-ef', 'DP-27').state).toBe('info')
  })

  it('every scenario builds on its page without throwing', () => {
    const ids: [ScenarioId, 'hf' | 'af'][] = [
      ['p1-suspected-hfpef', 'hf'], ['p2-new-hfref', 'hf'], ['p3-new-af', 'af'], ['p4-stable-optimised', 'hf'],
      ['p5-titrating-af', 'hf'], ['p6-hyperkalaemia', 'hf'], ['p7-worsening-congestion', 'hf'], ['p8-post-discharge', 'hf'],
      ['p9-hfpef-af-dose', 'hf'], ['p10-improved-ef', 'hf'], ['p11-af-dabigatran-renal', 'af'],
    ]
    for (const [id, page] of ids) expect(scenarioRun(id, { page }).model.points.length).toBeGreaterThan(0)
  })
})

describe('real pack · what a clinician reads without opening anything', () => {
  it('names the red flags in DP-24 itself, not above the page; marks K 5.7 and drops today’s dates (P6)', () => {
    // 「Today」 is the scenarios' visit date, whatever day the suite runs on;
    // only the clock is pinned.
    jest.useFakeTimers({ now: new Date('2026-09-27T10:00:00+08:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'] })
    try {
      render(<ScenarioMap id="p6-hyperkalaemia" />)
      expect(entry('DP-24')).toHaveTextContent('胸痛・暈厥・休息時喘・快速水腫')
      const values = screen.getByTestId('cdss-book-values')
      // K 5.7 is the one value marked.
      expect([...values.querySelectorAll('b[class]')].map((value) => value.textContent)).toEqual(['5.7'])
      expect(values).toHaveTextContent('K 5.7')
      // 09-27 is the visit date: today's heart rate carries no date; K (09-24) a short one.
      expect(values).toHaveTextContent('心率 70')
      expect(values).not.toHaveTextContent('09-27')
      expect(values).toHaveTextContent(/09-24 NT-proBNP 1500 · K 5\.7/)
      expect(values).not.toHaveTextContent('2026-09-24')
    } finally {
      jest.useRealTimers()
    }
  })
})

/**
 * The AF page's question groups live in the three sections (決策地圖 v2 asks
 * only what the prototype asks; docs/LAUNCH-ROUTE-GATES.md): 全部皆無 is
 * checked there, on the same answers.
 */
describe('real pack · AF 全部皆無 (three sections)', () => {
  /** Opens the AF page's sections the way a clinician does, by their headings. */
  const openSections = (...ids: ('diagnosis' | 'treatment' | 'prognosis')[]) => {
    for (const id of ids) {
      const toggle = screen.getByTestId(`cdss-af-${id}`).querySelector<HTMLButtonElement>('h3 > button')!
      if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
    }
  }
  const openGroup = (id: string): HTMLDetailsElement => {
    const group = document.querySelector<HTMLDetailsElement>(`[data-af-question-group="${id}"]`)
    if (!group) throw new Error(`no ${id} group`)
    fireEvent.click(group.querySelector('summary')!)
    return group
  }
  const answerIn = (group: HTMLElement) => (question: string, label: '有' | '無' | '依病歷／待確定') =>
    within(within(group).getByRole('group', { name: question })).getByRole('button', { name: label })

  it('answers a follow-up checklist 無 in one press, leaves 「有改善」 alone, and undoes on a second press (P11)', () => {
    render(<ScenarioMap id="p11-af-dabigatran-renal" page="af" layout="sections" />)
    openSections('diagnosis')
    const group = openGroup('followup')
    const answer = answerIn(group)
    const button = within(group).getByTestId('cdss-af-none-followup')
    expect(button).toHaveTextContent('全部皆無')
    fireEvent.click(button)
    for (const question of ['本次仍有心悸', '本次仍有呼吸困難', '新發暈厥／近乎暈厥']) {
      expect(answer(question, '無')).toHaveAttribute('aria-pressed', 'true')
    }
    // 「有改善」 is good news; a bulk 無 must not record 「沒有改善」.
    expect(answer('治療後症狀或活動耐受有改善', '無')).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByTestId('cdss-af-none-followup')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByTestId('cdss-af-none-followup'))
    expect(answer('本次仍有心悸', '無')).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers it on every checklist of problems, not on the NHI criteria, rate or antithrombotic groups (P11)', () => {
    render(<ScenarioMap id="p11-af-dabigatran-renal" page="af" layout="sections" />)
    openSections('diagnosis', 'treatment', 'prognosis')
    const offered = new Set(['screening', 'followup', 'adverse', 'bleeding', 'bleedingRisk', 'stroke', 'safety', 'comorbidity'])
    const seen = new Set<string>()
    for (const group of document.querySelectorAll<HTMLElement>('[data-af-question-group]')) {
      const id = group.dataset.afQuestionGroup!
      seen.add(id)
      const button = group.querySelector(`[data-testid="cdss-af-none-${id}"]`)
      if (offered.has(id)) expect(button).not.toBeNull()
      else expect(button).toBeNull()
    }
    // Not vacuous: the history, safety, HAS-BLED and comorbidity groups were
    // drawn, and so were those that keep no such button.
    expect([...seen]).toEqual(expect.arrayContaining(['stroke', 'safety', 'bleedingRisk', 'comorbidity', 'antithrombotic', 'rate', 'nhi']))
  })

  it('answers 瓣膜與當下安全 無 in one press and puts the rows back on a second (P11)', () => {
    render(<ScenarioMap id="p11-af-dabigatran-renal" page="af" layout="sections" />)
    openSections('treatment')
    const group = openGroup('safety')
    const answer = answerIn(group)
    const rows = ['機械瓣膜', '中重度 mitral stenosis', '已確認 HCM／心臟類澱粉沉積', '目前活動性出血', 'AF 相關血流動力學不穩定']
    const button = within(group).getByTestId('cdss-af-none-safety')
    expect(button).toHaveTextContent('全部皆無')
    expect(button).toHaveAttribute('title', '把 5 項記為「無」')
    fireEvent.click(button)
    for (const question of rows) expect(answer(question, '無')).toHaveAttribute('aria-pressed', 'true')
    expect(group.querySelector('summary')).toHaveTextContent('0 項待確定')
    fireEvent.click(within(group).getByTestId('cdss-af-none-safety'))
    for (const question of rows) expect(answer(question, '依病歷／待確定')).toHaveAttribute('aria-pressed', 'true')
  })

  it('never writes 無 over the record: a HAS-BLED factor the record scores stays 有 (P11, Cr >2.26)', () => {
    render(<ScenarioMap id="p11-af-dabigatran-renal" page="af" layout="sections" />)
    openSections('prognosis')
    const group = openGroup('bleedingRisk')
    const answer = answerIn(group)
    const renal = 'HAS-BLED 腎異常：透析／腎移植／Cr >2.26 mg/dL'
    // The pack scores it from the record; the question says so rather than 待確定.
    expect(answer(renal, '有')).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByText(/病歷預填：/)).toBeInTheDocument()
    const button = within(group).getByTestId('cdss-af-none-bleedingRisk')
    expect(button).toHaveTextContent('其餘皆無')
    fireEvent.click(button)
    expect(answer(renal, '有')).toHaveAttribute('aria-pressed', 'true')
    expect(answer('重大出血病史／出血傾向', '無')).toHaveAttribute('aria-pressed', 'true')
    expect(useAfAnswersStore.getState().answers.abnormalRenal).toBeUndefined()
  })

  it('leaves a row the record holds but cannot settle for the clinician, and says why (P3, ECG LVH)', () => {
    render(<ScenarioMap id="p3-new-af" page="af" layout="sections" />)
    openSections('diagnosis')
    // The coded AF opens on 追蹤; the screening questions are 診斷's.
    fireEvent.click(within(within(screen.getByTestId('cdss-af-diagnosis')).getByRole('group', { name: '診斷或追蹤檢視' })).getByRole('button', { name: '診斷' }))
    const group = openGroup('screening')
    const answer = answerIn(group)
    const lvh = '左心室肥厚'
    // The ECG report is there and does not mention LVH: not a 無 to write in bulk.
    expect(group.querySelector('[data-af-record-held="screening_lvh"]')).toHaveTextContent('病歷有紀錄、未能判定：心電圖 LVH：報告未提及 LVH')
    expect(within(group).getByTestId('cdss-af-none-held-screening')).toHaveTextContent('病歷有紀錄的 1 項請逐項確認')
    fireEvent.click(within(group).getByTestId('cdss-af-none-screening'))
    expect(answer(lvh, '依病歷／待確定')).toHaveAttribute('aria-pressed', 'true')
    expect(answer('慢性阻塞性肺病', '無')).toHaveAttribute('aria-pressed', 'true')
    expect(useAfAnswersStore.getState().answers.screening_lvh).toBeUndefined()
    expect(within(group).getByTestId('cdss-af-none-screening')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('real pack · one answer, one decision, on every page', () => {
  it('records AF anticoagulation once: decided on the HF page, decided on the AF page (P9)', () => {
    const hfPoint = point('p9-hfpef-af-dose', 'DP-14')
    const afOwner = scenarioRun('p9-hfpef-af-dose', { page: 'af' }).model.points.find((item) => item.decisionId === hfPoint.decisionId)
    expect(afOwner?.dp).toBeDefined()
    const { unmount } = render(<ScenarioMap id="p9-hfpef-af-dose" />)
    fireEvent.click(primaryOf('DP-14'))
    unmount()

    render(<ScenarioMap id="p9-hfpef-af-dose" page="af" />)
    expect(mapMark(afOwner!.dp)).toBe('done')
    expect(within(decision(afOwner!.dp)).getByTestId('cdss-visit-decided')).toHaveTextContent('改 2.5 mg bid')
    expect(Object.keys(usePhysicianDecisionsStore.getState().byPatientId[PATIENT] ?? {})).toContain(`visit:${hfPoint.decisionId}`)
  })

  it('shows the map’s 喘 and 體重 answers in the three sections, and writes back to them (P4)', () => {
    useVisitAnswersStore.getState().answer(PATIENT, 'weight-trend', 'up')
    render(<ScenarioMap id="p4-stable-optimised" layout="sections" />)
    const followUp = screen.getByTestId('cdss-followup-priorities')
    const weight = within(followUp).getByRole('group', { name: '體重變化' })
    expect(within(weight).getByRole('button', { name: '增加' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(weight).getByRole('button', { name: '減少' }))
    expect(visitAnswersOf(useVisitAnswersStore.getState().byPatientId[PATIENT])['weight-trend']).toBe('down')
    const breath = within(followUp).getByRole('group', { name: '喘 變化' })
    fireEvent.click(within(breath).getByRole('button', { name: '惡化' }))
    expect(visitAnswersOf(useVisitAnswersStore.getState().byPatientId[PATIENT])['dyspnoea-trend']).toBe('worse')
    expect(within(breath).getByRole('button', { name: '惡化' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('real pack · 「不耐受」 is the clinician’s', () => {
  // Clinician decision 2026-09-28: 「讓 user 來按下不耐受的按鈕」 — a pillar
  // marked 不耐受 is ESC Table 15's prognostic medication intolerance at DP-19.
  it('turns 「不耐受」 on the β-blocker into an I NEED HELP item at DP-19 (P5)', () => {
    render(<ScenarioMap id="p5-titrating-af" />)
    expect(drawnPoint('DP-19').state).not.toBe('confirm')
    expect(mapMark('DP-19')).toBe('info')
    // Beside 「上調至 5 mg」, the alternatives fold under 「其他」.
    fireEvent.click(within(entry('DP-08')).getByRole('button', { name: /其他/ }))
    fireEvent.click(within(entry('DP-08')).getByRole('button', { name: '不耐受' }))
    expect(drawnPoint('DP-19').state).toBe('confirm')
    expect(mapMark('DP-19')).toBe('act')
    expect(entry('DP-19')).toHaveTextContent('進階 HF 風險：轉介評估？')
  })
})

describe('real pack · the every-visit answers in the three sections', () => {
  it('marks a chosen answer with the page’s selected tint, a warning with the risk colour and an improvement with green (P7)', () => {
    render(<ScenarioMap id="p7-worsening-congestion" layout="sections" />)
    const followUp = screen.getByTestId('cdss-followup-priorities')
    const breath = () => within(followUp).getByRole('group', { name: '喘 變化' })
    const weight = () => within(followUp).getByRole('group', { name: '體重變化' })
    const worse = () => within(breath()).getByRole('button', { name: '惡化' })
    const better = () => within(breath()).getByRole('button', { name: '進步' })
    const down = () => within(weight()).getByRole('button', { name: '減少' })
    // Open answers carry their colour on the frame only, on one ground
    // (「沒選的時候可以只有外框有顏色」); a chosen one fills in: the page's
    // selected tint, a warning the risk colour, an improvement the success green.
    for (const open of [worse(), better(), down()]) expect(open.className).toContain('bg-card')
    expect(worse().className).toContain('border-destructive/45')
    expect(better().className).toContain('border-emerald-600/45')
    expect(down().className).toContain('border-amber-500/55')
    fireEvent.click(worse())
    expect(worse().className).toContain('bg-destructive/10')
    fireEvent.click(better())
    expect(better().className).toContain('bg-emerald-50')
    fireEvent.click(down())
    // 體重減少: amber — dry weight or dehydration, look at which.
    expect(down().className).toContain('bg-amber-50')
  })
})

describe('real pack · follow-up questions open once the pack says follow-up', () => {
  it('does not lock symptoms, signs and NYHA behind a hidden 「是否懷疑心衰竭」 (P9 HFpEF, P10 improved EF; three sections)', () => {
    for (const id of ['p9-hfpef-af-dose', 'p10-improved-ef'] as ScenarioId[]) {
      const { unmount } = render(<ScenarioMap id={id} layout="sections" />)
      const breath = within(screen.getByTestId('cdss-followup-priorities')).getByRole('group', { name: '喘 變化' })
      fireEvent.click(within(breath).getByRole('button', { name: '惡化' }))
      for (const question of ['symptoms', 'signs', 'nyha']) {
        expect({ id, question, state: screen.getByTestId(`cdss-hf-question-${question}`).getAttribute('data-state') }).toEqual({ id, question, state: 'open' })
      }
      expect(screen.queryByText('先回答「是否懷疑心衰竭」後開放')).toBeNull()
      expect(screen.queryByText('先回答「HFrEF 還是 HFpEF？」後開放')).toBeNull()
      unmount()
      useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
      useClinicVitalsStore.setState({ byPatientId: {} })
    }
  })
})
