/**
 * The every-visit questions, answered, per patient.
 *
 * The decision map asks the same two things at every visit — breathlessness
 * and weight on the heart-failure page, symptoms and bleeding on the
 * atrial-fibrillation page. The answer is a clinical statement about a named
 * person, so it is kept the way the rest of this feature's answers are:
 * encrypted under this tab's session key, keyed by patient, never readable in
 * plain text by the next person at the workstation (see
 * `encrypted-answer-cache.service`).
 *
 * An answer is this visit's answer. One read back from an earlier day is
 * dropped on hydration rather than applied, because 「喘變差」 last week says
 * nothing about today. Nothing here is written to the chart; the answers reach
 * the pack only through `applyVisitAnswers`, as facts on the profile.
 */
import { create } from 'zustand'
import { isVisitAnswer, VISIT_OBSERVATIONS } from '@voho0000/personalized-care'
import {
  createHydrationGuard,
} from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking, patientAnswerStorageKey } from './patient-answer-backing'
import type { VisitAnswers, VisitObservationId } from '../types'

/**
 * An every-visit observation, as the pack's catalogue defines it. The store
 * keeps one answer per patient and per observation — not per page — so an
 * answer given on one disease's page is the answer on every page that asks
 * the same thing.
 */
export type VisitAskId = VisitObservationId

// The observations and their answers are the pack's catalogue, the one every
// pack reads; a stored value outside it never reaches a pack. A pack that
// starts asking something new needs no change here.
const ASK_IDS = VISIT_OBSERVATIONS.map((concept) => concept.id)

function isAskId(value: string): value is VisitAskId {
  return ASK_IDS.some((id) => id === value)
}

function isAnswerValue(id: VisitAskId, value: string): boolean {
  return isVisitAnswer(id, value)
}

/**
 * One answer, when it was given (an ISO timestamp), and on which disease's
 * page (its pack id). Where it was given is what a second page names when it
 * shows the answer instead of asking again, and what a record of it written
 * back would carry.
 */
export interface VisitAnswerEntry {
  value: string
  answeredAt: string
  packId?: string
}

/** Where today's answer to one observation came from. */
export interface VisitAnswerSource {
  answeredAt: string
  packId?: string
}

export type VisitAnswerRecord = Readonly<Partial<Record<VisitAskId, VisitAnswerEntry>>>

const EMPTY_RECORD: VisitAnswerRecord = Object.freeze({})
const EMPTY_ANSWERS: VisitAnswers = Object.freeze({})
const EMPTY_SOURCES: Readonly<Partial<Record<VisitAskId, VisitAnswerSource>>> = Object.freeze({})

/** The key one patient's encrypted visit answers are kept under. */
export function visitAnswersStorageKey(patientId: string): string {
  return patientAnswerStorageKey('visit-answers', patientId)
}

function localDay(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Storage is a best-effort cache, never a source of clinical truth. Anything
 * unreadable, unknown or from another day degrades to 「還沒問」.
 */
export function toVisitAnswerRecord(parsed: unknown, now: Date = new Date()): VisitAnswerRecord {
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_RECORD
    const today = localDay(now)
    const record: Partial<Record<VisitAskId, VisitAnswerEntry>> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isAskId(id) || !value || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      if (typeof entry.value !== 'string' || !isAnswerValue(id, entry.value)) continue
      if (typeof entry.answeredAt !== 'string') continue
      const answeredAt = new Date(entry.answeredAt)
      if (Number.isNaN(answeredAt.getTime()) || localDay(answeredAt) !== today) continue
      record[id] = {
        value: entry.value,
        answeredAt: entry.answeredAt,
        ...(typeof entry.packId === 'string' && entry.packId ? { packId: entry.packId } : {}),
      }
    }
    return Object.keys(record).length ? record : EMPTY_RECORD
  } catch {
    return EMPTY_RECORD
  }
}

function answeredOn(entry: VisitAnswerEntry, day: string): boolean {
  const answeredAt = new Date(entry.answeredAt)
  return !Number.isNaN(answeredAt.getTime()) && localDay(answeredAt) === day
}

/**
 * The answers alone, in the shape `applyVisitAnswers` takes, narrowed to the
 * values the pack reads — and to those given on `day` (local `YYYY-MM-DD`,
 * today by default). Hydration drops an old answer read back from storage,
 * but one still held in memory from yesterday, on a page left open overnight,
 * is dropped here (#166 review).
 */
export function visitAnswersOf(record: VisitAnswerRecord | undefined, day: string = localDay(new Date())): VisitAnswers {
  if (!record) return EMPTY_ANSWERS
  const answers: Record<string, string> = {}
  for (const id of ASK_IDS) {
    const entry = record[id]
    if (entry && isAnswerValue(id, entry.value) && answeredOn(entry, day)) answers[id] = entry.value
  }
  return Object.keys(answers).length ? (answers as VisitAnswers) : EMPTY_ANSWERS
}

