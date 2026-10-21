// claim-expander.ts
// TW-PAS (事前審查申請) support — a pure preprocessor that "unpacks" a Claim
// resource into the standard FHIR resources the rest of the app already
// renders. See https://twcore.mohw.gov.tw/ig/pas/ (Claim-twpas profile).
//
// WHY A PREPROCESSOR, NOT A NEW ENTITY/PANEL:
//   A TW-PAS Claim is essentially standard clinical data wrapped in an
//   insurance-application envelope — its `diagnosis[]` is a Condition, its
//   `procedure[]` is a Procedure, its weight/height `supportingInfo` are
//   vital-sign Observations, and the long `diagnosis.type.text` narrative is a
//   clinical note. Without this step every one of those is silently dropped
//   (the app has no Claim mapper), so a PAS bundle shows almost nothing.
//   By synthesising real Condition/Procedure/Observation/DocumentReference
//   resources and injecting them into the entry list BEFORE parse() runs its
//   byType() split, the existing FhirMapper, encounter-linking, data-selection
//   and AI-context paths all pick them up with ZERO further changes.
//
// This runs after canonicalizeBundleResources (so every reference here is
// already the relative `ResourceType/id` form) and before attachReferenceDisplays.
// It MUTATES the passed entry array in place, appending the synthesised
// resources. Ids are deterministic (derived from the Claim id) so repeated
// parse() calls — React Query re-parses the cached bundle — stay stable.
//
// KNOWN SOURCE-DATA LIMITATIONS (not fixable here — flag to whoever exports the
// bundle):
//   - presentedForm / DocumentReference PDFs use `file://` local paths, which a
//     browser cannot fetch; those cards can only show a title, not the PDF.
//   - The PAS Encounter often ships without period.start / subject; we backfill
//     the visit date from Claim.created (a display-layer inference).
import { encodeBase64Utf8 } from '@/src/shared/utils/base64.utils'

// Standard vital-sign LOINC codes — kept in sync with the app's own vitals
// matcher (features/clinical-summary/vitals/types → LOINC.WEIGHT / .HEIGHT).
// Hardcoded rather than imported to avoid an infrastructure→feature dependency.
const unresolvedClaimEncounters = new WeakSet<object>()
const unresolvedClaimEncounter = Symbol('unresolved-claim-encounter')
export function hasUnresolvedClaimEncounter(resource: unknown): boolean {
  return Boolean(resource && typeof resource === 'object' && (unresolvedClaimEncounters.has(resource) || (resource as any)[unresolvedClaimEncounter] === true))
}
const claimEncounterLinks = new WeakMap<object, string>()
const claimEncounterLink = Symbol('claim-derived-encounter-link')
/** Only the trusted Claim expander can grant this domain-derived link. */
export function bindClaimEncounterLink<T extends object>(mapped: T, resource: object): T {
  if (hasUnresolvedClaimEncounter(resource)) Object.assign(mapped, { [unresolvedClaimEncounter]: true })
  const reference = claimEncounterLinks.get(resource)
  return reference ? Object.assign(mapped, { [claimEncounterLink]: reference }) : mapped
}
export function hasClaimEncounterLink(row: object & { encounter?: { reference?: string } }): boolean {
  return Boolean((row as any)[claimEncounterLink] && (row as any)[claimEncounterLink] === row.encounter?.reference)
}

const LOINC_BODY_WEIGHT = '29463-7'
const LOINC_BODY_HEIGHT = '8302-2'

// TW-PAS extension urls.
const EXT_CLAIM_ENCOUNTER =
  'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter'
const EXT_DIAGNOSIS_RECORDED_DATE =
  'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-diagnosisRecordedDate'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function findExtension(node: any, url: string): any | undefined {
  const exts = Array.isArray(node?.extension) ? node.extension : []
  return exts.find((e: any) => e?.url === url)
}

/**
 * Expand every Claim in `entries` into standard FHIR resources, appended to
 * `entries` in place. Non-Claim bundles are untouched (the loop finds nothing).
 */
