import { webcrypto } from 'crypto'
import {
  getSessionBundleKey,
  prepareSessionBundleKey,
  clearSessionBundleKey,
  isEncryptedRecord,
  encryptBytes,
  decryptBytes,
  encryptJson,
  decryptJson,
} from '@/src/infrastructure/fhir/services/bundle-crypto'

// jsdom ships getRandomValues but not crypto.subtle — swap in Node's WebCrypto
const jsdomCrypto = globalThis.crypto
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})
afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: jsdomCrypto, configurable: true })
})

describe('bundle-crypto', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('prepares a new encryption key without invalidating the active chart until commit', async () => {
    const oldKey = (await getSessionBundleKey({ create: true }))!
    const record = await encryptJson(oldKey, { chart: 'previous' })
    const candidate = await prepareSessionBundleKey()
    await expect(decryptJson((await getSessionBundleKey())!, record)).resolves.toEqual({ chart: 'previous' })
    candidate.commit()
    await expect(decryptJson((await getSessionBundleKey())!, record)).rejects.toBeDefined()
    candidate.rollback()
    await expect(decryptJson((await getSessionBundleKey())!, record)).resolves.toEqual({ chart: 'previous' })
  })

  it('does not publish a prepared key after the active chart key was cleared', async () => {
    await getSessionBundleKey({ create: true })
    const candidate = await prepareSessionBundleKey()
    clearSessionBundleKey()
    expect(() => candidate.commit()).toThrow('active bundle key changed')
    candidate.rollback()
    expect(await getSessionBundleKey()).toBeNull()
  })

  describe('getSessionBundleKey', () => {
    it('returns null when no key exists and create is not requested', async () => {
      expect(await getSessionBundleKey()).toBeNull()
    })

    it('creates a key on demand and returns the same key afterwards', async () => {
      const created = await getSessionBundleKey({ create: true })
      expect(created).not.toBeNull()
      const reread = await getSessionBundleKey()
      expect(reread).not.toBeNull()
      // Same underlying key material: ciphertext from one decrypts with the other
      const record = await encryptJson(created!, { ok: true })
      await expect(decryptJson(reread!, record)).resolves.toEqual({ ok: true })
    })

    it('clearSessionBundleKey removes the key', async () => {
      await getSessionBundleKey({ create: true })
      clearSessionBundleKey()
      expect(await getSessionBundleKey()).toBeNull()
    })
  })

  describe('round-trips', () => {
    it('encrypts and decrypts JSON', async () => {
      const key = (await getSessionBundleKey({ create: true }))!
      const bundle = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] }
      const record = await encryptJson(key, bundle)
      expect(isEncryptedRecord(record)).toBe(true)
      expect(record.savedAt).toBeGreaterThan(0)
      await expect(decryptJson(key, record)).resolves.toEqual(bundle)
    })

    it('encrypts and decrypts binary data with a MIME type', async () => {
      const key = (await getSessionBundleKey({ create: true }))!
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      const record = await encryptBytes(key, bytes, 'image/png')
      expect(record.type).toBe('image/png')
      const plain = new Uint8Array(await decryptBytes(key, record))
      expect(Array.from(plain)).toEqual([1, 2, 3, 4, 5])
    })

    it('ciphertext does not contain the plaintext', async () => {
      const key = (await getSessionBundleKey({ create: true }))!
      const record = await encryptJson(key, { name: 'SENSITIVE-PATIENT-NAME' })
      const asText = new TextDecoder().decode(record.data)
      expect(asText).not.toContain('SENSITIVE-PATIENT-NAME')
    })

    it('a different session key cannot decrypt (stale-session purge path)', async () => {
      const key1 = (await getSessionBundleKey({ create: true }))!
      const record = await encryptJson(key1, { secret: 'data' })
      // New tab session: old key gone, a fresh one is minted
      clearSessionBundleKey()
      const key2 = (await getSessionBundleKey({ create: true }))!
      await expect(decryptJson(key2, record)).rejects.toBeDefined()
    })
  })

  describe('isEncryptedRecord', () => {
    it('rejects plaintext bundles and blobs', () => {
      expect(isEncryptedRecord({ resourceType: 'Bundle', entry: [] })).toBe(false)
      expect(isEncryptedRecord(null)).toBe(false)
      expect(isEncryptedRecord('string')).toBe(false)
      expect(isEncryptedRecord(new Blob(['x']))).toBe(false)
    })
  })
})
