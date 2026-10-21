// IPS reverse mappers: ClinicalDataCollection entities -> FHIR resources with
// meta.profile, ready to drop into an IPS document Bundle.
//
// Phase 1 rule: reuse codings already present on the entities (ICD-10, LOINC,
// etc.). Do NOT fabricate or invent codes — in particular no SNOMED CT concept
// ids are generated here (that is Phase 2, gated by the SNOMED verification SOP).

import type {
  PatientEntity,
} from '@/src/core/entities/patient.entity'
import { getPatientDisplayName, isDeidentifiedPatient } from '@/src/core/entities/patient.entity'
import type {
  AllergyEntity,
  CarePlanEntity,
  ConditionEntity,
  ConsentEntity,
  DeviceEntity,
  DiagnosticReportEntity,
  ImmunizationEntity,
  MedicationEntity,
  ObservationEntity,
  ProcedureEntity,
} from '@/src/core/entities/clinical-data.entity'
import type {
  FhirCodeableConcept,
  FhirResource,
  IpsBundleEntry,
  SectionMapResult,
} from './ips-types'
import { CLINICAL_RECORD_VARIANT_EXTENSION, INFERENCE_TAG, IPS_PROFILES, SYSTEM, VITAL_SIGNS_PROFILE } from './ips-constants'
import { sourceComparisonNarrative } from '@/src/shared/utils/source-record-comparison'
import { sourceSelfPurchase } from '@/src/shared/utils/medication-source-markers'
import { escapeHtml, formatDate, makeEntry } from './ips-helpers'
import { medicationDirectionsForFhir } from './medication-display'
import { medicationExportUnit, sourceSupplyText, type ExportMedication } from './medication-source-records'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** App-defined FHIR extension: ambiguity is retained without inventing a preferred revision. */
export { CLINICAL_RECORD_VARIANT_EXTENSION } from './ips-constants'
function recordVariantExtension(row: { sourceId?: string; sourceVersionId?: string; _sourceResourceType?: string; clinicalRecordVariant?: import('@/src/core/entities/clinical-data.entity').ClinicalRecordVariant }): Record<string, unknown> {
  const variant = row.clinicalRecordVariant
  return variant ? { modifierExtension: [{ url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: [
    { url: 'groupId', valueString: variant.groupId },
    { url: 'classification', valueCode: variant.classification },
    { url: 'variantCount', valuePositiveInt: variant.variantCount },
    { url: 'reason', valueString: variant.reason },
    ...(row.sourceId ? [{ url: 'sourceId', valueString: row.sourceId }] : []),
    ...(row.sourceVersionId ? [{ url: 'versionId', valueString: row.sourceVersionId }] : []),
    ...(row._sourceResourceType ? [{ url: 'sourceResourceType', valueCode: row._sourceResourceType }] : []),
  ] }] } : {}
}

const DATA_ABSENT_REASON_URL = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason'
const DATA_ABSENT_CC: FhirCodeableConcept = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }],
}

/**
 * Spread helper for a required dateTime element. When the value is missing we
 * emit the primitive's sibling element with a data-absent-reason extension so
 * the 1..1 cardinality is satisfied without inventing a date.
 */
function requiredDateTime(field: string, value?: string): Record<string, unknown> {
  const formatted = value ? formatDate(value) : ''
  if (formatted) return { [field]: formatted }
  return { [`_${field}`]: { extension: [{ url: DATA_ABSENT_REASON_URL, valueCode: 'unknown' }] } }
}

/** Build a clean CodeableConcept; returns undefined when there is nothing usable. */
function toCodeableConcept(
  cc:
    | { text?: string; coding?: Array<{ code?: string; display?: string; system?: string }> }
    | undefined,
  fallbackText?: string,
): FhirCodeableConcept | undefined {
  const coding = (cc?.coding ?? [])
    .filter((c) => c && (c.code || c.display))
    .map((c) => ({
      ...(c.system ? { system: c.system } : {}),
      ...(c.code ? { code: c.code } : {}),
      ...(c.display ? { display: c.display } : {}),
    }))
  const text = cc?.text?.trim() || fallbackText?.trim()
  const out: FhirCodeableConcept = {}
  if (coding.length) out.coding = coding
  if (text) out.text = text
  return out.coding || out.text ? out : undefined
}

