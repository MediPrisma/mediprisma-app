// LocalBundleService
// Stores a FHIR Bundle and parses it into domain entities.
// When a bundle is present, query hooks use it instead of the live FHIR server.
// Encounter grouping: resources without encounter reference are matched by same-day date.
//
// Storage layout (changed in v0.5.x for imaging support):
//   - The full bundle JSON lives in IndexedDB (large quota — bundles with
//     inlined base64 imaging can be 16MB+, well over localStorage's ~5MB cap
//     which throws QuotaExceededError on setItem).
//   - A tiny active-import pointer stays in tab-scoped sessionStorage so
//     `hasData()` remains synchronous without exposing one tab's patient to
//     another tab.
//   - The bundle is also cached in a module-level variable for the session so
//     repeated reads don't hit IndexedDB.
//   - IndexedDB records and image refs are keyed by import id. Bundles written
//     by older builds under the origin-wide `current` key are migrated on read.
//
// Encryption at rest (audit B1, v0.12): everything in IndexedDB — bundle JSON
// and image Blobs — is AES-GCM ciphertext under a tab-session key (see
// bundle-crypto.ts). New imports rotate the key even when sessionStorage was
// cloned from an opener. Records older than MAX_BUNDLE_AGE_MS are swept on
// load/import, so an imported chart never lingers on a shared workstation.
// Plaintext data written by older builds is re-encrypted on first read.

import {
  FhirMapper,
  groupSpecialMaterialsByProcedure,
  isMedicationRemainingSummaryBasic,
} from '../mappers/fhir.mapper'
import { PatientMapper } from '../mappers/patient.mapper'
import { expandClaimResources } from './claim-expander'
import { expandRocheResources } from './roche-expander'
import { reconcileOutpatientEncounters } from './outpatient-encounter-reconciliation'
import { reconcileMedicationRequests } from './medication-reconciliation'
import {
  isNhiDrugCodeSystem,
  NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
  NHI_DRUG_ENRICHMENT_POLICY_VERSION,
} from './nhi-drug-terminology-enrichment.service'
import { enrichBundleWithNhiDrugTerminologyOffMainThread } from './nhi-drug-terminology-enrichment.worker-client'
import { referenceId } from '@/src/core/utils/observation-selectors'
import {
  applyUserEnteredPatientProfile,
  parseUserEnteredPatientProfile,
  type PatientEntity,
  type UserEnteredPatientProfile,
} from '@/src/core/entities/patient.entity'
import type {
  ClinicalDataCollection,
  ClinicalSourceMetadata,
  MedicationEntity,
} from '@/src/core/entities/clinical-data.entity'
import {
  getSessionBundleKey,
  rotateSessionBundleKey,
  clearSessionBundleKey,
  isEncryptedRecord,
  encryptBytes,
  decryptBytes,
  encryptJson,
  decryptJson,
} from './bundle-crypto'
import {
  LOCAL_BUNDLE_DEMO_FLAG_KEY,
  LOCAL_BUNDLE_IMPORT_MARKER_PREFIX,
  LOCAL_BUNDLE_MARKER,
  LOCAL_BUNDLE_STORAGE_KEY,
  importIdFromLocalBundleMarker,
  localBundleMarker,
  readTabLocalImportId,
} from './local-bundle-scope'

// New builds keep the active pointer in tab-scoped sessionStorage. These local
// aliases keep the migration code readable while older origin-wide
// localStorage markers are retired on the first successful load/import.
const STORAGE_KEY = LOCAL_BUNDLE_STORAGE_KEY
const MARKER = LOCAL_BUNDLE_MARKER
const IMPORT_MARKER_PREFIX = LOCAL_BUNDLE_IMPORT_MARKER_PREFIX

// Set while the loaded bundle is the bundled demo patient (試用資料). Owned
// here so every bundle wipe (import-bundle clear, logout PHI wipe) removes it
// from one place.
export const DEMO_FLAG_KEY = LOCAL_BUNDLE_DEMO_FLAG_KEY

// IndexedDB coordinates for the bundle payload.
const DB_NAME = 'mediprisma'
const DB_VERSION = 2
const STORE = 'bundles'
const LEGACY_BUNDLE_KEY = 'current'
// Separate store for inline imaging. At import we move each base64 image out of
// the bundle into a Blob here (off-heap, disk-backed) and leave only a reference
// (`_imageRef`) behind. This keeps hundreds of MB of imaging off the JS heap —
// the bundle/entities stay small and the bytes are fetched on demand (when the
// user opens the viewer). See ReportImageDialog.
const IMG_STORE = 'images'

// Session cache: avoids re-reading IndexedDB on every query. Module-level so it
// is shared across all hook instances in the same tab.
let memBundle: object | null = null
let memBundleImportId: string | null = null
let memBundleIsDemo = false
let memBundleSourceMetadata: ClinicalSourceMetadata | null = null
let memUserEnteredPatientProfile: UserEnteredPatientProfile | null = null
// A stored bundle can be requested concurrently by the Patient and clinical
// data repositories during startup. Share one terminology migration per
// plaintext bundle object so the 12 MB snapshot is never parsed twice.
const terminologyMigrationByBundle = new WeakMap<object, Promise<object>>()
// Mapping a FHIR Bundle into every domain collection is also expensive and was
// previously repeated independently by the Patient and clinical-data queries.
// Cache only the post-storage parse (not the import validator): save() may move
// inline images out of the Bundle before this path runs, and we must never keep
// a second parsed copy containing those large base64 payloads alive.
const parsedStoredDataByBundle = new WeakMap<object, {
  sourceMetadata: ClinicalSourceMetadata | null
  data: LocalBundleData
}>()

interface PersistedBundleEnvelope {
  __mediprismaBundle: 1
  importId: string
  demo: boolean
  sourceMetadata?: ClinicalSourceMetadata
  patientProfile?: UserEnteredPatientProfile
  bundle: object
}

const importIdFromMarker = importIdFromLocalBundleMarker

function isPersistedBundleEnvelope(value: unknown): value is PersistedBundleEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PersistedBundleEnvelope>
  return candidate.__mediprismaBundle === 1
    && typeof candidate.importId === 'string'
    && candidate.importId.trim().length > 0
    && typeof candidate.demo === 'boolean'
    && !!candidate.bundle
    && typeof candidate.bundle === 'object'
}

// Even within a live tab session, a bundle older than this is purged on read —
// a workstation left logged-in overnight shouldn't still expose yesterday's
// patient.
const MAX_BUNDLE_AGE_MS = 12 * 60 * 60 * 1000

