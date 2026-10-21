// Small shared helpers for the IPS builder: id/reference generation, HTML
// escaping for narratives, and lenient date formatting.

import type {
  DiagnosticReportEntity,
  ObservationEntity,
} from '@/src/core/entities/clinical-data.entity'
import { getAnalyteLabel } from '@voho0000/clinical-lab-normalization/canonical'
import { clinicalRecordKey, reportMemberRecordKeys, isVitalObservation } from '@/src/core/utils/observation-selectors'
import type { FhirResource, IpsBundleEntry } from './ips-types'

/** Generate a UUID v4. Uses crypto.randomUUID when available, else a fallback. */
export function uuidv4(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // RFC4122-ish fallback (sufficient for document-local fullUrls).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Wrap a resource into a Bundle entry with a urn:uuid fullUrl. The same uuid is
 * set as resource.id and returned as `reference`, so cross-resource references
 * and Composition.section.entry references resolve against the fullUrl.
 */
export function makeEntry(resource: FhirResource): { entry: IpsBundleEntry; reference: string } {
  const id = resource.id ?? uuidv4()
  const fullUrl = `urn:uuid:${id}`
  return {
    entry: { fullUrl, resource: { ...resource, id } },
    reference: fullUrl,
  }
}

/** Escape a string for safe inclusion inside XHTML narrative text nodes. */
export function escapeHtml(value: unknown): string {
  const s = value == null ? '' : String(value)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Format an ISO-ish date string to YYYY-MM-DD; returns '' on bad input. */
export function formatDate(value?: string): string {
  if (!value) return ''
  // Already a plain date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value // leave as-is rather than drop data
  return d.toISOString().slice(0, 10)
}

/** UTF-8 byte length of a serialized document (for the export size estimate). */
export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  return text.length // ASCII-lower-bound fallback for exotic runtimes
}

/** Human-readable size for the export preview (KB below 1 MB, MB above). */
export function formatByteSize(bytes: number): string {
  const MB = 1024 * 1024
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Compact YYYYMMDD stamp for filenames. */
export function dateStampForFilename(d: Date = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

/** Pick the best human label from a CodeableConcept-ish object (text-first). */
export function conceptLabel(cc?: {
  text?: string
  coding?: Array<{ display?: string; code?: string }>
}): string {
  if (!cc) return ''
  if (cc.text && cc.text.trim()) return cc.text.trim()
  const coding = cc.coding?.find((c) => c.display || c.code)
  return (coding?.display || coding?.code || '').trim()
}

/**
 * English-preferring label for a CodeableConcept.
 *
 * Per the NHI-FHIR-Bridge contract (v0.6.10+), for drug names and billing-ICD
 * descriptions `coding[].display` carries the canonical *English* label while
 * `text` holds the localized zh-TW string. An IPS is an international,
 * cross-border artifact, so its human-readable narrative should prefer the
 * English coding display when one exists, and otherwise fall back to `text` —
 * i.e. faithfully carry over whatever a non-bridge FHIR source provided.
 *
 * Machine-readable resources keep BOTH the English coding and the zh-TW text
 * (passed through verbatim); only the narrative display is anglicised here.
 */
export function conceptLabelEn(cc?: {
  text?: string
  coding?: Array<{ display?: string; code?: string }>
}): string {
  if (!cc) return ''
  const coded = cc.coding?.find((c) => c.display && c.display.trim())
  if (coded?.display) return coded.display.trim()
  if (cc.text && cc.text.trim()) return cc.text.trim()
  const codeOnly = cc.coding?.find((c) => c.code)
  return (codeOnly?.code || '').trim()
}

/**
 * Human-readable analyte label for IPS lab/vital narratives.
 *
 * An IPS is an international artifact, so the narrative should carry a
 * standardized English analyte name and avoid the bridge's Chinese NHI 醫令名.
 * `getAnalyteLabel` resolves in exactly that priority (per the NHI-FHIR-Bridge
 * coding contract):
 *   1. LOINC coding → the app's canonical English display (e.g. "Free T4").
 *   2. text/alias resolution (handles known analytes without LOINC).
 *   3. fallback to `code.text` — the bridge's cleaned English assay name
 *      ("T4 Free") — BEFORE any `coding[0].display`, so the Chinese
 *      nhi-medical-order-code display is never preferred.
 * Only the human-readable narrative is anglicised; the machine-readable
 * Observation.code keeps every original coding untouched.
 */
export function resultLabel(code?: {
  text?: string
  coding?: Array<{ system?: string; code?: string; display?: string }>
}): string {
  if (!code) return ''
  const label = getAnalyteLabel({ code })
  return label === '—' ? '' : label
}

/**
 * True when an Observation is a vital sign. Delegates to the shared SSOT so IPS
 * and the category system agree on what counts as a vital; kept under the
 * IPS-local name the builder/narrative already import.
 */
export function isVitalSignObservation(o: ObservationEntity): boolean {
  return isVitalObservation(o)
}

/**
 * Filter a flat Observation list down to the "orphan" result observations that
 * belong in the Diagnostic Results section as standalone rows: NOT already a
 * member of any DiagnosticReport, and NOT a vital sign.
 *
 * Why this is needed: per the OBSERVATION SUPERSET INVARIANT, `observations`
 * already contains every report member and every vital. Emitting those again as
 * standalone Results rows produced the duplicate "value row" + "N observation(s)"
 * display. The membership / vital rules now live in the shared SSOT
 * (src/core/utils/observation-selectors.ts); this is only the IPS-shaped
 * `(reports, observations)` composition of them.
 */
export function orphanResultObservations(
  reports: DiagnosticReportEntity[],
  observations: ObservationEntity[],
): ObservationEntity[] {
  const memberIds = reportMemberRecordKeys(reports)
  return observations.filter(
    (o) => !isVitalObservation(o) && !(clinicalRecordKey(o) && memberIds.has(clinicalRecordKey(o)!)),
  )
}
