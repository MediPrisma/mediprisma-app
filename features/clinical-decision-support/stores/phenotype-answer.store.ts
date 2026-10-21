/**
 * What the physician answered on the DP-00/DP-01 phenotype gate, per patient.
 *
 * 健保雲端 holds no ejection fraction for a patient whose only echocardiogram
 * was done at another hospital, on paper, or in a nuclear medicine department,
 * and both ESC 2026 phenotypes start from one. The 01 card therefore asks, and
 * the answer is handed back to the pack as facts (see `applyPhenotypeAnswer`)
 * so every module that reads an LVEF recomputes from it — nothing patches a
 * rendered card. The same store carries the DP-00 suspicion and the
 * physician's confirmation of the HFpEF diagnosis on the DP-01b card.
 *
 * Each of the three answers carries its own `modifiedAt`, because they are
 * given at different visits and a screen that dates them alike makes a
 * carried-over answer look like today's. Storing an answer unchanged leaves
 * its stamp alone, so 「最後修改」 dates the change rather than the click.
 *
 * Kept per patient, encrypted under this tab's session key, so an answer
 * survives a reload of this tab, no other browser session can read it, and it
 * never follows the previous patient into the next chart. Carrying an answer to
 * the next visit is phase 2: the seam for that server-side implementation is
 * the patient-answer backing every CDSS store shares (`patient-answer-backing.ts`)
 * — swap it, and this store follows with the others. `PhenotypeAnswerRepository`
 * remains for a repository of this answer alone (a test's, say).
 */
import { create } from 'zustand'
import {
  createHydrationGuard,
} from '@/src/application/services/encrypted-answer-cache.service'
import {
  ENCRYPTED_TAB_SESSION_BACKING,
  patientAnswerBacking,
  patientAnswerStorageKey,
  type PatientAnswerBacking,
} from './patient-answer-backing'

/** The three choices the pack offers, by the option ids it publishes. */
export type PhenotypeAnswerChoice = 'reduced' | 'preserved' | 'unknown'

/** 「暫不確認」: the question was put, and the answer is deliberately none. */
export const HFPEF_NOT_CONFIRMED = 'not-assessed' as const

/** The DP-00 answer: whether this clinician is asking about heart failure. */
export type HeartFailureSuspicionAnswer = 'suspected' | 'not-suspected'

/** The phenotype a clinician chose on DP-00 「診斷：HFrEF 還是 HFpEF？」. */
export type HeartFailureDiagnosisChoice = 'hfrEF' | 'hfpEF'

/** When each answer was last changed, as ISO timestamps. */
export interface PhenotypeAnswerTimestamps {
  hfSuspicion?: string
  /** The choice, the LVEF and its study date are one answer with one stamp. */
  phenotype?: string
  hfpEfConfirmed?: string
}

export interface PhenotypeAnswer {
  /** Explicit physician confirmation; does not infer an HF subtype. */
  diagnosisConfirmation?: { method: 'current' | 'existing'; confirmedAt: string; basis: string }
  /**
   * DP-00. Absent means nobody has been asked yet, which the pack never reads
   * as 「不懷疑」 — it is the difference between a quiet card and a closed one.
   */
  hfSuspicion?: HeartFailureSuspicionAnswer
  /**
   * The phenotype chosen on DP-00, where one was. It is the clinician's
   * diagnosis, and it is what that answer wrote beside it — the `choice`, and
   * the `diagnosisConfirmation` (HFrEF) or `hfpEfConfirmed` (HFpEF) — so
   * changing the answer knows exactly what to take back.
   */
  diagnosis?: HeartFailureDiagnosisChoice
  /**
   * Absent where the phenotype gate never asked — a patient whose record does
   * hold an LVEF can still reach the HFpEF confirmation below.
   */
  choice?: PhenotypeAnswerChoice
  /** The LVEF the physician read off the outside report, where they gave one. */
  lvef?: number
  /** The date of that study, as YYYY-MM-DD. */
  measuredOn?: string
  /** The day the answer was given, as YYYY-MM-DD. */
  answeredOn: string
  /**
   * Set once the physician works through §5.2.2: `true` confirms HFpEF,
   * `'not-assessed'` is 「暫不確認」 — the question was put and deliberately
   * left open. Both count as answered on screen; only `true` produces a fact,
   * because 「今天先不確認」 is not a statement that the patient has no HFpEF.
   */
  hfpEfConfirmed?: boolean | typeof HFPEF_NOT_CONFIRMED
  /** Per-answer last-modified stamps, kept by the store rather than callers. */
  modifiedAt?: PhenotypeAnswerTimestamps
}

