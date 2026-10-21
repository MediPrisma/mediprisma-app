// 門診偏好 — the clinician's own outpatient reading and copy habits: which
// analytes the overview pins, and the plain-text formats they paste back into
// their EMR.
//
// Only SETTINGS live here — concept ids, literal template text and field
// placeholders. No patient value, date, report text or resource id is ever
// stored (see memory/feedback_persistence_policy_no_phi.md); every patient
// result is recomputed from the loaded chart each time.
//
// Stored per visitor key (account uid, anonymous uid, or a shared guest key —
// the same resolution the Beta switch uses). A signed-in account's settings
// also go to that account (users/{uid}.outpatientPrefs, see
// outpatient-prefs-sync.ts), so every device signed in to it shows the same;
// anonymous and guest settings stay on this computer, and the UI says so.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const GUEST_OUTPATIENT_PREFS_KEY = 'guest'

export function resolveOutpatientPrefsKey(
  signedInUid?: string | null,
  anonymousUid?: string | null,
): string {
  return signedInUid || anonymousUid || GUEST_OUTPATIENT_PREFS_KEY
}

export type OverviewLabMode = 'abnormal' | 'pinned' | 'mine' | 'all'
const LAB_MODES: OverviewLabMode[] = ['abnormal', 'pinned', 'mine', 'all']

export type EmrHandoffMode = 'custom' | 'builtin'

export type EmrLabField = 'name' | 'value' | 'unit' | 'date' | 'flag'
export type EmrExamKind = 'echo' | 'ecg'
export type EmrExamField = 'title' | 'date' | 'org' | 'conclusion' | 'text'

export const EMR_LAB_FIELDS: EmrLabField[] = ['name', 'value', 'unit', 'date', 'flag']
export const EMR_EXAM_KINDS: EmrExamKind[] = ['echo', 'ecg']
export const EMR_EXAM_FIELDS: EmrExamField[] = ['title', 'date', 'org', 'conclusion', 'text']

/** 最近 N 次 for a lab's value or date field ("1.2→1.3→1.5"). Absent = one. */
export const EMR_LAB_RECENT_COUNTS = [2, 3, 4, 5] as const
/** Fields that can print a series. */
export const EMR_LAB_SERIES_FIELDS: EmrLabField[] = ['value', 'date']

/** One piece of a copy format. Text is kept verbatim — spaces, slashes,
 *  CJK punctuation — and a newline is its own token. */
export type EmrFormatToken =
  | { kind: 'text'; text: string }
  | { kind: 'newline' }
  | { kind: 'lab'; lab: string; field: EmrLabField; count?: number }
  | { kind: 'exam'; exam: EmrExamKind; field: EmrExamField }

/** 同一行的檢驗: all from one collection day, or each its own latest. */
export type EmrLabRule = 'sameDay' | 'eachLatest'
export type EmrDateStyle = 'md' | 'ymd' | 'roc'
/** A line whose every lab has no result at all: leave it out of the paste
 *  (reported under the preview) or print it with the missing text. */
export type EmrEmptyLines = 'omit' | 'show'

export interface EmrCustomFormat {
  id: string
  name: string
  tokens: EmrFormatToken[]
  labRule: EmrLabRule
  /** Printed where a lab has no result for the line's day. User-chosen. */
  missingText: string
  dateStyle: EmrDateStyle
  emptyLines: EmrEmptyLines
}

// ── 用藥複製格式 ───────────────────────────────────────────────────────────
// The 「複製現在用藥」 formats. Deliberately their own list, apart from the
// lab/exam 我的格式 above: the two are customised separately for now
// (decided 2026-10-03), so neither editor has to understand the other's model.

export type MedCopyFieldId =
  | 'name' | 'dose' | 'prevDose' | 'frequency' | 'route' | 'institution'
  | 'date' | 'days' | 'remaining' | 'category'

/** Canonical order — also where a field missing from a stored format goes. */
export const MED_COPY_FIELD_IDS: MedCopyFieldId[] = [
  'name', 'dose', 'frequency', 'route', 'prevDose', 'institution',
  'date', 'days', 'remaining', 'category',
]

/** Each field's writing styles; the first is its default. */
export const MED_COPY_FIELD_STYLES: Record<MedCopyFieldId, readonly string[]> = {
  name: ['ingredient', 'product', 'both'],
  dose: ['spaced', 'compact'],
  prevDose: ['paren', 'arrow'],
  // split: cloud codes glued together pulled apart (QDACPO → QD AC PO).
  frequency: ['split', 'source', 'zh'],
  route: ['source'],
  institution: ['full'],
  date: ['md', 'ymd', 'roc'],
  days: ['zh', 'd'],
  // endedOnly: nothing while supply lasts, 「（已用完 N 天）」 once it ran out.
  remaining: ['endedOnly', 'left', 'until'],
  category: ['bracket', 'paren'],
}

