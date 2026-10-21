/**
 * Which of today's answers were brought in from a saved CDSS record, and from
 * which day's record.
 *
 * The answer stores keep values; they do not say where a value came from. A
 * carried answer counts as today's answer — the decision map has to be able
 * to read it — so the screen has to say, beside it, 「帶入 · 10/07」: the
 * clinician did not give it today, and it is theirs to confirm or change.
 *
 * Each mark remembers the value it was carried with, and lives as long as the
 * answer it describes. A mark goes for good the moment its answer leaves the
 * carried value (changed or cleared — see `unmark`), so typing the same value
 * back is the clinician's own answer, not a carried one. An every-visit answer
 * (`isDayScoped`) ends with the day it was given, and its mark with it; every
 * other carried answer stays in force across days, and so does its mark.
 *
 * Kept per patient, encrypted under the tab-session key like the answers they
 * describe (see `patient-answer-backing`).
 */
import { create } from 'zustand'
import { createHydrationGuard } from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking } from './patient-answer-backing'
import { todayIsoDate } from './clinic-vitals.store'

/** One carried answer: the value it arrived with, the saved record's day and the day it was carried (YYYY-MM-DD). */
export interface CarriedMark {
  value: string
  from: string
  on: string
}

export interface CarriedAnswers {
  marks: Readonly<Record<string, CarriedMark>>
}

const EMPTY: CarriedAnswers = Object.freeze({ marks: Object.freeze({}) })
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Answers that end with their day: the every-visit asks, which their store
 * drops on the next day. The NYHA grade, the signs and the compensation
 * judgement stay held (三區塊 still shows them), so their marks stay too.
 */
export function isDayScoped(key: string): boolean {
  return key.startsWith('visit:')
}

/** The comparable form of an answer value, whatever store it lives in. */
export function carriedValue(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function live(mark: CarriedMark, key: string, today: string): boolean {
  return !isDayScoped(key) || mark.on === today
}

function toCarried(parsed: unknown, today: string): CarriedAnswers {
  try {
    const record = parsed as Record<string, unknown>
    if (!record || !record.marks || typeof record.marks !== 'object') return EMPTY
    const marks: Record<string, CarriedMark> = {}
    for (const [key, mark] of Object.entries(record.marks as Record<string, unknown>)) {
      const item = mark as Record<string, unknown>
      if (item && typeof item.value === 'string' && typeof item.from === 'string' && DAY.test(item.from)
        && typeof item.on === 'string' && DAY.test(item.on)) {
        const parsedMark = { value: item.value, from: item.from, on: item.on }
        if (live(parsedMark, key, today)) marks[key] = parsedMark
      }
    }
    return { marks }
  } catch {
    return EMPTY
  }
}

function persist(patientId: string, record: CarriedAnswers): void {
  if (Object.keys(record.marks).length) patientAnswerBacking().save('carried-answers', patientId, record)
  else patientAnswerBacking().discard('carried-answers', patientId)
}

const hydration = createHydrationGuard()

interface CarriedAnswersState {
  byPatientId: Readonly<Record<string, CarriedAnswers>>
  hydratedPatientIds: Readonly<Record<string, true>>
  hydrate: (patientId: string, now?: Date) => void
  /** Adds marks for answers just carried in; `from` is the saved record's day. */
  mark: (patientId: string, values: Readonly<Record<string, unknown>>, from: string, now?: Date) => void
  /** Drops marks for good: their answers no longer hold the carried value. */
  unmark: (patientId: string, keys: readonly string[]) => void
  clear: (patientId: string) => void
}

export const useCarriedAnswersStore = create<CarriedAnswersState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},

  hydrate: (patientId, now = new Date()) => {
    if (!patientId || get().hydratedPatientIds[patientId] || hydration.isPending(patientId)) return
    if (get().byPatientId[patientId] || !patientAnswerBacking().has('carried-answers', patientId)) {
      set(state => ({ hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true } }))
      return
    }
    const settle = hydration.begin(patientId)
    const apply = (record: CarriedAnswers) => {
      if (!settle()) return
      set(state => ({
        byPatientId: state.byPatientId[patientId] ? state.byPatientId : { ...state.byPatientId, [patientId]: record },
        hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
      }))
    }
    void patientAnswerBacking().load('carried-answers', patientId)
      .then(stored => apply(toCarried(stored, todayIsoDate(now))))
      .catch(() => apply(EMPTY))
  },

  mark: (patientId, values, from, now = new Date()) => {
    if (!patientId || !DAY.test(from) || !Object.keys(values).length) return
    const on = todayIsoDate(now)
    set(state => {
      const kept = state.byPatientId[patientId]?.marks ?? {}
      const added = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: carriedValue(value), from, on }]))
      const next: CarriedAnswers = { marks: { ...kept, ...added } }
      persist(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  unmark: (patientId, keys) => {
    if (!patientId || !keys.length) return
    set(state => {
      const current = state.byPatientId[patientId]
      if (!current || !keys.some(key => key in current.marks)) return state
      const marks = { ...current.marks }
      for (const key of keys) delete marks[key]
      const next: CarriedAnswers = { marks }
      persist(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clear: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('carried-answers', patientId)
    set(state => ({ byPatientId: { ...state.byPatientId, [patientId]: EMPTY } }))
  },
}))

/**
 * The saved record's day an answer was carried from, while the answer still
 * holds the carried value (and, for an every-visit answer, on the day it was
 * carried); otherwise null.
 */
export function carriedFrom(record: CarriedAnswers | undefined, key: string, current: unknown, now: Date = new Date()): string | null {
  const mark = record?.marks[key]
  if (!mark || !live(mark, key, todayIsoDate(now))) return null
  return current !== undefined && current !== null && mark.value === carriedValue(current) ? mark.from : null
}

/** The marks whose answers have left the carried value (changed, cleared, or an every-visit answer from another day). */
export function staleCarriedKeys(record: CarriedAnswers | undefined, current: Readonly<Record<string, unknown>>, now: Date = new Date()): string[] {
  return Object.keys(record?.marks ?? {}).filter(key => carriedFrom(record, key, current[key], now) === null)
}

/** One patient's carry marks, referentially stable between changes. */
export function useCarriedAnswers(patientId: string | undefined): CarriedAnswers {
  return useCarriedAnswersStore(state => (patientId ? state.byPatientId[patientId] : undefined) ?? EMPTY)
}