/**
 * The stamps after one save.
 *
 * Each group keeps its stamp while its own value is unchanged, so answering
 * the HFpEF confirmation today does not re-date a suspicion answered in
 * August. Exported because the diff, not the click, is what 「最後修改」 means.
 */
export function stampPhenotypeAnswer(
  previous: PhenotypeAnswer | undefined,
  next: PhenotypeAnswer,
  now: Date = new Date(),
): PhenotypeAnswer {
  const at = now.toISOString()
  const before = previous?.modifiedAt ?? {}
  const modifiedAt: PhenotypeAnswerTimestamps = {}

  // One question: the phenotype chosen on DP-00 dates with the suspicion.
  const suspicionChanged = previous?.hfSuspicion !== next.hfSuspicion || previous?.diagnosis !== next.diagnosis
  if (next.hfSuspicion !== undefined) {
    modifiedAt.hfSuspicion = suspicionChanged ? at : before.hfSuspicion ?? at
  }

  const phenotypeChanged = previous?.choice !== next.choice
    || previous?.lvef !== next.lvef
    || previous?.measuredOn !== next.measuredOn
  if (next.choice !== undefined) {
    modifiedAt.phenotype = phenotypeChanged ? at : before.phenotype ?? at
  }

  const confirmationChanged = previous?.hfpEfConfirmed !== next.hfpEfConfirmed
  if (next.hfpEfConfirmed !== undefined) {
    modifiedAt.hfpEfConfirmed = confirmationChanged ? at : before.hfpEfConfirmed ?? at
  }

  return { ...next, modifiedAt }
}

/** Whether two answers state the same thing, stamps aside. */
function sameAnswer(a: PhenotypeAnswer | undefined, b: PhenotypeAnswer): boolean {
  return Boolean(a)
    && a?.hfSuspicion === b.hfSuspicion
    && a?.diagnosis === b.diagnosis
    && a?.choice === b.choice
    && a?.lvef === b.lvef
    && a?.measuredOn === b.measuredOn
    && a?.hfpEfConfirmed === b.hfpEfConfirmed
    && JSON.stringify(a?.diagnosisConfirmation) === JSON.stringify(b.diagnosisConfirmation)
}

/**
 * Where a patient's answer is kept.
 *
 * Async on purpose. The browser implementation below resolves immediately, but
 * a per-UID Firestore document is the approved server-side path, and an
 * interface that could only be synchronous would have to be rewritten — along
 * with every caller — the day it lands. Callers await `load` once per patient
 * and read the cached value from the store afterwards.
 */
export interface PhenotypeAnswerRepository {
  load: (patientId: string) => Promise<PhenotypeAnswer | undefined>
  save: (patientId: string, answer: PhenotypeAnswer) => Promise<void>
  clear: (patientId: string) => Promise<void>
  /**
   * Optional: whether this repository holds anything for the patient, answered
   * without a round trip. A browser-local store can say so by looking at a key,
   * and the card then opens on the question instead of on 「讀取中」. A remote
   * one omits it, and the caller waits for `load` — which is why this is a
   * hint, never a substitute for the answer `load` returns.
   */
  has?: (patientId: string) => boolean
}

/** The key one patient's encrypted answer is kept under. */
export function phenotypeAnswerStorageKey(patientId: string): string {
  return patientAnswerStorageKey('phenotype-answer', patientId)
}

function isSuspicion(value: unknown): value is HeartFailureSuspicionAnswer {
  return value === 'suspected' || value === 'not-suspected'
}

function isChoice(value: unknown): value is PhenotypeAnswerChoice {
  return value === 'reduced' || value === 'preserved' || value === 'unknown'
}

