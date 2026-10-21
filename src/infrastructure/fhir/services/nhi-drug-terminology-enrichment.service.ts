/**
 * App-side NHI drug terminology enrichment.
 *
 * This service intentionally runs after every local input has become a FHIR
 * Bundle, so Health Bank SDK JSON, Health Bank website exports, and any future
 * NHI source share the same terminology policy. The source MedicationRequest
 * remains authoritative: enrichment only adds MedicationKnowledge,
 * supportingInformation links, Provenance, and an app-internal governed ATC
 * classification when the source already carries one exact WHO ATC code.
 */

import type {
  NhiDrugTerminologyResolutionStatus,
} from '@/vendor/nhi-fhir-bridge-nhi-drug-terminology/src/types'

import { isNhiDrugCodeSystem } from '@/src/shared/utils/nhi-drug-code-system'
export { isNhiDrugCodeSystem, NHI_DRUG_CODE_SYSTEMS } from '@/src/shared/utils/nhi-drug-code-system'
const WHO_ATC_CODE_SYSTEM = 'http://www.whocc.no/atc'

const ATC_HIERARCHY_TAG_SYSTEM =
  'https://nhi-fhir-bridge.github.io/CodeSystem/atc-hierarchy-snapshot'
export const NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM =
  'https://mediprisma.app/fhir/CodeSystem/nhi-drug-enrichment-policy'
export const NHI_DRUG_ENRICHMENT_POLICY_VERSION =
  'latest-covered-record-atc-levels-2-4-v5'

type FhirResource = Record<string, unknown> & {
  resourceType?: string
  id?: string
}

type BundleEntry = Record<string, unknown> & {
  fullUrl?: string
  resource?: FhirResource
}

interface Candidate {
  entryIndex: number
  resource: FhirResource
  nhiDrugCode: string
  prescriptionDate: string
  lookupKey: string
}

interface SourceAtcCandidate {
  entryIndex: number
  resource: FhirResource
  atcCode: string
  atcNameEn?: string
}

export interface NhiDrugTerminologyEnrichmentReport {
  status: 'not-applicable' | 'enriched' | 'unavailable'
  snapshotId?: string
  medicationRequestCount: number
  eligibleRequestCount: number
  linkedRequestCount: number
  knowledgeResourceCount: number
  atcResolvedCount: number
  sourceAtcFallbackCount: number
  skipped: {
    missingNhiDrugCode: number
    ambiguousNhiDrugCode: number
    missingPrescriptionDate: number
  }
  byResolutionStatus: Partial<Record<NhiDrugTerminologyResolutionStatus, number>>
}

export interface NhiDrugTerminologyEnrichmentResult {
  bundle: Record<string, unknown>
  report: NhiDrugTerminologyEnrichmentReport
}

function asEntries(bundle: Record<string, unknown>): BundleEntry[] {
  return Array.isArray(bundle.entry)
    ? bundle.entry.filter(
      (entry): entry is BundleEntry => !!entry && typeof entry === 'object',
    )
    : []
}

function resourceReferenceKeys(entry: BundleEntry): string[] {
  const resource = entry.resource
  if (!resource?.resourceType) return []
  const keys = new Set<string>()
  if (typeof entry.fullUrl === 'string' && entry.fullUrl) keys.add(entry.fullUrl)
  if (typeof resource.id === 'string' && resource.id) {
    keys.add(`${resource.resourceType}/${resource.id}`)
    keys.add(resource.id)
  }
  return [...keys]
}

function referencedMedication(
  request: FhirResource,
  medicationsByReference: Map<string, FhirResource>,
): FhirResource | undefined {
  const reference = (
    request.medicationReference as { reference?: unknown } | undefined
  )?.reference
  if (typeof reference !== 'string' || !reference) return undefined
  return medicationsByReference.get(reference)
    ?? medicationsByReference.get(reference.split('/').pop() ?? '')
}

function medicationCodings(
  request: FhirResource,
  medicationsByReference: Map<string, FhirResource>,
): Array<{ system?: unknown; code?: unknown; display?: unknown }> {
  const inline = request.medicationCodeableConcept as {
    coding?: unknown
  } | undefined
  const referenced = referencedMedication(request, medicationsByReference)
  const referencedCode = referenced?.code as { coding?: unknown } | undefined
  const coding = inline?.coding ?? referencedCode?.coding
  return Array.isArray(coding)
    ? coding.filter(
      (item): item is { system?: unknown; code?: unknown; display?: unknown } =>
        !!item && typeof item === 'object',
    )
    : []
}

