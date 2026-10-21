// 門診偏好 ↔ the signed-in account. One subscription per signed-in session,
// owned by AuthProvider (the same shape as the Beta switch's sync).
//
// The account copy lives on the user document, users/{uid}.outpatientPrefs —
// settings only (analyte ids, template text, choices), never a patient value.
// This browser keeps its own copy per account, so the overview and the copy
// panel read locally and keep working offline; an edit is marked dirty until
// the account has it, and a dirty edit survives a reload.
//
// Conflicts: two devices can both change the settings before either sees the
// other. Each browser remembers the account copy it last synced — the copy
// both sides started from — and a merge compares each side with it, one
// format and one choice at a time: whatever only one side changed takes that
// side, and only a format or choice BOTH changed goes to the newer side. A
// deletion never beats an edit: a format deleted on one device while the
// other edited it comes back rather than being lost.

import { doc, onSnapshot, runTransaction, type DocumentData } from 'firebase/firestore'
import { db } from '@/src/shared/config/firebase.config'
import {
  EMPTY_OUTPATIENT_PREFS,
  sanitizeOutpatientPrefs,
  useOutpatientPrefsStore,
  type OutpatientPrefs,
} from '@/src/application/stores/outpatient-prefs.store'

export const OUTPATIENT_PREFS_FIELD = 'outpatientPrefs'
const WRITE_DELAY_MS = 600
/** Far under Firestore's 1 MiB document limit — the user document also
 *  carries the profile and the Beta switch. */
export const MAX_SYNCED_CHARS = 200_000

export interface RemoteOutpatientPrefs {
  prefs: OutpatientPrefs
  updatedAt: number
}

