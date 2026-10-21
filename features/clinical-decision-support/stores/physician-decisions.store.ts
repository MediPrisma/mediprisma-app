/**
 * What the physician decided about each recommendation, per patient.
 *
 * A recommendation with no way to answer it is a recommendation that is read
 * once and scrolled past. This store is the answer: one decision per module —
 * prescribed, dose adjusted, contraindicated, deferred, the patient's own
 * preference, or an order placed — with the reasons chosen, a free-text note,
 * and when it was recorded.
 *
 * Three things it deliberately is not:
 *
 * - **Not a fact.** Nothing here re-enters the pack. There is no fact key for
 *   「我開了」 in `@voho0000/personalized-care` 1.13.0, so a decision changes
 *   the step bar and the next step and nothing else. When the pack grows one,
 *   this is the store that feeds it.
 * - **Not a closure.** 「已開立」 does not retire a row. If the rules find the
 *   same gap next visit the row comes back, carrying last visit's decision and
 *   its date, because the record is what decides whether a gap is still open.
 * - **Not a chart entry.** Nothing is written back to the record and nothing
 *   is claimed; the decision is encrypted under this tab's session key and
 *   keyed by patient, so it survives a reload and no one else's browser
 *   session can read it. Carrying it to the next visit is phase 2.
 *
 * `packVersion` travels with each decision so a reader can tell 「這是對哪一版
 * 規則做的決定」 — a row whose wording changed between releases is not
 * necessarily the row that was decided.
 *
 * The visit decision map records here too, one decision per decision point
 * rather than per module (`visitDecisionKey` in `renderers/visit/visit-decisions`),
 * and adds the pack's action id and label, its response check and its reopen
 * condition. The queue row and the map cell for one point write the same key,
 * so a point is decided once wherever it was decided.
 */
import { create } from 'zustand'
import {
  createHydrationGuard,
} from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking, patientAnswerStorageKey } from './patient-answer-backing'

export type PhysicianDecisionKind =
  | 'prescribed'
  | 'dose-adjusted'
  | 'contraindicated'
  | 'deferred'
  | 'patient-preference'
  | 'ordered'
  | 'measurements-completed'
  | 'follow-up-arranged'
  | 'referred'
  | 'exercise-cleared'
  | 'supervised-exercise'
  | 'reviewed'
  | 'held'
  | 'at-max-tolerated'

/**
 * What the pack asked to be checked after a decision, and within how many days.
 * Pack wording, stored as it was shown so the plan reads back what was decided.
 */
export interface DecisionResponseCheck {
  text: string
  /** When, in the guideline's own words (「1–2 週」); absent where ESC gives none. */
  interval?: string
  /** Kept only for decisions stored before `interval`. */
  withinDays?: number
}

/**
 * Where a decision was taken on the visit decision map. A decision recorded
 * there is keyed by its decision point rather than by a module, and carries the
 * pack's own action, check and reopen condition. Decisions recorded on the
 * other layouts have none of these, and a record written before they existed
 * reads back without them.
 */
export interface VisitDecisionContext {
  /** The decision point, e.g. `DP-07`. */
  dp?: string
  /** The pack's stable action id. */
  actionId?: string
  /** The action's label as the pack printed it (「換 ARNI」). */
  actionLabel?: string
  responseCheck?: DecisionResponseCheck
  /** When the pack says to ask again (「K 回到 <5.0 時重新開始」). */
  reopenWhen?: string
}

export interface PhysicianDecision extends VisitDecisionContext {
  decision: PhysicianDecisionKind
  /** Reason ids from `DECISION_REASONS`; free text goes in `note`. */
  reasons: readonly string[]
  note?: string
  /** When it was recorded, as an ISO timestamp. */
  recordedAt: string
  /** The rules version the decision was made against. */
  packVersion: string
}

export type PhysicianDecisionMap = Readonly<Record<string, PhysicianDecision>>

/** The key one patient's encrypted decisions are kept under. */
export function physicianDecisionsStorageKey(patientId: string): string {
  return patientAnswerStorageKey('physician-decisions', patientId)
}

const DECISION_KINDS: readonly PhysicianDecisionKind[] = [
  'prescribed',
  'dose-adjusted',
  'contraindicated',
  'deferred',
  'patient-preference',
  'ordered',
  'measurements-completed',
  'follow-up-arranged',
  'referred',
  'exercise-cleared',
  'supervised-exercise',
  'reviewed',
  'held',
  'at-max-tolerated',
]

function isDecisionKind(value: unknown): value is PhysicianDecisionKind {
  return DECISION_KINDS.some((kind) => kind === value)
}

