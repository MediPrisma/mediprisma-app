/**
 * The echo numbers the clinician read off a report and typed in, per patient.
 *
 * 健保雲端 carries an echocardiography report as text, and the scanner reads
 * what the report happens to print. A report that gives 「E/e′ Lat 11」 and no
 * absolute e′, or one whose strain study was not done, leaves HFA-PEFF short of
 * parameters it needs — and a score short of parameters is a floor, which is
 * the one reading that can talk a clinician out of a diagnosis. So the values
 * can be completed by hand, and what was typed is kept.
 *
 * Only what the clinician changed is stored. An auto-filled value is not
 * written here: it is already in the report, it would go stale the day a newer
 * echo arrives, and 「你輸入」 must mean what it says.
 *
 * Kept encrypted under this tab's session key, keyed by patient, like the rest
 * of this feature's answers: a typed value survives a reload of this tab, no
 * other session can read it, and carrying it to the next visit is phase 2.
 * Nothing is written to the chart and nothing leaves the browser.
 */
import { create } from 'zustand'
import {
  createHydrationGuard,
} from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking, patientAnswerStorageKey } from './patient-answer-backing'

/** One value the clinician typed, with the day it was measured and changed. */
export interface HfpefInputEntry {
  /** The calculator's own string value: a number, or a select's option id. */
  value: string
  /** The day the measurement was taken, as YYYY-MM-DD. */
  measuredOn?: string
  /** When this browser last recorded a change, as an ISO timestamp. */
  modifiedAt: string
}

export interface HfpefInputs {
  /** Keyed by the calculator input key (`lavi`, `septalE`, …). */
  entries: Readonly<Record<string, HfpefInputEntry>>
}

export const EMPTY_HFPEF_INPUTS: HfpefInputs = Object.freeze({ entries: Object.freeze({}) })

/**
 * A statement about some of the fields. `null` returns a field to 「沒填」,
 * which is not an entry of its own — the report's value stands again.
 */
export type HfpefInputsPatch = Readonly<Record<string, { value: string; measuredOn?: string } | null>>

/**
 * The record after a patch, or the record itself when nothing changed.
 *
 * Saving the same number again is not a new measurement, so 「最後修改」 dates
 * the change rather than the click — the same rule the visit answers keep.
 */
export function mergeHfpefInputs(
  current: HfpefInputs | undefined,
  patch: HfpefInputsPatch,
  now: Date = new Date(),
): HfpefInputs {
  const base = current ?? EMPTY_HFPEF_INPUTS
  const modifiedAt = now.toISOString()
  const entries: Record<string, HfpefInputEntry> = { ...base.entries }
  let changed = false

  for (const [key, entry] of Object.entries(patch)) {
    if (entry === null || entry === undefined || !entry.value.trim()) {
      if (entries[key]) {
        delete entries[key]
        changed = true
      }
      continue
    }
    const existing = entries[key]
    if (existing && existing.value === entry.value && existing.measuredOn === entry.measuredOn) {
      continue
    }
    entries[key] = {
      value: entry.value,
      ...(entry.measuredOn ? { measuredOn: entry.measuredOn } : {}),
      modifiedAt,
    }
    changed = true
  }

  return changed ? { entries } : base
}

/** The key one patient's encrypted typed echo values are kept under. */
export function hfpefInputsStorageKey(patientId: string): string {
  return patientAnswerStorageKey('hfpef-inputs', patientId)
}

/**
 * Storage is a best-effort cache, never a source of clinical truth: a private
 * window throws on write, a quota can be full, a session that cannot decrypt
 * hands back nothing, and a hand-edited value can be anything. Every path
 * degrades to 「沒填」, which is a first visit's reading.
 */
function toHfpefInputs(parsed: unknown): HfpefInputs {
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_HFPEF_INPUTS
    const record = (parsed as Record<string, unknown>).entries
    if (!record || typeof record !== 'object') return EMPTY_HFPEF_INPUTS
    const entries: Record<string, HfpefInputEntry> = {}
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      if (typeof item.value !== 'string' || !item.value.trim()) continue
      entries[key] = {
        value: item.value,
        ...(typeof item.measuredOn === 'string' ? { measuredOn: item.measuredOn } : {}),
        modifiedAt: typeof item.modifiedAt === 'string' ? item.modifiedAt : '',
      }
    }
    return { entries }
  } catch {
    return EMPTY_HFPEF_INPUTS
  }
}

