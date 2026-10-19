"use client"

import { Fragment, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Noto_Serif_TC } from 'next/font/google'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import {
  ABSENT_STATES,
  BLOCK_ORDER,
  criteriaOf,
  sourceTag,
  type DecisionBasisItem,
  type DecisionCriteriaGroupView,
  type QueueRow,
  type QueueStep,
  type VisitPlanModel,
} from './visit-decisions'
import { displayDate } from './VisitStatusHeader'
import type { DecisionPointView, VisitAction, VisitBlock, VisitDecisionModel } from '../../types'
import { BookChainDone, BookDecisionControls } from './BookDecisionControls'
import { VisitBookChromeContext, isVisitBookMode } from './visit-book-chrome'
import { carriedLabel, useCarriedLookup } from './carried-answer-context'
import styles from './VisitBookLayout.module.css'
import { coronaryPhaseInput } from './physician-input'

/**
 * The visit laid out as a pocket-handbook page (owner request 2026-09-30,
 * after the Pocket Medicine-style prototype: 「把這個版面套到 localhost 上的
 * 真實 CDSS 試試看」, then 「我想要看到跟 prototype 一模一樣的畫面」). Since
 * 2026-10-01 it is the decision map (決策地圖 v2), in the CDSS panel or over the
 * whole window; the first decision map is retired.
 *
 * Left, the decision map: every point of the page under its numbered section,
 * with a mark for where it stands today — the map says where the decisions
 * are. Right, one sheet in the map's order, each point once. A decision is a
 * table row — 本病人現在, 指引怎麼說, 今天 — with its buttons; a reminder is
 * one line. A point the clinician has to weigh carries 看依據: its criteria
 * with the values, what would change the answer, the guideline's points and
 * where they come from. At the foot, today's plan.
 */

/**
 * The prototype's heading face, served by the app itself — the page's
 * font-src is 'self', so a stylesheet from Google would never load (owner
 * decision 2026-09-30, option A). Bold only, not preloaded: the browser
 * fetches only the slices the headings use (about 0.5 MB, once, then cached);
 * until then the headings read in the system serif.
 */
const bookSerif = Noto_Serif_TC({
  weight: '700',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--book-serif',
  fallback: ['Songti TC', 'PMingLiU', 'serif'],
})

/**
 * `wait`: the diagnosis left open in its table (還不確定) — not today's decision
 * any more, and not settled either, so the page never reads as complete while
 * it stands (#219 review).
 */
export type BookMark = 'safety' | 'act' | 'ask' | 'wait' | 'done' | 'info' | 'absent'

/** What a point is on this page: a decision row, a line, or covered by another. */
export type BookEntry =
  | { kind: 'row'; point: DecisionPointView; row: QueueRow; queued: boolean }
  | { kind: 'covered'; point: DecisionPointView; by: DecisionPointView }
  | { kind: 'line'; point: DecisionPointView }
  /**
   * `merged`: a point this one's table stands for too, named in its tag (the
   * prototype's 「DP-01 · DP-34」) and drawn nowhere else.
   */
  | { kind: 'slot'; point: DecisionPointView; content: ReactNode; merged?: DecisionPointView }
  | { kind: 'skip'; point: DecisionPointView; anchorOf: DecisionPointView }

export interface VisitBookLayoutProps {
  points: readonly DecisionPointView[]
  isEnglish: boolean
  sourceOfPage: DecisionPointView['source']
  entryOf: (point: DecisionPointView) => BookEntry
  markOf: (point: DecisionPointView) => BookMark
  /** A point with reasoning worth opening: criteria, a chain, several options. */
  isComplex: (point: DecisionPointView) => boolean
  openKeyOf: (point: DecisionPointView) => string
  openKey: string | null
  onToggle: (point: DecisionPointView) => void
  onDecide?: (step: QueueStep, action: VisitAction, queued: boolean) => void
  onClear?: (step: QueueStep) => void
  basisOf: (point: DecisionPointView) => readonly DecisionBasisItem[]
  /** The sentence for where the patient stands, and the values the decisions read. */
  headline: string
  keyValues: VisitDecisionModel['keyValues']
  triggers: VisitDecisionModel['triggers']
  now: Date
  /** Drawn at the head of the sheet, unseen: the screen-reader status. */
  top?: ReactNode
  plan: VisitPlanModel
  /** The sentence once everything queued is recorded. */
  decidedLine?: string
  /** The pack's chapters (`VisitDecisionModel.book`); without them, the map's groups. */
  chapters?: readonly BookChapterView[]
  /** Today's decisions, each with its point and what to recheck, for 今天的計畫. */
  decided: readonly { key: string; dp: string; source: string; label: string; check?: string }[]
  /** The note 複製到病歷 copies. */
  summaryText: string
  /**
   * Writes a class chosen in a point's classification table (HF DP-01's
   * phenotype) as the answer to the point's question; without it the table
   * is read-only.
   */
  onChooseClass?: (point: DecisionPointView, input: ClassInput) => void
  /**
   * Writes an answer to a point's questions (AF DP-08's valves) into the named
   * answer set (`af-clinical`); `undefined` withdraws it. Without it the
   * questions are read-only.
   */
  onAnswerQuestion?: (point: DecisionPointView, answers: string, id: string, value: boolean | undefined) => void
}

/** A chapter as the model carries it (`VisitBookChapter`), read defensively. */
export interface BookChapterView {
  id: string
  title: string
  short: string
  aside?: string
  settled?: boolean
  plan?: boolean
  dps: readonly string[]
  /** The part of the chapter's question each point answers (AF 抗凝：DP-07 「要不要」). */
  pointLabels?: Readonly<Record<string, string>>
  /** The points the chapter lays out as its one table, settled or not applicable ones included. */
  table?: readonly string[]
  /** Rows the table also draws for a point living in another chapter (HF 藥物's diuretic row). */
  tableRefs?: readonly BookTableRef[]
  /** Points of the table drawn as one row (HFpEF's RAS inhibition and beta-blocker). */
  tableMerged?: readonly BookTableMerge[]
}

export interface BookTableRef { dp: string; chapter: string; after?: string; label: string; now?: string }
export interface BookTableMerge { dps: readonly string[]; label: string; note?: string }

/** The model's chapters, where the pack gives them; undefined for an older pack. */
export function bookChaptersOf(model: object): BookChapterView[] | undefined {
  const raw = (model as { book?: unknown }).book
  if (!Array.isArray(raw)) return undefined
  const chapters = raw.flatMap((item): BookChapterView[] => {
    const { id, title, short, aside, settled, plan, dps, pointLabels, table, tableRefs, tableMerged } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(dps)) return []
    const labels = pointLabels && typeof pointLabels === 'object'
      ? Object.fromEntries(Object.entries(pointLabels as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}
    return [{
      id,
      title,
      short: typeof short === 'string' ? short : title,
      ...(typeof aside === 'string' ? { aside } : {}),
      ...(settled === true ? { settled: true } : {}),
      ...(plan === true ? { plan: true } : {}),
      dps: dps.filter((dp): dp is string => typeof dp === 'string'),
      ...(Object.keys(labels).length ? { pointLabels: labels } : {}),
      ...(Array.isArray(table) ? { table: table.filter((dp): dp is string => typeof dp === 'string') } : {}),
      ...(refsOf(tableRefs).length ? { tableRefs: refsOf(tableRefs) } : {}),
      ...(mergesOf(tableMerged).length ? { tableMerged: mergesOf(tableMerged) } : {}),
    }]
  })
  return chapters.length ? chapters : undefined
}

function refsOf(raw: unknown): BookTableRef[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): BookTableRef[] => {
    const { dp, chapter, after, label, now } = (item ?? {}) as Record<string, unknown>
    if (typeof dp !== 'string' || typeof chapter !== 'string' || typeof label !== 'string') return []
    return [{ dp, chapter, label, ...(typeof after === 'string' ? { after } : {}), ...(typeof now === 'string' ? { now } : {}) }]
  })
}

function mergesOf(raw: unknown): BookTableMerge[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): BookTableMerge[] => {
    const { dps, label, note } = (item ?? {}) as Record<string, unknown>
    if (!Array.isArray(dps) || typeof label !== 'string') return []
    const ids = dps.filter((dp): dp is string => typeof dp === 'string')
    return ids.length > 1 ? [{ dps: ids, label, ...(typeof note === 'string' ? { note } : {}) }] : []
  })
}

export function bookAnchor(point: Pick<DecisionPointView, 'source' | 'dp'>): string {
  return `cdss-book-${point.source}-${point.dp}`
}

const PLAN_ANCHOR = 'cdss-book-plan'

function Mark({ mark }: { mark: BookMark }) {
  return (
    <span className={styles.markSlot} aria-hidden="true">
      {mark === 'done' ? (
        <svg className={styles.markDone} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : mark === 'act' ? <span className={styles.markAct} />
        : mark === 'safety' ? <span className={styles.markSafety} />
          : mark === 'ask' ? <span className={styles.markAsk} />
            : mark === 'wait' ? <span className={styles.markWait} />
            : mark === 'info' ? <span className={styles.markInfo} />
              : null}
    </span>
  )
}

const MARK_WORDS: Record<BookMark, { zh: string; en: string }> = {
  safety: { zh: '安全', en: 'Safety' },
  act: { zh: '待決定', en: 'To decide' },
  ask: { zh: '待答', en: 'To answer' },
  wait: { zh: '尚待確診', en: 'Diagnosis open' },
  done: { zh: '已定', en: 'Settled' },
  info: { zh: '資訊', en: 'Info' },
  absent: { zh: '不適用', en: 'Not applicable' },
}

interface Section {
  key: string
  title: string
  short: string
  aside?: string
  settled?: boolean
  plan?: boolean
  /** The map group's block, where the section is one (no chapters from the pack). */
  block?: VisitBlock
  points: DecisionPointView[]
  pointLabels?: Readonly<Record<string, string>>
  table?: readonly string[]
  tableRefs?: readonly BookTableRef[]
  tableMerged?: readonly BookTableMerge[]
}

/**
 * The page's chapters: the pack's, each point of the page in the one that
 * names it and any the pack placed nowhere at the end; without them, the
 * map's groups by column, as the pack lists them.
 */
function sectionsOf(points: readonly DecisionPointView[], chapters: readonly BookChapterView[] | undefined, isEnglish: boolean): Section[] {
  if (chapters?.length) {
    const placed = new Set<DecisionPointView>()
    const sections: Section[] = chapters.map((chapter) => {
      const mine = chapter.dps.flatMap((dp) => points.filter((point) => point.dp === dp && !placed.has(point)))
      mine.forEach((point) => placed.add(point))
      return {
        key: chapter.id,
        title: chapter.title,
        short: chapter.short,
        ...(chapter.aside ? { aside: chapter.aside } : {}),
        ...(chapter.settled ? { settled: true } : {}),
        ...(chapter.plan ? { plan: true } : {}),
        ...(chapter.pointLabels ? { pointLabels: chapter.pointLabels } : {}),
        ...(chapter.table?.length ? { table: chapter.table } : {}),
        ...(chapter.tableRefs?.length ? { tableRefs: chapter.tableRefs } : {}),
        ...(chapter.tableMerged?.length ? { tableMerged: chapter.tableMerged } : {}),
        points: mine,
      }
    })
    const rest = points.filter((point) => !placed.has(point))
    if (rest.length) sections.push({ key: 'other', title: isEnglish ? 'Other points' : '其他決策點', short: isEnglish ? 'Other' : '其他', points: rest })
    // The plan's points close the page, after every chapter.
    return [...sections.filter((section) => !section.plan), ...sections.filter((section) => section.plan)]
  }
  const sections: Section[] = []
  for (const block of BLOCK_ORDER) {
    for (const point of points.filter((candidate) => candidate.block === block)) {
      const key = `${block}|${point.group}`
      let section = sections.find((candidate) => candidate.key === key)
      if (!section) {
        const title = point.groupLabel ?? point.group
        section = { key, block, title, short: title, points: [] }
        sections.push(section)
      }
      section.points.push(point)
    }
  }
  return sections
}

/** A not-applicable point's reason, where its line says it in a few words; else nothing. */
function shortReason(headline: string): string | undefined {
  let width = 0
  for (const character of headline) width += character.charCodeAt(0) <= 0xff ? 0.5 : 1
  return width <= 14 ? headline : undefined
}

const sectionAnchor = (key: string) => `cdss-book-section-${key.replace(/[^a-z0-9-]/gi, '-')}`

/** 「什麼會改變答案」, read defensively: a pack older than the field has none. */
function changesOf(point: DecisionPointView): { when: string; then: string }[] {
  const raw = (point as { changesIf?: unknown }).changesIf
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const { when, then } = (item ?? {}) as { when?: unknown; then?: unknown }
    return typeof when === 'string' && typeof then === 'string' ? [{ when, then }] : []
  })
}