function readTabBundleMarker(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function readLegacyBundleMarker(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeTabBundleScope(importId: string | null, demo: boolean): void {
  sessionStorage.setItem(STORAGE_KEY, localBundleMarker(importId))
  if (demo) sessionStorage.setItem(DEMO_FLAG_KEY, importId ?? MARKER)
  else sessionStorage.removeItem(DEMO_FLAG_KEY)
  // Retire the origin-wide pointer used by older builds. The IndexedDB legacy
  // payload is migrated separately; new tabs must never discover another
  // tab's active patient through localStorage.
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(DEMO_FLAG_KEY)
}

function clearTabBundleScope(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(DEMO_FLAG_KEY)
  } catch {
    // sessionStorage unavailable — in-memory state is still cleared below.
  }
}

function bundleRecordKey(importId: string | null): string {
  return importId ?? LEGACY_BUNDLE_KEY
}

function migratedImportId(): string {
  try {
    return `local-${crypto.randomUUID()}`
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSweepExpiredRecords(now = Date.now()): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, IMG_STORE], 'readwrite')
      for (const storeName of [STORE, IMG_STORE]) {
        const req = tx.objectStore(storeName).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return
          if (
            isEncryptedRecord(cursor.value)
            && now - cursor.value.savedAt > MAX_BUNDLE_AGE_MS
          ) {
            cursor.delete()
          }
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Decode raw base64 → binary Blob. Tolerates a stray `data:<mime>;base64,`
 *  prefix even though the bridge omits it. The intermediate Uint8Array is
 *  per-image and short-lived; the resulting Blob is off-heap (disk-backed). */
function base64ToBlob(base64: string, contentType: string): Blob {
  const raw = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType || 'image/jpeg' })
}