const VALID_CONDITION_CLINICAL = new Set([
  'active',
  'recurrence',
  'relapse',
  'inactive',
  'remission',
  'resolved',
])
function conditionClinicalStatus(raw?: string): FhirCodeableConcept {
  const code = raw && VALID_CONDITION_CLINICAL.has(raw.toLowerCase()) ? raw.toLowerCase() : 'active'
  return { coding: [{ system: SYSTEM.conditionClinical, code }] }
}

const VALID_ALLERGY_CLINICAL = new Set(['active', 'inactive', 'resolved'])
function allergyClinicalStatus(raw?: string): FhirCodeableConcept {
  const code = raw && VALID_ALLERGY_CLINICAL.has(raw.toLowerCase()) ? raw.toLowerCase() : 'active'
  return { coding: [{ system: SYSTEM.allergyClinical, code }] }
}

function pickStatus(raw: string | undefined, valid: string[], fallback: string): string {
  return raw && valid.includes(raw.toLowerCase()) ? raw.toLowerCase() : fallback
}

/** Observation value[x] or dataAbsentReason. */
function observationValueFields(o: ObservationEntity): Record<string, unknown> {
  if (o.valueQuantity && o.valueQuantity.value != null) {
    return {
      valueQuantity: {
        value: o.valueQuantity.value,
        ...(o.valueQuantity.unit ? { unit: o.valueQuantity.unit } : {}),
      },
    }
  }
  if (o.valueString && o.valueString.trim()) {
    return { valueString: o.valueString }
  }
  const vcc = toCodeableConcept(o.valueCodeableConcept)
  if (vcc) return { valueCodeableConcept: vcc }
  return { dataAbsentReason: DATA_ABSENT_CC }
}