/**
 * When, and on which disease's page, each of `day`'s answers was given — the
 * same answers `visitAnswersOf` returns.
 */
export function visitAnswerSourcesOf(
  record: VisitAnswerRecord | undefined,
  day: string = localDay(new Date()),
): Readonly<Partial<Record<VisitAskId, VisitAnswerSource>>> {
  if (!record) return EMPTY_SOURCES
  const sources: Partial<Record<VisitAskId, VisitAnswerSource>> = {}
  for (const id of ASK_IDS) {
    const entry = record[id]
    if (entry && isAnswerValue(id, entry.value) && answeredOn(entry, day)) {
      sources[id] = { answeredAt: entry.answeredAt, ...(entry.packId ? { packId: entry.packId } : {}) }
    }
  }
  return Object.keys(sources).length ? sources : EMPTY_SOURCES
}

function writeStored(patientId: string, record: VisitAnswerRecord): void {
  if (Object.keys(record).length === 0) {
    patientAnswerBacking().discard('visit-answers', patientId)
    return
  }
  patientAnswerBacking().save('visit-answers', patientId, record)
}

const hydration = createHydrationGuard()

interface VisitAnswersState {
  byPatientId: Readonly<Record<string, VisitAnswerRecord>>
  /** Which charts have been read back, so a question can tell 「還沒問」 from
   *  「還沒讀到」 instead of drawing unanswered and then jumping. */
  hydratedPatientIds: Readonly<Record<string, true>>
  hydrate: (patientId: string, now?: Date) => void
  /** Records an answer; `null` returns the question to unanswered (the
   *  record's own reading, where the pack has one, stands again). `source`
   *  names the disease's page it was given on. */
  answer: (patientId: string, id: VisitAskId, value: string | null, now?: Date, source?: { packId?: string }) => void
  clearAnswers: (patientId: string) => void
}

export const useVisitAnswersStore = create<VisitAnswersState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},

  hydrate: (patientId, now = new Date()) => {
    if (!patientId) return
    const state = get()
    if (hydration.isPending(patientId)) return
    if (state.hydratedPatientIds[patientId]) {
      // Opening a patient again, maybe the next day: answers from an earlier
      // day are last visit's and go, from memory and from storage (#166 review).
      const held = state.byPatientId[patientId] ?? EMPTY_RECORD
      const day = localDay(now)
      const kept = Object.fromEntries(
        Object.entries(held).filter(([, entry]) => entry && answeredOn(entry, day)),
      ) as VisitAnswerRecord
      if (Object.keys(kept).length === Object.keys(held).length) return
      const next = Object.keys(kept).length ? kept : EMPTY_RECORD
      writeStored(patientId, next)
      set((current) => ({ byPatientId: { ...current.byPatientId, [patientId]: next } }))
      return
    }

    if (state.byPatientId[patientId] || !patientAnswerBacking().has('visit-answers', patientId)) {
      set((current) => ({
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: EMPTY_RECORD },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
      return
    }

    const settle = hydration.begin(patientId)
    const apply = (record: VisitAnswerRecord) => {
      if (!settle()) return
      set((current) => ({
        // An answer given while the read was in flight is more recent than
        // storage; it stands.
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: record },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
    }
    void patientAnswerBacking().load('visit-answers', patientId)
      .then((stored) => apply(toVisitAnswerRecord(stored, now)))
      .catch(() => apply(EMPTY_RECORD))
  },

  answer: (patientId, id, value, now = new Date(), source) => {
    if (!patientId || !isAskId(id)) return
    if (value !== null && value !== '' && !isAnswerValue(id, value)) return
    set((state) => {
      const current = state.byPatientId[patientId] ?? EMPTY_RECORD
      if (value === null || value === '') {
        if (!current[id]) return state
        const next = { ...current }
        delete next[id]
        writeStored(patientId, next)
        return { byPatientId: { ...state.byPatientId, [patientId]: next } }
      }
      if (current[id]?.value === value) return state
      const next: VisitAnswerRecord = {
        ...current,
        [id]: { value, answeredAt: now.toISOString(), ...(source?.packId ? { packId: source.packId } : {}) },
      }
      // In memory first; the encryption runs in the background.
      writeStored(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clearAnswers: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('visit-answers', patientId)
    set((state) => ({
      byPatientId: { ...state.byPatientId, [patientId]: EMPTY_RECORD },
      hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
    }))
  },
}))

/** One patient's answers, referentially stable between changes. */
export function useVisitAnswerRecord(patientId: string | undefined): VisitAnswerRecord {
  return useVisitAnswersStore(
    (state) => (patientId ? state.byPatientId[patientId] : undefined) ?? EMPTY_RECORD,
  )
}

/** Whether this chart's answers have been read back yet. */
export function useVisitAnswersHydrated(patientId: string | undefined): boolean {
  return useVisitAnswersStore(
    (state) => !patientId || Boolean(state.hydratedPatientIds[patientId]),
  )
}
