"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CdssRecommendation } from '../../types'
import type {
  PhysicianDecisionInput,
  PhysicianDecisionMap,
} from '../../stores/physician-decisions.store'
import { useCdssDecisionTimingStore } from '../../stores/cdss-decision-timing.store'
import type { CoronaryPhaseAnswer } from '../../stores/coronary-phase.store'
import {
  ABSENT_STATES,
  DECISION_STATES,
  buildQueueRows,
  buildVisitPlan,
  buildVisitSummaryText,
  checkIntervalSuffix,
  decisionBasis,
  decisionInputFor,
  dependentDecisionKeys,
  effectiveAnswer,
  pointSteps,
  queuedPointDps,
  settleDecisions,
  settledPointOf,
  visitDecisionKey,
  type QueueRow,
  type QueueStep,
} from './visit-decisions'
import type {
  DecisionPointView,
  VisitAction,
  VisitAnswers,
  VisitAsk,
  VisitDecisionModel,
} from '../../types'
import { BookAsks, examAsksOf } from './BookAsks'
import { VisitBookLayout, bookChaptersOf, questionRowOf, type BookEntry, type BookHeadToolsPage, type BookMark } from './VisitBookLayout'
import type { VisitAnswerProvenance } from './VisitAsks'
import { pageSourceOf } from './visit-model.source'
import { displayDate, visitStatusSentence, VisitStatusLine } from './VisitStatusHeader'
import { VisitCalculators } from './VisitCalculators'
import { useVisitCalculatorNotes, useVisitCalculatorNotesStore } from '../../stores/visit-calculator-notes.store'
import type { PrognosisEvidence } from '@/features/medical-calculator/prognosis/models'

export interface VisitDecisionScreenProps {
  model: VisitDecisionModel
  isEnglish: boolean
  /** One clock per mount; 「今天」 is read against it. */
  now: Date
  packVersion: string
  /** `<patientId>:<packId>`, for the in-memory decision timing. */
  screenKey: string
  decisions?: PhysicianDecisionMap
  onRecordDecision?: (key: string, input: PhysicianDecisionInput) => void
  onClearDecision?: (key: string) => void
  answers: VisitAnswers
  /** Where each of today's answers was given, so an answer from another page says so. */
  answerSources?: VisitAnswerProvenance
  onAnswer?: (id: VisitAsk['id'], value: string | null) => void
  /** Every card a point can read, by module id — this pack's and the companion's. */
  modules: ReadonlyMap<string, CdssRecommendation>
  /**
   * An action that also answers a structured question on its card (the pack's
   * optional `physicianInput`), handed back so the pack recomputes from it.
   */
  onPhysicianInput?: (input: NonNullable<VisitAction['physicianInput']>) => void
  /** CAD DP-01's answer as kept, so its month shows back beside the table. */
  coronaryPhase?: CoronaryPhaseAnswer
  /**
   * Writes an answer to a point's own questions into the answer set the pack
   * names — AF DP-08's valves (`af-clinical`), HF DP-06's triggers (`visit`),
   * its signs (`clinic-exam`, each of the row's `terms`); `undefined`
   * withdraws it.
   */
  onPointAnswer?: (answers: string, id: string, value: boolean | undefined, terms?: readonly string[]) => void
  /**
   * Writes what the clinician grades today beside the asks (the pack's
   * `examAsks`: HF's NYHA) where the host keeps the clinic examination;
   * `null` withdraws it.
   */
  onGrade?: (id: string, value: string | null) => void
  /**
   * The record's values for the HF prognosis models whose formula is not
   * connected (SHFM, GWTG-HF), shown when the heart-failure page's 計算機
   * opens one.
   */
  prognosisEvidence?: PrognosisEvidence
}

/**
 * The decision map the heart-failure and atrial-fibrillation pages share,
 * drawn as the pocket-handbook page (決策地圖 v2): the map on the left, each
 * point once on the right, 今天的計畫 at the foot. The first decision map —
 * the queue and the three columns — was retired on 2026-10-01 (owner, in
 * chat: 「決策地圖v2 心臟科醫師看了喜歡，那原本的決策地圖就可以整個拿掉了，
 * 留著v2跟三區塊」). The pack decides what each point says and which points
 * are today's; this component decides where they sit and records what the
 * clinician chose. One decision per point, one control, one store key.
 */