function writeStored(patientId: string, inputs: HfpefInputs): void {
  if (Object.keys(inputs.entries).length === 0) {
    patientAnswerBacking().discard('hfpef-inputs', patientId)
    return
  }
  patientAnswerBacking().save('hfpef-inputs', patientId, inputs)
}

const hydration = createHydrationGuard()

interface HfpefInputsState {
  byPatientId: Readonly<Record<string, HfpefInputs>>
  /** Which charts have been read back, so a field can tell 「沒填」 from
   *  「還沒讀到」 instead of offering an empty box that later fills itself. */
  hydratedPatientIds: Readonly<Record<string, true>>
  /** Reads one patient's stored values once; a no-op after that. */
  hydrate: (patientId: string) => void
  setInputs: (patientId: string, patch: HfpefInputsPatch, now?: Date) => void
  clearInputs: (patientId: string) => void
  carryForward: (patientId: string, saved: unknown) => void
  canCarryForward: (patientId: string) => boolean
}

export const useHfpefInputsStore = create<HfpefInputsState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},
  canCarryForward: patientId => Boolean(get().hydratedPatientIds[patientId]) && !hydration.isPending(patientId),

  carryForward: (patientId, saved) => {
    if (!patientId) return
    if (!get().canCarryForward(patientId)) throw new Error('cdss_carry_forward_unavailable')
    const old = toHfpefInputs(saved)
    set(state => {
      const next = { entries: { ...old.entries, ...state.byPatientId[patientId]?.entries } }
      writeStored(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  hydrate: (patientId) => {
    if (!patientId) return
    const state = get()
    if (state.hydratedPatientIds[patientId] || hydration.isPending(patientId)) return

    // Values already in memory are this session's own, and a chart with no
    // stored record is a first visit. Neither needs a decryption, and neither
    // writes anything.
    if (state.byPatientId[patientId] || !patientAnswerBacking().has('hfpef-inputs', patientId)) {
      set((current) => ({
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: EMPTY_HFPEF_INPUTS },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
      return
    }

    const settle = hydration.begin(patientId)
    const apply = (inputs: HfpefInputs) => {
      if (!settle()) return
      set((current) => ({
        // A value typed while the read was in flight is more recent than
        // storage; it stands.
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: inputs },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
    }
    void patientAnswerBacking().load('hfpef-inputs', patientId)
      .then((stored) => apply(toHfpefInputs(stored)))
      // A record that cannot be read leaves every field to the report, which
      // is a first visit's reading.
      .catch(() => apply(EMPTY_HFPEF_INPUTS))
  },

  setInputs: (patientId, patch, now = new Date()) => {
    if (!patientId) return
    set((state) => {
      const current = state.byPatientId[patientId]
      const next = mergeHfpefInputs(current, patch, now)
      // Nothing changed — and where there was nothing in memory to change,
      // `next` is the frozen empty record, which must not be written over a
      // stored one this session has not read back yet.
      if (next === current || next === EMPTY_HFPEF_INPUTS) return state
      // In memory first; the encryption runs in the background and cannot
      // reach back into what the screen is already showing.
      writeStored(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clearInputs: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('hfpef-inputs', patientId)
    set((state) => ({
      byPatientId: { ...state.byPatientId, [patientId]: EMPTY_HFPEF_INPUTS },
      hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
    }))
  },
}))

/** One patient's typed values, referentially stable between changes. */
export function useHfpefInputs(patientId: string | undefined): HfpefInputs | undefined {
  return useHfpefInputsStore((state) => (patientId ? state.byPatientId[patientId] : undefined))
}

/** Whether this chart's typed values have been read back yet. */
export function useHfpefInputsHydrated(patientId: string | undefined): boolean {
  return useHfpefInputsStore(
    (state) => !patientId || Boolean(state.hydratedPatientIds[patientId]),
  )
}

/** A record built from one statement, for a caller with no store. */
export function buildHfpefInputs(patch: HfpefInputsPatch, now: Date = new Date()): HfpefInputs {
  return mergeHfpefInputs(EMPTY_HFPEF_INPUTS, patch, now)
}
