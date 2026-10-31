// Small encrypted, session-scoped cache for AI-derived results (safety scans,
// insights, …) so they survive a page reload without re-billing the model.
//
// Privacy: these payloads are derived from patient data, so they get the SAME
// envelope as the imported bundle — encrypted with the tab-session key
// (bundle-crypto) and bounded to MAX_AGE_MS. A new tab/session can't decrypt
// (key is gone) → the stale blob is purged on read. The only difference from the
// bundle is the storage medium: localStorage (these payloads are small text),
// which can't hold the binary EncryptedRecord directly, so iv/data are base64'd.

import {
  getSessionBundleKey,
  encryptJson,
  decryptBytes,
  type EncryptedRecord,
} from '@/src/infrastructure/fhir/services/bundle-crypto'
import {
  localImportScopeSegment,
  readTabLocalImportId,
} from '@/src/infrastructure/fhir/services/local-bundle-scope'

/** localStorage-serialisable form of an EncryptedRecord (binary → base64). */
interface StoredRecord {
  v: 1
  iv: string
  data: string
  savedAt: number
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Encrypt + persist a value under `key`. Best-effort: silently no-ops when the
 *  session key / storage is unavailable (caller keeps its in-memory copy).
 *
 *  `shouldCommit` is checked after the asynchronous encryption step. Callers
 *  use it to prevent an older result (or a result from a purged Bundle epoch)
 *  from winning a late localStorage write. */
/**
 * Encrypt and store `value`. Resolves `true` once it is written — or once a
 * newer write has taken its place — and `false` when it could not be kept.
 */
export async function saveEncryptedCache(
  key: string,
  value: unknown,
  shouldCommit: () => boolean = () => true,
): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const cryptoKey = await getSessionBundleKey({ create: true })
    if (!cryptoKey) return false
    const record = await encryptJson(cryptoKey, value)
    const stored: StoredRecord = {
      v: 1,
      iv: bytesToBase64(record.iv),
      data: bytesToBase64(new Uint8Array(record.data)),
      savedAt: record.savedAt,
    }
    if (!shouldCommit()) return true
    window.localStorage.setItem(key, JSON.stringify(stored))
    return true
  } catch {
    // Best-effort cache — never throw into the caller.
    return false
  }
}

/** Load + decrypt a cached value, or null if missing / expired / undecryptable.
 *  Purges the entry in every not-usable case so it doesn't linger. */
export async function loadEncryptedCache<T>(key: string, maxAgeMs: number): Promise<T | null> {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredRecord
    if (!stored || stored.v !== 1 || typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > maxAgeMs) {
      window.localStorage.removeItem(key)
      return null
    }
    // No `create`: a new session that can't decrypt should purge, not re-key.
    const cryptoKey = await getSessionBundleKey()
    if (!cryptoKey) {
      window.localStorage.removeItem(key)
      return null
    }
    const record: EncryptedRecord = {
      v: 1,
      iv: base64ToBytes(stored.iv),
      // Uint8Array.from() always allocates a plain ArrayBuffer (never shared).
      data: base64ToBytes(stored.data).buffer as ArrayBuffer,
      savedAt: stored.savedAt,
    }
    const plain = await decryptBytes(cryptoKey, record)
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    return null
  }
}

export function removeEncryptedCache(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

// Shared namespace for AI-derived result caches (safety scans, insights, …) so
// they can all be purged together when the user clears their data.
const AI_RESULT_PREFIX = 'mediprisma:ai-result:'
const MAX_AI_RESULT_CACHE_AGE_MS = 12 * 60 * 60 * 1000

function aiResultNamespace(importId: string | null): string {
  return `${AI_RESULT_PREFIX}${localImportScopeSegment(importId)}:`
}

/** Cache key for an AI result, e.g. aiResultCacheKey('insights', patientId). */
export function aiResultCacheKey(
  scope: string,
  id: string,
  importId = readTabLocalImportId(),
): string {
  return `${aiResultNamespace(importId)}${scope}:${id}`
}

/** Drop only this tab/import's AI result caches. Another MediPrisma tab may be
 * displaying a different patient and must keep its independently-owned work. */
export function purgeAiResultCaches(importId = readTabLocalImportId()): void {
  if (typeof window === 'undefined') return
  try {
    const namespace = aiResultNamespace(importId)
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(namespace)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // ignore
  }
}

/** Sweep expired result ciphertext across every import namespace without
 * touching another tab's still-live (<12h) results. StoredRecord.savedAt is
 * non-PHI metadata and can be checked without that tab's encryption key. */
export function purgeExpiredAiResultCaches(now = Date.now()): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(AI_RESULT_PREFIX)) keys.push(key)
    }
    for (const key of keys) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(key) ?? '') as Partial<StoredRecord>
        if (
          typeof stored.savedAt !== 'number'
          || now - stored.savedAt > MAX_AI_RESULT_CACHE_AGE_MS
        ) {
          window.localStorage.removeItem(key)
        }
      } catch {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Best-effort cache hygiene.
  }
}

/** Stable short signature of a string — used to invalidate a cached result when
 *  the prompt/template that produced it changes (djb2, base36). */
export function contentSignature(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}