export interface MedCopyField {
  id: MedCopyFieldId
  on: boolean
  style: string
}

export type MedCopyNumbering = 'dot' | 'paren' | 'dash' | 'none'
export type MedCopySeparator = 'space' | 'dot' | 'comma' | 'bar'
/** `Current medication` / `Med:` / no title line. English by decision. */
export type MedCopyTitle = 'full' | 'short' | 'none'
// No 慢箋 field or grouping: 雲端病歷 records no 慢箋 at all, so a 慢箋 mark
// (or a 一般處方 group) would read as a fact the source never stated.
export type MedCopyGroup = 'none' | 'institution' | 'date' | 'category'
export type MedCopyGroupHeader = 'bracket' | 'colon' | 'hash'
/** Short courses that already ran out: leave them out, or list them last. */
export type MedCopyEndedAcute = 'omit' | 'list'

export interface MedCopyFormat {
  id: string
  name: string
  numbering: MedCopyNumbering
  /** Array order is the order the fields print in. */
  fields: MedCopyField[]
  separator: MedCopySeparator
  title: MedCopyTitle
  /** Date and item count after the title. */
  titleMeta: boolean
  group: MedCopyGroup
  groupHeader: MedCopyGroupHeader
  /** A value every row of a group shares (institution, date, days)
   *  moves up to the group's header line instead of repeating. */
  hoistShared: boolean
  endedAcute: MedCopyEndedAcute
}

export const MED_COPY_BUILTIN_IDS = ['builtin:compact', 'builtin:standard', 'builtin:full'] as const
export type MedCopyBuiltinId = typeof MED_COPY_BUILTIN_IDS[number]

export interface OutpatientPrefs {
  /** Pinned analyte ids (`chem:CREA`) and reminder rows (`note:…`), in the
   *  clinician's order. `null` = never customised. */
  pinnedLabs: string[] | null
  /** Last overview lab mode chosen, so 「自訂」 is what the next patient
   *  opens with. */
  labMode: OverviewLabMode | null
  formats: EmrCustomFormat[]
  activeFormatId: string | null
  handoffMode: EmrHandoffMode | null
  /** The clinician's one 用藥 copy format; `null` = the default (緊湊)
   *  built-in. One format only, by decision (2026-10-05). */
  medFormat: MedCopyFormat | null
}

export const EMPTY_OUTPATIENT_PREFS: OutpatientPrefs = {
  pinnedLabs: null,
  labMode: null,
  formats: [],
  activeFormatId: null,
  handoffMode: null,
  medFormat: null,
}

const MAX_PINNED = 60
const MAX_FORMATS = 20
const MAX_TOKENS = 2000
const MAX_TEXT = 500

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function sanitizeToken(raw: unknown): EmrFormatToken | null {
  if (!raw || typeof raw !== 'object') return null
  const token = raw as Record<string, unknown>
  switch (token.kind) {
    case 'text':
      return isString(token.text) && token.text.length > 0
        ? { kind: 'text', text: token.text.slice(0, MAX_TEXT) }
        : null
    case 'newline':
      return { kind: 'newline' }
    case 'lab': {
      if (!isString(token.lab) || !token.lab.includes(':') || !EMR_LAB_FIELDS.includes(token.field as EmrLabField)) return null
      const field = token.field as EmrLabField
      const count = EMR_LAB_SERIES_FIELDS.includes(field) && (EMR_LAB_RECENT_COUNTS as readonly unknown[]).includes(token.count)
        ? token.count as number
        : undefined
      return { kind: 'lab', lab: token.lab, field, ...(count ? { count } : {}) }
    }
    case 'exam':
      return EMR_EXAM_KINDS.includes(token.exam as EmrExamKind) && EMR_EXAM_FIELDS.includes(token.field as EmrExamField)
        ? { kind: 'exam', exam: token.exam as EmrExamKind, field: token.field as EmrExamField }
        : null
    default:
      return null
  }
}