function parseStoredAnswer(parsed: unknown): PhenotypeAnswer | undefined {
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const confirmation = record.diagnosisConfirmation as PhenotypeAnswer['diagnosisConfirmation']
    const stamps = (record.modifiedAt ?? {}) as Record<string, unknown>
    const stamp = (key: string) => (typeof stamps[key] === 'string' ? { [key]: stamps[key] } : {})
    return {
      answeredOn: typeof record.answeredOn === 'string' ? record.answeredOn : '',
      ...(confirmation && ['current', 'existing'].includes(confirmation.method)
        && typeof confirmation.confirmedAt === 'string' && Number.isFinite(Date.parse(confirmation.confirmedAt))
        && typeof confirmation.basis === 'string' ? { diagnosisConfirmation: confirmation } : {}),
      ...(isSuspicion(record.hfSuspicion) ? { hfSuspicion: record.hfSuspicion } : {}),
      ...(record.diagnosis === 'hfrEF' || record.diagnosis === 'hfpEF' ? { diagnosis: record.diagnosis } : {}),
      ...(isChoice(record.choice) ? { choice: record.choice } : {}),
      ...(typeof record.lvef === 'number' && Number.isFinite(record.lvef) ? { lvef: record.lvef } : {}),
      ...(typeof record.measuredOn === 'string' ? { measuredOn: record.measuredOn } : {}),
      ...(typeof record.hfpEfConfirmed === 'boolean' || record.hfpEfConfirmed === HFPEF_NOT_CONFIRMED
        ? { hfpEfConfirmed: record.hfpEfConfirmed as boolean | typeof HFPEF_NOT_CONFIRMED }
        : {}),
      modifiedAt: {
        ...stamp('hfSuspicion'),
        ...stamp('phenotype'),
        ...stamp('hfpEfConfirmed'),
      },
    }
  } catch {
    return undefined
  }
}

/**
 * The default: this tab, keyed by patient, encrypted.
 *
 * Nothing is written to the chart and nothing leaves the machine. What is kept
 * is what the clinician said about this patient, under the same envelope as the
 * imported bundle — ciphertext in `localStorage`, readable only by the tab
 * session that wrote it, so the next person at a shared workstation reads
 * nothing. A save returns before the ciphertext lands; the store's in-memory
 * answer is what the screen shows, and a write that fails never reaches it.
 */
export function createEncryptedPhenotypeAnswerRepository(): PhenotypeAnswerRepository {
  return repositoryOver(() => ENCRYPTED_TAB_SESSION_BACKING)
}

/**
 * The phenotype answer on a patient-answer backing: read back through the
 * same validation whichever backing holds it.
 */
function repositoryOver(backing: () => PatientAnswerBacking): PhenotypeAnswerRepository {
  const available = (patientId: string) => typeof window !== 'undefined' && Boolean(patientId)
  return {
    has: (patientId) => (
      available(patientId) && backing().has('phenotype-answer', patientId)
    ),
    load: async (patientId) => {
      if (!available(patientId)) return undefined
      if (!backing().has('phenotype-answer', patientId)) return undefined
      return parseStoredAnswer(await backing().load('phenotype-answer', patientId))
    },
    save: async (patientId, answer) => {
      if (!available(patientId)) return
      backing().save('phenotype-answer', patientId, answer)
    },
    clear: async (patientId) => {
      if (!available(patientId)) return
      backing().discard('phenotype-answer', patientId)
    },
  }
}

/** This tab's memory and nothing else, for a test that wants no storage. */
export function createSessionPhenotypeAnswerRepository(): PhenotypeAnswerRepository {
  const answers = new Map<string, PhenotypeAnswer>()
  return {
    has: (patientId) => answers.has(patientId),
    load: async (patientId) => answers.get(patientId),
    save: async (patientId, answer) => {
      answers.set(patientId, answer)
    },
    clear: async (patientId) => {
      answers.delete(patientId)
    },
  }
}

// The default follows the patient-answer backing every CDSS store shares.
let repository: PhenotypeAnswerRepository = repositoryOver(patientAnswerBacking)

/** One read in flight at a time, so an answer that decrypts after the chart
 *  moved on is dropped rather than applied to whoever is on screen now. */
const hydration = createHydrationGuard()

/**
 * Replaces the repository, for a server-side implementation or for a test.
 *
 * Anything already cached in the store is dropped: a new repository is a new
 * answer to 「這位病人上次填了什麼」, and keeping the old cache would show one
 * store's answer over another's.
 */
export function setPhenotypeAnswerRepository(next: PhenotypeAnswerRepository): void {
  repository = next
  // A read still in flight belongs to the repository being replaced, and its
  // answer is no longer this store's answer to 「上次填了什麼」.
  hydration.invalidate()
  usePhenotypeAnswerStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
}