export function readRemoteOutpatientPrefs(data: DocumentData | undefined): RemoteOutpatientPrefs | null {
  const raw = data?.[OUTPATIENT_PREFS_FIELD]
  if (!raw || typeof raw !== 'object' || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null
  return { prefs: sanitizeOutpatientPrefs(raw), updatedAt: raw.updatedAt }
}

/** The document field: the settings, their stamp, and nothing else. JSON
 *  round-trip drops any undefined, which Firestore refuses. */
export function toRemoteOutpatientPrefs(prefs: OutpatientPrefs, updatedAt: number): DocumentData {
  const {
    pinnedLabs, labMode, formats, activeFormatId, handoffMode, medFormat,
  } = sanitizeOutpatientPrefs(prefs)
  return JSON.parse(JSON.stringify({
    pinnedLabs, labMode, formats, activeFormatId, handoffMode, medFormat, updatedAt,
  }))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Three-way merge of two copies that both started from `base`. Each format
 * (by id) and each single choice is decided on its own: the side that changed
 * it wins; when both changed the same one, the newer side (`mineIsNewer`)
 * wins — except that a deletion never beats an edit. Formats keep `mine`'s
 * order, then any only `theirs` has.
 */
export function mergeOutpatientPrefs(
  base: OutpatientPrefs,
  mine: OutpatientPrefs,
  theirs: OutpatientPrefs,
  mineIsNewer: boolean,
): OutpatientPrefs {
  const choice = <K extends 'pinnedLabs' | 'labMode' | 'activeFormatId' | 'handoffMode' | 'medFormat'>(key: K): OutpatientPrefs[K] => {
    const mineChanged = !same(mine[key], base[key])
    const theirsChanged = !same(theirs[key], base[key])
    if (mineChanged && theirsChanged) return mineIsNewer ? mine[key] : theirs[key]
    return mineChanged ? mine[key] : theirs[key]
  }
  return sanitizeOutpatientPrefs({
    pinnedLabs: choice('pinnedLabs'),
    labMode: choice('labMode'),
    formats: mergeFormatLists(base.formats, mine.formats, theirs.formats, mineIsNewer),
    activeFormatId: choice('activeFormatId'),
    handoffMode: choice('handoffMode'),
    // The one 用藥 format is a single choice: whichever side changed it.
    medFormat: choice('medFormat'),
  })
}

/** One list of formats, merged format by format (see mergeOutpatientPrefs). */
function mergeFormatLists<T extends { id: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  mineIsNewer: boolean,
): T[] {
  const byId = (formats: T[]) => new Map(formats.map((format) => [format.id, format]))
  const baseFormats = byId(base)
  const mineFormats = byId(mine)
  const theirFormats = byId(theirs)
  const keep = (id: string): T | undefined => {
    const was = baseFormats.get(id)
    const ours = mineFormats.get(id)
    const their = theirFormats.get(id)
    if (same(ours, was)) return their
    if (same(their, was)) return ours
    // Both sides touched it. Deleted on one side, edited on the other: keep
    // the edit. Edited on both: the newer side.
    if (!ours) return their
    if (!their) return ours
    return mineIsNewer ? ours : their
  }
  const ids = [
    ...mine.map((format) => format.id),
    ...theirs.map((format) => format.id).filter((id) => !mineFormats.has(id)),
  ]
  return ids.map(keep).filter((format): format is T => !!format)
}

function samePrefs(a: OutpatientPrefs, b: OutpatientPrefs): boolean {
  return JSON.stringify(sanitizeOutpatientPrefs(a)) === JSON.stringify(sanitizeOutpatientPrefs(b))
}

export function syncOutpatientPrefsForAccount(userId: string): () => void {
  const database = db
  if (!database) return () => {}
  const store = useOutpatientPrefsStore
  const userRef = doc(database, 'users', userId)
  let active = true
  let inFlight = false
  let again = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The newest account read not yet acted on. A read that lands while a
   *  save of ours is scheduled or on its way waits here until that save
   *  settles — it is never dropped (the save may not happen at all, or may
   *  have gone up before this other device's change). */
  let pendingRemote: { data: DocumentData | undefined } | null = null

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void push()
    }, WRITE_DELAY_MS)
  }

  // Send this browser's copy. Read-then-write in one transaction, so a copy
  // another device saved since this one last synced is merged, not replaced.
  const push = async () => {
    if (!active) return
    if (inFlight) { again = true; return }
    const local = store.getState().byUser[userId]
    const meta = store.getState().syncMeta[userId]
    // Nothing new to send (a queued retry after the edit already went up):
    // this was the last thing an account read could be waiting on.
    if (!local || (meta && !meta.dirty && meta.baseUpdatedAt !== null)) {
      reconcile()
      return
    }
    inFlight = true
    try {
      const result = await runTransaction(database, async (transaction) => {
        const current = readRemoteOutpatientPrefs((await transaction.get(userRef)).data())
        const changedElsewhere = current !== null && current.updatedAt !== (meta?.baseUpdatedAt ?? null)
        const mineIsNewer = !current || (meta?.updatedAt ?? 0) >= current.updatedAt
        const next = changedElsewhere
          ? mergeOutpatientPrefs(meta?.base ?? EMPTY_OUTPATIENT_PREFS, local, current.prefs, mineIsNewer)
          : local
        const stamp = Math.max(meta?.updatedAt ?? Date.now(), (current?.updatedAt ?? 0) + 1)
        const field = toRemoteOutpatientPrefs(next, stamp)
        if (JSON.stringify(field).length > MAX_SYNCED_CHARS) throw new Error('outpatient settings too large to sync')
        transaction.set(userRef, { [OUTPATIENT_PREFS_FIELD]: field }, { mergeFields: [OUTPATIENT_PREFS_FIELD] })
        return { next, stamp }
      })
      const state = store.getState()
      const now = state.byUser[userId]
      const nowMeta = state.syncMeta[userId]
      // The account now holds result.next: that is the new common copy.
      const synced = { baseUpdatedAt: result.stamp, base: result.next }
      if (nowMeta?.updatedAt === meta?.updatedAt || !now) {
        state.replace(userId, result.next, { ...synced, updatedAt: result.stamp, dirty: false })
      } else {
        // Edited again while this was on its way: replay just those edits —
        // what changed since the copy that was sent, deletions included —
        // onto what the account now holds, and send again.
        state.replace(userId, mergeOutpatientPrefs(local, now, result.next, true), {
          ...synced,
          updatedAt: Math.max(nowMeta?.updatedAt ?? 0, result.stamp + 1),
          dirty: true,
        })
        again = true
      }
      if (active) state.setSyncStatus(userId, 'synced')
    } catch (error) {
      // Offline, refused, or too large: the settings stay here, still dirty,
      // and go up with the next change or the next read of the account.
      console.warn('[Outpatient prefs sync] Could not save to the account:', error)
      if (active) store.getState().setSyncStatus(userId, 'error')
    } finally {
      inFlight = false
      if (again && active) {
        again = false
        void push()
      } else {
        reconcile()
      }
    }
  }

  const unsubscribeStore = store.subscribe((state, previous) => {
    const meta = state.syncMeta[userId]
    if (!meta?.dirty || meta.updatedAt === previous.syncMeta[userId]?.updatedAt) return
    schedule()
  })

  // Act on the newest account read, once no save of ours is scheduled or on
  // its way (each of those calls back here when it settles).
  function reconcile() {
    if (!active || inFlight || timer || !pendingRemote) return
    const { data } = pendingRemote
    pendingRemote = null
    const state = store.getState()
    const remote = readRemoteOutpatientPrefs(data)
    const local = state.byUser[userId]
    const meta = state.syncMeta[userId]
    // A read that works clears an old read error; a failed save stays shown
    // until a save succeeds.
    if (!meta?.dirty) state.setSyncStatus(userId, 'synced')

    if (!remote) {
      // Nothing in the account yet: this browser's copy of THIS account
      // becomes it. Another account's, the anonymous or the guest settings
      // are never carried into an account.
      if (local && (!meta || meta.dirty || meta.baseUpdatedAt === null)) void push()
      return
    }
    const accountCopy = { updatedAt: remote.updatedAt, dirty: false, baseUpdatedAt: remote.updatedAt, base: remote.prefs }
    if (!local) {
      state.replace(userId, remote.prefs, accountCopy)
      return
    }
    if (!meta || meta.baseUpdatedAt === null || !meta.base) {
      // First sync of this account in this browser. With no copy in common,
      // everything set on either side counts as a change: a format only one
      // side has is kept, and a choice both made goes to the newer side — an
      // edit made here since signing in over an older account copy; settings
      // an older build saved here (no stamp) under the account's.
      const localIsNewer = !!meta?.dirty && meta.updatedAt > remote.updatedAt
      // The account's formats first, then the ones only this browser has.
      const merged = mergeOutpatientPrefs(EMPTY_OUTPATIENT_PREFS, remote.prefs, local, !localIsNewer)
      if (samePrefs(merged, remote.prefs)) {
        state.replace(userId, remote.prefs, accountCopy)
      } else {
        state.replace(userId, merged, {
          ...accountCopy,
          updatedAt: Math.max(meta?.updatedAt ?? 0, remote.updatedAt + 1),
          dirty: true,
        })
        // The stamp may not move (an edit here already carried it), so the
        // store subscription cannot be relied on to send this.
        schedule()
      }
      return
    }
    if (meta.dirty) {
      void push()
      return
    }
    // Every save stamps the account higher than the copy it read, so a read
    // at or below this browser's base is one it already holds (a read that
    // waited out a save that since went up on top of it).
    if (remote.updatedAt > meta.baseUpdatedAt) {
      state.replace(userId, remote.prefs, accountCopy)
    }
  }

  const unsubscribeRemote = onSnapshot(userRef, { includeMetadataChanges: true }, (snapshot) => {
    if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
    pendingRemote = { data: snapshot.data() }
    reconcile()
  }, (error) => {
    console.warn('[Outpatient prefs sync] Could not read the account:', error)
    if (active) store.getState().setSyncStatus(userId, 'error')
  })

  return () => {
    active = false
    if (timer) clearTimeout(timer)
    timer = null
    pendingRemote = null
    unsubscribeStore()
    unsubscribeRemote()
  }
}