export function sanitizeEmrFormat(raw: unknown): EmrCustomFormat | null {
  if (!raw || typeof raw !== 'object') return null
  const format = raw as Record<string, unknown>
  if (!isString(format.id) || !format.id) return null
  const tokens = Array.isArray(format.tokens)
    ? format.tokens.slice(0, MAX_TOKENS).map(sanitizeToken).filter((t): t is EmrFormatToken => t !== null)
    : []
  return {
    id: format.id,
    name: isString(format.name) ? format.name.slice(0, 80) : '',
    tokens,
    labRule: format.labRule === 'eachLatest' ? 'eachLatest' : 'sameDay',
    missingText: isString(format.missingText) ? format.missingText.slice(0, 40) : '—',
    dateStyle: format.dateStyle === 'ymd' || format.dateStyle === 'roc' ? format.dateStyle : 'md',
    emptyLines: format.emptyLines === 'show' ? 'show' : 'omit',
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

export function sanitizeMedCopyFormat(raw: unknown): MedCopyFormat | null {
  if (!raw || typeof raw !== 'object') return null
  const format = raw as Record<string, unknown>
  if (!isString(format.id) || !format.id || format.id.startsWith('builtin:')) return null
  // Known fields once each, in the stored order; any field the stored copy
  // lacks (an older build, a newly added field) joins at the end, switched off.
  const seen = new Set<MedCopyFieldId>()
  const fields: MedCopyField[] = []
  for (const entry of Array.isArray(format.fields) ? format.fields : []) {
    if (!entry || typeof entry !== 'object') continue
    const field = entry as Record<string, unknown>
    const id = field.id as MedCopyFieldId
    if (!MED_COPY_FIELD_IDS.includes(id) || seen.has(id)) continue
    seen.add(id)
    const styles = MED_COPY_FIELD_STYLES[id]
    fields.push({
      id,
      // The drug name is the one field a line cannot do without.
      on: id === 'name' ? true : field.on === true,
      style: pick(field.style, styles, styles[0]),
    })
  }
  for (const id of MED_COPY_FIELD_IDS) {
    if (!seen.has(id)) fields.push({ id, on: id === 'name', style: MED_COPY_FIELD_STYLES[id][0] })
  }
  return {
    id: format.id,
    name: isString(format.name) ? format.name.slice(0, 80) : '',
    numbering: pick(format.numbering, ['dot', 'paren', 'dash', 'none'] as const, 'dot'),
    fields,
    separator: pick(format.separator, ['space', 'dot', 'comma', 'bar'] as const, 'space'),
    title: pick(format.title, ['full', 'short', 'none'] as const, 'full'),
    titleMeta: format.titleMeta !== false,
    group: pick(format.group, ['none', 'institution', 'date', 'category'] as const, 'none'),
    groupHeader: pick(format.groupHeader, ['bracket', 'colon', 'hash'] as const, 'bracket'),
    hoistShared: format.hoistShared !== false,
    endedAcute: format.endedAcute === 'list' ? 'list' : 'omit',
  }
}

/** Anything unrecognised — older build, hand-edited storage — falls back to
 *  the default rather than dead-ending the overview or the copy panel. */
export function sanitizeOutpatientPrefs(raw: unknown): OutpatientPrefs {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_OUTPATIENT_PREFS }
  const prefs = raw as Record<string, unknown>
  const pinnedLabs = Array.isArray(prefs.pinnedLabs)
    ? [...new Set(prefs.pinnedLabs.filter((id): id is string => isString(id) && id.includes(':')))].slice(0, MAX_PINNED)
    : null
  const formats = Array.isArray(prefs.formats)
    ? prefs.formats.map(sanitizeEmrFormat).filter((f): f is EmrCustomFormat => f !== null).slice(0, MAX_FORMATS)
    : []
  const activeFormatId = isString(prefs.activeFormatId) && formats.some((f) => f.id === prefs.activeFormatId)
    ? prefs.activeFormatId
    : formats[0]?.id ?? null
  const medFormat = sanitizeMedCopyFormat(prefs.medFormat)
  return {
    pinnedLabs,
    labMode: LAB_MODES.includes(prefs.labMode as OverviewLabMode) ? prefs.labMode as OverviewLabMode : null,
    formats,
    activeFormatId,
    handoffMode: prefs.handoffMode === 'custom' || prefs.handoffMode === 'builtin' ? prefs.handoffMode : null,
    medFormat,
  }
}

/** Where this browser's copy of an account's settings stands against the
 *  account. Kept per key; only account keys are ever synced. */
export interface OutpatientPrefsSyncMeta {
  /** When these settings last changed here — or, after the account copy was
   *  applied, that copy's own stamp. */
  updatedAt: number
  /** Changed here and not yet confirmed saved to the account. Survives a
   *  reload, so an edit made offline or just before closing still goes up. */
  dirty: boolean
  /** Stamp of the account copy these settings were last based on; null until
   *  this browser has synced this account once. */
  baseUpdatedAt: number | null
  /** That account copy itself — what both this browser and any other device
   *  started from, so a merge can tell which side changed what. */
  base: OutpatientPrefs | null
}

/** 'error' = the account refused the write or could not be read; the
 *  settings stay in this browser and go up with the next change or read. */
export type OutpatientPrefsSyncStatus = 'synced' | 'error'

interface OutpatientPrefsStore {
  byUser: Record<string, OutpatientPrefs>
  syncMeta: Record<string, OutpatientPrefsSyncMeta>
  /** Not persisted: this session's connection only. */
  syncStatus: Record<string, OutpatientPrefsSyncStatus>
  update: (key: string, patch: Partial<OutpatientPrefs>) => void
  /** Sync only: put settings in place with the given meta, without marking
   *  them as a change made here. */
  replace: (key: string, prefs: OutpatientPrefs, meta: OutpatientPrefsSyncMeta) => void
  setSyncMeta: (key: string, meta: OutpatientPrefsSyncMeta) => void
  setSyncStatus: (key: string, status: OutpatientPrefsSyncStatus) => void
}

function sanitizeSyncMeta(raw: unknown): OutpatientPrefsSyncMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const meta = raw as Record<string, unknown>
  if (typeof meta.updatedAt !== 'number' || !Number.isFinite(meta.updatedAt)) return null
  // A stamp without the copy it names cannot anchor a merge: treat this
  // browser as never synced rather than guess what the account held.
  const synced = typeof meta.baseUpdatedAt === 'number' && Number.isFinite(meta.baseUpdatedAt)
    && !!meta.base && typeof meta.base === 'object'
  return {
    updatedAt: meta.updatedAt,
    dirty: meta.dirty === true,
    baseUpdatedAt: synced ? meta.baseUpdatedAt as number : null,
    base: synced ? sanitizeOutpatientPrefs(meta.base) : null,
  }
}