interface CriterionView { label: string; value?: string; met?: boolean }
interface OptionRowView {
  name: string
  standard?: string
  patient: string
  basis?: string
  status?: string
  current?: boolean
  conditions?: { rule?: string; items: CriterionView[]; note?: string }
}

function criterionOf(raw: unknown): CriterionView | undefined {
  const { label, value, met } = (raw ?? {}) as Record<string, unknown>
  if (typeof label !== 'string') return undefined
  return { label, ...(typeof value === 'string' ? { value } : {}), ...(typeof met === 'boolean' ? { met } : {}) }
}

/**
 * The criteria a row draws in its 指引怎麼說 cell: a dose rule beside the
 * options it chooses between — DP-14's apixaban reduction, as the prototype
 * draws it. Any other point's criteria (DP-04's triggers, a pillar's start
 * conditions, I NEED HELP) are its 看依據, and the cell keeps the guideline's
 * line, so the table reads as the handbook's.
 */
function inlineCriteriaOf(point: object | undefined): DecisionCriteriaGroupView[] {
  return optionTableOf(point) ? criteriaOf(point) : []
}

/** Every option side by side (the DOACs at this patient's dose), read defensively like `changesOf`. */
function optionTableOf(point: object | undefined): { title: string; rows: OptionRowView[] } | undefined {
  const raw = (point as { optionTable?: unknown } | undefined)?.optionTable
  if (!raw || typeof raw !== 'object') return undefined
  const { title, rows } = raw as { title?: unknown; rows?: unknown }
  if (typeof title !== 'string' || !Array.isArray(rows)) return undefined
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const parsed = rows.flatMap((row): OptionRowView[] => {
    const { name, standard, patient, basis, status, current, conditions } = (row ?? {}) as Record<string, unknown>
    if (typeof name !== 'string' || typeof patient !== 'string') return []
    const { rule, items, note } = (conditions ?? {}) as Record<string, unknown>
    const criteria = Array.isArray(items) ? items.flatMap((item) => criterionOf(item) ?? []) : []
    return [{
      name,
      patient,
      ...(text(standard) ? { standard: text(standard) } : {}),
      ...(text(basis) ? { basis: text(basis) } : {}),
      ...(text(status) ? { status: text(status) } : {}),
      ...(current === true ? { current: true } : {}),
      ...(criteria.length ? { conditions: { items: criteria, ...(text(rule) ? { rule: text(rule) } : {}), ...(text(note) ? { note: text(note) } : {}) } } : {}),
    }]
  })
  return parsed.length ? { title, rows: parsed } : undefined
}

interface ScoreTableView {
  title: string
  rows: { id: string; label: string; points: number; met?: boolean; evidence: string }[]
  total?: number
  verdict?: string
  /** The verdict waits on something (a missing item, HCM, a bleed): not a conclusion yet. */
  pending?: boolean
}