function exactSourceWhoAtc(
  medication: FhirResource,
  medicationsByReference: Map<string, FhirResource>,
): { atcCode: string; atcNameEn?: string } | undefined {
  const codings = medicationCodings(medication, medicationsByReference)
    .filter(({ system, code }) =>
      system === WHO_ATC_CODE_SYSTEM
      && typeof code === 'string'
      && /^[A-Z]\d{2}[A-Z]{2}\d{2}$/i.test(code.trim()))
  const codes = [
    ...new Set(
      codings.map(({ code }) => String(code).trim().toUpperCase()),
    ),
  ]
  // Multiple distinct full codes are ambiguous for grouping. Never choose one
  // silently or infer a category from product/class free text.
  if (codes.length !== 1) return undefined
  const atcCode = codes[0]
  const sourceCoding = codings.find(
    ({ code }) => String(code).trim().toUpperCase() === atcCode,
  )
  const atcNameEn = typeof sourceCoding?.display === 'string'
    ? sourceCoding.display.replace(/\s+/g, ' ').trim()
    : ''
  return {
    atcCode,
    ...(atcNameEn && atcNameEn !== atcCode ? { atcNameEn } : {}),
  }
}

function exactNhiDrugCodes(
  request: FhirResource,
  medicationsByReference: Map<string, FhirResource>,
): string[] {
  return [
    ...new Set(
      medicationCodings(request, medicationsByReference)
        .filter(({ system }) => isNhiDrugCodeSystem(system))
        .map(({ code }) => typeof code === 'string' ? code.trim().toUpperCase() : '')
        .filter(Boolean),
    ),
  ]
}

function prescriptionDate(request: FhirResource): string | null {
  if (typeof request.authoredOn !== 'string') return null
  const date = request.authoredOn.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf())
    && parsed.toISOString().slice(0, 10) === date
    ? date
    : null
}

function notApplicableReport(
  medicationRequestCount: number,
  skipped: NhiDrugTerminologyEnrichmentReport['skipped'],
): NhiDrugTerminologyEnrichmentReport {
  return {
    status: 'not-applicable',
    medicationRequestCount,
    eligibleRequestCount: 0,
    linkedRequestCount: 0,
    knowledgeResourceCount: 0,
    atcResolvedCount: 0,
    sourceAtcFallbackCount: 0,
    skipped,
    byResolutionStatus: {},
  }
}

function withAppEnrichmentPolicyTag(resource: FhirResource): FhirResource {
  const meta = resource.meta && typeof resource.meta === 'object'
    ? resource.meta as Record<string, unknown>
    : {}
  const existingTags = Array.isArray(meta.tag)
    ? meta.tag.filter(
      (tag: unknown) =>
        !tag
        || typeof tag !== 'object'
        || (tag as { system?: unknown }).system
          !== NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
    )
    : []
  return {
    ...resource,
    meta: {
      ...meta,
      tag: [
        ...existingTags,
        {
          system: NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
          code: NHI_DRUG_ENRICHMENT_POLICY_VERSION,
          display: 'Use the latest covered drug record for newer prescriptions',
        },
      ],
    },
  }
}

/**
 * Enrich a local FHIR Bundle without changing any source clinical fields.
 *
 * The terminology package is loaded only after either an eligible NHI lookup
 * or an exact source WHO ATC code is found. This function runs in the existing
 * enrichment worker, keeping both the 12 MB drug snapshot and the ATC hierarchy
 * off the UI thread. Dates covered by the snapshot retain strict point-in-time
 * matching. A newer prescription is matched against the latest date covered by
 * the bundled snapshot so an exact code still receives the newest terminology
 * known to the App.
 */