export const useOutpatientPrefsStore = create<OutpatientPrefsStore>()(
  persist(
    (set) => ({
      byUser: {},
      syncMeta: {},
      syncStatus: {},
      update: (key, patch) => set((state) => {
        const previous = state.syncMeta[key]
        // Strictly after the previous stamp, so two edits in one millisecond
        // (or a clock set back) still read as the newer change.
        const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
        return {
          byUser: {
            ...state.byUser,
            [key]: sanitizeOutpatientPrefs({ ...(state.byUser[key] ?? EMPTY_OUTPATIENT_PREFS), ...patch }),
          },
          syncMeta: {
            ...state.syncMeta,
            [key]: {
              updatedAt,
              dirty: true,
              baseUpdatedAt: previous?.baseUpdatedAt ?? null,
              base: previous?.base ?? null,
            },
          },
        }
      }),
      replace: (key, prefs, meta) => set((state) => ({
        byUser: { ...state.byUser, [key]: sanitizeOutpatientPrefs(prefs) },
        syncMeta: { ...state.syncMeta, [key]: meta },
      })),
      setSyncMeta: (key, meta) => set((state) => ({ syncMeta: { ...state.syncMeta, [key]: meta } })),
      setSyncStatus: (key, status) => set((state) => (
        state.syncStatus[key] === status ? state : { syncStatus: { ...state.syncStatus, [key]: status } }
      )),
    }),
    {
      name: 'mediprisma-outpatient-prefs',
      version: 1,
      partialize: (state) => ({ byUser: state.byUser, syncMeta: state.syncMeta }),
      merge: (persisted, current) => {
        const stored = persisted as { byUser?: unknown; syncMeta?: unknown } | undefined
        const byUser: Record<string, OutpatientPrefs> = {}
        if (stored?.byUser && typeof stored.byUser === 'object') {
          for (const [key, value] of Object.entries(stored.byUser as Record<string, unknown>)) {
            byUser[key] = sanitizeOutpatientPrefs(value)
          }
        }
        const syncMeta: Record<string, OutpatientPrefsSyncMeta> = {}
        if (stored?.syncMeta && typeof stored.syncMeta === 'object') {
          for (const [key, value] of Object.entries(stored.syncMeta as Record<string, unknown>)) {
            const meta = sanitizeSyncMeta(value)
            if (meta && byUser[key]) syncMeta[key] = meta
          }
        }
        return { ...current, byUser, syncMeta }
      },
    },
  ),
)
