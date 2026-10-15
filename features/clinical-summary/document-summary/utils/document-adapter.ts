// document-adapter.ts
// Converts the two FHIR document carriers — Composition and DocumentReference —
// into a unified DocumentEntry view model. Keeps the card logic source-agnostic.
//
// IMPORTANT: this module is pure and does NOT decode base64 / sanitise HTML.
// Both are deferred to the renderer so the cost is paid only for documents the
// user actually opens.
import type {
  ConditionEntity,
  CompositionEntity,
  DocumentReferenceEntity,
  EncounterEntity,
} from '@/src/core/entities/clinical-data.entity'
import type { DocumentEntry } from '../types'
import { hasNarrativeContent } from './sanitize-narrative'
import {
  DOCUMENT_TYPE_LOINC,
  getDocumentTypeCode,
  isIpsComposition,
  isPreventiveMedicineComposition,
} from './loinc-document-types'
import { extractInstitutionFromDocumentTitle } from '@/src/shared/utils/document-institution'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { localizeDemoDisplayText } from '@/src/shared/utils/demo-display'

const DISCHARGE_SUMMARY_LOINC = '18842-5'

/** Strip a leading ICD-10 code from a diagnosis text. Bridge populates the
 *  text field as "<ICD> <description>" (e.g. "R042 咳血"); the 健保存摺 UI
 *  shows just the description, and so do we. The regex matches the standard
 *  ICD-10 letter+digits[.digits]? shape. */
function stripIcdPrefix(s: string): string {
  return s.replace(/^[A-Z]\d+(\.\d+)?\s+/, '').trim()
}

/** Extract the primary diagnosis from an Encounter, localised. Prefers
 *  reasonCode[0] (the bridge's primary diagnosis position), falling back
 *  to reasonReference[0].display. Returns undefined when nothing usable. */
function extractPrimaryDiagnosis(
  encounter: EncounterEntity | undefined,
  locale: string,
): { text: string; code?: string } | undefined {
  if (!encounter) return undefined
  const rc = encounter.reasonCode?.[0]
  if (rc) {
    const coding = Array.isArray(rc.coding) ? rc.coding[0] : undefined
    const code = coding?.code
    // Locale-driven: zh-TW prefers `text` (Chinese), en prefers
    // coding[].display (English). Either way the result is ICD-prefix-free.
    const rawDisplay = typeof coding?.display === 'string' ? coding.display.trim() : ''
    const rawText = typeof rc.text === 'string' ? rc.text.trim() : ''
    const localised =
      locale === 'en'
        ? rawDisplay || stripIcdPrefix(rawText)
        : stripIcdPrefix(rawText) || rawDisplay
    if (localised) return { text: localised, code }
  }
  const rr = encounter.reasonReference?.[0]?.display?.trim()
  if (rr) return { text: stripIcdPrefix(rr) }
  return undefined
}