export function expandClaimResources(entries: any[], resolveClaimTarget: (claim: object, path: string, resourceType: string) => any | undefined = () => undefined): void {
  const claims = entries.filter((r) => r?.resourceType === 'Claim')
  if (!claims.length) return

  const synthesised: any[] = []

  for (const claim of claims) {
    const synthesisedStart = synthesised.length
    const claimId: string = claim.id || 'claim'
    const patientRef: string | undefined = claim.patient?.reference
    const created: string | undefined = claim.created
    const subject = patientRef ? { reference: patientRef } : undefined

    // The Claim links its visit via an extension, not the usual encounter field.
    const encounterRef: string | undefined = findExtension(claim, EXT_CLAIM_ENCOUNTER)
      ?.valueReference?.reference

    const encounterIndex = claim.extension?.findIndex((extension: any) => extension.url === EXT_CLAIM_ENCOUNTER)
    const resolvedEncounter = resolveClaimTarget(claim, `extension[${encounterIndex}].valueReference`, 'Encounter')
    const canLinkEncounter = Boolean(resolvedEncounter && encounterRef === 'Encounter/' + resolvedEncounter.id)
    const encounter = canLinkEncounter && encounterRef ? { reference: encounterRef } : undefined

    // --- Backfill the PAS Encounter (usually has no period.start / subject) ---
    if (canLinkEncounter) {
      const enc = resolvedEncounter
      if (enc) {
        if (!enc.period?.start && created) enc.period = { ...(enc.period ?? {}), start: created }
        if (!enc.subject && subject) enc.subject = subject
      }
    }

    // --- diagnosis[] → Condition (+ collect the narrative for a document) ---
    const diagnoses: any[] = Array.isArray(claim.diagnosis) ? claim.diagnosis : []
    const narrativeParts: string[] = []
    diagnoses.forEach((dx, i) => {
      const seq = dx?.sequence ?? i + 1
      const recordedDate: string | undefined = findExtension(dx, EXT_DIAGNOSIS_RECORDED_DATE)
        ?.valueDate
      const code = dx?.diagnosisCodeableConcept
      if (code) {
        synthesised.push({
          resourceType: 'Condition',
          id: `claim-${claimId}-condition-${seq}`,
          clinicalStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                code: 'active',
              },
            ],
          },
          verificationStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
                code: 'confirmed',
              },
            ],
          },
          category: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                  code: 'encounter-diagnosis',
                },
              ],
            },
          ],
          code,
          subject,
          encounter,
          recordedDate: recordedDate ?? created,
          onsetDateTime: recordedDate,
        })
      }
      // The申請理由/病摘 narrative rides in diagnosis.type[].text.
      const dxLabel =
        code?.coding?.[0]?.display || code?.text || ''
      const types: any[] = Array.isArray(dx?.type) ? dx.type : []
      for (const t of types) {
        if (typeof t?.text === 'string' && t.text.trim()) {
          narrativeParts.push(
            (dxLabel ? `<p><strong>${escapeHtml(dxLabel)}</strong></p>` : '') +
              `<p>${escapeHtml(t.text.trim())}</p>`,
          )
        }
      }
    })

    // --- narrative → an inline text/html DocumentReference (readable + AI) ---
    if (narrativeParts.length) {
      const html = narrativeParts.join('')
      synthesised.push({
        resourceType: 'DocumentReference',
        id: `claim-${claimId}-narrative`,
        status: 'current',
        type: { text: '事前審查申請病摘' },
        category: [{ text: '事前審查申請' }],
        subject,
        date: created,
        content: [
          {
            attachment: {
              contentType: 'text/html',
              data: encodeBase64Utf8(html),
              title: '事前審查申請病摘／申請理由',
            },
          },
        ],
        context: {
          ...(encounter ? { encounter: [encounter] } : {}),
          ...(created ? { period: { start: created } } : {}),
        },
      })
    }

    // --- procedure[] → Procedure ---
    const procedures: any[] = Array.isArray(claim.procedure) ? claim.procedure : []
    procedures.forEach((proc, i) => {
      const seq = proc?.sequence ?? i + 1
      const code = proc?.procedureCodeableConcept
      if (!code) return
      synthesised.push({
        resourceType: 'Procedure',
        id: `claim-${claimId}-procedure-${seq}`,
        status: 'completed',
        code,
        subject,
        encounter,
        performedDateTime: proc?.date ?? created,
      })
    })

    // --- supportingInfo weight/height → vital-sign Observations ---
    const supporting: any[] = Array.isArray(claim.supportingInfo) ? claim.supportingInfo : []
    for (const si of supporting) {
      const cat: string | undefined = si?.category?.coding?.[0]?.code
      const q = si?.valueQuantity
      if (!q || (cat !== 'weight' && cat !== 'height')) continue
      const isWeight = cat === 'weight'
      synthesised.push({
        resourceType: 'Observation',
        id: `claim-${claimId}-${cat}`,
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: isWeight ? LOINC_BODY_WEIGHT : LOINC_BODY_HEIGHT,
              display: isWeight ? 'Body weight' : 'Body height',
            },
          ],
          text: isWeight ? '體重' : '身高',
        },
        subject,
        encounter,
        effectiveDateTime: created,
        // Source omits `unit`; mirror the UCUM `code` so the value renders with
        // its unit (kg / cm) instead of a bare number.
        valueQuantity: { ...q, unit: q.unit ?? q.code },
      })
    }

    // --- item[] → backfill the requested MedicationRequest's date/visit ---
    // The申請 drug is a real MedicationRequest referenced from item.extension;
    // it already renders, but PAS omits authoredOn/encounter, so give it the
    // application date and link it to the visit for correct sorting/grouping.
    const items: any[] = Array.isArray(claim.item) ? claim.item : []
    for (const [itemIndex, item] of items.entries()) {
      // The requestedService extension points at the MedicationRequest; match
      // by any valueReference to a MedicationRequest rather than the exact url.
      const exts: any[] = Array.isArray(item?.extension) ? item.extension : []
      const extensionIndex = exts.findIndex(e => typeof e?.valueReference?.reference === 'string' && e.valueReference.reference.startsWith('MedicationRequest/'))
      const mr = resolveClaimTarget(claim, `item[${itemIndex}].extension[${extensionIndex}].valueReference`, 'MedicationRequest')
      if (!mr) continue
      if (!mr.encounter?.reference && encounterRef && !canLinkEncounter) unresolvedClaimEncounters.add(mr)
      if (!mr.authoredOn && created) mr.authoredOn = created
      if (!mr.encounter && encounter && canLinkEncounter) {
        mr.encounter = encounter
        if (/^Encounter\/[^/]+$/.test(encounter.reference) && canLinkEncounter) claimEncounterLinks.set(mr, encounter.reference)
      }
    }
    for (const resource of synthesised.slice(synthesisedStart)) {
      if (encounterRef && !canLinkEncounter) unresolvedClaimEncounters.add(resource)
      const reference = resource.encounter?.reference
      if (typeof reference === 'string' && /^Encounter\/[^/]+$/.test(reference) && canLinkEncounter) claimEncounterLinks.set(resource, reference)
    }
  }
  entries.push(...synthesised)
}
