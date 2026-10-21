/**
 * Which evidence rows this physician has switched on or off, per patient.
 *
 * A row's `defaultEnabled` is what the record can say for itself. Whether that
 * row belongs in today's reading is a clinical judgement — only the physician
 * knows that last month's chest film was taken during a pneumonia — so the
 * decision lives in the host, never in the pack, and is handed back to the pack
 * as `CdssPatientProfile.evidenceOverrides` so the module recomputes from it.
 * Nothing here patches a rendered card.
 *
 * The state is keyed by patient because it is a statement about one person's
 * chart: carrying a switch from the previous patient into the next one would be
 * a wrong reading presented as a considered one. Persistence follows the same
 * rule — one key per patient — so clearing one patient never touches another.
 *
 * A switch is patient data like any other answer, so it is kept where every
 * other answer is: through the patient-answer backing, encrypted under this
 * tab's session key. A reload of the tab keeps the switches; a new tab session
 * starts from the record's own reading.
 */
import { create } from 'zustand'
import { createHydrationGuard } from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking, patientAnswerStorageKey } from './patient-answer-backing'

export type EvidenceOverrideMap = Readonly<Record<string, boolean>>

const EMPTY_OVERRIDES: EvidenceOverrideMap = Object.freeze({})

/** The key one patient's encrypted switches are kept under. */
export function evidenceOverridesStorageKey(patientId: string): string {
  return patientAnswerStorageKey('evidence-overrides', patientId)
}

/**
 * Where earlier builds wrote the switches as plain JSON, with no expiry.
 *
 * Nothing under it is read: a plaintext copy is what this store no longer
 * keeps, and carrying it into the sealed one would keep it alive for one more
 * session for no reason. It is removed instead — every patient's, not only the
 * chart being opened, so a copy for a chart nobody opens again does not stay.
 */
const PLAINTEXT_PREFIX = 'cdss-evidence-overrides:'

/** Removes every plaintext copy of the switches earlier builds left behind. */
export function discardPlaintextEvidenceOverrides(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(PLAINTEXT_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Storage that cannot be listed cannot be swept; the next chart tries again.
  }
}

/**
 * Storage is a best-effort cache, never a source of clinical truth: a record
 * from another build, or a hand-edited one, can hold anything at all. Only
 * true and false survive a read, and everything else degrades to "no
 * override", which is the same reading the pack gives on a first visit.
 */
function toOverrides(parsed: unknown): EvidenceOverrideMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_OVERRIDES
  const overrides: Record<string, boolean> = {}
  for (const [itemId, enabled] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof enabled === 'boolean') overrides[itemId] = enabled
  }
  return overrides
}

function writeStored(patientId: string, overrides: EvidenceOverrideMap): void {
  if (Object.keys(overrides).length === 0) patientAnswerBacking().discard('evidence-overrides', patientId)
  else patientAnswerBacking().save('evidence-overrides', patientId, overrides)
}

const hydration = createHydrationGuard()

interface EvidenceOverridesState {
  byPatientId: Readonly<Record<string, EvidenceOverrideMap>>
  /** Which charts' stored switches have been read back, so the screen can tell
   *  「沒切過」 from 「還沒讀到」 and show the rows only once it knows which. */
  hydratedPatientIds: Readonly<Record<string, true>>
  /** Reads one patient's stored switches once; a no-op after that. */
  hydrate: (patientId: string) => void
  setOverride: (patientId: string, itemId: string, enabled: boolean) => void
  clearOverrides: (patientId: string) => void
}

export const useEvidenceOverridesStore = create<EvidenceOverridesState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},

  hydrate: (patientId) => {
    discardPlaintextEvidenceOverrides()
    if (!patientId) return
    const state = get()
    if (state.hydratedPatientIds[patientId] || hydration.isPending(patientId)) return

    // A chart with nothing stored is read in the same tick: a first visit never
    // waits on a decryption with nothing to decrypt.
    if (!patientAnswerBacking().has('evidence-overrides', patientId)) {
      set((current) => ({
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: EMPTY_OVERRIDES },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
      return
    }

    const settle = hydration.begin(patientId)
    const apply = (stored: EvidenceOverrideMap) => {
      // A read that resolves after the chart moved on is dropped, and the chart
      // it belongs to is read again if it is opened.
      if (!settle()) return
      set((current) => {
        // A switch flipped while the read was in flight is newer than storage;
        // the stored switches on the other rows stay beside it.
        const inMemory = current.byPatientId[patientId] ?? EMPTY_OVERRIDES
        const merged = { ...stored, ...inMemory }
        if (Object.keys(inMemory).length > 0) writeStored(patientId, merged)
        return {
          byPatientId: { ...current.byPatientId, [patientId]: merged },
          hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
        }
      })
    }
    void patientAnswerBacking().load('evidence-overrides', patientId)
      .then((stored) => apply(toOverrides(stored)))
      // What cannot be read is a first visit's reading.
      .catch(() => apply(EMPTY_OVERRIDES))
  },

  setOverride: (patientId, itemId, enabled) => {
    if (!patientId || !itemId) return
    set((state) => {
      const next: EvidenceOverrideMap = { ...(state.byPatientId[patientId] ?? EMPTY_OVERRIDES), [itemId]: enabled }
      // Before the stored switches are back, writing now would drop them; the
      // read merges this switch in and writes the whole when it lands.
      if (state.hydratedPatientIds[patientId]) writeStored(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clearOverrides: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('evidence-overrides', patientId)
    // A read still in flight would bring the discarded switches back.
    if (hydration.isPending(patientId)) hydration.invalidate()
    set((state) => ({
      byPatientId: { ...state.byPatientId, [patientId]: EMPTY_OVERRIDES },
      hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
    }))
  },
}))

/**
 * One patient's switches, referentially stable between changes.
 *
 * The profile memo in `LiveFeature` uses this object as a dependency, so a new
 * literal on every render would rebuild the whole adapter on unrelated renders.
 */
export function useEvidenceOverrides(patientId: string | undefined): EvidenceOverrideMap {
  return useEvidenceOverridesStore(
    (state) => (patientId ? state.byPatientId[patientId] : undefined) ?? EMPTY_OVERRIDES,
  )
}

/**
 * Whether this chart's stored switches have been read back yet.
 *
 * A row drawn at the pack's default while the physician's switch is still
 * being decrypted reads as their judgement having been dropped, so the rows
 * wait for this rather than flipping when the read lands.
 */
export function useEvidenceOverridesHydrated(patientId: string | undefined): boolean {
  return useEvidenceOverridesStore(
    (state) => !patientId || Boolean(state.hydratedPatientIds[patientId]),
  )
}

/** Reads one patient's switches outside React (tests, imperative callers). The
 *  stored copy is encrypted, so only what this session has read back is here. */
export function getEvidenceOverrides(patientId: string): EvidenceOverrideMap {
  return useEvidenceOverridesStore.getState().byPatientId[patientId] ?? EMPTY_OVERRIDES
}