export function VisitDecisionScreen({
  model,
  isEnglish,
  now,
  packVersion,
  screenKey,
  decisions,
  onRecordDecision,
  onClearDecision,
  answers,
  answerSources,
  onAnswer,
  modules,
  onPhysicianInput,
  coronaryPhase,
  onPointAnswer,
  onGrade,
  prognosisEvidence,
}: VisitDecisionScreenProps) {
  const sourceOfPage = pageSourceOf(model)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const allRows = useMemo(() => buildQueueRows(model, decisions, now), [decisions, model, now])
  const screenShown = useCdssDecisionTimingStore((state) => state.screenShown)
  const decisionRecorded = useCdssDecisionTimingStore((state) => state.decisionRecorded)

  useEffect(() => {
    screenShown(screenKey)
  }, [screenKey, screenShown])

  const plan = useMemo(() => buildVisitPlan(model, decisions, now), [decisions, model, now])
  // What the clinician attached from a calculator today: a note in the plan
  // and in the copied text, never an input the pack reads.
  const calculatorNotes = useVisitCalculatorNotes(screenKey, now)
  const attachCalculatorNote = useVisitCalculatorNotesStore((state) => state.attach)
  const removeCalculatorNote = useVisitCalculatorNotesStore((state) => state.remove)
  const summaryText = useMemo(() => {
    const text = buildVisitSummaryText({ model, answers, decisions, now, isEnglish })
    if (!calculatorNotes.length) return text
    const heading = isEnglish ? 'Calculator notes (not part of the recommendations)' : '計算機附註（不改變指引建議）'
    return [text, '', heading, ...calculatorNotes.map((note) => `- ${note.dp} ${note.text}`)].join('\n')
  }, [answers, calculatorNotes, decisions, isEnglish, model, now])
  // What today's decisions settle, point by point, as the pack reads them.
  const settlement = useMemo(() => settleDecisions(model, decisions, now), [decisions, model, now])
  // A chain with a step still open — 「開始抗凝」 recorded, the DOAC not yet
  // chosen; 「改用其他 DOAC」, not yet which — is today's decision, not
  // 「已記錄」: its mark says what was recorded and what is left.
  const openStepOf = useCallback((point: DecisionPointView) => settledPointOf(settlement, point)?.open, [settlement])
  // What a point stands settled by: its own row's furthest step, else the
  // step on another row that decides it (DP-07's DOAC for DP-08／DP-09).
  const decisionOf = useCallback((point: DecisionPointView) => settledPointOf(settlement, point)?.settled, [settlement])

  // A step decided anew, or taken back, leaves the steps that followed from it
  // without the decision they answered: they go too (#166 review), so the
  // chain is walked again from here rather than restored as it was.
  const clearDependents = (key: string) => {
    for (const dependent of dependentDecisionKeys(key, allRows, decisions)) onClearDecision?.(dependent)
  }
  const record = (key: string, point: DecisionPointView, action: VisitAction, surface: 'queue' | 'map') => {
    if (!onRecordDecision) return
    clearDependents(key)
    onRecordDecision(key, decisionInputFor(point, action, packVersion))
    decisionRecorded(screenKey, key, surface)
    if (action.physicianInput) onPhysicianInput?.(action.physicianInput)
  }
  const clear = (key: string) => {
    clearDependents(key)
    onClearDecision?.(key)
  }

  const openPoint = openKey
    ? model.points.find((point) => visitDecisionKey(point) === openKey)
    : undefined
  const toggleOpen = (point: DecisionPointView) => {
    const key = visitDecisionKey(point)
    setOpenKey((current) => (current === key ? null : key))
  }

  // A point another row decides (DP-08／DP-09 by DP-07's DOAC choice) stands
  // for that step — its record, or its choices once 改 has cleared it — and
  // not for its own 「等上一步」, which the step has overtaken (#196 review).
  const decidedElsewhere = (point: DecisionPointView) => {
    const settled = settledPointOf(settlement, point)
    return settled?.latest ? undefined : settled?.decidedBy
  }
  // What an open decision reads from the record, under its row. LVEF heads the
  // page's values line, so it is not repeated on every pillar.
  const headedKeys = useMemo(() => new Set(model.keyValues.filter((item) => item.key === 'LVEF').map((item) => item.key)), [model.keyValues])
  const lvefValue = Number.parseFloat(model.keyValues.find((item) => item.key === 'LVEF')?.value ?? '')
  const lvef = Number.isFinite(lvefValue) ? lvefValue : undefined
  const basisOf = (point: DecisionPointView) => decisionBasis(point, modules, headedKeys, (date) => displayDate(date, now))
  const unansweredAsks = model.asks.filter((ask) => !effectiveAnswer(ask, answers).value)

  // The page draws the pack's model in place of the older question cards
  // (owner request 2026-09-30: 「原本的 UI 跟問題那些都廢棄了，包含 DP03」):
  // DP-01's phenotype table asks the diagnosis, DP-03 the pack's every-visit
  // asks, and every other point decides on its own row, asking only what the
  // Artifact prototype asks there (owner decision 2026-09-30; what the three
  // sections keep is listed in docs/LAUNCH-ROUTE-GATES.md). So no point is
  // left out as asked elsewhere: the rows are all of them.
  const samePoint = (a: DecisionPointView, b: DecisionPointView) => a.dp === b.dp && a.source === b.source
  const headRowOf = (point: DecisionPointView) => allRows.find((row) => samePoint(row.steps[0].point, point))
  // A row that walks on to other points (an older pack's DP-07 → DP-08)
  // stands for them too.
  const coveringRowOf = (point: DecisionPointView) => allRows.find((row) => row.steps.some((step, index) => (
    index > 0 && samePoint(step.point, point) && !samePoint(step.point, row.steps[0].point)
  )))
  const bookAsks = (
    <BookAsks
      asks={model.asks}
      answers={answers}
      isEnglish={isEnglish}
      onAnswer={onAnswer}
      pagePackId={model.packId}
      {...(answerSources ? { sources: answerSources } : {})}
      examAsks={examAsksOf(model)}
      {...(onGrade ? { onGrade } : {})}
    />
  )
  // A point answered in its classification table (HF DP-01's phenotype).
  const answeredInTable = (point: DecisionPointView) => Boolean(
    (point as { classification?: { classes?: { physicianInput?: unknown }[] } }).classification?.classes?.some((item) => item.physicianInput),
  )
  const ownEntryOf = (point: DecisionPointView): BookEntry => {
    if (point.dp === 'DP-03' && point.source === sourceOfPage) return { kind: 'slot', point, content: bookAsks }
    // A point answered in its classification table; a table only to read (AF
    // DP-17's agents by LVEF) sits on the point's own line.
    if (answeredInTable(point)) return { kind: 'slot', point, content: null }
    const head = headRowOf(point)
    if (head) return { kind: 'row', point, row: head, queued: true }
    const covering = coveringRowOf(point)
    if (covering) return { kind: 'covered', point, by: covering.steps[0].point }
    const decidedBy = decidedElsewhere(point)
    if (decidedBy) return { kind: 'covered', point, by: decidedBy.owner }
    // A point with buttons the pack did not queue (a dose to confirm, 用藥
    // 核對's 已核對) decides on its own row.
    if (point.actions.length > 0) {
      const steps = pointSteps(point, decisions, now)
      const current = steps.find((step) => !step.decision)
      return { kind: 'row', point, row: { key: visitDecisionKey(point), steps, ...(current ? { current } : {}), safety: point.state === 'safety' }, queued: false }
    }
    return { kind: 'line', point }
  }
  // The prototype has no DP-34 of its own: DP-01's table stands for it
  // (「DP-01 · DP-34」), the HFpEF confirmation being the phenotype's other
  // half, answered in that table (owner request 2026-09-30: 「Prototype 的
  // DP34不用填症狀，完全照著prototype」). The map rail's DP-34 leads there.
  const dp01 = model.points.find((point) => point.dp === 'DP-01' && point.source === 'hf')
  const dp34 = model.points.find((point) => point.dp === 'DP-34' && point.source === 'hf')
  const mergesIntoDp01 = (point: DecisionPointView) => (
    point === dp34 && sourceOfPage === 'hf' && Boolean(dp01) && !ABSENT_STATES.has(point.state) && ownEntryOf(dp01!).kind === 'slot'
  )
  const entryOf = (point: DecisionPointView): BookEntry => {
    if (mergesIntoDp01(point)) return { kind: 'skip', point, anchorOf: dp01! }
    const own = ownEntryOf(point)
    if (point === dp01 && own.kind === 'slot' && dp34 && mergesIntoDp01(dp34)) return { ...own, merged: dp34 }
    return own
  }
  const markOf = (point: DecisionPointView): BookMark => {
    if (ABSENT_STATES.has(point.state)) return 'absent'
    if (openStepOf(point)) return 'act'
    if (decisionOf(point)) return 'done'
    const entry = ownEntryOf(point)
    if (entry.kind === 'row') {
      if (!entry.row.current) return 'done'
      if (entry.row.safety) return 'safety'
      if (entry.queued || DECISION_STATES.has(point.state)) return 'act'
      return point.state === 'done' ? 'done' : 'info'
    }
    if (entry.kind === 'slot' && point.dp === 'DP-03') return unansweredAsks.length ? 'ask' : 'done'
    // The diagnosis still to answer in its table.
    if (entry.kind === 'slot' && DECISION_STATES.has(point.state)) return 'act'
    // Left open there (還不確定): the pack waits, and the table still offers
    // the diagnosis — open, never info, so the page does not read as
    // complete (#219 review).
    if (entry.kind === 'slot' && entry.content === null && point.state === 'waiting') return 'wait'
    if (point.state === 'safety') return 'safety'
    if (point.state === 'ask') return 'ask'
    if (point.state === 'done') return 'done'
    return 'info'
  }
  // Every point the page shows opens its reasoning (owner correction
  // 2026-10-01: 「沒有這個規則吧」): a reminder line has its record and its
  // guideline behind it as much as a decision does — DP-05 names which
  // medicines ESC calls harmful, not only that none is prescribed.
  const isComplex = (point: DecisionPointView) => point.state !== 'not-applicable' && point.state !== 'not-included'
  // Today's decisions for 今天的計畫, once each: the point, what was chosen,
  // and what to recheck when.
  const bookDecided = model.points.flatMap((point) => {
    const decision = decisionOf(point)
    if (!decision) return []
    const check = decision.record.responseCheck
    return [{
      key: decision.key,
      dp: point.dp,
      source: point.source,
      label: decision.record.actionLabel ?? decision.action.label,
      ...(check ? { check: `${check.text}${checkIntervalSuffix(check, isEnglish)}` } : {}),
    }]
  }).filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index)

  // The pack's sentence for the day: its decided form once every decision row
  // is recorded. A diagnosis answered in DP-01's table is not a row of the
  // day's decisions — the table holds it, and the rail marks it open.
  const rows: QueueRow[] = allRows.filter((row) => !answeredInTable((row.current ?? row.steps[0]).point) && !mergesIntoDp01((row.current ?? row.steps[0]).point))
  const queuedDps = queuedPointDps(rows)
  // What still needs the clinician beyond the rows, for the pack's decided sentence.
  const stillToConfirm = model.points.filter((point) => (
    DECISION_STATES.has(point.state) && !decisionOf(point) && !queuedDps.has(point.dp)
  )).length
  const status = visitStatusSentence(model, rows, stillToConfirm, isEnglish)

  return (
    <div className="space-y-3" data-testid="cdss-visit-screen" data-pack={model.packId} data-stage={model.stage} data-layout="book">
      <VisitBookLayout
        points={model.points}
        isEnglish={isEnglish}
        sourceOfPage={sourceOfPage}
        entryOf={entryOf}
        markOf={markOf}
        isComplex={isComplex}
        openKeyOf={visitDecisionKey}
        openKey={openPoint ? openKey : null}
        onToggle={toggleOpen}
        {...(onRecordDecision ? { onDecide: (step: QueueStep, action: VisitAction, queued: boolean) => record(step.key, step.point, action, queued ? 'queue' : 'map') } : {})}
        {...(onClearDecision ? { onClear: (step: QueueStep) => clear(step.key) } : {})}
        basisOf={basisOf}
        headline={status.text}
        keyValues={model.keyValues}
        triggers={model.triggers}
        now={now}
        // Only the screen-reader status: the page draws nothing of the three
        // sections' surfaces — the values editor, the column footers, the
        // outlook cards, the module cards (owner request 2026-09-30:
        // 「都照著 CDSS 小麻式版面原型，不要使用任何原本的外觀」).
        top={<VisitStatusLine model={model} sentence={status.text} />}
        plan={plan}
        {...(status.decided ? { decidedLine: status.text } : {})}
        {...(bookChaptersOf(model) ? { chapters: bookChaptersOf(model)! } : {})}
        decided={bookDecided}
        summaryText={summaryText}
        // A class chosen in DP-01's table is the answer the diagnosis
        // question's own control wrote, handed back the same way.
        {...(coronaryPhase ? { coronaryPhase } : {})}
        {...(onPhysicianInput ? { onChooseClass: (_point: DecisionPointView, input: NonNullable<VisitAction['physicianInput']>) => onPhysicianInput(input) } : {})}
        {...(sourceOfPage === 'hf' ? {
          headTools: (page: BookHeadToolsPage) => (
            <VisitCalculators
              isEnglish={isEnglish}
              points={model.points}
              sourceOfPage={sourceOfPage}
              {...(lvef !== undefined ? { lvef } : {})}
              {...(prognosisEvidence ? { evidence: prognosisEvidence } : {})}
              chapterOf={page.chapterOf}
              goTo={page.goTo}
              attached={new Set(calculatorNotes.map((note) => note.calculatorId))}
              onAttach={(note) => attachCalculatorNote(screenKey, { ...note, at: new Date().toISOString() })}
            />
          ),
          calculatorNotes: calculatorNotes.map((note) => ({ key: note.calculatorId, dp: note.dp, source: note.source, text: note.text })),
          onRemoveCalculatorNote: (key: string) => removeCalculatorNote(screenKey, key),
        } : {})}
        {...(onPointAnswer ? { onAnswerQuestion: (point: DecisionPointView, answers: string, id: string, value: boolean | undefined) => onPointAnswer(answers, id, value, questionRowOf(point, id)?.terms) } : {})}
      />
    </div>
  )
}