export async function enrichBundleWithNhiDrugTerminology(
  bundle: Record<string, unknown>,
  options: { recordedAt?: string } = {},
): Promise<NhiDrugTerminologyEnrichmentResult> {
  const entries = asEntries(bundle)
  const medicationRequests = entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => entry.resource?.resourceType === 'MedicationRequest')
  const sourceAtcResources = entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) =>
      entry.resource?.resourceType === 'MedicationRequest'
      || entry.resource?.resourceType === 'MedicationStatement')
  const medicationsByReference = new Map<string, FhirResource>()
  for (const entry of entries) {
    if (entry.resource?.resourceType !== 'Medication') continue
    for (const key of resourceReferenceKeys(entry)) {
      medicationsByReference.set(key, entry.resource)
    }
  }

  const skipped = {
    missingNhiDrugCode: 0,
    ambiguousNhiDrugCode: 0,
    missingPrescriptionDate: 0,
  }
  const candidates: Candidate[] = []
  for (const { entry, entryIndex } of medicationRequests) {
    const resource = entry.resource!
    const codes = exactNhiDrugCodes(resource, medicationsByReference)
    if (codes.length === 0) {
      skipped.missingNhiDrugCode += 1
      continue
    }
    if (codes.length !== 1) {
      skipped.ambiguousNhiDrugCode += 1
      continue
    }
    const date = prescriptionDate(resource)
    if (!date) {
      skipped.missingPrescriptionDate += 1
      continue
    }
    candidates.push({
      entryIndex,
      resource,
      nhiDrugCode: codes[0],
      prescriptionDate: date,
      lookupKey: `${codes[0]}|${date}`,
    })
  }

  const sourceAtcCandidates: SourceAtcCandidate[] = []
  for (const { entry, entryIndex } of sourceAtcResources) {
    const resource = entry.resource!
    const sourceAtc = exactSourceWhoAtc(resource, medicationsByReference)
    if (!sourceAtc) continue
    sourceAtcCandidates.push({
      entryIndex,
      resource,
      ...sourceAtc,
    })
  }

  if (candidates.length === 0 && sourceAtcCandidates.length === 0) {
    return {
      bundle,
      report: notApplicableReport(medicationRequests.length, skipped),
    }
  }

  try {
    // Keep this static dynamic import inside the eligible-only branch. Next.js
    // emits both the official drug snapshot and governed ATC hierarchy as an
    // async worker chunk instead of adding them to initial application JS.
    const terminology = await import(
      '@/vendor/nhi-fhir-bridge-nhi-drug-terminology/src/index'
    )
    const uniqueInputs = [
      ...new Map(
        candidates.map((candidate) => [
          candidate.lookupKey,
          {
            nhiDrugCode: candidate.nhiDrugCode,
            prescriptionDate: candidate.prescriptionDate,
          },
        ]),
      ).entries(),
    ]
    const latestCoveredDate =
      terminology.NHI_DRUG_TERMINOLOGY_MANIFEST.latestCoveredDate
    const { resolutions } = terminology.resolveManyNhiDrugTerminologies(
      uniqueInputs.map(([, input]) => ({
        ...input,
        prescriptionDate: input.prescriptionDate > latestCoveredDate
          ? latestCoveredDate
          : input.prescriptionDate,
      })),
    )
    const resolutionByKey = new Map(
      uniqueInputs.map(([key], index) => [key, resolutions[index]]),
    )

    const nextEntries = [...entries]
    const knowledgeById = new Map<string, FhirResource>()
    const knowledgeEntryIndexById = new Map<string, number>()
    for (const [entryIndex, entry] of entries.entries()) {
      if (
        entry.resource?.resourceType === 'MedicationKnowledge'
        && typeof entry.resource.id === 'string'
      ) {
        knowledgeById.set(entry.resource.id, entry.resource)
        knowledgeEntryIndexById.set(entry.resource.id, entryIndex)
      }
    }

    const generatedKnowledge = new Map<string, FhirResource>()
    const linkedKnowledge = new Map<string, FhirResource>()
    const byResolutionStatus:
      Partial<Record<NhiDrugTerminologyResolutionStatus, number>> = {}
    let linkedRequestCount = 0
    let atcResolvedCount = 0
    let sourceAtcFallbackCount = 0
    const officiallyLinkedEntryIndexes = new Set<number>()

    for (const candidate of candidates) {
      const resolution = resolutionByKey.get(candidate.lookupKey)
      if (!resolution) continue
      byResolutionStatus[resolution.status] =
        (byResolutionStatus[resolution.status] ?? 0) + 1
      if (resolution.status !== 'resolved' || !resolution.record) continue

      const knowledge = withAppEnrichmentPolicyTag(
        terminology.buildMedicationKnowledge(
          resolution.record,
        ) as FhirResource,
      )
      if (typeof knowledge.id !== 'string' || !knowledge.id) continue
      const existingKnowledge = knowledgeById.get(knowledge.id)
      const existingHasHierarchyTag = Array.isArray(
        (existingKnowledge as any)?.meta?.tag,
      ) && (existingKnowledge as any).meta.tag.some(
        (tag: any) =>
          tag?.system === ATC_HIERARCHY_TAG_SYSTEM
          && typeof tag?.code === 'string',
      )
      const existingHasCurrentPolicyTag = Array.isArray(
        (existingKnowledge as any)?.meta?.tag,
      ) && (existingKnowledge as any).meta.tag.some(
        (tag: any) =>
          tag?.system === NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM
          && tag?.code === NHI_DRUG_ENRICHMENT_POLICY_VERSION,
      )
      const existingClassifications = Array.isArray(
        (existingKnowledge as any)?.medicineClassification?.[0]?.classification,
      )
        ? (existingKnowledge as any).medicineClassification[0].classification
        : []
      const existingHasFullAtc = existingClassifications.some(
        (classification: any) =>
          Array.isArray(classification?.coding)
          && classification.coding.some(
            (coding: any) =>
              coding?.system === 'http://www.whocc.no/atc'
              && typeof coding?.code === 'string'
              && /^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(coding.code),
          ),
      )
      const existingHasLevel2 = existingClassifications.some(
        (classification: any) =>
          Array.isArray(classification?.coding)
          && classification.coding.some(
            (coding: any) =>
              coding?.system === 'http://www.whocc.no/atc'
              && typeof coding?.code === 'string'
              && /^[A-Z]\d{2}$/.test(coding.code),
          ),
      )
      const existingHasLevel3 = existingClassifications.some(
        (classification: any) =>
          Array.isArray(classification?.coding)
          && classification.coding.some(
            (coding: any) =>
              coding?.system === 'http://www.whocc.no/atc'
              && typeof coding?.code === 'string'
              && /^[A-Z]\d{2}[A-Z]$/.test(coding.code),
          ),
      )
      const existingHasLevel4 = existingClassifications.some(
        (classification: any) =>
          Array.isArray(classification?.coding)
          && classification.coding.some(
            (coding: any) =>
              coding?.system === 'http://www.whocc.no/atc'
              && typeof coding?.code === 'string'
              && /^[A-Z]\d{2}[A-Z]{2}$/.test(coding.code),
          ),
      )
      const existingIsCurrent = existingHasHierarchyTag
        && existingHasCurrentPolicyTag
        && (!existingHasFullAtc
          || (existingHasLevel2 && existingHasLevel3 && existingHasLevel4))
      const effectiveKnowledge =
        existingKnowledge && existingIsCurrent ? existingKnowledge : knowledge
      if (!existingKnowledge) {
        generatedKnowledge.set(knowledge.id, knowledge)
        knowledgeById.set(knowledge.id, knowledge)
      } else if (!existingIsCurrent) {
        const existingIndex = knowledgeEntryIndexById.get(knowledge.id)
        if (existingIndex !== undefined) {
          nextEntries[existingIndex] = {
            ...nextEntries[existingIndex],
            resource: knowledge,
          }
        }
        knowledgeById.set(knowledge.id, knowledge)
      }
      linkedKnowledge.set(knowledge.id, effectiveKnowledge)
      const linked = terminology.linkMedicationRequestToKnowledge(
        candidate.resource,
        effectiveKnowledge,
      ) as FhirResource
      nextEntries[candidate.entryIndex] = {
        ...nextEntries[candidate.entryIndex],
        resource: linked,
      }
      linkedRequestCount += 1
      officiallyLinkedEntryIndexes.add(candidate.entryIndex)
      if (resolution.record.atcCode) atcResolvedCount += 1
    }

    for (const candidate of sourceAtcCandidates) {
      if (officiallyLinkedEntryIndexes.has(candidate.entryIndex)) continue
      const level2 = terminology.resolveAtcLevel2(candidate.atcCode)
      const level3 = terminology.resolveAtcLevel3(candidate.atcCode)
      const level4 = terminology.resolveAtcLevel4(candidate.atcCode)
      if (!level2 || !level4) continue

      const currentEntry = nextEntries[candidate.entryIndex]
      if (!currentEntry) continue
      const currentResource = currentEntry.resource ?? candidate.resource
      nextEntries[candidate.entryIndex] = {
        ...currentEntry,
        resource: {
          ...currentResource,
          atcClassification: {
            source: 'source-who-atc',
            atcCode: candidate.atcCode,
            ...(candidate.atcNameEn ? { atcNameEn: candidate.atcNameEn } : {}),
            atcLevel2Code: level2.code,
            atcLevel2NameEn: level2.nameEn,
            ...(level2.nameZh ? { atcLevel2NameZh: level2.nameZh } : {}),
            ...(level3
              ? {
                  atcLevel3Code: level3.code,
                  atcLevel3NameEn: level3.nameEn,
                  ...(level3.nameZh ? { atcLevel3NameZh: level3.nameZh } : {}),
                }
              : {}),
            atcLevel4Code: level4.code,
            atcLevel4NameEn: level4.nameEn,
            ...(level4.nameZh ? { atcLevel4NameZh: level4.nameZh } : {}),
            atcHierarchySnapshotId: level4.hierarchySnapshotId,
          },
        },
      }
      sourceAtcFallbackCount += 1
    }

    for (const knowledge of generatedKnowledge.values()) {
      nextEntries.push({
        fullUrl: `urn:uuid:${knowledge.id}`,
        resource: knowledge,
      })
    }

    const recordedAt = options.recordedAt
      ?? (typeof bundle.timestamp === 'string' ? bundle.timestamp : undefined)
      ?? new Date().toISOString()
    const provenance = terminology.buildDrugTerminologyProvenance(
      [...linkedKnowledge.values()],
      recordedAt,
    ) as FhirResource | null
    if (
      provenance
      && typeof provenance.id === 'string'
    ) {
      const exactIndex = nextEntries.findIndex(
        (entry) =>
          entry.resource?.resourceType === 'Provenance'
          && entry.resource.id === provenance.id,
      )
      if (exactIndex < 0) {
        const targetReferences = new Set(
          Array.isArray((provenance as any).target)
            ? (provenance as any).target
              .map((target: any) => target?.reference)
              .filter((reference: unknown): reference is string =>
                typeof reference === 'string')
            : [],
        )
        const previousVersionIndex = nextEntries.findIndex((entry) => {
          const resource = entry.resource as any
          if (
            resource?.resourceType !== 'Provenance'
            || resource?.activity?.coding?.[0]?.code
              !== 'official-drug-master-lookup'
          ) return false
          const references = Array.isArray(resource.target)
            ? resource.target
              .map((target: any) => target?.reference)
              .filter((reference: unknown): reference is string =>
                typeof reference === 'string')
            : []
          return references.length === targetReferences.size
            && references.every((reference: string) =>
              targetReferences.has(reference))
        })
        const nextProvenanceEntry = {
          fullUrl: `urn:uuid:${provenance.id}`,
          resource: provenance,
        }
        if (previousVersionIndex >= 0) {
          nextEntries[previousVersionIndex] = nextProvenanceEntry
        } else {
          nextEntries.push(nextProvenanceEntry)
        }
      }
    }

    return {
      bundle: linkedRequestCount > 0 || sourceAtcFallbackCount > 0
        ? { ...bundle, entry: nextEntries }
        : bundle,
      report: {
        status: linkedRequestCount > 0 || sourceAtcFallbackCount > 0
          ? 'enriched'
          : 'not-applicable',
        snapshotId: terminology.NHI_DRUG_TERMINOLOGY_MANIFEST.snapshotId,
        medicationRequestCount: medicationRequests.length,
        eligibleRequestCount: candidates.length,
        linkedRequestCount,
        knowledgeResourceCount: generatedKnowledge.size,
        atcResolvedCount,
        sourceAtcFallbackCount,
        skipped,
        byResolutionStatus,
      },
    }
  } catch {
    // Terminology is supplemental. A cached deployment mismatch or unsupported
    // browser must never make the patient's source FHIR impossible to import.
    return {
      bundle,
      report: {
        status: 'unavailable',
        medicationRequestCount: medicationRequests.length,
        eligibleRequestCount: candidates.length,
        linkedRequestCount: 0,
        knowledgeResourceCount: 0,
        atcResolvedCount: 0,
        sourceAtcFallbackCount: 0,
        skipped,
        byResolutionStatus: {},
      },
    }
  }
}