function referenceRangeFields(o: Pick<ObservationEntity, 'referenceRange'>): Record<string, unknown> {
  if (!o.referenceRange?.length) return {}
  const ranges = o.referenceRange
    .map((r) => {
      const out: Record<string, unknown> = {}
      if (r.low?.value != null) out.low = { value: r.low.value, ...(r.low.unit ? { unit: r.low.unit } : {}) }
      if (r.high?.value != null) out.high = { value: r.high.value, ...(r.high.unit ? { unit: r.high.unit } : {}) }
      if (r.text) out.text = r.text
      return out
    })
    .filter((r) => Object.keys(r).length)
  return ranges.length ? { referenceRange: ranges } : {}
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

function patientIdentifiers(patient: PatientEntity | null): Array<Record<string, unknown>> | undefined {
  const identifiers = (patient?.identifier ?? [])
    .map((id) => {
      const coding = (id.type?.coding ?? [])
        .filter((c) => c?.system || c?.code)
        .map((c) => ({
          ...(c.system ? { system: c.system } : {}),
          ...(c.code ? { code: c.code } : {}),
        }))
      const typeText = id.type?.text?.trim()
      const type: Record<string, unknown> = {}
      if (coding.length) type.coding = coding
      if (typeText) type.text = typeText

      const out: Record<string, unknown> = {}
      if (id.system) out.system = id.system
      if (id.value) out.value = id.value
      if (Object.keys(type).length) out.type = type
      if (!out.system && !out.value && !out.type) return undefined
      if (id.use) out.use = id.use
      return out
    })
    .filter((id): id is Record<string, unknown> => Boolean(id))
  return identifiers.length ? identifiers : undefined
}

export function buildPatient(
  patient: PatientEntity | null,
  options: { includeIdentifiers?: boolean; maskedLabel?: string } = {},
): { entry: IpsBundleEntry; reference: string } {
  const includeIdentifiers = options.includeIdentifiers !== false
  const deidentified = patient ? isDeidentifiedPatient(patient) : false
  const name = patient?.name?.[0]
  // Carry whatever the source had — text (TW Core/IPS local-script name),
  // family, given — so a round-trip never drops the name. Only when there is
  // no usable name at all do we fall back to the "Unknown Patient" sentinel.
  const nameArray = !includeIdentifiers
    ? [{ ...(deidentified ? { use: 'anonymous' } : {}), text: options.maskedLabel || 'Identity masked by the exporter' }]
    : name && (name.text || name.family || name.given?.length)
      ? [
          {
            ...(deidentified ? { use: 'anonymous' } : {}),
            ...(name.text ? { text: name.text } : {}),
            ...(name.family ? { family: name.family } : {}),
            ...(name.given?.length ? { given: name.given } : {}),
          },
        ]
      : [{ ...(deidentified ? { use: 'anonymous' } : {}), text: getPatientDisplayName(patient) }]
  const identifiers = includeIdentifiers ? patientIdentifiers(patient) : undefined

  const resource: FhirResource = {
    resourceType: 'Patient',
    meta: {
      profile: [IPS_PROFILES.patient],
      ...(patient?.demographicsSource === 'user-entered-local-profile'
        ? {
            tag: [{
              system: 'https://mediprisma.app/fhir/CodeSystem/data-origin',
              code: 'user-entered-local-profile',
              display: 'User-entered local patient profile',
            }],
          }
        : {}),
    },
    name: nameArray,
    text: {
      status: 'generated',
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(nameArray[0]?.text || getPatientDisplayName(patient))}</p></div>`,
    },
    ...(identifiers ? { identifier: identifiers } : {}),
    ...(patient?.gender ? { gender: patient.gender } : {}),
    ...(includeIdentifiers && patient?.birthDate ? { birthDate: formatDate(patient.birthDate) } : {}),
  }
  return makeEntry(resource)
}

// ---------------------------------------------------------------------------
// Allergies & Intolerances (required section)
// ---------------------------------------------------------------------------

export function mapAllergies(allergies: AllergyEntity[], patientRef: string): SectionMapResult {
  const entries = allergies.map((a) => {
    const reaction = a.reaction
      ?.map((r) => {
        const manifestation = (r.manifestation ?? [])
          .map((m) => toCodeableConcept({ text: m.text }))
          .filter(Boolean)
        if (!manifestation.length) return undefined
        return {
          manifestation,
          ...(r.severity ? { severity: r.severity } : {}),
        }
      })
      .filter(Boolean)

    const resource: FhirResource = {
      resourceType: 'AllergyIntolerance',
      ...recordVariantExtension(a),
      meta: { profile: [IPS_PROFILES.allergyIntolerance] },
      clinicalStatus: allergyClinicalStatus(a.clinicalStatus),
      ...(a.verificationStatus
        ? {
            verificationStatus: {
              coding: [{ system: SYSTEM.allergyVerification, code: a.verificationStatus.toLowerCase() }],
            },
          }
        : {}),
      code: toCodeableConcept(a.code, 'Unknown allergy/intolerance') ?? { text: 'Unknown allergy/intolerance' },
      patient: { reference: patientRef },
      ...(a.criticality ? { criticality: a.criticality } : {}),
      ...(a.recordedDate ? { recordedDate: formatDate(a.recordedDate) } : {}),
      ...(reaction && reaction.length ? { reaction } : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Medication Summary (required section) — emitted as MedicationStatement
// ---------------------------------------------------------------------------

const VALID_MED_STATEMENT_STATUS = [
  'active',
  'completed',
  'entered-in-error',
  'intended',
  'stopped',
  'on-hold',
  'unknown',
  'not-taken',
]

export function mapMedications(medications: MedicationEntity[], patientRef: string): SectionMapResult {
  const makeStatement = (m: ExportMedication): FhirResource => {
    const directions = medicationDirectionsForFhir(m)
    const dosage = m.exportOriginalDosage ? m.dosageInstruction : directions ? [{ text: directions }] : undefined
    const notes = [m.exportSourceLabel, sourceComparisonNarrative(m), sourceSupplyText(m), sourceSelfPurchase(m) === true ? '來源明列自費／自購（self-pay）' : undefined,
      `Original source order status: ${m.status || 'unknown'}; actual medication use has not been verified.`,
      ...(m.note ?? []).map(note => note.text)]
      .filter((text): text is string => Boolean(text)).map((text) => ({ text }))

    const resource: FhirResource = {
      resourceType: 'MedicationStatement',
      ...recordVariantExtension(m),
      meta: { profile: [IPS_PROFILES.medicationStatement] },
      status: m.exportCurrentnessUnconfirmed ? 'unknown' : pickStatus(m.status, VALID_MED_STATEMENT_STATUS, 'unknown'),
      medicationCodeableConcept:
        toCodeableConcept(m.medicationCodeableConcept, 'Unknown medication') ?? { text: 'Unknown medication' },
      subject: { reference: patientRef },
      ...(m.identifier?.length ? { identifier: m.identifier } : {}),
      ...requiredDateTime('effectiveDateTime', m.authoredOn),
      ...(dosage ? { dosage } : {}),
      ...(notes.length ? { note: notes } : {}),
    }
    return resource
  }
  const entries = medications.map(m => {
    const { canonical, sources } = medicationExportUnit(m)
    const resource = makeStatement(canonical)
    if (sources.length) {
      const contained = sources.map((source, index) => ({ ...makeStatement(source), id: `source-${index + 1}` }))
      resource.contained = contained
      resource.derivedFrom = contained.map(source => ({ reference: `#${source.id}` }))
    }
    return makeEntry(resource).entry
  })
  const groups = new Map<string, { status: string; references: string[] }>()
  medications.forEach((medication, index) => {
    const comparison = medication._sourceRecordComparison
    if (!comparison || comparison.status === 'confirmed') return
    const key = [...comparison.references].sort().join('|')
    const group = groups.get(key) ?? { status: comparison.status, references: [] }
    group.references.push(entries[index].fullUrl)
    groups.set(key, group)
  })
  const referencedOnly = [...groups.values()].filter(group => group.references.length > 1).map(group => makeEntry({
    resourceType: 'Provenance',
    target: group.references.map(reference => ({ reference })),
    recorded: new Date().toISOString(),
    activity: { coding: [{ system: 'urn:mediprisma:source-comparison-status', code: group.status }],
      text: 'Unconfirmed cross-source comparison; distinct prescriptions may exist. Do not sum source quantities.' },
    agent: [{ who: { display: 'MediPrisma' } }],
  }).entry)
  return { entries, referencedOnly }
}