/**
 * care 2.8 renamed these prescriptions without changing their actions. Keep
 * decisions from an open tab's older encrypted cache, including any next
 * step, under the new keys. Dates, labels and rule versions stay untouched;
 * the visit map still checks whether an action applies today.
 */
const LEGACY_VISIT_DECISIONS: Readonly<Record<string, string>> = {
  'visit:hf-ras': 'visit:ras-inhibition',
  'visit:hf-sglt2i': 'visit:sglt2i',
  'visit:hf-lipid': 'visit:lipid-lowering',
}

function currentDecisionKey(key: string): string {
  for (const [legacy, current] of Object.entries(LEGACY_VISIT_DECISIONS)) {
    if (key === legacy || key.startsWith(`${legacy}:`)) return current + key.slice(legacy.length)
  }
  return key
}

/**
 * Storage is a best-effort cache, never a source of clinical truth: Safari
 * private mode throws on write, a quota can be full, a session that cannot
 * decrypt hands back nothing, and a hand-edited value can be anything at all.
 * Every path therefore degrades to 「還沒決定」.
 */
function toDecisions(parsed: unknown): PhysicianDecisionMap {
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const decisions: Record<string, PhysicianDecision> = {}
    for (const [moduleId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      if (!isDecisionKind(record.decision)) continue
      const key = currentDecisionKey(moduleId)
      // A valid record already written under the current key wins over its
      // legacy alias, regardless of the stored object's property order.
      if (key !== moduleId && decisions[key]) continue
      decisions[key] = {
        decision: record.decision,
        reasons: Array.isArray(record.reasons)
          ? record.reasons.filter((reason): reason is string => typeof reason === 'string')
          : [],
        ...(typeof record.note === 'string' && record.note ? { note: record.note } : {}),
        recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : '',
        packVersion: typeof record.packVersion === 'string' ? record.packVersion : '',
        ...toVisitContext(record),
      }
    }
    return decisions
  } catch {
    return {}
  }
}

/** The visit-map fields, each kept only when it is the shape it claims to be. */
function toVisitContext(record: Record<string, unknown>): VisitDecisionContext {
  const check = record.responseCheck as Record<string, unknown> | undefined
  const withinDays = check && typeof check === 'object' ? check.withinDays : undefined
  const interval = check && typeof check === 'object' ? check.interval : undefined
  return {
    ...(typeof record.dp === 'string' && record.dp ? { dp: record.dp } : {}),
    ...(typeof record.actionId === 'string' && record.actionId ? { actionId: record.actionId } : {}),
    ...(typeof record.actionLabel === 'string' && record.actionLabel ? { actionLabel: record.actionLabel } : {}),
    ...(check && typeof check === 'object' && typeof check.text === 'string' && check.text
      ? {
          responseCheck: {
            text: check.text,
            ...(typeof interval === 'string' && interval ? { interval } : {}),
            ...(typeof withinDays === 'number' && Number.isFinite(withinDays) && withinDays >= 0 ? { withinDays } : {}),
          },
        }
      : {}),
    ...(typeof record.reopenWhen === 'string' && record.reopenWhen ? { reopenWhen: record.reopenWhen } : {}),
  }
}

function writeStoredDecisions(patientId: string, decisions: PhysicianDecisionMap): void {
  if (Object.keys(decisions).length === 0) {
    patientAnswerBacking().discard('physician-decisions', patientId)
    return
  }
  patientAnswerBacking().save('physician-decisions', patientId, decisions)
}

const hydration = createHydrationGuard()

/** What a decision is being recorded about, without the clock or the store. */
export interface PhysicianDecisionInput extends VisitDecisionContext {
  decision: PhysicianDecisionKind
  reasons?: readonly string[]
  note?: string
  packVersion: string
}

const EMPTY_DECISIONS: PhysicianDecisionMap = Object.freeze({})

interface PhysicianDecisionsState {
  byPatientId: Readonly<Record<string, PhysicianDecisionMap>>
  /** Which charts have been read back, so the screen can tell 「沒有決定」 from
   *  「還沒讀到」 rather than showing every row undecided and then jumping. */
  hydratedPatientIds: Readonly<Record<string, true>>
  /** Loads one patient's stored decisions once; a no-op after that. */
  hydrate: (patientId: string) => void
  recordDecision: (
    patientId: string,
    moduleId: string,
    input: PhysicianDecisionInput,
    now?: Date,
  ) => void
  clearDecision: (patientId: string, moduleId: string) => void
  clearDecisions: (patientId: string) => void
  /** Fill unanswered decisions from a confirmed snapshot, retaining the original date. */
  carryForward: (patientId: string, saved: unknown, packVersion: string) => void
  canCarryForward: (patientId: string) => boolean
}

