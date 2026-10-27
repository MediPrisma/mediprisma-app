/**
 * Where this feature's per-patient answers are kept, and on what terms.
 *
 * Everything the clinician answers in the room — the measurements, the NYHA
 * grade, the phenotype, the decisions, the echo values typed off a report — is
 * patient data. It used to be written to `localStorage` as plain JSON, which
 * meant the next person at a shared clinic workstation could read the previous
 * patient's answers out of the browser. That is the finding CodeQL raised as
 * `js/clear-text-storage-of-sensitive-data`, and this module is the answer to
 * it: every value goes through the same envelope the imported bundle and the AI
 * result caches already use — AES-GCM under the tab-session key from
 * `bundle-crypto`, ciphertext in `localStorage`.
 *
 * Two consequences, both accepted:
 *
 * - **The answers live for the tab session.** They survive a reload, because
 *   the key lives in `sessionStorage`; a new tab or a new session cannot
 *   decrypt them, and `loadEncryptedCache` purges what it cannot read.
 * - **Carrying an answer across visits is phase 2.** That needs a server-side
 *   store with its own path, expiry and Rules (see
 *   `docs/HF-DP01_phenotype-answer-persistence-proposal.md`), not a longer-lived
 *   browser key.
 *
 * Decryption is asynchronous, so every hydration is too. What is *not*
 * asynchronous is a save: callers update their in-memory state first and hand
 * the value here, which encrypts and writes in the background. A write that
 * cannot be made leaves the in-memory answer untouched — storage is a cache,
 * never the source of clinical truth.
 */
import {
  loadEncryptedCache,
  removeEncryptedCache,
  saveEncryptedCache,
} from '@/src/infrastructure/cache/encrypted-session-cache'

/**
 * Seven days, which the tab-session key makes academic: a session that can
 * still decrypt is a session that has been open all along. It is a ceiling
 * against a clock that moved, not the expiry the design relies on.
 */
export const ANSWER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether anything at all is stored under `key`.
 *
 * A synchronous peek at the envelope, never at the payload — the ciphertext is
 * not read and nothing is decrypted. It exists so a first visit, which is the
 * common case, can hydrate in the same tick instead of putting 「讀取中」 on
 * screen while a decryption that has nothing to decrypt resolves.
 */
export function hasEncryptedAnswers(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

/** Decrypt what is stored under `key`, or null when there is nothing usable. */
export function loadEncryptedAnswers<T>(key: string): Promise<T | null> {
  return loadEncryptedCache<T>(key, ANSWER_CACHE_MAX_AGE_MS)
}

/**
 * The last write per key, so a save whose encryption finishes late cannot
 * overwrite a newer save — or resurrect what a clear has just removed.
 */
const writeTokens = new Map<string, number>()

/** The newest write per key, which an overtaken write reports instead of its own. */
const latestWrites = new Map<string, Promise<boolean>>()

function nextWriteToken(key: string): number {
  const token = (writeTokens.get(key) ?? 0) + 1
  writeTokens.set(key, token)
  return token
}

/**
 * Encrypt and write in the background. Returns immediately: the caller's
 * in-memory state is already the answer, and a failed write never reaches it.
 * The promise says whether it was kept, for a caller that tells the clinician.
 */
export function persistEncryptedAnswers(key: string, value: unknown): Promise<boolean> {
  const token = nextWriteToken(key)
  let superseded = false
  const written = saveEncryptedCache(key, value, () => {
    superseded = writeTokens.get(key) !== token
    return !superseded
  }).then(kept => (
    // A newer write carries this one's answers too, so whether they were kept
    // is that write's result — not this one's, which never reached storage.
    superseded ? (latestWrites.get(key) ?? kept) : kept
  ))
  latestWrites.set(key, written)
  return written
}

/** Remove one patient's stored answers, and cancel any write still in flight. */
export function discardEncryptedAnswers(key: string): void {
  nextWriteToken(key)
  // A write overtaken by a clear was meant to go: it counts as settled.
  latestWrites.set(key, Promise.resolve(true))
  removeEncryptedCache(key)
}

/**
 * The chart a store is currently reading, so a decryption that resolves late
 * cannot land on the wrong one.
 *
 * Each store keeps one of these. `begin` claims the slot for a patient and
 * hands back the check to run when the read settles: it answers `false` — and
 * the result is dropped — once the clinician has moved to another chart, which
 * is the one case where a stored answer must never be applied. Dropping it also
 * leaves that patient unhydrated, so returning to the chart reads it again.
 */
export interface HydrationGuard {
  /** Whether a read for this patient is already in flight. */
  isPending: (patientId: string) => boolean
  /** Claim the slot; call the returned check before applying the result. */
  begin: (patientId: string) => () => boolean
  /** Drop whatever is in flight — the store it feeds no longer wants it. */
  invalidate: () => void
}

export function createHydrationGuard(): HydrationGuard {
  let current: string | null = null
  let epoch = 0
  return {
    isPending: (patientId) => current === patientId,
    begin: (patientId) => {
      current = patientId
      const claimed = epoch
      return () => {
        if (current !== patientId || epoch !== claimed) return false
        current = null
        return true
      }
    },
    invalidate: () => {
      current = null
      epoch += 1
    },
  }
}