interface PhenotypeAnswerState {
  byPatientId: Readonly<Record<string, PhenotypeAnswer>>
  /**
   * Which patients the repository has already answered for — set when the read
   * resolves, not when it starts. 「沒作答」 and 「還沒讀到」 look identical on
   * the card and mean opposite things, so the question waits for this rather
   * than opening unanswered and jumping when the read lands.
   */
  hydratedPatientIds: Readonly<Record<string, true>>
  /** Reads one patient's stored answer once; a no-op after that. */
  hydrate: (patientId: string) => void
  setAnswer: (patientId: string, answer: PhenotypeAnswer, now?: Date) => void
  clearAnswer: (patientId: string) => void
  carryForward: (patientId: string, saved: unknown) => void
  canCarryForward: (patientId: string) => boolean
}

export const usePhenotypeAnswerStore = create<PhenotypeAnswerState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},
  canCarryForward: patientId => Boolean(get().hydratedPatientIds[patientId]) && !hydration.isPending(patientId),

  carryForward: (patientId, saved) => {
    if (!patientId || get().byPatientId[patientId]) return
    if (!get().canCarryForward(patientId)) throw new Error('cdss_carry_forward_unavailable')
    const answer = parseStoredAnswer(saved)
    if (!answer) return
    set(state => ({ byPatientId: { ...state.byPatientId, [patientId]: answer } }))
    void repository.save(patientId, answer).catch(() => {})
  },

  hydrate: (patientId) => {
    if (!patientId) return
    const state = get()
    if (state.hydratedPatientIds[patientId] || hydration.isPending(patientId)) return

    // An answer already in memory is this session's own, and a repository that
    // can say 「沒有」 without a round trip has already answered. Neither waits,
    // and neither writes anything back.
    if (state.byPatientId[patientId] || repository.has?.(patientId) === false) {
      set((current) => ({
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
      return
    }

    const settle = hydration.begin(patientId)
    const apply = (answer: PhenotypeAnswer | undefined) => {
      // A read that resolves after the chart moved on is an answer for a
      // patient nobody is looking at; it is dropped, and the chart it belongs
      // to is read again if it is opened.
      if (!settle()) return
      set((current) => ({
        // A physician who answered while the read was in flight has said
        // something more recent than storage; their answer stands.
        byPatientId: answer && !current.byPatientId[patientId]
          ? { ...current.byPatientId, [patientId]: answer }
          : current.byPatientId,
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
    }
    void repository.load(patientId)
      .then(apply)
      // A store that cannot be read leaves the card asking, which is the same
      // state as a patient who has never been answered for.
      .catch(() => apply(undefined))
  },

  setAnswer: (patientId, answer, now = new Date()) => {
    if (!patientId) return
    const previous = get().byPatientId[patientId]
    // Saving the same answer again is not a new answer. The stamps are carried
    // forward so a re-render, a hydration or a second click cannot re-date what
    // the clinician said last month.
    if (sameAnswer(previous, answer) && previous?.answeredOn === answer.answeredOn) return
    const stamped = stampPhenotypeAnswer(previous, answer, now)
    set((state) => ({ byPatientId: { ...state.byPatientId, [patientId]: stamped } }))
    void repository.save(patientId, stamped).catch(() => {
      // The answer holds for this session even where it could not be written.
    })
  },

  clearAnswer: (patientId) => {
    if (!patientId) return
    set((state) => {
      const next = { ...state.byPatientId }
      delete next[patientId]
      return {
        byPatientId: next,
        // Cleared is an answer to 「讀到了嗎」: there is nothing to read back.
        hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
      }
    })
    void repository.clear(patientId).catch(() => {})
  },
}))

/** One patient's answer, or undefined while the card is still asking. */
export function usePhenotypeAnswer(patientId: string | undefined): PhenotypeAnswer | undefined {
  return usePhenotypeAnswerStore(
    (state) => (patientId ? state.byPatientId[patientId] : undefined),
  )
}

/** Whether this chart's answer has been read back yet. */
export function usePhenotypeAnswerHydrated(patientId: string | undefined): boolean {
  return usePhenotypeAnswerStore(
    (state) => !patientId || Boolean(state.hydratedPatientIds[patientId]),
  )
}