/** Resolve the explicitly ranked primary diagnosis, never another visit's condition. */
function outpatientPrimaryDiagnosis(
  encounter: EncounterEntity | undefined,
  conditions: Map<string, ConditionEntity> | undefined,
  locale: string,
): DocumentEntry['primaryDiagnosis'] {
  const primary = encounter?.diagnosis?.find((diagnosis) => diagnosis.rank === 1)
  const reference = primary?.condition?.reference
  const concept = reference ? conditions?.get(reference.replace(/^Condition\//, ''))?.code : undefined
  if (concept) {
    const coding = concept.coding?.find((item) => item.code &&
      /\/sid\/icd-10(?:-cm)?$/.test(item.system || ''))
      || concept.coding?.find((item) => item.code)
    const code = coding?.code?.trim()
    const display = coding?.display?.trim() || ''
    const rawText = concept.text?.trim() || ''
    const text = rawText === code ? ''
      : code && rawText.startsWith(`${code} `) ? rawText.slice(code.length).trim()
      : stripIcdPrefix(rawText)
    return { code, text: (locale === 'en' ? display || text : text || display) }
  }
  const referenceDisplay = primary?.condition?.display?.trim()
  if (referenceDisplay) {
    const match = referenceDisplay.match(/^([A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4})?)\s+(.+)$/)
    return match ? { code: match[1], text: match[2] } : { text: referenceDisplay }
  }
  // A reason string may contain all diagnosis codes. Do not relabel it as
  // the primary when a ranked primary exists but cannot resolve. Unranked
  // diagnoses from other FHIR sources retain the existing reason fallback.
  if (primary) return undefined
  return extractPrimaryDiagnosis(encounter, locale)
}

/**
 * Looks up the localised label for a LOINC document type code.
 * `docTypeStrings` is the `documentSummary.docTypes` map from i18n; callers
 * pass it in to avoid coupling the adapter to the language provider.
 */
function pickLoincTypeLabel(
  code: string | null,
  docTypeStrings: Record<string, string>,
): string | null {
  if (!code) return null
  const i18nKey = DOCUMENT_TYPE_LOINC[code]
  if (!i18nKey) return null
  return docTypeStrings[i18nKey] ?? null
}

/** Inline DocumentReference attachment shape — mirrors the entity to avoid
 *  index-signature contortions in callers that need the renderer payload. */
type DocRefAttachment = NonNullable<
  NonNullable<DocumentReferenceEntity['content']>[number]['attachment']
>

/**
 * Looks up the first attachment with a usable payload (data or url).
 * Returns undefined if the DocumentReference has no usable attachments —
 * the caller drops the entry rather than rendering an empty card.
 */
function pickRenderableAttachment(
  docRef: DocumentReferenceEntity,
): DocRefAttachment | undefined {
  const contents = Array.isArray(docRef.content) ? docRef.content : []
  for (const c of contents) {
    const att = c?.attachment
    if (!att) continue
    const ct = (att.contentType || '').toLowerCase()
    // Renderable inline: HTML / XHTML / plain text. PDFs and images have their
    // own viewers elsewhere (ReportImageDialog etc.); we don't surface them
    // here to avoid pretending we can render them as readable text.
    const isRenderable =
      ct.startsWith('text/html') ||
      ct.startsWith('application/xhtml') ||
      ct.startsWith('text/plain')
    if (!isRenderable) continue
    if (att.data || att.url) return att
  }
  return undefined
}

/**
 * Adapt a FHIR Composition to a DocumentEntry. Returns null when the
 * Composition has no renderable narrative content (every section.text.div is
 * empty/whitespace), since the structured data is already shown in other
 * cards and an empty narrative panel would be noise.
 */
export function compositionToEntry(
  comp: CompositionEntity,
  docTypeStrings: Record<string, string>,
): DocumentEntry | null {
  const sections = Array.isArray(comp.section) ? comp.section : []
  const hasSectionNarrative = sections.some((s) => hasNarrativeContent(s?.text?.div))
  // Bridge's adult preventive-care document is one continuous Composition:
  // its top-level narrative precedes its ordered section narratives. Retain a
  // document that only has the introductory narrative as well.
  const hasAny = hasSectionNarrative || (
    isPreventiveMedicineComposition(comp) && hasNarrativeContent(comp.text?.div)
  )
  if (!hasAny) return null

  const typeCode = getDocumentTypeCode(comp)
  const loincLabel = pickLoincTypeLabel(typeCode, docTypeStrings)
  const typeLabel =
    loincLabel ||
    comp.title?.trim() ||
    comp.type?.text?.trim() ||
    '—'

  return {
    id: comp.id || `composition-${comp.date ?? Math.random()}`,
    date: comp.date ?? '',
    typeLabel,
    typeCode,
    sourceKind: 'composition',
    isIps: isIpsComposition(comp),
    isDischargeSummary: typeCode === DISCHARGE_SUMMARY_LOINC,
    composition: comp,
  }
}

/**
 * Adapt a FHIR DocumentReference to a DocumentEntry. Returns null when no
 * usable inline attachment exists (PDF/image/url-only DocumentReferences are
 * intentionally skipped — see pickRenderableAttachment).
 *
 * Pass `encounterMap` + `locale` to surface the linked Encounter's primary
 * diagnosis (健保存摺's 「疾病分類」line); both are optional.
 */
export function documentReferenceToEntry(
  docRef: DocumentReferenceEntity,
  docTypeStrings: Record<string, string>,
  encounterMap?: Map<string, EncounterEntity>,
  locale: string = 'zh-TW',
  conditionMap?: Map<string, ConditionEntity>,
): DocumentEntry | null {
  const att = pickRenderableAttachment(docRef)
  if (!att) return null

  const codings = Array.isArray(docRef.type?.coding) ? docRef.type!.coding! : []
  const typeCode = codings.find((c) => c?.code)?.code ?? null
  const loincLabel = pickLoincTypeLabel(typeCode, docTypeStrings)
  const attachmentTitle = localizeDemoDisplayText(att.title?.trim() || '', locale)
  const typeLabel =
    loincLabel ||
    localizeDemoDisplayText(docRef.type?.text?.trim() || '', locale) ||
    attachmentTitle ||
    '—'

  const period = docRef.context?.period
  const encounterRef = docRef.context?.encounter?.[0]?.reference
  const encounterId = encounterRef ? encounterRef.replace(/^Encounter\//, '') : undefined
  const encounter = encounterId ? encounterMap?.get(encounterId) : undefined
  const institutionSource =
    encounter?.serviceProvider?.display?.trim() ||
    extractInstitutionFromDocumentTitle(att.title)
  const institution = institutionSource
    ? formatOrganizationDisplay(institutionSource, locale)
    : undefined
  const isOutpatient = encounter?.class?.code === 'AMB' || (
    docRef.type?.text === '門診 SOAP 與醫囑' && docRef.meta?.tag?.some((tag) =>
      tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement')
  )
  const outpatient = isOutpatient ? {
    department: encounter?.serviceType?.text?.trim()
      || encounter?.serviceType?.coding?.find((coding) => coding.display?.trim())?.display?.trim(),
    physician: encounter?.participant?.map((participant) =>
      participant.individual?.display?.trim() || participant.actor?.display?.trim()).filter(Boolean).join('、') || undefined,
  } : undefined
  const primaryDiagnosis = isOutpatient
    ? outpatientPrimaryDiagnosis(encounter, conditionMap, locale)
    : extractPrimaryDiagnosis(encounter, locale)

  return {
    id: docRef.id || `documentReference-${docRef.date ?? Math.random()}`,
    // Sort by the admission date (period.start) first: the NHI bridge's
    // DocumentReference.date is a registration timestamp that clusters across a
    // batch, so sorting on it groups unrelated admissions. The period is the
    // distinct, meaningful date and keeps this list in step with data-selection.
    date: period?.start ?? docRef.date ?? '',
    typeLabel,
    typeCode,
    sourceKind: 'documentReference',
    isIps: false,
    isDischargeSummary: typeCode === DISCHARGE_SUMMARY_LOINC,
    institution,
    period: period ? { start: period.start, end: period.end } : undefined,
    subtitle: attachmentTitle || undefined,
    attachment: att,
    encounterRef,
    primaryDiagnosis,
    outpatient,
  }
}

/**
 * Adapt both source arrays into a unified, deduplicated, newest-first list
 * suitable for direct iteration in DocumentSummaryCard.
 *
 * `encounters` (when provided) lets DocumentReference entries pull primary
 * diagnosis from the linked visit — bridge populates Encounter.reasonCode[0]
 * with the same diagnosis 健保存摺 surfaces on its 住院 list.
 */
export function buildDocumentEntries(
  compositions: CompositionEntity[] | undefined,
  documentReferences: DocumentReferenceEntity[] | undefined,
  docTypeStrings: Record<string, string>,
  encounters?: EncounterEntity[],
  locale: string = 'zh-TW',
  conditions?: ConditionEntity[],
): DocumentEntry[] {
  const entries: DocumentEntry[] = []
  const conditionMap = new Map((conditions ?? []).map((condition) => [condition.id, condition]))
  // Build the encounter index once per call so 50+ document refs don't
  // re-walk the encounter list each time.
  const encounterMap = new Map<string, EncounterEntity>()
  for (const enc of encounters ?? []) {
    if (enc?.id) encounterMap.set(enc.id, enc)
  }
  for (const c of compositions ?? []) {
    const e = compositionToEntry(c, docTypeStrings)
    if (e) entries.push(e)
  }
  for (const d of documentReferences ?? []) {
    const e = documentReferenceToEntry(d, docTypeStrings, encounterMap, locale, conditionMap)
    if (e) entries.push(e)
  }
  // Newest-first; entries without a date sink to the bottom.
  entries.sort((a, b) => {
    if (a.date && !b.date) return -1
    if (!a.date && b.date) return 1
    if (a.date === b.date) return 0
    return b.date.localeCompare(a.date)
  })
  return entries
}