export const usePhysicianDecisionsStore = create<PhysicianDecisionsState>()((set, get) => ({
  byPatientId: {},
  hydratedPatientIds: {},
  canCarryForward: patientId => Boolean(get().hydratedPatientIds[patientId]) && !hydration.isPending(patientId),

  carryForward: (patientId, saved, packVersion) => {
    if (!patientId) return
    if (!get().canCarryForward(patientId)) throw new Error('cdss_carry_forward_unavailable')
    const valid = Object.fromEntries(Object.entries(toDecisions(saved))
      .filter(([key, decision]) => !['__proto__', 'constructor', 'prototype'].includes(key)
        && decision.packVersion === packVersion && Number.isFinite(Date.parse(decision.recordedAt))))
    set(state => {
      const next = { ...valid, ...state.byPatientId[patientId] }
      writeStoredDecisions(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  hydrate: (patientId) => {
    if (!patientId) return
    const state = get()
    if (state.hydratedPatientIds[patientId] || hydration.isPending(patientId)) return

    // Decisions already in memory are this session's own, and a chart with no
    // stored record is a first visit. Neither needs a decryption, and neither
    // writes anything.
    if (
      state.byPatientId[patientId]
      || !patientAnswerBacking().has('physician-decisions', patientId)
    ) {
      set((current) => ({
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: EMPTY_DECISIONS },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
      return
    }

    const settle = hydration.begin(patientId)
    const apply = (decisions: PhysicianDecisionMap) => {
      if (!settle()) return
      set((current) => ({
        // A decision recorded while the read was in flight is more recent than
        // storage; it stands.
        byPatientId: current.byPatientId[patientId]
          ? current.byPatientId
          : { ...current.byPatientId, [patientId]: decisions },
        hydratedPatientIds: { ...current.hydratedPatientIds, [patientId]: true },
      }))
    }
    void patientAnswerBacking().load('physician-decisions', patientId)
      .then((stored) => apply(toDecisions(stored)))
      // A record that cannot be read leaves every row undecided, which is the
      // same state as a chart nobody has decided on.
      .catch(() => apply(EMPTY_DECISIONS))
  },

  recordDecision: (patientId, moduleId, input, now = new Date()) => {
    if (!patientId || !moduleId) return
    set((state) => {
      const current = state.byPatientId[patientId] ?? EMPTY_DECISIONS
      const next: PhysicianDecisionMap = {
        ...current,
        [moduleId]: {
          decision: input.decision,
          reasons: [...(input.reasons ?? [])],
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
          recordedAt: now.toISOString(),
          packVersion: input.packVersion,
          ...toVisitContext(input as unknown as Record<string, unknown>),
        },
      }
      // In memory first; the encryption runs in the background and cannot
      // reach back into what the screen is already showing.
      writeStoredDecisions(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clearDecision: (patientId, moduleId) => {
    if (!patientId || !moduleId) return
    set((state) => {
      const current = state.byPatientId[patientId] ?? EMPTY_DECISIONS
      if (!(moduleId in current)) return state
      const next = { ...current }
      delete next[moduleId]
      writeStoredDecisions(patientId, next)
      return { byPatientId: { ...state.byPatientId, [patientId]: next } }
    })
  },

  clearDecisions: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('physician-decisions', patientId)
    set((state) => ({
      byPatientId: { ...state.byPatientId, [patientId]: EMPTY_DECISIONS },
      hydratedPatientIds: { ...state.hydratedPatientIds, [patientId]: true },
    }))
  },
}))

/**
 * One patient's decisions, referentially stable between changes, so the flow
 * model is not rebuilt on every unrelated render.
 */
export function usePhysicianDecisions(patientId: string | undefined): PhysicianDecisionMap {
  return usePhysicianDecisionsStore(
    (state) => (patientId ? state.byPatientId[patientId] : undefined) ?? EMPTY_DECISIONS,
  )
}

/** Whether this chart's decisions have been read back yet. */
export function usePhysicianDecisionsHydrated(patientId: string | undefined): boolean {
  return usePhysicianDecisionsStore(
    (state) => !patientId || Boolean(state.hydratedPatientIds[patientId]),
  )
}

/** Reads one patient's decisions outside React (tests, imperative callers). The
 *  stored copy is encrypted, so only what this session has read back is here. */
export function getPhysicianDecisions(patientId: string): PhysicianDecisionMap {
  return usePhysicianDecisionsStore.getState().byPatientId[patientId] ?? EMPTY_DECISIONS
}