/** A point's score, item by item (AF DP-07's CHA₂DS₂-VA), read defensively like `changesOf`. */
function scoreTableOf(point: object | undefined): ScoreTableView | undefined {
  const raw = (point as { scoreTable?: unknown } | undefined)?.scoreTable
  if (!raw || typeof raw !== 'object') return undefined
  const { title, rows, total, verdict, pending } = raw as Record<string, unknown>
  if (typeof title !== 'string' || !Array.isArray(rows)) return undefined
  const parsed = rows.flatMap((row): ScoreTableView['rows'] => {
    const { id, label, points, met, evidence } = (row ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string' || typeof points !== 'number') return []
    return [{ id, label, points, evidence: typeof evidence === 'string' ? evidence : '', ...(typeof met === 'boolean' ? { met } : {}) }]
  })
  if (!parsed.length) return undefined
  return {
    title,
    rows: parsed,
    ...(typeof total === 'number' ? { total } : {}),
    ...(typeof verdict === 'string' ? { verdict } : {}),
    // A pack from before `pending` marks only a missing total.
    ...(pending === true || typeof total !== 'number' ? { pending: true } : {}),
  }
}

interface QuestionsView {
  title: string
  answers: string
  rows: { id: string; label: string; detail?: string; answer?: boolean; record?: boolean; recordHolds?: boolean; terms?: string[] }[]
  bulkNone?: boolean
  labels?: { yes: string; no: string }
  note?: string
}

/** What a point asks before it decides (AF DP-08's valves), read defensively like `changesOf`. */
function questionsOf(point: object | undefined): QuestionsView | undefined {
  return parseQuestions((point as { questions?: unknown } | undefined)?.questions)
}

/** The further question groups a point asks (HF DP-06's 誘因), each read as `questionsOf` reads one. */
function questionGroupsOf(point: object | undefined): QuestionsView[] {
  const raw = (point as { questionGroups?: unknown } | undefined)?.questionGroups
  return Array.isArray(raw) ? raw.flatMap((group) => parseQuestions(group) ?? []) : []
}

interface MoreQuestionsView {
  title: string
  badge?: string
  groups: QuestionsView[]
  note?: string
}

/** A point's folded, optional questions (HF DP-06's other symptoms and signs), read defensively. */
function moreQuestionsOf(point: object | undefined): MoreQuestionsView | undefined {
  const raw = (point as { moreQuestions?: unknown } | undefined)?.moreQuestions
  if (!raw || typeof raw !== 'object') return undefined
  const { title, badge, groups, note } = raw as Record<string, unknown>
  const parsed = Array.isArray(groups) ? groups.flatMap((group) => parseQuestions(group) ?? []) : []
  if (typeof title !== 'string' || !parsed.length) return undefined
  return {
    title,
    ...(typeof badge === 'string' ? { badge } : {}),
    groups: parsed,
    ...(typeof note === 'string' ? { note } : {}),
  }
}

/** The row a point's questions hold under an id, in `questions`, a further group or the fold — for its `terms`. */
export function questionRowOf(point: object, id: string): QuestionsView['rows'][number] | undefined {
  return [questionsOf(point), ...questionGroupsOf(point), ...(moreQuestionsOf(point)?.groups ?? [])]
    .flatMap((group) => group?.rows ?? []).find((row) => row.id === id)
}

function parseQuestions(raw: unknown): QuestionsView | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { title, answers, rows, bulkNone, note, labels } = raw as Record<string, unknown>
  if (typeof title !== 'string' || typeof answers !== 'string' || !Array.isArray(rows)) return undefined
  const parsed = rows.flatMap((row): QuestionsView['rows'] => {
    const { id, label, detail, answer, record, recordHolds, terms } = (row ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string') return []
    const termList = Array.isArray(terms) ? terms.filter((term): term is string => typeof term === 'string') : []
    return [{
      id,
      label,
      ...(typeof detail === 'string' ? { detail } : {}),
      ...(typeof answer === 'boolean' ? { answer } : {}),
      ...(typeof record === 'boolean' ? { record } : {}),
      ...(recordHolds === true ? { recordHolds: true } : {}),
      ...(termList.length ? { terms: termList } : {}),
    }]
  })
  if (!parsed.length) return undefined
  const { yes, no } = (labels ?? {}) as Record<string, unknown>
  return {
    title,
    answers,
    rows: parsed,
    ...(bulkNone === true ? { bulkNone: true } : {}),
    ...(typeof yes === 'string' && typeof no === 'string' ? { labels: { yes, no } } : {}),
    ...(typeof note === 'string' ? { note } : {}),
  }
}

interface ProfileGridView {
  title: string
  columns: { id: string; label: string }[]
  rows: { id: string; label: string }[]
  cells: { row: string; column: string; label: string; action: string }[]
  current?: { row?: string; column?: string }
  reading: string
  note?: string
}

/** The two-axis profile a point places the patient in (HF DP-06's 乾濕 by 冷暖), read defensively. */
function profileGridOf(point: object | undefined): ProfileGridView | undefined {
  const raw = (point as { profileGrid?: unknown } | undefined)?.profileGrid
  if (!raw || typeof raw !== 'object') return undefined
  const { title, columns, rows, cells, current, reading, note } = raw as Record<string, unknown>
  const axis = (value: unknown) => (Array.isArray(value)
    ? value.flatMap((item) => {
      const { id, label } = (item ?? {}) as Record<string, unknown>
      return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : []
    })
    : [])
  const cellList = Array.isArray(cells)
    ? cells.flatMap((cell) => {
      const { row, column, label, action } = (cell ?? {}) as Record<string, unknown>
      return typeof row === 'string' && typeof column === 'string' && typeof label === 'string' && typeof action === 'string'
        ? [{ row, column, label, action }]
        : []
    })
    : []
  if (typeof title !== 'string' || typeof reading !== 'string' || !cellList.length) return undefined
  const { row, column } = (current ?? {}) as Record<string, unknown>
  return {
    title,
    columns: axis(columns),
    rows: axis(rows),
    cells: cellList,
    ...(typeof row === 'string' || typeof column === 'string'
      ? { current: { ...(typeof row === 'string' ? { row } : {}), ...(typeof column === 'string' ? { column } : {}) } }
      : {}),
    reading,
    ...(typeof note === 'string' ? { note } : {}),
  }
}

/**
 * The prototype's 2×2 (乾／濕 by 暖／冷): each cell with what it means today,
 * the one the answers settle drawn as the patient's, and what that means.
 */
function ProfileGrid({ grid }: { grid: ProfileGridView }) {
  const cell = (row: string, column: string) => grid.cells.find((item) => item.row === row && item.column === column)
  return (
    <div className={styles.profile} data-testid="cdss-book-profile-grid">
      <table className={styles.profileGrid} aria-label={grid.title}>
        <thead>
          <tr>
            <td />
            {grid.columns.map((column) => (
              <th key={column.id} scope="col" data-current={grid.current?.column === column.id || undefined}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" data-current={grid.current?.row === row.id || undefined}>{row.label}</th>
              {grid.columns.map((column) => {
                const item = cell(row.id, column.id)
                const here = grid.current?.row === row.id && grid.current?.column === column.id
                return (
                  <td key={column.id} className={styles.profileCell} data-current={here || undefined} data-book-profile-cell={`${row.id}-${column.id}`}>
                    {item ? <><b>{item.label}</b><br />{item.action}</> : null}
                    {here ? <span className="sr-only">（本病人）</span> : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.profileReading} data-testid="cdss-book-profile-reading">{grid.reading}</p>
      {grid.note ? <p className={styles.profileNote}>{grid.note}</p> : null}
    </div>
  )
}

interface StartDoseRowView { name: string; dose: string; role: string; when: string; proposed?: boolean }

/** 起始劑量怎麼選, read defensively like `changesOf`. */
function startDosesOf(point: object | undefined): { title: string; values?: string; rows: StartDoseRowView[] } | undefined {
  const raw = (point as { startDoses?: unknown } | undefined)?.startDoses
  if (!raw || typeof raw !== 'object') return undefined
  const { title, values, rows } = raw as { title?: unknown; values?: unknown; rows?: unknown }
  if (typeof title !== 'string' || !Array.isArray(rows)) return undefined
  const parsed = rows.flatMap((row): StartDoseRowView[] => {
    const { name, dose, role, when, proposed } = (row ?? {}) as Record<string, unknown>
    if (typeof name !== 'string' || typeof dose !== 'string' || typeof when !== 'string') return []
    return [{ name, dose, when, role: typeof role === 'string' ? role : 'start', ...(proposed === true ? { proposed: true } : {}) }]
  })
  return parsed.length ? { title, ...(typeof values === 'string' ? { values } : {}), rows: parsed } : undefined
}

/** What choosing a class writes: the physician input the point's own question writes. */
export type ClassInput = NonNullable<VisitAction['physicianInput']>

interface ClassChoice { id: string; label: string; physicianInput?: ClassInput; chosen?: boolean }
interface ClassificationView {
  title: string
  rowLabel?: string
  classes: (ClassChoice & { definition: string; current?: boolean })[]
  patient?: string
  alternatives: (ClassChoice & { physicianInput: ClassInput })[]
}

function classInputOf(raw: unknown): ClassInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { request, optionId } = raw as Record<string, unknown>
  if (typeof request !== 'string') return undefined
  return { request, ...(typeof optionId === 'string' ? { optionId } : {}) } as ClassInput
}

/** A point's classification table (HF DP-01's phenotype), read defensively like `changesOf`. */
function classificationOf(point: object | undefined): ClassificationView | undefined {
  const raw = (point as { classification?: unknown } | undefined)?.classification
  if (!raw || typeof raw !== 'object') return undefined
  const { title, classes, patient, alternatives, rowLabel } = raw as Record<string, unknown>
  if (typeof title !== 'string' || !Array.isArray(classes)) return undefined
  const parsed = classes.flatMap((item): ClassificationView['classes'] => {
    const { id, label, definition, current, physicianInput, chosen } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string' || typeof definition !== 'string') return []
    const input = classInputOf(physicianInput)
    return [{
      id,
      label,
      definition,
      ...(current === true ? { current: true } : {}),
      ...(input ? { physicianInput: input } : {}),
      ...(chosen === true ? { chosen: true } : {}),
    }]
  })
  if (!parsed.length) return undefined
  const others = (Array.isArray(alternatives) ? alternatives : []).flatMap((item): ClassificationView['alternatives'] => {
    const { id, label, physicianInput, chosen } = (item ?? {}) as Record<string, unknown>
    const input = classInputOf(physicianInput)
    if (typeof id !== 'string' || typeof label !== 'string' || !input) return []
    return [{ id, label, physicianInput: input, ...(chosen === true ? { chosen: true } : {}) }]
  })
  return {
    title,
    ...(typeof rowLabel === 'string' ? { rowLabel } : {}),
    classes: parsed,
    ...(typeof patient === 'string' ? { patient } : {}),
    alternatives: others,
  }
}

/**
 * The classes side by side, the patient's column marked, as the prototype's
 * DP-01 table — and, where the pack says what each class answers and the page
 * can write it, the place the clinician answers (owner request 2026-09-30:
 * 「新的可能要讓醫師可以點」): a button under each class it offers, and the
 * answers beside the classes (「還不確定」) under the table.
 */
function ClassificationTable({ point, isEnglish, onChoose, tag }: { point: DecisionPointView; isEnglish: boolean; onChoose?: (input: ClassInput) => void; tag?: string }) {
  const choiceId = useId()
  const table = classificationOf(point)
  if (!table) return null
  const current = table.classes.find((item) => item.current)
  const choosable = onChoose && (table.classes.some((item) => item.physicianInput) || table.alternatives.length > 0)
  // The month field belongs to CAD DP-01's two windowed classes, once chosen.
  const chosenPhase = table.classes.find((item) => item.chosen && item.physicianInput?.request === 'cad-phase')?.id
  const monthFor = chosenPhase === 'acs-recent' || chosenPhase === 'pci-recent' ? chosenPhase : undefined
  const choose = (item: ClassChoice) => {
    // The same answer again writes nothing new.
    if (item.physicianInput && !item.chosen) onChoose?.(item.physicianInput)
  }
  return (
    <div className={styles.classWrap} data-testid="cdss-book-classification">
      <div className={styles.optScroll}>
        <table className={styles.classTable} aria-label={table.title}>
          <thead>
            <tr>
              <th scope="col"><span className={styles.dpTag}>{tag ?? point.dp}</span></th>
              {table.classes.map((item) => (
                <th key={item.id} scope="col" data-current={item.current || undefined}>
                  {item.label}{item.current ? (isEnglish ? ' ← this patient' : ' ← 本病人') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{table.rowLabel ?? (isEnglish ? 'Definition' : '定義')}</th>
              {table.classes.map((item) => <td key={item.id} data-current={item.current || undefined}>{item.definition}</td>)}
            </tr>
            {table.patient ? (
              <tr>
                <th scope="row">{isEnglish ? 'This patient' : '本病人'}</th>
                {current
                  ? table.classes.map((item) => <td key={item.id} data-current={item.current || undefined} className={item.current ? styles.classPatient : undefined}>{item.current ? table.patient : ''}</td>)
                  : <td colSpan={table.classes.length}>{table.patient}</td>}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {choosable ? (
        // The answer as every answer on the page is given (the prototype's
        // 「喘比上次」): one segmented control, the classes it offers and the
        // answers beside them (「還不確定」); the table itself stays as the
        // prototype draws it, only to read.
        <div className={styles.askRow} data-testid="cdss-book-class-choices">
          <span id={`${choiceId}-label`} className={styles.askLabel}>{isEnglish ? 'Your call' : '你的判斷'}</span>
          <div role="group" aria-labelledby={`${choiceId}-label`} className={styles.askGroup}>
            {[...table.classes.filter((item) => item.physicianInput), ...table.alternatives].map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={Boolean(item.chosen)}
                onClick={() => choose(item)}
                data-testid={`cdss-book-class-${item.id}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {monthFor ? <EventMonthField key={monthFor} isEnglish={isEnglish} onSet={(month) => onChoose?.(coronaryPhaseInput(monthFor, month))} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * CAD DP-01's 「知道年月？」 (owner request 2026-10-19: 「除了三個選項也開放
 * user 知道具體年月想寫上去」): closed until asked for, and never required.
 * The month rides on the same `cad-phase` answer as the class it dates.
 */
function EventMonthField({ isEnglish, onSet }: { isEnglish: boolean; onSet: (month: string) => void }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!open) {
    return (
      <button type="button" className={styles.askNote} onClick={() => setOpen(true)} data-testid="cdss-book-class-month-open">
        {isEnglish ? 'Know the month?' : '知道年月？'}
      </button>
    )
  }
  return (
    <span className={styles.askNote}>
      <label htmlFor={id}>{isEnglish ? 'Event month ' : '事件年月 '}</label>
      <input
        id={id}
        type="month"
        max={new Date().toISOString().slice(0, 7)}
        onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onSet(event.target.value) }}
        data-testid="cdss-book-class-month"
      />
    </span>
  )
}

/** A score item by item, as the prototype's 「要不要：CHA₂DS₂-VA」 table. */
function ScoreTable({ table, isEnglish }: { table: ScoreTableView; isEnglish: boolean }) {
  return (
    <table className={styles.scoreTable} aria-label={table.title} data-testid="cdss-book-score">
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.id} data-met={row.met === true || undefined} data-book-score-item={row.id}>
            <td className={styles.scoreMark}>
              <span aria-hidden="true">{row.met ? '✓' : '✗'}</span>
              <span className="sr-only">{row.met ? (isEnglish ? 'counts' : '符合') : row.met === false ? (isEnglish ? 'does not count' : '不符合') : (isEnglish ? 'nothing on record' : '紀錄無')}</span>
            </td>
            <td>{row.label}</td>
            <td className={styles.scorePoints}>{row.points}</td>
            <td className={styles.scoreEvidence}>{row.evidence}</td>
          </tr>
        ))}
        <tr className={styles.scoreTotal}>
          <td />
          <td>{isEnglish ? 'Total' : '合計'}</td>
          <td className={styles.scorePoints}>{table.total ?? '—'}</td>
          <td className={table.pending ? styles.scorePending : styles.scoreVerdict} data-pending={table.pending || undefined}>{table.verdict}</td>
        </tr>
      </tbody>
    </table>
  )
}

type AnswerQuestion = (id: string, value: boolean | undefined) => void

/**
 * 「全部皆無」 over a point's questions: 無 on every row not yet answered, never
 * over a row the record holds but cannot settle, nor one answered 有 (then it
 * reads 「其餘皆無」); pressed again, it takes those 無 back.
 */
function BulkNone({ questions, isEnglish, onAnswer }: { questions: QuestionsView; isEnglish: boolean; onAnswer?: AnswerQuestion }) {
  // A row the record reads 有, or holds but cannot settle, is the clinician's to answer row by row.
  const open = questions.rows.filter((row) => !row.recordHolds && (row.answer ?? row.record) !== true)
  if (!onAnswer || !open.length) return null
  const pressed = open.every((row) => row.answer === false)
  const anyYes = questions.rows.some((row) => (row.answer ?? row.record) === true)
  return (
    <button
      type="button"
      className={styles.bulkNone}
      aria-pressed={pressed}
      onClick={() => {
        for (const row of open) {
          if (pressed) onAnswer(row.id, undefined)
          else if (row.answer === undefined) onAnswer(row.id, false)
        }
      }}
      data-book-bulk-none=""
    >
      {anyYes ? (isEnglish ? 'None of the rest' : '其餘皆無') : (isEnglish ? 'None of these' : '全部皆無')}
      {pressed ? (isEnglish ? ' · press again to undo' : ' · 再按復原') : ''}
    </button>
  )
}

/** A point's questions, each 有／無 as one segmented control; the chosen one pressed again withdraws it. */
function PointQuestions({ questions, isEnglish, onAnswer, titled }: { questions: QuestionsView; isEnglish: boolean; onAnswer?: AnswerQuestion; titled: boolean }) {
  const idBase = useId()
  const carriedLookup = useCarriedLookup()
  const options = [
    { value: true, label: questions.labels?.yes ?? (isEnglish ? 'Yes' : '有') },
    { value: false, label: questions.labels?.no ?? (isEnglish ? 'No' : '無') },
  ]
  /** The day a row's answer was carried from, while it still stands; a sign row is carried when any of its terms is. */
  const carriedOf = (row: QuestionsView['rows'][number]): string | null => {
    if (row.answer === undefined) return null
    if (questions.answers === 'visit') return carriedLookup(`visit:${row.id}`)
    if (questions.answers === 'af-clinical') return carriedLookup(`af:${row.id}`)
    if (questions.answers === 'clinic-exam') return (row.terms ?? []).map((term) => carriedLookup(`sign:${term}`)).find(Boolean) ?? null
    return null
  }
  return (
    <div className={styles.questions} data-testid="cdss-book-questions">
      {titled ? (
        <div className={styles.questionsHead}>
          <span className={styles.questionsTitle}>{questions.title}</span>
          {questions.bulkNone ? <BulkNone questions={questions} isEnglish={isEnglish} {...(onAnswer ? { onAnswer } : {})} /> : null}
        </div>
      ) : null}
      {questions.rows.map((row) => (
        <div key={row.id} className={styles.questionRow} data-book-question={row.id}>
          <span id={`${idBase}-${row.id}`}>
            {row.label}
            {row.detail ? <span className={styles.questionDetail}>{row.detail}</span> : null}
            {carriedOf(row) ? (
              <span className={styles.carriedNote} data-carried-from={carriedOf(row) ?? undefined}>{carriedLabel(carriedOf(row) ?? '', isEnglish)}</span>
            ) : null}
          </span>
          <div role="group" aria-labelledby={`${idBase}-${row.id}`} className={styles.questionGroup}>
            {options.map((option) => {
              // The record's reading stands until the clinician answers; pressing it makes it theirs,
              // pressing their own answer again withdraws it.
              const prefilled = row.answer === undefined && row.record === option.value
              const selected = row.answer === option.value || prefilled
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  aria-pressed={selected}
                  disabled={!onAnswer}
                  data-prefilled={prefilled || undefined}
                  onClick={() => onAnswer?.(row.id, row.answer === option.value ? undefined : option.value)}
                >
                  {option.label}
                  {prefilled ? <span className="sr-only">{isEnglish ? ' (from the record)' : '（紀錄預填）'}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {questions.note ? <p className={styles.questionsNote}>{questions.note}</p> : null}
    </div>
  )
}

/**
 * A point's folded, optional questions — HF DP-06's other symptoms and signs
 * (owner decision 2026-10-02, the design canvas 「決策地圖 v2 · 今日評估」).
 * Folded, the head names what is inside, or once any is answered how many and
 * what was found; open, the groups side by side, and 「其餘皆無」 across them.
 * A row left blank was not assessed: the fold never answers it.
 */
function MoreQuestions({ more, isEnglish, onAnswer }: {
  more: MoreQuestionsView
  isEnglish: boolean
  onAnswer?: (group: QuestionsView, id: string, value: boolean | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const rows = more.groups.flatMap((group) => group.rows)
  const answered = rows.filter((row) => row.answer !== undefined)
  const found = rows.filter((row) => row.answer === true)
  const sep = isEnglish ? ', ' : '、'
  const count = answered.length
    ? `${isEnglish ? `${answered.length} of ${rows.length} answered` : `已答 ${answered.length}／${rows.length}`}${
      found.length
        ? `${isEnglish ? ' · present: ' : '・有：'}${found.map((row) => row.label).join(sep)}`
        : answered.length === rows.length ? (isEnglish ? ' · none' : '・皆無') : ''
    }`
    : (isEnglish ? 'Not answered' : '尚未填')
  const unanswered = more.groups.flatMap((group) => group.rows.filter((row) => row.answer === undefined).map((row) => ({ group, row })))
  return (
    <div className={styles.more} data-book-more="" {...(open ? { 'data-open': '' } : {})}>
      <button type="button" className={styles.moreHead} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true" className={styles.moreCaret}>{open ? '▾' : '▸'}</span>
        <span className={styles.moreText}>
          <span><b>{more.title}</b>{more.badge ? <span className={styles.moreBadge}>{more.badge}・{isEnglish ? `${rows.length} items` : `${rows.length} 項`}</span> : null}</span>
          {open ? null : <span className={styles.moreItems}>{more.groups.map((group) => group.rows.map((row) => row.label).join(sep)).join(isEnglish ? ' · ' : '・')}</span>}
        </span>
        <span className={styles.moreCount}>{count}</span>
      </button>
      {open ? (
        <div id={bodyId} className={styles.moreBody}>
          <div className={styles.moreGroups}>
            {more.groups.map((group) => (
              <PointQuestions
                key={group.title}
                questions={group}
                isEnglish={isEnglish}
                titled
                {...(onAnswer ? { onAnswer: (id: string, value: boolean | undefined) => onAnswer(group, id, value) } : {})}
              />
            ))}
          </div>
          <div className={styles.moreFoot}>
            {onAnswer && unanswered.length ? (
              <button
                type="button"
                className={styles.bulkNone}
                onClick={() => { for (const { group, row } of unanswered) onAnswer(group, row.id, false) }}
                data-book-more-none=""
              >
                {answered.length ? (isEnglish ? 'None of the rest' : '其餘皆無') : (isEnglish ? 'None of these' : '全部皆無')}
              </button>
            ) : null}
            {more.note ? <span>{more.note}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Every option at this patient's dose, as the prototype's 「多少」 table: 藥｜標準｜減量條件（本病人）｜本病人劑量. */
/**
 * A locale layer's lines under a point (CAD core §7.2): the payer's coverage
 * — 「健保給付」 on a Taiwan deployment — tagged with its source, never in the
 * point's own words. A deployment without the layer draws nothing here.
 */
function CoverageLines({ point, isEnglish }: { point: DecisionPointView; isEnglish: boolean }) {
  const lines = point.coverage ?? []
  if (!lines.length) return null
  return (
    <div className={styles.coverage} data-book-coverage="">
      {lines.map((line) => (
        <p key={`${line.source}|${line.text}`} className={styles.coverageLine} data-coverage-status={line.status}>
          <span className={styles.coverageTag}>{line.source}</span>
          <span>{line.text}</span>
          {line.remindAt ? <span className="sr-only">{isEnglish ? `Reminder ${line.remindAt}` : `提醒點 ${line.remindAt}`}</span> : null}
        </p>
      ))}
    </div>
  )
}

function DoseTable({ table, isEnglish }: { table: { title: string; rows: OptionRowView[] }; isEnglish: boolean }) {
  const mark = (met: boolean | undefined) => (met === true ? '✓' : met === false ? '✗' : '？')
  return (
    <div className={styles.optScroll}>
      <table className={styles.doseTable} aria-label={table.title} data-testid="cdss-book-dose-table">
        <thead>
          <tr>
            <th scope="col">{isEnglish ? 'Agent' : '藥'}</th>
            <th scope="col">{isEnglish ? 'Usual' : '標準'}</th>
            <th scope="col">{isEnglish ? 'Reduction criteria (this patient)' : '減量條件（本病人）'}</th>
            <th scope="col">{isEnglish ? 'This patient' : '本病人劑量'}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.name} data-current={row.current || undefined} data-status={row.status}>
              <td><b>{row.name}{row.current ? (isEnglish ? ' ← prescribed' : ' ← 現用') : ''}</b></td>
              <td>{row.standard ?? '—'}</td>
              <td>
                {row.conditions ? (
                  <>
                    {row.conditions.rule ? `${row.conditions.rule}${isEnglish ? ': ' : '：'}` : null}
                    {row.conditions.items.map((item, index) => (
                      <Fragment key={item.label}>
                        {index ? ' · ' : null}
                        <span className={item.met === true ? styles.met : item.met === false ? styles.unmet : styles.unknown}>
                          {mark(item.met)} {item.label}{item.value ? `（${item.value}）` : ''}
                        </span>
                      </Fragment>
                    ))}
                    {row.conditions.note ? `${isEnglish ? '; ' : '；'}${row.conditions.note}` : null}
                  </>
                ) : row.basis ?? '—'}
              </td>
              <td className={row.current ? styles.doseCurrent : undefined}>{row.patient}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The criteria, each with its value and the date the record line gave it. */
function Criteria({ point, basis, isEnglish, dated }: { point: DecisionPointView; basis: readonly DecisionBasisItem[]; isEnglish: boolean; dated?: boolean }) {
  const groups = criteriaOf(point)
  if (!groups.length) return null
  return (
    <div data-visit-criteria="">
      {groups.map((group) => (
        <div key={group.title} className={styles.critGroup} data-visit-criteria-group={group.title}>
          <p className={dated ? styles.panelLabel : styles.critTitle}>{group.title}</p>
          <ul className={dated ? styles.panelPlain : styles.critList}>
            {group.items.map((item) => {
              const state = item.met === true ? 'met' : item.met === false ? 'unmet' : 'unknown'
              const date = dated && item.value ? basis.find((value) => value.value === item.value)?.date : undefined
              return (
                <li key={item.label} className={state === 'unmet' ? styles.unmet : state === 'unknown' ? styles.unknown : undefined}>
                  <span className={`${styles.critSymbol} ${styles[state]}`} aria-hidden="true">{state === 'met' ? '✓' : state === 'unmet' ? '✗' : '？'}</span>
                  <span className="sr-only">{state === 'met' ? (isEnglish ? 'met: ' : '符合：') : state === 'unmet' ? (isEnglish ? 'not met: ' : '不符合：') : (isEnglish ? 'unknown: ' : '未知：')}</span>
                  {item.label}
                  {item.value ? <>　<b>{item.value}</b></> : state === 'unknown' ? <>　{isEnglish ? 'not in the record, please confirm' : '紀錄未見，請確認'}</> : null}
                  {date ? <> <span className={styles.date}>{date}</span></> : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function VisitBookLayout({
  points,
  isEnglish,
  sourceOfPage,
  entryOf,
  markOf,
  isComplex,
  openKeyOf,
  openKey,
  onToggle,
  onDecide,
  onClear,
  basisOf,
  headline,
  keyValues,
  triggers,
  now,
  top,
  plan,
  decidedLine,
  chapters,
  decided,
  summaryText,
  onChooseClass,
  onAnswerQuestion,
}: VisitBookLayoutProps) {
  const chrome = useContext(VisitBookChromeContext)
  const onSaveTarget = chrome?.onSaveTarget
  const attachSaveTarget = useCallback((target: HTMLDivElement | null) => onSaveTarget?.(target), [onSaveTarget])
  // Inside the CDSS panel unless the page around it says otherwise, or the
  // address asks for the whole window (`?visit=book`).
  const [urlBook] = useState(isVisitBookMode)
  const inline = chrome ? Boolean(chrome.inline) : !urlBook
  const [mapOpen, setMapOpen] = useState(true)
  // Over the whole window, Esc returns to the panel, as a dialog would.
  const onCollapse = chrome?.onCollapse
  useEffect(() => {
    if (!onCollapse) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onCollapse() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCollapse])
  // Over the whole window the page is all there is: what it covers is out of
  // reach — Tab no longer walks into the panel and the header underneath, and
  // a screen reader no longer reads them — until it is back in the panel.
  const bookRef = useRef<HTMLDivElement>(null)
  const overWindow = !inline
  useEffect(() => {
    const book = bookRef.current
    if (!overWindow || !book) return
    const covered: Element[] = []
    for (let node: Element = book; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        // A live region (the toasts, the route announcer) still has to be heard.
        if (sibling === node || sibling.hasAttribute('inert') || sibling.matches('script, style, template, [aria-live], next-route-announcer')) continue
        sibling.setAttribute('inert', '')
        covered.push(sibling)
      }
    }
    return () => covered.forEach((element) => element.removeAttribute('inert'))
  }, [overWindow])
  // A point's own questions under its row or line — in place of the page's older question folds there.
  const pointQuestions = (point: DecisionPointView, className: string) => {
    const questions = questionsOf(point)
    if (!questions) return null
    const answer: AnswerQuestion | undefined = onAnswerQuestion
      ? (id, value) => onAnswerQuestion(point, questions.answers, id, value)
      : undefined
    return (
      <div className={className}>
        <PointQuestions questions={questions} isEnglish={isEnglish} titled={questions.rows.length > 1 || Boolean(questions.bulkNone)} {...(answer ? { onAnswer: answer } : {})} />
      </div>
    )
  }
  const classTable = (point: DecisionPointView, tag?: string) => (
    <ClassificationTable
      point={point}
      isEnglish={isEnglish}
      {...(tag ? { tag } : {})}
      {...(onChooseClass ? { onChoose: (input: ClassInput) => onChooseClass(point, input) } : {})}
    />
  )
  const { copied, copy } = useCopyToClipboard()
  const sections = sectionsOf(points, chapters, isEnglish)
  // The guideline sources the page cites, numbered as they first appear; the
  // 指引怎麼說 cell carries its point's number, the foot of the page the list.
  const citations: string[] = []
  const citationOf = (point: DecisionPointView) => {
    const reference = point.guideline?.references[0]
    if (!reference || ABSENT_STATES.has(point.state)) return undefined
    const cite = `${reference.source} §${reference.section}（p.${reference.page}）`
    if (!citations.includes(cite)) citations.push(cite)
    return citations.indexOf(cite) + 1
  }
  const onCopy = async () => {
    const ok = await copy(summaryText)
    if (!ok) toast.error(isEnglish ? 'Could not copy — the clipboard is unavailable in this context.' : '無法複製，此環境無法使用剪貼簿。')
  }
  // Back to the panel: the same address without `?visit=book`.
  const exitHref = (() => {
    if (typeof window === 'undefined') return undefined
    const url = new URL(window.location.href)
    url.searchParams.delete('visit')
    return `${url.pathname}${url.search}${url.hash}`
  })()
  const scrollTo = (id: string) => {
    // A point drawn inside a merged row is reached at the row: its own
    // anchor is an empty mark, with nothing to show focus on.
    const anchor = document.getElementById(id)
    const target = anchor?.closest<HTMLElement>('[data-book-merged]') ?? anchor
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    target?.focus?.({ preventScroll: true })
  }
  const goTo = (point: DecisionPointView) => {
    const entry = entryOf(point)
    scrollTo(bookAnchor(entry.kind === 'skip' ? entry.anchorOf : point))
  }
  const marks = new Map(points.map((point) => [point, markOf(point)] as const))
  const pending = points.filter((point) => ['act', 'safety'].includes(marks.get(point)!))
  const asking = points.filter((point) => marks.get(point) === 'ask')
  const waiting = points.filter((point) => marks.get(point) === 'wait')
  const counted = points.filter((point) => marks.get(point) !== 'absent')

  const reasoningButton = (point: DecisionPointView) => {
    if (!isComplex(point)) return null
    const open = openKey === openKeyOf(point)
    return (
      <button
        type="button"
        className={styles.whyPill}
        aria-expanded={open}
        onClick={() => onToggle(point)}
        data-book-reasoning={point.dp}
      >
        {open ? (isEnglish ? 'Hide reasoning' : '收起依據') : (isEnglish ? 'Reasoning ▸' : '看依據 ▸')}
      </button>
    )
  }

  /** 看依據: what the decision turns on, what would change it, the guideline, the sources. */
  const reasoning = (head: DecisionPointView, shown: DecisionPointView, drawn: { table?: boolean } = {}) => {
    if (openKey !== openKeyOf(head)) return null
    const changes = changesOf(shown).length ? changesOf(shown) : changesOf(head)
    const guideline = head.guideline
    const basis = basisOf(shown)
    const nextOptions = shown === head && head.next ? criteriaOf(head.next) : []
    // The options side by side: the step's own, else the step the row walks
    // on to (an older pack copies no table onto the step), else the row's.
    // Not a second time where the block already draws it.
    const table = drawn.table ? undefined : optionTableOf(shown) ?? optionTableOf(head.next) ?? optionTableOf(head)
    const startDoses = startDosesOf(shown) ?? startDosesOf(head)
    const checklist = shown.checklist ?? head.checklist ?? []
    // What the record lacks, where no checklist line already says it.
    const missing = (shown.needsData ?? []).filter((need) => !checklist.some((item) => !item.present && item.label === need))
    return (
      <div className={styles.panel} data-testid="cdss-book-reasoning" data-dp={head.dp}>
        <div className={styles.panelHead}>
          <span className={styles.dpTag}>{head.dp}</span>
          <b>{isEnglish ? `${head.label}: reasoning` : `${head.label}：依據`}</b>
          <button type="button" className={styles.whyEnd} onClick={() => onToggle(head)}>{isEnglish ? 'Hide reasoning' : '收起依據'}</button>
        </div>
        {criteriaOf(shown).length ? <Criteria point={shown} basis={basis} isEnglish={isEnglish} dated /> : basis.length ? (
          <div>
            <span className={styles.panelLabel}>{isEnglish ? 'This patient (record)' : '本病人（紀錄）'}</span>
            <ul className={styles.panelPlain}>
              {basis.map((item) => (
                <li key={`${item.label}|${item.value}`}>{item.label}　<b>{item.value}</b>{item.date ? <> <span className={styles.date}>{item.date}</span></> : null}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {checklist.length ? (
          // The point's items one by one (DP-02's baseline, AF DP-05's work-up): each with what the record holds.
          <div data-testid="cdss-book-checklist">
            <span className={styles.panelLabel}>{isEnglish ? 'Item by item (record)' : '逐項（紀錄）'}</span>
            <ul className={styles.critList}>
              {checklist.map((item) => (
                <li key={item.key} className={item.present ? undefined : styles.unknown}>
                  <span className={`${styles.critSymbol} ${item.present ? styles.met : styles.unknown}`} aria-hidden="true">{item.present ? '✓' : '？'}</span>
                  <span className="sr-only">{item.present ? (isEnglish ? 'on record: ' : '紀錄有：') : (isEnglish ? 'not on record: ' : '紀錄無：')}</span>
                  {item.label}
                  {item.value ? <>　<b>{item.value}</b></> : item.present ? null : <>　{isEnglish ? 'not in the record' : '紀錄未見'}</>}
                  {item.date ? <> <span className={styles.date}>{item.date}</span></> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {missing.length ? (
          <p className={styles.panelMissing} data-testid="cdss-book-needs-data">{isEnglish ? 'Missing: ' : '缺：'}{missing.join(isEnglish ? ', ' : '、')}</p>
        ) : null}
        {nextOptions.length ? (
          <div>
            <span className={styles.panelLabel}>{isEnglish ? `Next: ${head.next!.headline}` : `下一步：${head.next!.headline}`}</span>
            <Criteria point={head.next as unknown as DecisionPointView} basis={basis} isEnglish={isEnglish} dated />
          </div>
        ) : null}
        {startDoses ? (
          <div data-testid="cdss-book-start-doses">
            <span className={styles.panelLabel}>
              {startDoses.title}
              {startDoses.values ? <span className={styles.panelValues}>{isEnglish ? `　This patient: ${startDoses.values}` : `　本病人：${startDoses.values}`}</span> : null}
            </span>
            <div className={styles.optScroll}>
              <table className={styles.optTable}>
                <thead>
                  <tr>
                    <th scope="col">{isEnglish ? 'Agent' : '藥'}</th>
                    <th scope="col">{isEnglish ? 'Dose' : '劑量'}</th>
                    <th scope="col">{isEnglish ? 'When' : '何時用'}</th>
                  </tr>
                </thead>
                <tbody>
                  {startDoses.rows.map((row, index) => (
                    <tr key={`${row.name}|${row.dose}|${row.role}`} data-proposed={row.proposed || undefined} data-role={row.role}>
                      <td>{index === 0 || startDoses.rows[index - 1]!.name !== row.name ? <b>{row.name}</b> : null}</td>
                      <td className={styles.optPatient}>{row.dose}</td>
                      <td>{row.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {table ? (
          <div data-testid="cdss-book-option-table">
            <span className={styles.panelLabel}>{table.title}</span>
            <div className={styles.optScroll}>
              <table className={styles.optTable}>
                <thead>
                  <tr>
                    <th scope="col">{isEnglish ? 'Agent' : '藥'}</th>
                    <th scope="col">{isEnglish ? 'Usual' : '標準'}</th>
                    <th scope="col">{isEnglish ? 'This patient' : '本病人'}</th>
                    <th scope="col">{isEnglish ? 'Why' : '依據'}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.name} data-current={row.current || undefined} data-status={row.status}>
                      <td><b>{row.name}</b>{row.current ? (isEnglish ? ' ← prescribed' : ' ← 現用') : ''}</td>
                      <td>{row.standard ?? '—'}</td>
                      <td className={styles.optPatient}>{row.patient}</td>
                      <td>{row.basis ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {changes.length ? (
          <div data-testid="cdss-book-changes-if">
            <span className={styles.panelLabel}>{isEnglish ? 'What would change the answer' : '什麼會改變答案'}</span>
            <ul className={styles.panelList}>
              {changes.map((change) => <li key={change.when}>{change.when} → {change.then}</li>)}
            </ul>
          </div>
        ) : null}
        {guideline?.points.length ? (
          <div data-testid="cdss-book-guideline-points">
            <span className={styles.panelLabel}>{isEnglish ? 'Guideline points' : '指引重點'}</span>
            <ul className={styles.panelList}>
              {guideline.points.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {guideline?.references.length ? (
          <p className={styles.sources}>
            {isEnglish ? 'Sources: ' : '出處：'}
            {guideline.references
              .map((reference) => `${reference.source} §${reference.section}（p.${reference.page}${reference.recommendation ? `，${reference.recommendation.class} ${reference.recommendation.level}` : ''}）`)
              .filter((text, index, all) => all.indexOf(text) === index)
              .join(' · ')}
          </p>
        ) : null}
      </div>
    )
  }

  const nameCell = (point: DecisionPointView) => (
    <div>
      <span className={styles.dpTag}>{point.dp}</span>
      {point.source !== sourceOfPage ? <span className={styles.fromTag}>{sourceTag(point)}</span> : null}
      <br />
      <b>{point.label}</b>
      <span className="sr-only">{isEnglish ? MARK_WORDS[marks.get(point)!].en : MARK_WORDS[marks.get(point)!].zh}</span>
      <br />
      {reasoningButton(point)}
    </div>
  )

  /** A decision: 決策點 | 本病人現在 | 指引怎麼說 | 今天, and under it what the row reads and 看依據. */
  const renderRow = (point: DecisionPointView, row: QueueRow, queued: boolean) => {
    const mark = marks.get(point)!
    const current = row.current
    const shown = (current ?? row.steps[row.steps.length - 1]).point
    const decided = row.steps.filter((step) => step.decision)
    const criteria = inlineCriteriaOf(shown)
    const basis = basisOf(shown)
    const guide = point.guideline?.points[0]
    const cite = citationOf(point)
    // 本病人現在: the values the row reads, and what the record lacks (「缺 ferritin、TSAT」);
    // beside criteria, or with neither, the reason line.
    const needs = shown.needsData ?? []
    const missing = needs.length
      ? <span className={styles.cellMissing}>{isEnglish ? `Missing: ${needs.join(', ')}` : `缺：${needs.join('、')}`}</span>
      : null
    const nowCell = !criteria.length && basis.length ? (
      <>
        <ul className={styles.basisList}>
          {basis.map((item) => (
            <li key={`${item.label}|${item.value}`}>{item.label} <b>{item.value}</b>{item.date ? <span className={styles.date}>（{item.date}）</span> : null}</li>
          ))}
        </ul>
        {missing}
      </>
    ) : !criteria.length && missing ? missing
      : shown.why ? <span>{shown.why}</span> : <span className={styles.cellMuted}>—</span>
    const tone = current && (mark === 'act' || mark === 'safety') ? (row.safety ? 'safety' : 'act') : undefined
    return (
      <div
        key={`${point.source}:${point.dp}`}
        id={bookAnchor(point)}
        tabIndex={-1}
        className={styles.entry}
        data-tone={tone}
        data-book-dp={point.dp}
        data-book-mark={mark}
      >
        <div className={styles.rowCells}>
          {nameCell(point)}
          <div>{nowCell}</div>
          <div className={styles.cellGuide}>
            {criteria.length > 1 ? (
              // Several options (the four DOACs): one line each here, each
              // criterion under 看依據.
              <>
                <ul className={styles.critList}>
                  {criteria.map((group) => <li key={group.title}>{group.title}</li>)}
                </ul>
                {isComplex(point) ? <span className={styles.small}>{isEnglish ? 'Each criterion under Reasoning' : '逐項條件見看依據'}</span> : null}
              </>
            ) : criteria.length ? <Criteria point={shown} basis={basis} isEnglish={isEnglish} /> : guide ?? <span className={styles.cellMuted}>—</span>}
            {cite ? <sup className={styles.cite}>{cite}</sup> : null}
          </div>
          <div className={styles.inner}>
            {current ? (
              <>
                <BookChainDone steps={decided} isEnglish={isEnglish} {...(onClear ? { onClear } : {})} />
                <p className={styles.question} data-visit-headline="">{shown.headline ?? shown.label}</p>
                {!(criteria.length || !basis.length) && shown.why ? <p className={styles.why} data-visit-why="">{shown.why}</p> : null}
                <BookDecisionControls
                  point={shown}
                  isEnglish={isEnglish}
                  safety={row.safety}
                  onDecide={onDecide ? (action) => onDecide(current, action, queued) : undefined}
                />
              </>
            ) : (
              <>
                <BookChainDone steps={decided.slice(0, -1)} isEnglish={isEnglish} {...(onClear ? { onClear } : {})} />
                <BookDecisionControls
                  point={shown}
                  decision={row.steps[row.steps.length - 1].decision}
                  isEnglish={isEnglish}
                  onClear={onClear ? () => onClear(row.steps[row.steps.length - 1]) : undefined}
                />
              </>
            )}
          </div>
        </div>
        {classificationOf(point) ? <div className={styles.rowExtras}>{classTable(point)}</div> : null}
        {pointQuestions(point, styles.rowExtras)}
        {point.coverage?.length ? <div className={styles.rowExtras}><CoverageLines point={point} isEnglish={isEnglish} /></div> : null}
        {reasoning(point, shown)}
      </div>
    )
  }

  /** A reminder: DP | name | one line; covered points say by which. */
  /**
   * A table point with nothing to decide today, as the prototype's muted rows:
   * a settled pillar (DP-10 「已在目標，繼續」), a comorbidity to read (DP-31),
   * or one that does not apply here, its reason across the last two columns
   * (DP-07·08 in HFpEF).
   */
  const renderQuietRow = (point: DecisionPointView) => {
    const mark = marks.get(point)!
    const absentHere = ABSENT_STATES.has(point.state)
    const basis = basisOf(point)
    const criteria = inlineCriteriaOf(point)
    const guide = point.guideline?.points[0]
    const cite = citationOf(point)
    const line = <>{point.headline ?? point.label}{point.why ? <span className={styles.lineWhy}>{isEnglish ? '; ' : '；'}{point.why}</span> : null}</>
    return (
      <div
        key={`${point.source}:${point.dp}`}
        id={bookAnchor(point)}
        tabIndex={-1}
        className={styles.entry}
        data-quiet=""
        data-book-dp={point.dp}
        data-book-mark={mark}
      >
        <div className={styles.rowCells}>
          {nameCell(point)}
          <div>
            {/* A few values; a long evidence list reads in 看依據, the line says what counts. */}
            {!absentHere && !criteria.length && basis.length && basis.length <= 3 ? (
              <ul className={styles.basisList}>
                {basis.map((item) => (
                  <li key={`${item.label}|${item.value}`}>{item.label} <b>{item.value}</b>{item.date ? <span className={styles.date}>（{item.date}）</span> : null}</li>
                ))}
              </ul>
            ) : <span className={styles.cellMuted}>—</span>}
          </div>
          {absentHere ? (
            <div className={styles.quietSpan}>{line}</div>
          ) : (
            <>
              <div className={styles.cellGuide}>
                {criteria.length ? <Criteria point={point} basis={basis} isEnglish={isEnglish} /> : guide ?? <span className={styles.cellMuted}>—</span>}
                {cite ? <sup className={styles.cite}>{cite}</sup> : null}
              </div>
              <div className={mark === 'done' ? styles.quietDone : undefined}>{line}</div>
            </>
          )}
        </div>
        {point.coverage?.length ? <div className={styles.rowExtras}><CoverageLines point={point} isEnglish={isEnglish} /></div> : null}
        {reasoning(point, point)}
      </div>
    )
  }

  // Where the every-visit questions are asked: a point waiting on their answer links there.
  const asksPoint = points.find((point) => point.dp === 'DP-03' && point.source === sourceOfPage && !ABSENT_STATES.has(point.state))
  const lineHeadline = (point: DecisionPointView, text: string) => (
    marks.get(point) === 'ask' && asksPoint && asksPoint !== point
      ? <button type="button" className={styles.askLink} onClick={() => goTo(asksPoint)}>{text}</button>
      : text
  )

  const renderLine = (point: DecisionPointView, by?: DecisionPointView, row?: QueueRow) => {
    const mark = marks.get(point)!
    const panel = reasoning(point, point)
    const why = !by && point.why ? <span className={styles.lineWhy}>{isEnglish ? '; ' : '；'}{point.why}</span> : null
    // Today's triage (HF DP-24, AF DP-00) is the red-flag strip at the head of its chapter.
    if (!by && /-triage$/.test(point.semanticId) && !panel) {
      return (
        <p
          key={`${point.source}:${point.dp}`}
          id={bookAnchor(point)}
          tabIndex={-1}
          className={styles.redFlag}
          data-book-dp={point.dp}
          data-book-mark={mark}
        >
          <span className={styles.dpTag}>{point.dp}</span>　<b>{isEnglish ? 'Red flags' : '紅旗'}</b>　
          <span className="sr-only">{point.label}：</span>
          {lineHeadline(point, point.headline ?? point.label)}
          {why}
        </p>
      )
    }
    // A point with buttons that is not today's decision (用藥核對's 已核對): its buttons on the line.
    const step = row ? row.current ?? row.steps[row.steps.length - 1] : undefined
    return (
      <div
        key={`${point.source}:${point.dp}`}
        id={bookAnchor(point)}
        tabIndex={-1}
        className={styles.line}
        data-book-dp={point.dp}
        data-book-mark={mark}
      >
        <span className={styles.dpTag}>{point.dp}</span>
        <b>
          {point.label}
          {point.source !== sourceOfPage ? <span className={styles.fromTag}>{sourceTag(point)}</span> : null}
        </b>
        <span className={`${styles.lineText} ${mark === 'ask' ? styles.lineAsk : ''}`}>
          <span className="sr-only">{isEnglish ? MARK_WORDS[mark].en : MARK_WORDS[mark].zh}：</span>
          {by
            ? <>{isEnglish ? `Decided with ${by.dp} ${by.label}` : `與 ${by.dp} ${by.label} 一起決定`}{point.headline ? ` · ${point.headline}` : ''}</>
            : lineHeadline(point, point.headline ?? point.label)}
          {why}
          {row && step ? (
            <span className={`${styles.lineControls} ${styles.inner}`}>
              {row.current ? (
                <BookDecisionControls
                  point={step.point}
                  isEnglish={isEnglish}
                  safety={row.safety}
                  onDecide={onDecide ? (action) => onDecide(step, action, false) : undefined}
                />
              ) : (
                <BookDecisionControls
                  point={step.point}
                  decision={step.decision}
                  isEnglish={isEnglish}
                  onClear={onClear ? () => onClear(step) : undefined}
                />
              )}
            </span>
          ) : null}
          {reasoningButton(point)}
        </span>
        {classificationOf(point) ? <div className={styles.lineWide}>{classTable(point)}</div> : null}
        {pointQuestions(point, styles.lineWide)}
        {point.coverage?.length ? <div className={styles.lineWide}><CoverageLines point={point} isEnglish={isEnglish} /></div> : null}
        {panel ? <div className={styles.lineWide}>{panel}</div> : null}
      </div>
    )
  }

  const renderSlot = (point: DecisionPointView, content: ReactNode, merged?: DecisionPointView) => (
    <div
      key={`${point.source}:${point.dp}`}
      id={bookAnchor(point)}
      tabIndex={-1}
      className={styles.slot}
      data-book-dp={point.dp}
      data-book-mark={marks.get(point)}
    >
      {/* A point answered in its table has no heading of its own, as the
          Artifact prototype: the table's tag names it (「DP-01 · DP-34」) and
          the chapter's heading says where it stands. */}
      {classificationOf(point) ? null : (
        <div className={styles.slotHead}>
          <span className={styles.dpTag}>{point.dp}</span>
          <b>{point.label}</b>
        </div>
      )}
      {classTable(point, merged ? `${point.dp} · ${merged.dp}` : undefined)}
      {content ? <div className={styles.inner}>{content}</div> : null}
    </div>
  )

  /** Drawn as a block: a point of this page that decides on a score, asks its own questions, or lays its options out. */
  const isBlock = (point: DecisionPointView, entry: BookEntry, section: Section) => entry.kind !== 'slot' && entry.kind !== 'skip'
    && point.source === sourceOfPage
    && Boolean(scoreTableOf(point) || optionTableOf(point) || (questionsOf(point) && section.pointLabels?.[point.dp]))

  /**
   * A point as the prototype draws the AF anticoagulation chapter (owner
   * request 2026-09-30): the part of the chapter's question it answers as its
   * heading (「要不要：CHA₂DS₂-VA」) and what it decides on — its score item by
   * item, the questions it asks, every option at this patient's dose. Today's
   * decision follows in a box (`blockDecision`): under the block, or, for two
   * blocks side by side, under the pair at full width.
   */
  const renderBlock = (point: DecisionPointView, entry: BookEntry, section: Section, withDecision: boolean) => {
    const mark = marks.get(point)!
    const score = scoreTableOf(point)
    const questions = questionsOf(point)
    const table = optionTableOf(point)
    const grid = profileGridOf(point)
    const groups = questionGroupsOf(point)
    const more = moreQuestionsOf(point)
    const title = score?.title ?? table?.title ?? questions?.title ?? ''
    const part = section.pointLabels?.[point.dp] ?? point.label
    const answer: AnswerQuestion | undefined = onAnswerQuestion && questions
      ? (id, value) => onAnswerQuestion(point, questions.answers, id, value)
      : undefined
    // A block that is only its questions names them in its heading, 全部皆無 beside it.
    const questionsLead = Boolean(questions && !score && !table)
    return (
      <div
        key={`${point.source}:${point.dp}`}
        id={bookAnchor(point)}
        tabIndex={-1}
        className={styles.block}
        data-book-dp={point.dp}
        data-book-mark={mark}
      >
        <div className={styles.blockHead}>
          <span className={styles.dpTag}>{point.dp}</span>
          <b className={styles.blockTitle}>{`${part}${isEnglish ? ': ' : '：'}${title}`}</b>
          <span className="sr-only">{isEnglish ? MARK_WORDS[mark].en : MARK_WORDS[mark].zh}</span>
          {questionsLead && questions?.bulkNone ? <BulkNone questions={questions} isEnglish={isEnglish} {...(answer ? { onAnswer: answer } : {})} /> : null}
          {entry.kind === 'row' ? null : reasoningButton(point)}
        </div>
        {score ? <ScoreTable table={score} isEnglish={isEnglish} /> : null}
        {questions && grid ? (
          <div className={styles.profileSplit}>
            <PointQuestions questions={questions} isEnglish={isEnglish} titled={!questionsLead} {...(answer ? { onAnswer: answer } : {})} />
            <ProfileGrid grid={grid} />
          </div>
        ) : questions ? <PointQuestions questions={questions} isEnglish={isEnglish} titled={!questionsLead} {...(answer ? { onAnswer: answer } : {})} /> : null}
        {groups.map((group) => {
          const answerGroup: AnswerQuestion | undefined = onAnswerQuestion
            ? (id, value) => onAnswerQuestion(point, group.answers, id, value)
            : undefined
          return (
            <div key={group.title} className={styles.groupBox} data-book-question-group={group.title}>
              <PointQuestions questions={group} isEnglish={isEnglish} titled {...(answerGroup ? { onAnswer: answerGroup } : {})} />
            </div>
          )
        })}
        {table ? <DoseTable table={table} isEnglish={isEnglish} /> : null}
        {withDecision ? blockDecision(point, entry) : null}
        {/* Optional, and changes nothing today's decision reads: after it. */}
        {more ? (
          <MoreQuestions
            more={more}
            isEnglish={isEnglish}
            {...(onAnswerQuestion ? { onAnswer: (group: QuestionsView, id: string, value: boolean | undefined) => onAnswerQuestion(point, group.answers, id, value) } : {})}
          />
        ) : null}
      </div>
    )
  }

  /** A block's decision: today's box (with a later step's options), or the line it stands on; then 看依據. */
  const blockDecision = (point: DecisionPointView, entry: BookEntry) => {
    const mark = marks.get(point)!
    const row = entry.kind === 'row' ? entry.row : undefined
    const current = row?.current
    const shown = row ? (current ?? row.steps[row.steps.length - 1]).point : point
    const decided = row ? row.steps.filter((step) => step.decision) : []
    // A chain's later step with its own options (the DOAC once 開始抗凝 is recorded).
    const stepTable = row && shown !== point ? optionTableOf(shown) : undefined
    const tone = current && (mark === 'act' || mark === 'safety') ? (row?.safety ? 'safety' : 'act') : undefined
    const decision = row ? (
      <div className={`${styles.box} ${styles.inner}`} data-tone={tone} data-book-box={point.dp}>
        {current ? (
          <>
            <BookChainDone steps={decided} isEnglish={isEnglish} {...(onClear ? { onClear } : {})} />
            {stepTable ? <div className={styles.boxWide}><DoseTable table={stepTable} isEnglish={isEnglish} /></div> : null}
            <p className={styles.boxQuestion} data-visit-headline="">{isEnglish ? 'Today: ' : '今天：'}{shown.headline ?? shown.label}</p>
            <BookDecisionControls
              point={shown}
              isEnglish={isEnglish}
              safety={row.safety}
              onDecide={onDecide ? (action) => onDecide(current, action, entry.kind === 'row' && entry.queued) : undefined}
            />
          </>
        ) : (
          <>
            <BookChainDone steps={decided.slice(0, -1)} isEnglish={isEnglish} {...(onClear ? { onClear } : {})} />
            <BookDecisionControls
              point={shown}
              decision={row.steps[row.steps.length - 1].decision}
              isEnglish={isEnglish}
              onClear={onClear ? () => onClear(row.steps[row.steps.length - 1]) : undefined}
            />
          </>
        )}
        {reasoningButton(point)}
      </div>
    ) : entry.kind === 'covered' ? (
      <p className={styles.blockNote}>
        {isEnglish ? `Decided with ${entry.by.dp} ${entry.by.label}` : `與 ${entry.by.dp} ${entry.by.label} 一起決定`}
        {point.headline ? ` · ${point.headline}` : ''}
      </p>
    ) : point.state !== 'done' && point.headline ? (
      // Settled, the table says it (「≥2 建議抗凝 · 已在用」); otherwise the point's line.
      <p className={styles.blockNote}>{point.headline}{point.why ? ` · ${point.why}` : ''}</p>
    ) : null
    return (
      <>
        {decision}
        {reasoning(point, shown, { table: Boolean(optionTableOf(point) || stepTable) })}
      </>
    )
  }

  /**
   * A table's rows in order, with the pack's additions (the prototype's
   * medicines table): a merged group drawn as one row where none of its points
   * is decided today, and a row for a point living in another chapter after
   * the point it follows (else at the end).
   */
  type TableItem =
    | { kind: 'point'; point: DecisionPointView; entry: BookEntry }
    | { kind: 'merged'; merge: BookTableMerge; points: DecisionPointView[] }
    | { kind: 'ref'; ref: BookTableRef; point: DecisionPointView }
  const tableEntries = (section: Section, items: readonly { point: DecisionPointView; entry: BookEntry }[]): TableItem[] => {
    // Merged only while every member does not apply and none holds a
    // decision today: a recorded one keeps its row, its record and 「改」.
    const quiet = (item: { point: DecisionPointView; entry: BookEntry }) => ABSENT_STATES.has(item.point.state)
      && !(item.entry.kind === 'row' && item.entry.row.steps.some((step) => step.decision))
    const merges = (section.tableMerged ?? []).filter((merge) => merge.dps.every((dp) => {
      const item = items.find((candidate) => candidate.point.dp === dp)
      return item && quiet(item)
    }))
    const refs = (section.tableRefs ?? []).flatMap((ref) => {
      const point = points.find((candidate) => candidate.dp === ref.dp && candidate.source === sourceOfPage)
        ?? points.find((candidate) => candidate.dp === ref.dp)
      return point && !ABSENT_STATES.has(point.state) ? [{ ref, point }] : []
    })
    const out: TableItem[] = []
    const placed = new Set<BookTableRef>()
    for (const item of items) {
      const merge = merges.find((candidate) => candidate.dps.includes(item.point.dp))
      // A merged group is drawn once, where its first point falls.
      if (!merge) out.push({ kind: 'point', ...item })
      else if (!out.some((entry) => entry.kind === 'merged' && entry.merge === merge)) {
        out.push({ kind: 'merged', merge, points: merge.dps.flatMap((dp) => items.filter((candidate) => candidate.point.dp === dp).map((candidate) => candidate.point)) })
      }
      for (const { ref, point } of refs) {
        if (ref.after === item.point.dp && !placed.has(ref)) {
          out.push({ kind: 'ref', ref, point })
          placed.add(ref)
        }
      }
    }
    for (const { ref, point } of refs) if (!placed.has(ref)) out.push({ kind: 'ref', ref, point })
    return out
  }

  /** A row for a point whose home is another chapter: what it is here, and a way to it. */
  const renderRefRow = (ref: BookTableRef, point: DecisionPointView) => {
    const home = numbered.find(({ section }) => section.key === ref.chapter)
    const guide = point.guideline?.points[0]
    // Once decided in its own chapter, the row says what was recorded there.
    const entry = entryOf(point)
    const decided = entry.kind === 'row' ? entry.row.steps.filter((step) => step.decision) : []
    return (
      <div key={`ref:${point.source}:${point.dp}`} className={styles.entry} data-quiet="" data-book-ref={point.dp}>
        <div className={styles.rowCells}>
          <div>
            <span className={styles.dpTag}>{point.dp}</span>
            <br />
            <b>{ref.label}</b>
          </div>
          <div>{ref.now ?? <span className={styles.cellMuted}>—</span>}</div>
          <div className={styles.cellGuide}>{guide ?? <span className={styles.cellMuted}>—</span>}</div>
          <div>
            {decided.length ? <BookChainDone steps={decided} /> : <span>{point.headline ?? point.label}</span>}
            {home ? (
              <>
                <br />
                <button type="button" className={styles.whyPill} onClick={() => goTo(point)}>
                  {isEnglish ? `See ${home.num} ${home.section.short}` : `見 ${home.num} ${home.section.short}`}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  /** Points the pack draws as one row: their tags, one name, one line. */
  const renderMergedRow = (merge: BookTableMerge, grouped: readonly DecisionPointView[]) => (
    <div key={`merged:${merge.dps.join('+')}`} className={styles.entry} tabIndex={-1} aria-label={`${merge.dps.join(' · ')} ${merge.label}`} data-quiet="" data-book-merged={merge.dps.join(' ')}>
      {/* Each point keeps its anchor, so the map's line still lands on the row; focus goes to the row itself. */}
      {grouped.map((point) => <span key={point.dp} id={bookAnchor(point)} data-book-dp={point.dp} data-book-mark={marks.get(point)} />)}
      <div className={styles.rowCells}>
        <div>
          <span className={styles.dpTag}>{merge.dps.join(' · ')}</span>
          <br />
          <b>{merge.label}</b>
        </div>
        <div><span className={styles.cellMuted}>—</span></div>
        <div className={styles.quietSpan}>{merge.note ?? grouped.map((point) => point.headline).join(isEnglish ? '; ' : '；')}</div>
      </div>
    </div>
  )

  /** A section's present points, consecutive rows in one table, consecutive lines in one list. */
  const renderSection = (section: Section) => {
    const inTable = (point: DecisionPointView) => Boolean(section.table?.includes(point.dp))
    // A chapter's table points stay in its table even when settled or not applicable.
    const present = section.points.filter((point) => !ABSENT_STATES.has(point.state) || inTable(point))
    const runs: { kind: 'table' | 'lines' | 'slot' | 'blocks'; items: { point: DecisionPointView; entry: BookEntry }[] }[] = []
    for (const point of present) {
      const entry = entryOf(point)
      if (entry.kind === 'skip') continue
      const asLine = entry.kind === 'row' && !entry.queued && ['info', 'done'].includes(marks.get(point)!)
      const kind = isBlock(point, entry, section) ? 'blocks'
        : inTable(point) || (entry.kind === 'row' && !asLine) ? 'table'
          : entry.kind === 'slot' ? 'slot' : 'lines'
      // A chapter with a table has one: every row joins it, wherever it falls.
      const table = kind === 'table' && section.table?.length ? runs.find((run) => run.kind === 'table') : undefined
      if (table) { table.items.push({ point, entry }); continue }
      const last = runs[runs.length - 1]
      if (last && last.kind === kind && kind !== 'slot') last.items.push({ point, entry })
      else runs.push({ kind, items: [{ point, entry }] })
    }
    return runs.map((run, index) => {
      if (run.kind === 'blocks') {
        // Two blocks without an options table side by side (要不要｜用哪個), a table full width.
        const groups: (typeof run.items)[] = []
        for (const item of run.items) {
          const last = groups[groups.length - 1]
          const half = !optionTableOf(item.point)
          if (half && last?.length === 1 && !optionTableOf(last[0]!.point)) last.push(item)
          else groups.push([item])
        }
        return (
          <div key={`blocks-${index}`} className={styles.blocks}>
            {groups.map((group) => (group.length === 2 ? (
              <Fragment key={`pair-${group[0]!.point.dp}`}>
                <div className={styles.blockPair}>{group.map(({ point, entry }) => renderBlock(point, entry, section, false))}</div>
                {group.map(({ point, entry }) => <Fragment key={`decision-${point.dp}`}>{blockDecision(point, entry)}</Fragment>)}
              </Fragment>
            ) : renderBlock(group[0]!.point, group[0]!.entry, section, true)))}
          </div>
        )
      }
      if (run.kind === 'slot') {
        const { point, entry } = run.items[0]
        return entry.kind === 'slot' ? <Fragment key={`slot-${index}`}>{renderSlot(point, entry.content, entry.merged)}</Fragment> : null
      }
      if (run.kind === 'lines') {
        return (
          <div key={`lines-${index}`} className={styles.lines}>
            {run.items.map(({ point, entry }) => renderLine(point, entry.kind === 'covered' ? entry.by : undefined, entry.kind === 'row' ? entry.row : undefined))}
          </div>
        )
      }
      return (
        <div key={`table-${index}`} className={styles.table} role="group" aria-label={section.title}>
          <div className={styles.thead} aria-hidden="true">
            <span>{['drugs', 'comorbidity'].includes(section.key) ? section.short : (isEnglish ? 'Decision' : '決策點')}</span>
            <span>{isEnglish ? 'This patient now' : '本病人現在'}</span>
            <span>{isEnglish ? 'The guideline says' : '指引怎麼說'}</span>
            <span>{isEnglish ? 'Today' : '今天'}</span>
          </div>
          {/* A table point with buttons but nothing to decide today reads as a muted row; one decided today keeps its row. */}
          {tableEntries(section, run.items).map((item) => (item.kind === 'ref'
            ? renderRefRow(item.ref, item.point)
            : item.kind === 'merged'
              ? renderMergedRow(item.merge, item.points)
              : item.entry.kind === 'row' && !(inTable(item.point) && !item.entry.queued && marks.get(item.point) === 'info')
                ? renderRow(item.point, item.entry.row, item.entry.queued)
                : renderQuietRow(item.point)))}
        </div>
      )
    })
  }

  // Chapters numbered down the page as the map numbers them; today's plan
  // closes the page unnumbered. Without the pack's chapters, a group label's
  // own marker (AF's ⓪ ① and A／R／C) stands for the number.
  const chaptersOnly = sections.filter((section) => !section.plan)
  const numbered = sections.map((section) => {
    if (section.plan) return { section, num: '' }
    const count = chaptersOnly.indexOf(section) + 1
    const marked = chapters?.length ? null : /^([⓪①-⑳]|[A-Z])\s+(.+)$/u.exec(section.title)
    return marked
      ? { section: { ...section, title: marked[2]!, short: marked[2]! }, num: marked[1]! }
      : { section, num: String(count) }
  })
  const planSection = numbered.find(({ section }) => section.plan)?.section
  const major = (section: Section) => section.points.some((point) => {
    if (ABSENT_STATES.has(point.state)) return false
    const kind = entryOf(point).kind
    return kind === 'row' || kind === 'slot'
  })

  // The values the decisions read, by date, as the header's second line.
  const byDate = new Map<string, VisitDecisionModel['keyValues']>()
  // Newest first, as the prototype's header reads.
  for (const item of [...keyValues].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))) {
    if (!item.value.trim() || /^[—–-]+$/.test(item.value.trim())) continue
    const date = displayDate(item.date, now) ?? ''
    byDate.set(date, [...(byDate.get(date) ?? []), item])
  }

  const mapLines = (section: Section) => (
    <ul className={styles.mapLines}>
      {/* What does not apply goes last, as the page lists it. */}
      {[...section.points.filter((point) => !ABSENT_STATES.has(point.state)), ...section.points.filter((point) => ABSENT_STATES.has(point.state))].map((point) => {
        const mark = marks.get(point)!
        const note = mark === 'act' || mark === 'safety' || mark === 'wait'
          ? MARK_WORDS[mark]
          : mark === 'ask'
            ? MARK_WORDS.ask
            : mark === 'absent'
              ? (point.state === 'not-included' ? { zh: '未納入', en: 'Not covered' } : MARK_WORDS.absent)
              : undefined
        return (
          <li key={`${point.source}:${point.dp}`}>
            <button
              type="button"
              className={styles.mapLine}
              onClick={() => goTo(point)}
              data-book-map-dp={point.dp}
              data-book-mark={mark}
            >
              <Mark mark={mark} />
              <span className={styles.mapDp}>{point.dp}</span>
              <span className={styles.mapLabel}>{point.label}</span>
              {note ? <span className={styles.mapNote}>{isEnglish ? note.en : note.zh}</span> : <span className="sr-only">{isEnglish ? MARK_WORDS[mark].en : MARK_WORDS[mark].zh}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )

  const renderChapter = ({ section, num }: { section: Section; num: string }) => {
    // A table point that does not apply is a muted row of the table, not in the 不適用 line.
    const absent = section.points.filter((point) => ABSENT_STATES.has(point.state) && !section.table?.includes(point.dp))
    return (
      <section
        key={section.key}
        id={sectionAnchor(section.key)}
        tabIndex={-1}
        className={`${styles.section} ${major(section) || section !== chaptersOnly[chaptersOnly.length - 1] ? '' : styles.minor}`}
        aria-labelledby={`${sectionAnchor(section.key)}-title`}
        data-book-section={section.key}
      >
        <div className={styles.sectionHead}>
          <span className={styles.sectionNum}>{num}</span>
          <h2 id={`${sectionAnchor(section.key)}-title`} className={styles.sectionTitle}>{section.title}</h2>
          {section.aside ? <span className={section.settled ? styles.sectionSettled : styles.sectionAside}>{section.aside}</span> : null}
        </div>
        {renderSection(section)}
        {([['not-applicable', isEnglish ? 'Not applicable　' : '不適用　'], ['not-included', isEnglish ? 'Not yet covered　' : '尚未納入　']] as const).map(([state, words]) => {
          const here = absent.filter((point) => point.state === state)
          if (!here.length) return null
          return (
            <p key={state} className={styles.absent} data-book-absent={section.key} data-state={state}>
              {words}
              {here.map((point, pointIndex) => {
                // Why, where it fits in a few words (「未用 warfarin」「併入 DP-01…」).
                const reason = state === 'not-applicable' && point.headline ? shortReason(point.headline) : undefined
                return (
                  <span key={`${point.source}:${point.dp}`} id={bookAnchor(point)} tabIndex={-1}>
                    {pointIndex ? ' · ' : ''}
                    <span className={styles.dpInline}>{point.dp}</span> {point.label}{reason ? `（${reason}）` : ''}
                  </span>
                )
              })}
            </p>
          )
        })}
      </section>
    )
  }

  const chaptersShown = numbered.filter(({ section }) => !section.plan)

  return (
    <div ref={bookRef} className={`${styles.book} ${inline ? styles.inline : ''} ${bookSerif.variable}`} data-testid="cdss-visit-book" data-inline={inline ? 'true' : undefined}>
      <header className={styles.head}>
        <div className={styles.headInner}>
          {chrome?.tabs ? <div className={styles.tabs}>{chrome.tabs}</div> : null}
          <div className={styles.headText}>
            <span className={styles.headLine}>{headline}</span>
            <span className={styles.headValues} data-testid="cdss-book-values">
              {[...byDate.entries()].map(([date, items], index) => (
                <Fragment key={date || 'undated'}>
                  {index ? ' ｜ ' : ''}
                  {date ? `${date} ` : ''}
                  {items.map((item, itemIndex) => (
                    <Fragment key={item.key}>
                      {itemIndex ? ' · ' : ''}
                      {item.label} <b className={item.alert ? styles.alert : undefined}>{item.value}</b>
                      {item.abnormal ? (item.abnormal === 'high' ? (isEnglish ? ' H' : ' 高') : (isEnglish ? ' L' : ' 低')) : ''}
                      {item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : ''}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </span>
          </div>
          <button type="button" className={pending.length || asking.length || waiting.length ? styles.pending : styles.pendingDone} onClick={() => scrollTo(PLAN_ANCHOR)} data-testid="cdss-book-pending">
            {pending.length
              ? (isEnglish ? `${pending.length} to decide today` : `今天待決定 ${pending.length}`)
              : asking.length
                ? (isEnglish ? `${asking.length} to answer` : `待答 ${asking.length}`)
                // Nothing to press today is not everything settled: an open
                // diagnosis says so until it is answered (#219 review).
                : waiting.length
                  ? MARK_WORDS.wait[isEnglish ? 'en' : 'zh']
                  : (isEnglish ? 'Every decision recorded' : '今天的決定都記下了')}
          </button>
          {chrome?.onSaveTarget ? <div ref={attachSaveTarget} className={styles.saveRecord} data-testid="cdss-book-save-target" /> : null}
          {/* One button either way (the shared key): pressed from the keyboard,
              focus stays on it as the page moves between panel and window. */}
          {chrome?.onExpand ? (
            <button key="window-toggle" type="button" className={styles.windowToggle} onClick={chrome.onExpand} data-testid="cdss-book-expand">
              {isEnglish ? 'Full window' : '全螢幕'}
            </button>
          ) : chrome?.onCollapse ? (
            <button key="window-toggle" type="button" className={styles.windowToggle} onClick={chrome.onCollapse} data-testid="cdss-book-collapse">
              {isEnglish ? 'Back to the panel' : '回到面板'}
            </button>
          ) : exitHref && !inline ? <a className={styles.exit} href={exitHref}>{isEnglish ? 'Back to the panel' : '回到面板'}</a> : null}
        </div>
      </header>

      <div className={`${styles.body} ${mapOpen ? '' : styles.bodyMapClosed}`}>
        {mapOpen ? (
          <nav aria-label={isEnglish ? 'Decision map' : '決策地圖'} className={styles.map} data-testid="cdss-book-map">
            <div className={styles.mapHead}>
              <span className={styles.mapTitle}>{isEnglish ? 'Decision map' : '決策地圖'}</span>
              <span className={styles.mapCount}>
                {/* Non-breaking inside each half, so a narrow rail breaks only at the dot. */}
                {isEnglish ? `${counted.length}\u00a0DPs · ${pending.length + asking.length + waiting.length}\u00a0open` : `${counted.length}\u00a0個\u00a0DP · ${pending.length + asking.length + waiting.length}\u00a0待處理`}
              </span>
              <button
                type="button"
                className={styles.mapToggle}
                onClick={() => setMapOpen(false)}
                aria-label={isEnglish ? 'Collapse the decision map' : '收合決策地圖'}
                title={isEnglish ? 'Collapse' : '收合'}
                data-testid="cdss-book-map-collapse"
              >
                ‹
              </button>
            </div>
            <div className={styles.legend} aria-hidden="true">
              {pending.some((point) => marks.get(point) === 'safety') ? <span><span className={styles.markSafety} />{isEnglish ? 'Safety' : '安全'}</span> : null}
              <span><span className={styles.markAct} />{isEnglish ? 'To decide' : '待決定'}</span>
              <span><span className={styles.markAsk} />{isEnglish ? 'To answer' : '待答'}</span>
              {waiting.length ? <span><span className={styles.markWait} />{isEnglish ? MARK_WORDS.wait.en : MARK_WORDS.wait.zh}</span> : null}
              <span><svg className={styles.markDone} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>{isEnglish ? 'Settled' : '已定'}</span>
              <span><span className={styles.markInfo} />{isEnglish ? 'Info' : '資訊'}</span>
              <span className={styles.legendMuted}>{isEnglish ? 'Grey: not applicable' : '灰字 不適用'}</span>
            </div>
            {numbered.map(({ section, num }) => {
              const open = section.points.filter((point) => ['act', 'safety', 'ask', 'wait'].includes(marks.get(point)!)).length
              return (
                <div key={section.key} className={styles.mapSection}>
                  <button type="button" className={styles.mapSectionHead} onClick={() => scrollTo(section.plan ? PLAN_ANCHOR : sectionAnchor(section.key))}>
                    {num ? <span className={styles.mapNum}>{num}</span> : null}
                    <span className={styles.mapName}>{section.short}</span>
                    {open ? <span className={styles.mapPending}>{isEnglish ? `${open} open` : `${open} 待`}</span> : null}
                  </button>
                  {mapLines(section)}
                </div>
              )
            })}
          </nav>
        ) : (
          <nav aria-label={isEnglish ? 'Decision map' : '決策地圖'} className={styles.mapRail} data-testid="cdss-book-map">
            <button
              type="button"
              className={styles.mapExpand}
              onClick={() => setMapOpen(true)}
              aria-label={isEnglish ? 'Open the decision map' : '展開決策地圖'}
              data-testid="cdss-book-map-expand"
            >
              <span className={styles.mapExpandArrow} aria-hidden="true">›</span>
              <span className={styles.mapExpandText}>{isEnglish ? 'Decision map' : '決策地圖'}</span>
              {pending.length + asking.length ? <span className={styles.mapPending}>{pending.length + asking.length}</span> : null}
            </button>
          </nav>
        )}

        <main className={styles.sheet} aria-label={isEnglish ? 'The visit' : '本次門診'}>
          {top ? <div className={styles.inner}>{top}</div> : null}
          {triggers.length ? (
            <p className={styles.triggers} data-testid="cdss-visit-triggers">
              <b>{isEnglish ? 'Reassessment opened by: ' : '重新評估的原因：'}</b>
              {triggers.map((trigger, index) => (
                <span key={trigger.id} data-trigger={trigger.id}>{index ? (isEnglish ? '; ' : '；') : ''}{trigger.text}</span>
              ))}
            </p>
          ) : null}
          {chaptersShown.map(renderChapter)}

          <section id={PLAN_ANCHOR} tabIndex={-1} className={styles.plan} aria-labelledby={`${PLAN_ANCHOR}-title`} data-testid="cdss-book-end">
            <div className={styles.planHead}>
              <h2 id={`${PLAN_ANCHOR}-title`} className={styles.planTitle}>{isEnglish ? "Today's plan" : '今天的計畫'}</h2>
              {planSection?.points.length ? (
                <span className={styles.planSub}>
                  {planSection.points.map((point) => `${point.dp} ${point.label}`).join(' · ')}
                </span>
              ) : null}
              <button type="button" className={styles.copy} onClick={onCopy} data-testid="cdss-visit-summary-copy">
                {copied ? (isEnglish ? 'Copied' : '已複製') : (isEnglish ? 'Copy to the note' : '複製到病歷')}
              </button>
            </div>
            {planSection ? renderSection(planSection) : null}
            {plan.notes.length ? (
              <ul className={styles.planList} data-testid="cdss-visit-plan-notes">
                {plan.notes.map((note) => <li key={note.text}><b>{note.text}</b></li>)}
              </ul>
            ) : null}
            {decided.length ? (
              <ol className={styles.planList} data-testid="cdss-visit-plan">
                {decided.map((item) => (
                  <li key={item.key} data-dp={item.dp} data-plan-item="">
                    <span className={styles.dpTag}>{item.source !== sourceOfPage ? `${item.source.toUpperCase()} ` : ''}{item.dp}</span>　<b>{item.label}</b>
                    {item.check ? <span className={styles.small}>　{item.check}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.planEmpty} data-testid="cdss-visit-plan-empty">
                {isEnglish ? 'No decision recorded yet.' : '還沒有記錄任何決定。'}
              </p>
            )}
            {pending.length ? (
              <p className={styles.planPending}>
                <b>{isEnglish ? 'Not yet decided　' : '尚未決定　'}</b>
                {pending.map((point) => `${point.dp} ${point.label}`).join(' · ')}
              </p>
            ) : null}
            {waiting.length ? (
              <p className={styles.planPending} data-testid="cdss-book-plan-waiting">
                <b>{isEnglish ? `${MARK_WORDS.wait.en}　` : `${MARK_WORDS.wait.zh}　`}</b>
                {waiting.map((point) => `${point.dp} ${point.label}`).join(' · ')}
              </p>
            ) : null}
            {decidedLine ? <p className={styles.question} data-testid="cdss-visit-decided-line">{decidedLine}</p> : null}
          </section>

          {citations.length ? (
            <footer className={styles.foot} data-testid="cdss-book-citations">
              <span>{citations.map((cite, index) => `${index + 1} ${cite}`).join('　')}</span>
            </footer>
          ) : null}
        </main>
      </div>
    </div>
  )
}