async function idbPut(value: unknown, bundleKey = LEGACY_BUNDLE_KEY): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, bundleKey)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbGet<T = unknown>(bundleKey = LEGACY_BUNDLE_KEY): Promise<T | null> {
  const db = await openDb()
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(bundleKey)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbDelete(bundleKey = LEGACY_BUNDLE_KEY): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(bundleKey)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// --- Image Blob store ---------------------------------------------------------

async function idbDeleteImages(imageIds: string[]): Promise<void> {
  if (imageIds.length === 0) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readwrite')
      const store = tx.objectStore(IMG_STORE)
      for (const imageId of imageIds) store.delete(imageId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Delete only image records owned by one import. Cursor deletion avoids
 * clearing another MediPrisma tab's concurrently-open patient. */
async function idbDeleteImagesForImport(importId: string): Promise<void> {
  const prefix = `${importId}:`
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readwrite')
      const req = tx.objectStore(IMG_STORE).openKeyCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          tx.objectStore(IMG_STORE).delete(cursor.key)
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function legacyImageRefsInBundle(bundle: object | null): string[] {
  const refs = new Set<string>()
  const entries = Array.isArray((bundle as { entry?: unknown[] } | null)?.entry)
    ? (bundle as { entry: any[] }).entry
    : []
  for (const entry of entries) {
    const forms = entry?.resource?.resourceType === 'DiagnosticReport'
      && Array.isArray(entry.resource.presentedForm)
      ? entry.resource.presentedForm
      : []
    for (const form of forms) {
      if (typeof form?._imageRef === 'string' && !form._imageRef.includes(':')) {
        refs.add(form._imageRef)
      }
    }
  }
  return [...refs]
}

// Persist all extracted image records in a single transaction (one DB open for
// the whole import, not one per image). Values are EncryptedRecords.
async function idbPutImages(items: Array<{ id: string; record: unknown }>): Promise<void> {
  if (!items.length) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readwrite')
      const store = tx.objectStore(IMG_STORE)
      for (const { id, record } of items) store.put(record, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Raw read — value may be an EncryptedRecord (current) or a plaintext Blob
// (written by older builds); getImage() handles both.
async function idbGetImage(id: string): Promise<unknown> {
  const db = await openDb()
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readonly')
      const req = tx.objectStore(IMG_STORE).get(id)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

// Pure (no IndexedDB): walk a bundle's DiagnosticReports and move every inline
// base64 image out of `presentedForm[].data`, leaving a `_imageRef` pointer
// behind. Mutates `bundle` in place so the retained copy (memBundle + the JSON
// persisted to IndexedDB) carries references, not megabytes of base64. Returns
// the decoded Blobs (keyed by the assigned ref) for the caller to persist.
// Non-image attachments and reports without images are untouched. If a base64
// payload fails to decode it is LEFT INLINE (the viewer falls back to decoding
// `data` directly) rather than dropped — we never silently lose data.
export function prepareImagesForStorage(
  bundle: any,
  importId?: string | null,
): Array<{ id: string; blob: Blob }> {
  const entries: any[] = Array.isArray(bundle?.entry) ? bundle.entry : []
  const toStore: Array<{ id: string; blob: Blob }> = []
  let counter = 0

  for (const e of entries) {
    const res = e?.resource
    if (res?.resourceType !== 'DiagnosticReport' || !Array.isArray(res.presentedForm)) continue
    for (const form of res.presentedForm) {
      const data = form?.data
      const ct: string = form?.contentType || ''
      if (typeof data !== 'string' || data.length === 0 || !ct.startsWith('image/')) continue
      let blob: Blob
      try {
        blob = base64ToBlob(data, ct)
      } catch {
        continue // malformed base64 — leave inline for the viewer to attempt
      }
      const localId = `img_${counter++}`
      const id = importId ? `${importId}:${localId}` : localId
      toStore.push({ id, blob })
      delete form.data
      form._imageRef = id
      if (form.size == null) form.size = blob.size
    }
  }
  return toStore
}

// Strip images out of the bundle (in place), encrypt each one, and persist to
// the import-scoped IndexedDB image keys. Rewriting one import clears only that
// import's prior images; another open tab's image records are never touched.
// When no session key is available the bundle is left untouched (images stay
// inline); the caller will then also skip persisting the bundle itself.
async function extractAndStoreImages(bundle: any, importId: string | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const key = await getSessionBundleKey({ create: true })
  if (!key) return
  const toStore = prepareImagesForStorage(bundle, importId)
  const encrypted: Array<{ id: string; record: unknown }> = []
  for (const { id, blob } of toStore) {
    const bytes = await blob.arrayBuffer()
    encrypted.push({ id, record: await encryptBytes(key, bytes, blob.type) })
  }
  if (importId) await idbDeleteImagesForImport(importId)
  else await idbDeleteImages(toStore.map(({ id }) => id))
  await idbPutImages(encrypted)
}

// --- Bundle identity canonicalisation -----------------------------------------

interface RefTarget {
  resourceType: string
  id: string
}

/**
 * Reduce a bundle entry's `fullUrl` to the bare id that internal references
 * should resolve against. Kept symmetric with `referenceId` (which parses the
 * reference side) so a stamped id and a rewritten reference always agree:
 *   - urn:uuid:<id>                       -> <id>
 *   - urn:oid:<id>                        -> <id>
 *   - http://host/base/Type/<id>[/_hist]  -> <id>
 *   - Type/<id>                           -> <id>
 */
export function idFromFullUrl(fullUrl?: string): string | undefined {
  if (!fullUrl) return undefined
  if (fullUrl.startsWith('urn:uuid:')) return fullUrl.slice('urn:uuid:'.length) || undefined
  if (fullUrl.startsWith('urn:oid:')) return fullUrl.slice('urn:oid:'.length) || undefined
  const noHistory = fullUrl.replace(/\/_history\/[^/]+$/, '')
  return noHistory.split('/').pop() || undefined
}

/** Deep-copy a single FHIR resource (plain JSON — no functions/Dates). */
function cloneResource<T>(resource: T): T {
  if (typeof structuredClone === 'function') return structuredClone(resource)
  return JSON.parse(JSON.stringify(resource))
}

/** Rewrite every internal `reference` string in-place to `ResourceType/id`. */
function rewriteReferences(node: unknown, targets: Map<string, RefTarget>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteReferences(item, targets)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (typeof obj.reference === 'string') {
    const target = targets.get(obj.reference)
    if (target) obj.reference = `${target.resourceType}/${target.id}`
  }
  for (const key of Object.keys(obj)) {
    if (key === 'reference') continue
    rewriteReferences(obj[key], targets)
  }
}

/**
 * Canonicalise a bundle's resource identity at the ingestion boundary so the
 * rest of the app never has to understand bundle-specific reference forms.
 *
 * Why this exists: IPS / TW-Core (and any transaction/collection/document)
 * bundles identify resources by `entry.fullUrl` (e.g. `urn:uuid:…`), leave
 * `resource.id` absent, and point every internal reference at those fullUrls.
 * The app, by contrast, assumes each resource has an `id` and that references
 * are the relative `ResourceType/id` form — both the `patient.id`-gated
 * clinical-data query AND the ~11 `split('/').pop()` reference-resolution sites
 * depend on it. Without normalisation such a bundle loads only the Patient
 * demographics and silently drops everything else (the IPS "只讀得到年齡性別"
 * bug), and reports never link to their member observations.
 *
 * Returns a NEW array of resource clones (the cached raw bundle is never
 * mutated). Two passes:
 *   1. Every resource gets a stable `id` — existing `id`, else derived from its
 *      `fullUrl`, else a deterministic positional fallback (so the id is stable
 *      across the repeated parse() calls React Query makes).
 *   2. Every internal reference (one that resolves to a known fullUrl or the
 *      equivalent `ResourceType/id`) is rewritten to the relative form.
 * References to other servers / unknown targets are left untouched.
 */
export function canonicalizeBundleResources(bundle: any): any[] {
  const rawEntries: any[] = Array.isArray(bundle?.entry) ? bundle.entry : []
  const entries = rawEntries.filter((e) => e?.resource)

  // Pass 1 — assign ids; index every resolvable key to its canonical target.
  const targets = new Map<string, RefTarget>()
  const resources = entries.map((e, index) => {
    const res = cloneResource(e.resource)
    const resourceType: string = res.resourceType ?? 'Resource'
    const id = String(res.id || idFromFullUrl(e.fullUrl) || `${resourceType}-${index}`)
    res.id = id
    const target: RefTarget = { resourceType, id }
    if (e.fullUrl) targets.set(e.fullUrl, target)
    targets.set(`${resourceType}/${id}`, target)
    return res
  })

  // Pass 2 — rewrite internal references to the relative ResourceType/id form.
  for (const res of resources) rewriteReferences(res, targets)
  return resources
}

/** Best human-readable name for a person/place resource (display resolution). */
function resourceDisplayName(res: any): string | undefined {
  if (!res) return undefined
  // Organization / Location use a plain string `name`.
  if (typeof res.name === 'string') return res.name || undefined
  // Practitioner (and other HumanName[] holders): prefer `text`, else assemble.
  const n = Array.isArray(res.name) ? res.name[0] : undefined
  if (!n) return undefined
  if (n.text) return n.text
  const parts = [n.family, ...(n.given ?? [])].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

/**
 * Display canonicalisation: stamp a human-readable `display` onto every
 * in-bundle reference whose target is a person/place resource (Practitioner /
 * PractitionerRole / Organization / Location).
 *
 * Why: TW-Core document bundles (e.g. 門診 scenario files) model the attending
 * physician as `Encounter.participant[].individual → Reference(Practitioner)`
 * and the institution as `serviceProvider → Reference(Organization)` with NO
 * display strings — the UI renders only `.display`, so both showed blank.
 * PractitionerRole references resolve through to the underlying practitioner's
 * name. Organization references deliberately prefer the structured
 * `Organization.name` even when the source already supplied a display: NHI
 * displays may contain "name;visit type;institution code", which is useful as
 * source metadata but is not an appropriate institution label. Existing
 * displays for people and locations remain untouched. Mutates in place (the
 * canonicalised clones, never the cached raw bundle).
 */
export function attachReferenceDisplays(resources: any[]): void {
  const displayByRef = new Map<string, string>()
  const organizationRefs = new Set<string>()
  for (const res of resources) {
    if (!['Practitioner', 'Organization', 'Location'].includes(res.resourceType)) continue
    const display = resourceDisplayName(res)
    if (display) {
      const reference = `${res.resourceType}/${res.id}`
      displayByRef.set(reference, display)
      if (res.resourceType === 'Organization') organizationRefs.add(reference)
    }
  }
  // Second pass: PractitionerRole → its practitioner's resolved name.
  for (const res of resources) {
    if (res.resourceType !== 'PractitionerRole') continue
    const display = res.practitioner?.reference
      ? displayByRef.get(res.practitioner.reference)
      : undefined
    if (display) displayByRef.set(`PractitionerRole/${res.id}`, display)
  }
  if (!displayByRef.size) return

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (
      typeof obj.reference === 'string'
      && (!obj.display || organizationRefs.has(obj.reference))
    ) {
      const display = displayByRef.get(obj.reference)
      if (display) obj.display = display
    }
    for (const key of Object.keys(obj)) walk(obj[key])
  }
  walk(resources)
}

export interface LocalBundleData {
  patient: PatientEntity
  collection: ClinicalDataCollection
}

function toDateStr(dateStr?: string): string | null {
  if (!dateStr) return null
  return dateStr.slice(0, 10)
}

const NHI_DRUG_SNAPSHOT_TAG_SYSTEM =
  'https://nhi-fhir-bridge.github.io/CodeSystem/drug-terminology-snapshot'
const NHI_DRUG_OFFICIAL_URL_IDENTIFIER_SYSTEM =
  'https://nhi-fhir-bridge.github.io/IdentifierSystem/nhi-drug-official-url'
const ATC_HIERARCHY_TAG_SYSTEM =
  'https://nhi-fhir-bridge.github.io/CodeSystem/atc-hierarchy-snapshot'

function hasNhiDrugTerminologyKnowledge(bundle: object): boolean {
  const entries = Array.isArray((bundle as { entry?: unknown }).entry)
    ? (bundle as { entry: any[] }).entry
    : []
  const governedKnowledge = entries
    .map((entry: any) => entry?.resource)
    .filter((resource: any) =>
      resource?.resourceType === 'MedicationKnowledge'
      && Array.isArray(resource.meta?.tag)
      && resource.meta.tag.some(
        (tag: any) => tag?.system === NHI_DRUG_SNAPSHOT_TAG_SYSTEM,
      ))
  if (governedKnowledge.length === 0) return false
  const hasCurrentHierarchy = governedKnowledge.every((resource: any) =>
    Array.isArray(resource.meta?.tag)
    && resource.meta.tag.some(
      (tag: any) =>
        tag?.system === ATC_HIERARCHY_TAG_SYSTEM
        && typeof tag?.code === 'string',
    ))
  const hasCurrentAppPolicy = governedKnowledge.some((resource: any) =>
    Array.isArray(resource.meta?.tag)
    && resource.meta.tag.some(
      (tag: any) =>
        tag?.system === NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM
        && tag?.code === NHI_DRUG_ENRICHMENT_POLICY_VERSION,
    ))
  return hasCurrentHierarchy && hasCurrentAppPolicy
}

function terminologyFromMedicationKnowledge(
  request: any,
  knowledgeById: Map<string, any>,
): MedicationEntity['drugTerminology'] | undefined {
  const references = Array.isArray(request.supportingInformation)
    ? request.supportingInformation
    : []
  for (const candidate of references) {
    const ref = typeof candidate?.reference === 'string'
      ? candidate.reference
      : ''
    if (!ref) continue
    const id = referenceId(ref)
    const knowledge = id ? knowledgeById.get(id) : undefined
    if (!knowledge) continue

    const snapshotTag = Array.isArray(knowledge.meta?.tag)
      ? knowledge.meta.tag.find(
        (tag: any) =>
          tag?.system === NHI_DRUG_SNAPSHOT_TAG_SYSTEM
          && typeof tag?.code === 'string',
      )
      : undefined
    const drugCoding = Array.isArray(knowledge.code?.coding)
      ? knowledge.code.coding.find(
        (coding: any) => isNhiDrugCodeSystem(coding?.system),
      )
      : undefined
    const snapshotId = snapshotTag?.code ?? drugCoding?.version
    if (typeof snapshotId !== 'string' || !snapshotId) continue

    const classifications = Array.isArray(
      knowledge.medicineClassification?.[0]?.classification,
    )
      ? knowledge.medicineClassification[0].classification
      : []
    const atcConcepts = classifications
      .map((classification: any) => {
        const coding = Array.isArray(classification?.coding)
          ? classification.coding.find(
            (candidate: any) =>
              candidate?.system === 'http://www.whocc.no/atc'
              && typeof candidate?.code === 'string',
          )
          : undefined
        return { classification, coding }
      })
      .filter(({ coding }: any) => coding)
    const fullAtc = atcConcepts.find(
      ({ coding }: any) => /^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(coding.code),
    )
    const level2Atc = atcConcepts.find(
      ({ coding }: any) => /^[A-Z]\d{2}$/.test(coding.code),
    )
    const level3Atc = atcConcepts.find(
      ({ coding }: any) => /^[A-Z]\d{2}[A-Z]$/.test(coding.code),
    )
    const level4Atc = atcConcepts.find(
      ({ coding }: any) => /^[A-Z]\d{2}[A-Z]{2}$/.test(coding.code),
    )
    const atcCoding = fullAtc?.coding
    const classification = fullAtc?.classification
    const level2Coding = level2Atc?.coding
    const level2Classification = level2Atc?.classification
    const level3Coding = level3Atc?.coding
    const level3Classification = level3Atc?.classification
    const level4Coding = level4Atc?.coding
    const level4Classification = level4Atc?.classification
    const officialProductIdentifier = Array.isArray(knowledge.identifier)
      ? knowledge.identifier.find(
        (identifier: any) =>
          identifier?.system === NHI_DRUG_OFFICIAL_URL_IDENTIFIER_SYSTEM,
      )
      : undefined

    const officialNameZh = typeof knowledge.code?.text === 'string'
      ? knowledge.code.text
      : undefined
    const officialNameEn = typeof drugCoding?.display === 'string'
      ? drugCoding.display
      : undefined
    const atcNameEn = typeof atcCoding?.display === 'string'
      ? atcCoding.display
      : undefined
    const classificationText = typeof classification?.text === 'string'
      ? classification.text
      : undefined
    const atcLevel2NameEn = typeof level2Coding?.display === 'string'
      ? level2Coding.display
      : undefined
    const atcLevel2NameZh =
      typeof level2Classification?.text === 'string'
      && level2Classification.text !== atcLevel2NameEn
        ? level2Classification.text
        : undefined
    const atcLevel3NameEn = typeof level3Coding?.display === 'string'
      ? level3Coding.display
      : undefined
    const atcLevel3NameZh =
      typeof level3Classification?.text === 'string'
      && level3Classification.text !== atcLevel3NameEn
        ? level3Classification.text
        : undefined
    const atcLevel4NameEn = typeof level4Coding?.display === 'string'
      ? level4Coding.display
      : undefined
    const atcLevel4NameZh =
      typeof level4Classification?.text === 'string'
      && level4Classification.text !== atcLevel4NameEn
        ? level4Classification.text
        : undefined

    return {
      source: 'nhi-official-drug-master',
      snapshotId,
      ...(officialNameZh ? { officialNameZh } : {}),
      ...(officialNameEn && officialNameEn !== officialNameZh
        ? { officialNameEn }
        : {}),
      ...(typeof knowledge.ingredient?.[0]?.itemCodeableConcept?.text === 'string'
        ? { ingredientText: knowledge.ingredient[0].itemCodeableConcept.text }
        : {}),
      ...(typeof knowledge.doseForm?.text === 'string'
        ? { doseForm: knowledge.doseForm.text }
        : {}),
      ...(typeof atcCoding?.code === 'string'
        ? { atcCode: atcCoding.code }
        : {}),
      ...(atcNameEn ? { atcNameEn } : {}),
      ...(classificationText && classificationText !== atcNameEn
        ? { atcNameZh: classificationText }
        : {}),
      ...(typeof level2Coding?.code === 'string'
        ? { atcLevel2Code: level2Coding.code }
        : {}),
      ...(atcLevel2NameEn ? { atcLevel2NameEn } : {}),
      ...(atcLevel2NameZh ? { atcLevel2NameZh } : {}),
      ...(typeof level3Coding?.code === 'string'
        ? { atcLevel3Code: level3Coding.code }
        : {}),
      ...(atcLevel3NameEn ? { atcLevel3NameEn } : {}),
      ...(atcLevel3NameZh ? { atcLevel3NameZh } : {}),
      ...(typeof level4Coding?.code === 'string'
        ? { atcLevel4Code: level4Coding.code }
        : {}),
      ...(atcLevel4NameEn ? { atcLevel4NameEn } : {}),
      ...(atcLevel4NameZh ? { atcLevel4NameZh } : {}),
      ...(typeof (level4Coding?.version ?? level3Coding?.version ?? level2Coding?.version) === 'string'
        ? { atcHierarchySnapshotId: level4Coding?.version ?? level3Coding?.version ?? level2Coding?.version }
        : {}),
      ...(typeof officialProductIdentifier?.value === 'string'
        ? { officialProductUrl: officialProductIdentifier.value }
        : {}),
    }
  }
  return undefined
}

// Attach encounter references for non-medication resources by same-day match.
// Used by Observation / Procedure / Condition / DiagnosticReport / ImagingStudy — these
// don't carry a "requester / provider" field, so date alone is the best we
// have. Multi-encounter same-day collisions take the first match (existing
// VGH behaviour).
function attachEncounterRefsByDate(resources: any[], encounterDateMap: Map<string, string>): any[] {
  return resources.map((r) => {
    if (r.encounter?.reference) return r // already has a reference

    const dateFields: string[] = [
      r.performedDateTime,    // Procedure
      r.performedPeriod?.start,
      r.recordedDate,         // Condition
      r.effectiveDateTime,    // Observation, DiagnosticReport
      r.started,              // ImagingStudy
      r.period?.start,
    ]

    for (const d of dateFields) {
      const key = toDateStr(d)
      if (key && encounterDateMap.has(key)) {
        return {
          ...r,
          encounter: { reference: `Encounter/${encounterDateMap.get(key)}` },
          // Preserve the difference between a source encounter reference and
          // this date-only convenience link. Conservative report grouping must
          // never use an inferred encounter as proof that two orders belong to
          // the same encounter.
          _encounterInferred: true,
        }
      }
    }

    return r
  })
}

// Attach encounter references for MedicationRequests. REQUIRES provider
// match in addition to same-day match — otherwise pharmacy-only refills get
// silently merged into an unrelated same-day clinic visit (e.g. an ENT
// outpatient encounter ends up "containing" the patient's BPH chronic
// refills). Unmatched meds remain orphans here; synthesizePharmacyEncounters()
// downstream gives each orphan group its own synthetic 藥局 Encounter.
function attachEncounterRefsForMeds(
  meds: any[],
  encounterByDateProvider: Map<string, string>,
): any[] {
  return meds.map((m) => {
    if (m.encounter?.reference) return m
    const date = toDateStr(m.authoredOn || m.effectiveDateTime)
    const requester = m.requester?.display?.trim() || ''
    if (!date || !requester) return m
    const id = encounterByDateProvider.get(`${date}|${requester}`)
    if (!id) return m
    return { ...m, encounter: { reference: `Encounter/${id}` }, _encounterInferred: true }
  })
}

export const LocalBundleService = {
  // Synchronous presence check. Reads the in-memory cache first (set the moment
  // a bundle is imported this session) then this tab's sessionStorage marker.
  // The localStorage fallback exists only to migrate pre-tab-isolation builds.
  hasData(): boolean {
    if (typeof window === 'undefined') return false
    if (memBundle !== null) return true
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return true
      return !!localStorage.getItem(STORAGE_KEY)
    } catch {
      return false
    }
  },

  /** Import identity of the Bundle this browser tab is actually serving. */
  getActiveImportId(): string | null {
    if (memBundle !== null) return memBundleImportId
    if (typeof window === 'undefined') return null
    try {
      return readTabLocalImportId()
        ?? importIdFromMarker(localStorage.getItem(STORAGE_KEY))
    } catch {
      return null
    }
  },

  /** Source classification bound to this tab's active Bundle identity. */
  isDemoData(): boolean {
    if (memBundle !== null) return memBundleIsDemo
    if (typeof window === 'undefined') return false
    try {
      const tabMarker = sessionStorage.getItem(STORAGE_KEY)
      if (tabMarker) {
        const importId = importIdFromMarker(tabMarker)
        const demoMarker = sessionStorage.getItem(DEMO_FLAG_KEY)
        return importId ? demoMarker === importId : demoMarker === MARKER
      }
      const legacyImportId = importIdFromMarker(localStorage.getItem(STORAGE_KEY))
      const legacyDemoMarker = localStorage.getItem(DEMO_FLAG_KEY)
      return legacyImportId
        ? legacyDemoMarker === legacyImportId
        : legacyDemoMarker === MARKER
    } catch {
      return false
    }
  },

  // Persist a bundle. Inline base64 images are first moved out to the IndexedDB
  // Blob store (off-heap) — `extractAndStoreImages` mutates `bundle` in place so
  // the retained copies (memBundle + the JSON in IndexedDB) stay small. Only a
  // tiny active pointer goes to sessionStorage. After save resolves,
  // `memBundle` holds the stripped bundle, so no image base64 lingers in the JS
  // heap.
  // Everything persisted is ciphertext; if encryption is unavailable the bundle
  // lives in memory only for this session — never plaintext at rest.
  async save(
    bundle: object,
    options: {
      importId?: string
      demo?: boolean
      sourceMetadata?: ClinicalSourceMetadata
      patientProfile?: UserEnteredPatientProfile | null
    } = {},
  ): Promise<void> {
    const importId = typeof options.importId === 'string' && options.importId.trim()
      ? options.importId.trim()
      : null
    const demo = options.demo === true
    const sourceMetadata = options.sourceMetadata
    const patientProfile = parseUserEnteredPatientProfile(options.patientProfile)
    const activeImportId = typeof window !== 'undefined'
      ? (memBundle !== null ? memBundleImportId : readTabLocalImportId())
      : null
    const isNewImport = Boolean(importId && importId !== activeImportId)
    if (typeof window !== 'undefined') {
      if (isNewImport) {
        // A new import is a new patient-workspace encryption boundary. This is
        // essential when the browser cloned sessionStorage from an opener tab.
        await rotateSessionBundleKey()
        try {
          await idbSweepExpiredRecords()
          await extractAndStoreImages(bundle, importId)
        } catch {
          // IndexedDB image store unavailable — keep images inline; the bundle is
          // still usable and the viewer falls back to decoding `data` directly.
        }
      }
    }
    memBundle = bundle
    memBundleImportId = importId
    memBundleIsDemo = demo
    memBundleSourceMetadata = sourceMetadata ?? null
    memUserEnteredPatientProfile = patientProfile
    if (typeof window === 'undefined') return
    try {
      const key = await getSessionBundleKey({ create: true })
      if (!key) throw new Error('bundle session key unavailable')
      const persisted: object = importId
        ? {
            __mediprismaBundle: 1,
            importId,
            demo,
            ...(sourceMetadata ? { sourceMetadata } : {}),
            ...(patientProfile ? { patientProfile } : {}),
            bundle,
          } satisfies PersistedBundleEnvelope
        : bundle
      await idbPut(await encryptJson(key, persisted), bundleRecordKey(importId))
      writeTabBundleScope(importId, demo)
    } catch {
      // Could not persist ciphertext. Detach only this tab and this import;
      // another MediPrisma tab's Bundle must remain untouched.
      try {
        await idbDelete(bundleRecordKey(importId))
        if (importId) await idbDeleteImagesForImport(importId)
      } catch {
        // Best-effort cleanup.
      }
      // The Bundle is still active in this tab's memory. Keep its scope marker
      // so AI/cache/chat ownership remains isolated until reload; load() will
      // remove the marker if no IndexedDB record exists then.
      try {
        writeTabBundleScope(importId, demo)
      } catch {
        // sessionStorage unavailable; the in-memory chart remains usable.
      }
    }
  },

  async clear(): Promise<void> {
    const activeImportId = memBundle !== null
      ? memBundleImportId
      : readTabLocalImportId()
    const legacyImageRefs = legacyImageRefsInBundle(memBundle)
    memBundle = null
    memBundleImportId = null
    memBundleIsDemo = false
    memBundleSourceMetadata = null
    memUserEnteredPatientProfile = null
    if (typeof window === 'undefined') return
    clearTabBundleScope()
    // Remove only legacy origin-wide markers. New tab-local markers never
    // touch another tab when this tab clears its patient.
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(DEMO_FLAG_KEY)
    clearSessionBundleKey()
    try {
      await idbDelete(bundleRecordKey(activeImportId))
    } catch {
      // Best-effort: the marker is already gone, so hasData() is false regardless.
    }
    try {
      if (activeImportId) await idbDeleteImagesForImport(activeImportId)
      await idbDeleteImages(legacyImageRefs)
    } catch {
      // Best-effort image cleanup.
    }
  },

  // Fetch a stored image by its `_imageRef`. Used by the lazy viewer so the
  // bytes are only pulled into memory while the dialog is open. Handles both
  // encrypted records (current) and plaintext Blobs from older builds.
  async getImage(ref: string): Promise<Blob | null> {
    if (typeof window === 'undefined') return null
    try {
      const stored = await idbGetImage(ref)
      if (!stored) return null
      if (stored instanceof Blob) return stored // legacy plaintext (purged on next load/import)
      if (isEncryptedRecord(stored)) {
        const key = await getSessionBundleKey()
        if (!key) return null
        const plain = await decryptBytes(key, stored)
        return new Blob([plain], { type: stored.type || 'image/jpeg' })
      }
      return null
    } catch {
      return null
    }
  },

  async load(): Promise<object | null> {
    if (memBundle) return memBundle
    if (typeof window === 'undefined') return null

    const tabMarker = readTabBundleMarker()
    const tabImportId = importIdFromMarker(tabMarker)
    const bundleKey = bundleRecordKey(tabImportId)

    // Primary path: this tab's import-scoped IndexedDB record. With no
    // tab-local pointer, read only the legacy `current` key for migration.
    try {
      await idbSweepExpiredRecords()
      const fromIdb = await idbGet<unknown>(bundleKey)
      if (isEncryptedRecord(fromIdb)) {
        // Expired (workstation left open) → remove only this import's record.
        if (Date.now() - fromIdb.savedAt > MAX_BUNDLE_AGE_MS) {
          await this.clear()
          return null
        }
        const key = await getSessionBundleKey()
        if (!key) {
          clearTabBundleScope()
          if (!tabMarker) {
            localStorage.removeItem(STORAGE_KEY)
            localStorage.removeItem(DEMO_FLAG_KEY)
          }
          return null
        }
        try {
          const decrypted = await decryptJson<unknown>(key, fromIdb)
          if (isPersistedBundleEnvelope(decrypted)) {
            if (tabImportId && decrypted.importId !== tabImportId) {
              clearTabBundleScope()
              return null
            }
            memBundle = decrypted.bundle
            memBundleImportId = decrypted.importId
            memBundleIsDemo = decrypted.demo
            memBundleSourceMetadata = decrypted.sourceMetadata ?? null
            memUserEnteredPatientProfile = parseUserEnteredPatientProfile(
              decrypted.patientProfile,
            )
            // Older builds stored every envelope under `current`. Move it to
            // its immutable import key so future tabs cannot overwrite it.
            if (!tabImportId) {
              await idbPut(fromIdb, decrypted.importId)
              await idbDelete(LEGACY_BUNDLE_KEY)
            }
            writeTabBundleScope(decrypted.importId, decrypted.demo)
            return decrypted.bundle
          }
          const bundle = decrypted as object
          const importId = migratedImportId()
          memBundle = bundle
          memBundleImportId = importId
          memBundleIsDemo = localStorage.getItem(DEMO_FLAG_KEY) === MARKER
          memBundleSourceMetadata = null
          memUserEnteredPatientProfile = null
          const migrated = {
            __mediprismaBundle: 1,
            importId,
            demo: memBundleIsDemo,
            bundle,
          } satisfies PersistedBundleEnvelope
          await idbPut(await encryptJson(key, migrated), importId)
          await idbDelete(LEGACY_BUNDLE_KEY)
          writeTabBundleScope(importId, memBundleIsDemo)
          return bundle
        } catch {
          // Never delete an undecryptable scoped record: this tab may have
          // inherited only the pointer while another tab still owns the key.
          memBundle = null
          memBundleImportId = null
          memBundleIsDemo = false
          memBundleSourceMetadata = null
          memUserEnteredPatientProfile = null
          clearTabBundleScope()
          clearSessionBundleKey()
          if (!tabMarker) {
            localStorage.removeItem(STORAGE_KEY)
            localStorage.removeItem(DEMO_FLAG_KEY)
          }
          return null
        }
      }
      if (fromIdb) {
        // Plaintext bundle written by an older build — serve it this once and
        // immediately re-encrypt in place so it stops existing as plaintext.
        const importId = migratedImportId()
        memBundle = fromIdb as object
        memBundleImportId = importId
        memBundleIsDemo = localStorage.getItem(DEMO_FLAG_KEY) === MARKER
        memBundleSourceMetadata = null
        memUserEnteredPatientProfile = null
        try {
          const key = await getSessionBundleKey({ create: true })
          if (key) {
            const migrated = {
              __mediprismaBundle: 1,
              importId,
              demo: memBundleIsDemo,
              bundle: fromIdb as object,
            } satisfies PersistedBundleEnvelope
            await idbPut(await encryptJson(key, migrated), importId)
            await idbDelete(bundleKey)
            writeTabBundleScope(importId, memBundleIsDemo)
          } else {
            await idbDelete(bundleKey)
          }
        } catch {
          // Re-encryption failed — leave the in-memory copy serving this session.
        }
        return fromIdb as object
      }
    } catch {
      // IndexedDB unavailable (private mode, etc.) — fall through to migration.
    }

    // Migration path: older builds stored the full bundle JSON under STORAGE_KEY.
    const raw = readLegacyBundleMarker()
    if (raw && raw !== MARKER && !raw.startsWith(IMPORT_MARKER_PREFIX)) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && (parsed.resourceType === 'Bundle' || Array.isArray(parsed.entry))) {
          const importId = migratedImportId()
          memBundle = parsed
          memBundleImportId = importId
          memBundleIsDemo = localStorage.getItem(DEMO_FLAG_KEY) === MARKER
          memBundleSourceMetadata = null
          memUserEnteredPatientProfile = null
          // Move it (encrypted) to IndexedDB and shrink the marker so we don't
          // re-migrate.
          try {
            const key = await getSessionBundleKey({ create: true })
            if (key) {
              const migrated = {
                __mediprismaBundle: 1,
                importId,
                demo: memBundleIsDemo,
                bundle: parsed,
              } satisfies PersistedBundleEnvelope
              await idbPut(await encryptJson(key, migrated), importId)
              writeTabBundleScope(importId, memBundleIsDemo)
            }
          } catch {
            // Migration write failed — keep serving from the in-memory copy.
          }
          return parsed
        }
      } catch {
        // Corrupt JSON — treat as no data.
      }
    }
    if (tabMarker) {
      clearTabBundleScope()
      clearSessionBundleKey()
    }
    if (raw) {
      try {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(DEMO_FLAG_KEY)
      } catch {
        // Storage unavailable; there is no plaintext fallback.
      }
    }
    return null
  },

  parse(
    bundle: any,
    sourceMetadata?: ClinicalSourceMetadata,
  ): LocalBundleData | null {
    // Canonicalise identity FIRST: stamp ids onto id-less resources and rewrite
    // urn:uuid / absolute references to the relative ResourceType/id form, so
    // every downstream step (patient-id gate, report-member linking, the inline
    // split('/').pop() resolvers) works regardless of the bundle's reference
    // style. See canonicalizeBundleResources.
    let entries: any[] = canonicalizeBundleResources(bundle)
    if (!entries.length) return null

    // Comparison projections belong to this import, never to the source FHIR.
    // Recompute them so re-imported exports cannot hide genuine source orders.
    for (const resource of entries) {
      for (const key of ['_sourceRecordComparison', '_sourcePrescriptionRecords', '_sourceEncounterRecords',
        '_reconciledSourceReferences', '_resolvedMedicationCodeableConcept']) delete resource[key]
    }

    // TW-PAS support: unpack any Claim (事前審查申請) into the standard
    // Condition / Procedure / Observation / DocumentReference resources the rest
    // of the pipeline already renders. No-op for non-PAS bundles. Runs before the
    // byType() split below so the synthesised resources flow through unchanged.
    expandClaimResources(entries)

    // Roche DIP support: flatten the oncology (mCODE) resources Roche nests
    // inside List.contained and relink its identifier-based references, so the
    // Condition / cancer-staging Observations / treatment Procedures surface and
    // the DiagnosticReports link to the patient. No-op for non-Roche bundles.
    expandRocheResources(entries)

    // Display canonicalisation: resolve Practitioner / Organization / Location
    // references to human-readable display strings (attending physician,
    // institution) so the UI's `.display`-only renderers can show them.
    attachReferenceDisplays(entries)
    entries = reconcileOutpatientEncounters(entries)
    entries = reconcileMedicationRequests(entries)

    const byType = (type: string) => entries.filter((r) => r.resourceType === type)
    const sourceCapturedAt = typeof bundle.timestamp === 'string'
      ? bundle.timestamp
      : undefined

    // Extract patient
    const patientRaw = byType('Patient')[0]
    if (!patientRaw) return null
    const patient = PatientMapper.toDomain(patientRaw)
    if (!patient) return null

    // Keep the report -> outpatient order edge useful after domain mapping.
    // The complete ServiceRequest and Provenance remain in the imported Bundle.
    const orderLabels = new Map(byType('ServiceRequest').map((order: any) => [
      `ServiceRequest/${order.id}`, order.code?.text || order.code?.coding?.find((coding: any) => coding.display)?.display,
    ]))
    for (const result of [...byType('Observation'), ...byType('DiagnosticReport')]) {
      if (!Array.isArray(result.basedOn)) continue
      result.basedOn = result.basedOn.map((reference: any) => {
        const display = orderLabels.get(reference.reference)
        return !reference.display && typeof display === 'string' ? { ...reference, display } : reference
      })
    }

    // Build encounter date map: { "YYYY-MM-DD" -> encounterId }
    // VGH data has one encounter per day per department; use first match if multiple same-day.
    const encounters = byType('Encounter')
    const encounterDateMap = new Map<string, string>()
    // Also build (date, provider) → encounterId so medication attachment can
    // disambiguate when multiple same-day encounters exist across providers
    // (e.g. ENT clinic + pharmacy refill on the same day).
    const encounterByDateProvider = new Map<string, string>()
    const ambiguousDateProviders = new Set<string>()
    for (const enc of encounters) {
      const d = toDateStr(enc.period?.start)
      if (d && !encounterDateMap.has(d)) {
        encounterDateMap.set(d, enc.id)
      }
      const provider = enc.serviceProvider?.display?.trim() || ''
      const providerKey = `${d}|${provider}`
      if (d && provider && !ambiguousDateProviders.has(providerKey)) {
        const previous = encounterByDateProvider.get(providerKey)
        if (previous && previous !== enc.id) {
          ambiguousDateProviders.add(providerKey)
          encounterByDateProvider.delete(providerKey)
        } else encounterByDateProvider.set(providerKey, enc.id)
      }
    }

    // Build Medication resource map for resolving medicationReference. BOTH
    // MedicationRequest and MedicationStatement can carry the drug as a
    // `medicationReference` to a contained/standalone Medication instead of an
    // inline `medicationCodeableConcept` — IPS / TW-Core bundles do exactly this
    // (12 MedicationRequests → 4 shared Medication resources in the sample). The
    // map is keyed by the (now-canonicalised) Medication id.
    const medicationResources = byType('Medication')
    const medicationMap = new Map(medicationResources.map((m: any) => [m.id, m]))
    const medicationKnowledgeMap = new Map(
      byType('MedicationKnowledge').map((resource: any) => [resource.id, resource]),
    )

    // Promote a referenced Medication.code into medicationCodeableConcept so the
    // display helpers (which only look at medicationCodeableConcept) find a drug
    // name. References are already relative post-canonicalisation; referenceId
    // also tolerates urn-form as a second line of defence.
    const resolveMedicationCode = <T extends {
      medicationCodeableConcept?: unknown
      medicationReference?: { reference?: string }
    }>(m: T): T => {
      if (m.medicationCodeableConcept || !m.medicationReference?.reference) return m
      const refId = referenceId(m.medicationReference.reference)
      const medResource = refId ? medicationMap.get(refId) : null
      return medResource?.code ? { ...m, medicationCodeableConcept: medResource.code } : m
    }

    // Normalize MedicationStatements to a MedicationRequest-compatible shape so
    // the rest of the pipeline (FhirMapper, display components) can handle them
    // without needing to know which resource type they came from. The original
    // resource type is preserved as `_sourceResourceType` so the medications
    // panel can surface "目前服用中" when an IPS dataset is loaded.
    const medicationStatements = byType('MedicationStatement').map((ms: any) => {
      const resolved = resolveMedicationCode(ms)
      // Normalize field names that differ between MedicationRequest and MedicationStatement
      return {
        ...resolved,
        _sourceResourceType: 'MedicationStatement' as const,
        _sourceCapturedAt: sourceCapturedAt,
        authoredOn: resolved.authoredOn
          ?? resolved.effectivePeriod?.start
          ?? resolved.effectiveDateTime,
        dosageInstruction: resolved.dosageInstruction ?? resolved.dosage,
      }
    })

    // Stamp MedicationRequest with its source type too so downstream code can
    // tell a mixed-source list from a pure one. Resolve its medicationReference
    // as well (IPS-style orders reference a Medication rather than inlining it).
    const medicationRequests = byType('MedicationRequest').map((m: any) => {
      const resolved = resolveMedicationCode(m)
      const drugTerminology = terminologyFromMedicationKnowledge(
        m,
        medicationKnowledgeMap,
      )
      return {
        ...resolved,
        _sourceResourceType: 'MedicationRequest' as const,
        _sourceCapturedAt: sourceCapturedAt,
        ...(drugTerminology ? { drugTerminology } : {}),
      }
    })

    // Pre-process resources: attach encounter refs where missing.
    // Medications use provider-aware matching (date + requester); everything
    // else falls back to date-only matching as before. Orphan pharmacy
    // MedicationRequests that don't match any clinic encounter are LEFT
    // ORPHAN on purpose — per the bridge team's design (bridge bug report
    // 2026-05-20), 健保存摺 itself only surfaces pharmacy events as visits
    // in the IC-card section (≤6 most-recent rows, where bridge v0.7.1+
    // tags them with type.text='藥局'). The older "申報資料" channel never
    // shows pharmacy events as visits at all, so synthesising fake Encounter
    // resources for them would diverge from NHI's data model.
    const meds = attachEncounterRefsForMeds(
      [...medicationRequests, ...medicationStatements],
      encounterByDateProvider,
    )

    const obs    = attachEncounterRefsByDate(byType('Observation'), encounterDateMap)
    const reports = byType('DiagnosticReport')
    const imagingStudies = attachEncounterRefsByDate(byType('ImagingStudy'), encounterDateMap)
    const procs  = attachEncounterRefsByDate(byType('Procedure'), encounterDateMap)
    const conds  = attachEncounterRefsByDate(byType('Condition'), encounterDateMap)
    const allerg = byType('AllergyIntolerance')
    const docRefs = byType('DocumentReference')
    const comps  = byType('Composition')
    const imms   = byType('Immunization')
    const consents = byType('Consent')
    // The SDK converter records its unit-inference software as a Device linked
    // from Provenance. It is an audit agent, not a device implanted in or used
    // by the patient, and must never enter clinical Device cards, AI context,
    // or IPS exports.
    const devices = byType('Device').filter((resource: any) => {
      const names = Array.isArray(resource.deviceName)
        ? resource.deviceName.map((item: any) => String(item?.name ?? ''))
        : []
      const isSdkUnitPolicyAgent = names.some((name: string) =>
        name.startsWith('NHI-FHIR-Bridge sdk-unit-policy-'),
      )
      return !isSdkUnitPolicyAgent
    })
    const carePlans = byType('CarePlan')
    const medicationRemainingSummaries = [...new Map(
      byType('Basic')
        .filter(isMedicationRemainingSummaryBasic)
        .map((resource: any) => {
          const summary = FhirMapper.toMedicationRemainingSummary(
            resource,
            sourceCapturedAt,
          )
          return [summary.id, summary] as const
        }),
    ).values()]

    const specialMaterialsByProcedure = groupSpecialMaterialsByProcedure(byType('Basic'))

    // Build observation map for DiagnosticReport expansion
    const allObs = obs.map((r: any) => FhirMapper.toObservation(r))

    // Attach encounter refs to DiagnosticReports using same-day strategy
    const processedReports = attachEncounterRefsByDate(reports, encounterDateMap).map((r: any) =>
      FhirMapper.toDiagnosticReport(r, allObs)
    )

    // Separate vital signs from other observations
    const observations = allObs
    const vitalSigns = allObs.filter((o: any) => {
      const cats = o.category ?? []
      return cats.some((c: any) => c.coding?.[0]?.code === 'vital-signs')
    })

    const collection: ClinicalDataCollection = {
      conditions:       conds.map((r: any) => FhirMapper.toCondition(r)),
      medications:      meds.map((r: any) => FhirMapper.toMedication(r)),
      medicationRemainingSummaries,
      allergies:        allerg.map((r: any) => FhirMapper.toAllergy(r)),
      observations,
      vitalSigns,
      diagnosticReports: processedReports,
      imagingStudies:    imagingStudies.map((r: any) => FhirMapper.toImagingStudy(r)),
      procedures:       procs.map((r: any) => FhirMapper.toProcedure(r, specialMaterialsByProcedure)),
      encounters:       encounters.map((r: any) => FhirMapper.toEncounter(r)),
      documentReferences: docRefs.map((r: any) => FhirMapper.toDocumentReference(r)),
      compositions:     comps.map((r: any) => FhirMapper.toComposition(r)),
      immunizations:    imms.map((r: any) => FhirMapper.toImmunization(r)),
      consents:         consents.map((r: any) => FhirMapper.toConsent(r)),
      devices:          devices.map((r: any) => FhirMapper.toDevice(r)),
      carePlans:        carePlans.map((r: any) => FhirMapper.toCarePlan(r)),
      ...(sourceMetadata ? { sourceMetadata } : {}),
    }

    return { patient, collection }
  },

  async parseStored(): Promise<LocalBundleData | null> {
    let bundle = await this.load()
    if (!bundle) return null

    // Bundles persisted before App-side drug terminology existed, or before
    // the current exact-code/latest-covered-date policy, do not carry the
    // current policy tag. Upgrade them once locally, then re-encrypt the
    // enriched FHIR under the same import id. The raw SDK JSON is neither
    // needed nor recovered.
    if (!hasNhiDrugTerminologyKnowledge(bundle)) {
      let migration = terminologyMigrationByBundle.get(bundle)
      if (!migration) {
        migration = (async () => {
          // Worker-routed: this upgrade runs while the workspace is painting
          // its first patient view, and the terminology snapshot's JSON.parse
          // would otherwise hold the main thread for seconds.
          const result = await enrichBundleWithNhiDrugTerminologyOffMainThread(
            bundle as Record<string, unknown>,
          )
          if (
            result.report.status === 'enriched'
            && result.report.linkedRequestCount > 0
          ) {
            await this.save(result.bundle, {
              ...(memBundleImportId ? { importId: memBundleImportId } : {}),
              demo: memBundleIsDemo,
              ...(memBundleSourceMetadata
                ? { sourceMetadata: memBundleSourceMetadata }
                : {}),
              patientProfile: memUserEnteredPatientProfile,
            })
            return result.bundle
          }
          return bundle
        })()
        terminologyMigrationByBundle.set(bundle, migration)
      }
      bundle = await migration
    }

    const sourceMetadata = memBundleSourceMetadata
    const cached = parsedStoredDataByBundle.get(bundle)
    const parsed = cached?.sourceMetadata === sourceMetadata
      ? cached.data
      : this.parse(bundle, sourceMetadata ?? undefined)
    if (!parsed) return null
    if (cached?.sourceMetadata !== sourceMetadata) {
      parsedStoredDataByBundle.set(bundle, { sourceMetadata, data: parsed })
    }
    return {
      ...parsed,
      patient: applyUserEnteredPatientProfile(
        parsed.patient,
        memUserEnteredPatientProfile,
      ),
    }
  },

  getUserEnteredPatientProfile(): UserEnteredPatientProfile | null {
    return memUserEnteredPatientProfile
      ? { ...memUserEnteredPatientProfile }
      : null
  },

  /** Persist a local-import demographic overlay in the same AES-GCM envelope
   * as the Bundle. The original FHIR Patient is never mutated. */
  async setUserEnteredPatientProfile(
    profile: UserEnteredPatientProfile | null,
  ): Promise<void> {
    const bundle = await this.load()
    if (!bundle || !memBundleImportId) {
      throw new Error('No active local import is available')
    }
    const normalized = parseUserEnteredPatientProfile(profile)
    if (profile && !normalized) {
      throw new Error('Invalid user-entered patient profile')
    }
    if (typeof window === 'undefined') {
      throw new Error('Encrypted browser storage is unavailable')
    }

    const key = await getSessionBundleKey()
    if (!key) throw new Error('Encrypted browser storage is unavailable')
    const persisted = {
      __mediprismaBundle: 1,
      importId: memBundleImportId,
      demo: memBundleIsDemo,
      ...(memBundleSourceMetadata
        ? { sourceMetadata: memBundleSourceMetadata }
        : {}),
      ...(normalized ? { patientProfile: normalized } : {}),
      bundle,
    } satisfies PersistedBundleEnvelope

    // Update in-memory state only after the encrypted IndexedDB write succeeds.
    await idbPut(
      await encryptJson(key, persisted),
      bundleRecordKey(memBundleImportId),
    )
    writeTabBundleScope(memBundleImportId, memBundleIsDemo)
    memUserEnteredPatientProfile = normalized
  },
}
