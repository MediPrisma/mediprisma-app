// Session-scoped encryption for the locally imported FHIR bundle (audit B1).
//
// Threat model: shared hospital workstations. The imported bundle (patient
// demographics, full chart, medical images) used to sit in IndexedDB as
// plaintext with no expiry — the next person at the machine could open the app
// and read the previous patient's chart.
//
// Design: a random AES-GCM key lives in sessionStorage (tab-scoped — survives
// reloads, gone when the tab closes). Everything written to IndexedDB is
// ciphertext. A new session that finds ciphertext it cannot decrypt purges it.
// This deliberately trades "bundle survives browser restart" for "PHI never
// outlives the tab session"; re-importing a file from the Welcome screen is
// the supported way to come back.

const KEY_STORAGE = '__bundle_session_key__'
const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12

export interface EncryptedRecord {
  v: 1
  iv: Uint8Array
  data: ArrayBuffer
  savedAt: number
  /** MIME type, present only for image records */
  type?: string
}

// Tag-based checks instead of instanceof: IndexedDB structured clone and
// cross-realm crypto implementations can hand back typed arrays/buffers whose
// constructors differ from the current realm's globals.
function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value)
}

export function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return rec.v === 1 && tagOf(rec.iv) === '[object Uint8Array]' && tagOf(rec.data) === '[object ArrayBuffer]'
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/**
 * Get the tab-session bundle key. With `create`, a missing key is generated
 * and stored; without it, missing key → null (used on the read path so a new
 * session can detect stale ciphertext instead of minting a useless key).
 * Returns null when sessionStorage / WebCrypto are unavailable — callers must
 * then skip persistence entirely rather than fall back to plaintext.
 */
export async function getSessionBundleKey(opts?: { create?: boolean }): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return null

  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }

  if (!raw) {
    if (!opts?.create) return null
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    raw = toBase64(bytes)
    try {
      window.sessionStorage.setItem(KEY_STORAGE, raw)
    } catch {
      return null
    }
  }

  try {
    return await crypto.subtle.importKey('raw', fromBase64(raw) as BufferSource, ALGORITHM, false, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    return null
  }
}

/** Start a fresh encryption boundary for a newly imported Bundle. A browser
 * may clone sessionStorage when a page opens another tab; rotating here keeps
 * the new tab's patient payload and AI caches cryptographically independent
 * from the opener after its own import begins. */
export async function rotateSessionBundleKey(): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return null
  try {
    window.sessionStorage.removeItem(KEY_STORAGE)
  } catch {
    return null
  }
  return getSessionBundleKey({ create: true })
}

/** Storage failures permit memory-only use; identity/key changes do not. */
export class BundleSessionStorageError extends Error {}

/** Prepare a replacement key without making the active chart unreadable. */
export async function prepareSessionBundleKey(): Promise<{
  key: CryptoKey
  commit: () => void
  rollback: () => void
}> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) throw new Error('bundle encryption unavailable')
  let previous: string | null
  try { previous = window.sessionStorage.getItem(KEY_STORAGE) }
  catch { throw new BundleSessionStorageError('bundle session storage unavailable') }
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const encoded = toBase64(bytes)
  const key = await crypto.subtle.importKey('raw', bytes, ALGORITHM, false, ['encrypt', 'decrypt'])
  return {
    key,
    commit() {
      let current: string | null
      try { current = window.sessionStorage.getItem(KEY_STORAGE) }
      catch { throw new BundleSessionStorageError('bundle session storage unavailable') }
      if (current !== previous) throw new Error('active bundle key changed')
      try { window.sessionStorage.setItem(KEY_STORAGE, encoded) }
      catch { throw new BundleSessionStorageError('bundle session storage unavailable') }
    },
    rollback() {
      if (window.sessionStorage.getItem(KEY_STORAGE) !== encoded) return
      if (previous === null) window.sessionStorage.removeItem(KEY_STORAGE)
      else window.sessionStorage.setItem(KEY_STORAGE, previous)
    },
  }
}

export function clearSessionBundleKey(): void {
  try {
    window.sessionStorage.removeItem(KEY_STORAGE)
  } catch {
    // sessionStorage unavailable — nothing to clear
  }
}

export async function encryptBytes(
  key: CryptoKey,
  plain: BufferSource,
  type?: string
): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plain)
  const record: EncryptedRecord = { v: 1, iv, data, savedAt: Date.now() }
  if (type) record.type = type
  return record
}

/** Throws when the key doesn't match the record (stale session). */
export async function decryptBytes(key: CryptoKey, record: EncryptedRecord): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: ALGORITHM, iv: record.iv as BufferSource }, key, record.data)
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedRecord> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return encryptBytes(key, bytes as BufferSource)
}

export async function decryptJson<T = unknown>(key: CryptoKey, record: EncryptedRecord): Promise<T> {
  const plain = await decryptBytes(key, record)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}