// ---------------------------------------------------------------------------
// Problem List (required section)
// ---------------------------------------------------------------------------

/**
 * Build the IPS Condition.code. The problem list is text-only from the app's
 * side: the app NEVER generates or attaches SNOMED CT codes. Any coding present
 * on the source Condition.code (ICD-10 etc.) is preserved as-is; a condition
 * with no source coding stays a text-only CodeableConcept.
 */
function problemCode(c: ConditionEntity): FhirCodeableConcept {
  return toCodeableConcept(c.code, 'Unknown problem') ?? { text: 'Unknown problem' }
}

export function mapProblemList(conditions: ConditionEntity[], patientRef: string): SectionMapResult {
  const entries = conditions.map((c) => {
    const conditionLabel = c.code?.text || c.code?.coding?.[0]?.display || c.code?.coding?.[0]?.code || 'Unknown problem'
    const resource: FhirResource = {
      resourceType: 'Condition',
      ...recordVariantExtension(c),
      meta: {
        profile: [IPS_PROFILES.condition],
        // Phase 2.2 — flag a confirmed AI-inferred problem for downstream audit.
        ...(c._inferred
          ? { tag: [{ system: INFERENCE_TAG.system, code: INFERENCE_TAG.code, display: INFERENCE_TAG.display }] }
          : {}),
      },
      clinicalStatus: conditionClinicalStatus(c.clinicalStatus),
      ...(c.verificationStatus
        ? {
            verificationStatus: {
              coding: [{ system: SYSTEM.conditionVerification, code: c.verificationStatus.toLowerCase() }],
            },
          }
        : {}),
      category: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] },
      ],
      code: problemCode(c),
      text: {
        status: 'generated',
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(conditionLabel)}</p></div>`,
      },
      subject: { reference: patientRef },
      ...(c.onsetDateTime ? { onsetDateTime: formatDate(c.onsetDateTime) } : {}),
      ...(c.recordedDate ? { recordedDate: formatDate(c.recordedDate) } : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Immunizations
// ---------------------------------------------------------------------------

export function mapImmunizations(immunizations: ImmunizationEntity[], patientRef: string): SectionMapResult {
  const entries = immunizations.map((im) => {
    const resource: FhirResource = {
      resourceType: 'Immunization',
      ...recordVariantExtension(im),
      meta: { profile: [IPS_PROFILES.immunization] },
      status: pickStatus(im.status, ['completed', 'entered-in-error', 'not-done'], 'completed'),
      vaccineCode: toCodeableConcept(im.vaccineCode, 'Unknown vaccine') ?? { text: 'Unknown vaccine' },
      patient: { reference: patientRef },
      ...requiredDateTime('occurrenceDateTime', im.occurrenceDateTime),
      ...(im.lotNumber ? { lotNumber: im.lotNumber } : {}),
      // Reference(Organization): prefer display; fall back to the raw
      // reference rather than silently dropping the manufacturer when a
      // bridge sends only `reference` (FHIR allows either).
      ...(im.manufacturer?.display
        ? { manufacturer: { display: im.manufacturer.display } }
        : im.manufacturer?.reference
          ? { manufacturer: { reference: im.manufacturer.reference } }
          : {}),
      ...(im.note?.length ? { note: im.note.filter((n) => n.text).map((n) => ({ text: n.text })) } : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export function mapProcedures(procedures: ProcedureEntity[], patientRef: string): SectionMapResult {
  const entries = procedures.map((p) => {
    const performed =
      p.performedDateTime
        ? { performedDateTime: formatDate(p.performedDateTime) }
        : p.performedPeriod?.start || p.performedPeriod?.end
          ? {
              performedPeriod: {
                ...(p.performedPeriod?.start ? { start: formatDate(p.performedPeriod.start) } : {}),
                ...(p.performedPeriod?.end ? { end: formatDate(p.performedPeriod.end) } : {}),
              },
            }
          : {}

    const resource: FhirResource = {
      resourceType: 'Procedure',
      ...recordVariantExtension(p),
      meta: { profile: [IPS_PROFILES.procedure] },
      status: pickStatus(
        p.status,
        ['preparation', 'in-progress', 'not-done', 'on-hold', 'stopped', 'completed', 'entered-in-error', 'unknown'],
        'completed',
      ),
      code: toCodeableConcept(p.code, 'Unknown procedure') ?? { text: 'Unknown procedure' },
      subject: { reference: patientRef },
      ...performed,
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Vital Signs (base FHIR vital-signs profile)
// ---------------------------------------------------------------------------

export function mapVitalSigns(vitalSigns: ObservationEntity[], patientRef: string): SectionMapResult {
  const entries = vitalSigns.map((o) => {
    const components = o.component
      ?.map((comp) => {
        const code = toCodeableConcept(comp.code)
        if (!code) return undefined
        return {
          code,
          ...observationValueFields(comp as ObservationEntity),
        }
      })
      .filter(Boolean)

    const resource: FhirResource = {
      resourceType: 'Observation',
      ...recordVariantExtension(o),
      meta: { profile: [VITAL_SIGNS_PROFILE] },
      status: pickStatus(o.status, ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'], 'final'),
      category: [{ coding: [{ system: SYSTEM.observationCategory, code: 'vital-signs' }] }],
      code: toCodeableConcept(o.code, 'Vital sign') ?? { text: 'Vital sign' },
      subject: { reference: patientRef },
      ...requiredDateTime('effectiveDateTime', o.effectiveDateTime),
      ...observationValueFields(o),
      ...referenceRangeFields(o),
      ...(components && components.length ? { component: components } : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Diagnostic Results — DiagnosticReports (+ their observations) and lab observations
// ---------------------------------------------------------------------------

function buildResultObservation(
  o: ObservationEntity,
  patientRef: string,
  profile: string,
  categoryCode: string,
): IpsBundleEntry {
  const resource: FhirResource = {
    resourceType: 'Observation',
    ...recordVariantExtension(o),
    meta: { profile: [profile] },
    status: pickStatus(o.status, ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'], 'final'),
    category: [{ coding: [{ system: SYSTEM.observationCategory, code: categoryCode }] }],
    code: toCodeableConcept(o.code, 'Result') ?? { text: 'Result' },
    subject: { reference: patientRef },
    ...requiredDateTime('effectiveDateTime', o.effectiveDateTime),
    ...observationValueFields(o),
    ...referenceRangeFields(o),
    ...(o.interpretation
      ? { interpretation: [toCodeableConcept(o.interpretation)].filter(Boolean) }
      : {}),
  }
  return makeEntry(resource).entry
}

export interface MapResultsOptions {
  /** Opt-in: also carry image/* presentedForm attachments (default: stripped). */
  includeImageAttachments?: boolean
}

/**
 * DiagnosticReport.presentedForm for the IPS export.
 *
 * 預設剝除 image/* 附件(健保存摺 X 光/心電圖 base64 JPEG 每張 2-3 MB,會把
 * IPS 撐到數十 MB),保留 conclusion 與 text/*(及其他非影像,如 PDF)附件 —
 * Roche DIP 的 base64 text/plain 報告內文因此不會遺失。使用者可在匯出 tab 以
 * 「包含影像附件」opt-in 帶回影像。
 *
 * 一律排除:沒有 inline `data` 的附件(本地匯入路徑會把 base64 搬進 IndexedDB
 * 並以 app-local `_imageRef` 取代 — 匯出檔帶一個空殼附件沒有意義),以及
 * `_imageRef` 這個 app-local 欄位本身(不是 FHIR Attachment 的欄位)。
 */
function presentedFormFields(
  dr: DiagnosticReportEntity,
  includeImageAttachments: boolean,
): Record<string, unknown> {
  const attachments = (dr.presentedForm ?? [])
    .filter((a) => !!a?.data)
    .filter((a) => includeImageAttachments || !(a.contentType ?? '').toLowerCase().startsWith('image/'))
    .map((a) => ({
      ...(a.contentType ? { contentType: a.contentType } : {}),
      data: a.data,
      ...(a.title ? { title: a.title } : {}),
      ...(a.size != null ? { size: a.size } : {}),
    }))
  return attachments.length ? { presentedForm: attachments } : {}
}

export function mapResults(
  diagnosticReports: DiagnosticReportEntity[],
  labObservations: ObservationEntity[],
  patientRef: string,
  options: MapResultsOptions = {},
): SectionMapResult {
  const entries: IpsBundleEntry[] = []
  const referencedOnly: IpsBundleEntry[] = []

  // Standalone lab observations -> Observation entries in the Results section.
  for (const o of labObservations) {
    entries.push(buildResultObservation(o, patientRef, IPS_PROFILES.observationResultsLaboratory, 'laboratory'))
  }

  // DiagnosticReports -> DiagnosticReport entries; their observations are added
  // to the Bundle (referencedOnly) and linked via DiagnosticReport.result.
  for (const dr of diagnosticReports) {
    const resultRefs: Array<{ reference: string }> = []
    for (const obs of dr._observations ?? []) {
      // Member observations of 健保存摺 / EHR reports are lab panel values, not
      // imaging. Default to the laboratory result profile (the previous
      // radiology/imaging hardcode mis-categorised every lab value).
      const obsEntry = buildResultObservation(obs, patientRef, IPS_PROFILES.observationResultsLaboratory, 'laboratory')
      referencedOnly.push(obsEntry)
      resultRefs.push({ reference: obsEntry.fullUrl })
    }

    const resource: FhirResource = {
      resourceType: 'DiagnosticReport',
      ...recordVariantExtension(dr),
      meta: { profile: [IPS_PROFILES.diagnosticReport] },
      status: pickStatus(dr.status, ['registered', 'partial', 'preliminary', 'final', 'amended', 'corrected', 'appended', 'cancelled', 'entered-in-error', 'unknown'], 'final'),
      code: toCodeableConcept(dr.code, 'Diagnostic report') ?? { text: 'Diagnostic report' },
      subject: { reference: patientRef },
      ...requiredDateTime('effectiveDateTime', dr.effectiveDateTime),
      ...(dr.issued ? { issued: dr.issued } : {}),
      ...(dr.conclusion ? { conclusion: dr.conclusion } : {}),
      ...(resultRefs.length ? { result: resultRefs } : {}),
      ...presentedFormFields(dr, !!options.includeImageAttachments),
    }
    entries.push(makeEntry(resource).entry)
  }

  return { entries, referencedOnly }
}

// ---------------------------------------------------------------------------
// Medical Devices — DeviceUseStatement (+ referenced Device)
// ---------------------------------------------------------------------------

export function mapDevices(devices: DeviceEntity[], patientRef: string): SectionMapResult {
  const entries: IpsBundleEntry[] = []
  const referencedOnly: IpsBundleEntry[] = []

  for (const d of devices) {
    const deviceName = d.deviceName?.find((n) => n.name)?.name
    const deviceResource: FhirResource = {
      resourceType: 'Device',
      ...recordVariantExtension(d),
      meta: { profile: [IPS_PROFILES.device] },
      ...(d.type ? { type: toCodeableConcept(d.type, deviceName || 'Device') } : deviceName ? { type: { text: deviceName } } : { type: { text: 'Device' } }),
      ...(d.manufacturer ? { manufacturer: d.manufacturer } : {}),
      ...(d.modelNumber ? { modelNumber: d.modelNumber } : {}),
      ...(d.deviceName?.length
        ? { deviceName: d.deviceName.filter((n) => n.name).map((n) => ({ name: n.name, type: n.type || 'user-friendly-name' })) }
        : {}),
      ...(d.udiCarrier?.length ? { udiCarrier: d.udiCarrier } : {}),
    }
    const deviceEntry = makeEntry(deviceResource)
    referencedOnly.push(deviceEntry.entry)

    const useResource: FhirResource = {
      resourceType: 'DeviceUseStatement',
      ...recordVariantExtension(d),
      meta: { profile: [IPS_PROFILES.deviceUseStatement] },
      status: pickStatus(d.status, ['active', 'completed', 'entered-in-error', 'intended', 'stopped', 'on-hold'], 'active'),
      subject: { reference: patientRef },
      ...requiredDateTime('timingDateTime', d.manufactureDate),
      device: { reference: deviceEntry.reference },
      ...(d.note?.length ? { note: d.note.filter((n) => n.text).map((n) => ({ text: n.text })) } : {}),
    }
    entries.push(makeEntry(useResource).entry)
  }

  return { entries, referencedOnly }
}

// ---------------------------------------------------------------------------
// Plan of Care — CarePlan (base FHIR profile; IPS defines no CarePlan profile)
// ---------------------------------------------------------------------------

export function mapCarePlans(carePlans: CarePlanEntity[], patientRef: string): SectionMapResult {
  const entries = carePlans.map((cp) => {
    const resource: FhirResource = {
      resourceType: 'CarePlan',
      ...recordVariantExtension(cp),
      meta: { profile: [IPS_PROFILES.carePlan] },
      status: pickStatus(cp.status, ['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown'], 'active'),
      intent: pickStatus(cp.intent, ['proposal', 'plan', 'order', 'option'], 'plan'),
      subject: { reference: patientRef },
      ...(cp.title ? { title: cp.title } : {}),
      ...(cp.description ? { description: cp.description } : {}),
      ...(cp.category?.length ? { category: cp.category.map((c) => toCodeableConcept(c)).filter(Boolean) } : {}),
      ...(cp.period?.start || cp.period?.end
        ? {
            period: {
              ...(cp.period?.start ? { start: formatDate(cp.period.start) } : {}),
              ...(cp.period?.end ? { end: formatDate(cp.period.end) } : {}),
            },
          }
        : {}),
      ...(cp.created ? { created: cp.created } : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}

// ---------------------------------------------------------------------------
// Advance Directives — Consent (base FHIR profile; IPS defines no Consent profile)
// ---------------------------------------------------------------------------

export function mapAdvanceDirectives(consents: ConsentEntity[], patientRef: string): SectionMapResult {
  const entries = consents.map((c) => {
    const resource: FhirResource = {
      resourceType: 'Consent',
      ...recordVariantExtension(c),
      meta: { profile: [IPS_PROFILES.consent] },
      status: pickStatus(c.status, ['draft', 'proposed', 'active', 'rejected', 'inactive', 'entered-in-error'], 'active'),
      scope: toCodeableConcept(c.scope) ?? {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'adr', display: 'Advanced Directive' }],
      },
      category: c.category?.length
        ? c.category.map((cat) => toCodeableConcept(cat)).filter(Boolean)
        : [{ coding: [{ system: 'http://loinc.org', code: '42348-3', display: 'Advance directives' }] }],
      patient: { reference: patientRef },
      ...(c.dateTime ? { dateTime: c.dateTime } : {}),
      ...(c.provision?.type
        ? {
            provision: {
              type: c.provision.type,
              ...(c.provision.period ? { period: c.provision.period } : {}),
            },
          }
        : {}),
    }
    return makeEntry(resource).entry
  })
  return { entries, referencedOnly: [] }
}
