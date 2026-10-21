// IPS (International Patient Summary) constants.
//
// Profile canonical URLs come from the HL7 IPS Implementation Guide
// (http://hl7.org/fhir/uv/ips/). These are part of the IG specification and are
// stable across IPS releases — unlike SNOMED CT *concept codes*, which must be
// web-search-verified before use (see memory/feedback_snomed_ct_verification.md).
// No SNOMED CT concept codes are introduced in Phase 1.

export const IPS_BASE = 'http://hl7.org/fhir/uv/ips/StructureDefinition'

export const IPS_PROFILES = {
  bundle: `${IPS_BASE}/Bundle-uv-ips`,
  composition: `${IPS_BASE}/Composition-uv-ips`,
  patient: `${IPS_BASE}/Patient-uv-ips`,
  allergyIntolerance: `${IPS_BASE}/AllergyIntolerance-uv-ips`,
  condition: `${IPS_BASE}/Condition-uv-ips`,
  medicationStatement: `${IPS_BASE}/MedicationStatement-uv-ips`,
  medication: `${IPS_BASE}/Medication-uv-ips`,
  immunization: `${IPS_BASE}/Immunization-uv-ips`,
  procedure: `${IPS_BASE}/Procedure-uv-ips`,
  device: `${IPS_BASE}/Device-uv-ips`,
  deviceUseStatement: `${IPS_BASE}/DeviceUseStatement-uv-ips`,
  diagnosticReport: `${IPS_BASE}/DiagnosticReport-uv-ips`,
  // NOTE: laboratory results use the combined laboratory-pathology IPS profile.
  observationResultsLaboratory: `${IPS_BASE}/Observation-results-laboratory-pathology-uv-ips`,
  observationResultsRadiology: `${IPS_BASE}/Observation-results-radiology-uv-ips`,
  // IPS does NOT define profiles for CarePlan / Consent — the Plan of Care and
  // Advance Directives sections reference the base FHIR resources. We still set
  // meta.profile (to the base canonical) so every resource is self-describing.
  carePlan: 'http://hl7.org/fhir/StructureDefinition/CarePlan',
  consent: 'http://hl7.org/fhir/StructureDefinition/Consent',
} as const

// Vital signs in IPS use the base FHIR vital-signs profile, not an IPS profile.
export const VITAL_SIGNS_PROFILE = 'http://hl7.org/fhir/StructureDefinition/vitalsigns'

// Code systems
export const SYSTEM = {
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  ucum: 'http://unitsofmeasure.org',
  conditionClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  conditionVerification: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
  allergyVerification: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
  observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  listEmptyReason: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
} as const

// Provenance tag for an LLM-INFERRED, user-confirmed problem (Phase 2.2). Emitted
// as Condition.meta.tag so a downstream reader can tell an AI-synthesized problem
// apart from one that came straight from the source FHIR. App-local namespace —
// not an HL7-registered system.
export const INFERENCE_TAG = {
  system: 'urn:ips:inference',
  code: 'ai-inferred',
  display: 'AI-inferred problem (user-confirmed)',
} as const

// Composition.type — "Patient summary Document"
export const COMPOSITION_TYPE_LOINC = '60591-5'

// Default author for app-assembled IPS documents (user-confirmed).
export const IPS_AUTHOR_DISPLAY = 'MediPrisma (software-generated; no clinical attestation)'

export const IPS_DOC_TITLE = 'International Patient Summary'

// Section LOINC codes (HL7 IPS IG). `required` marks the three sections that
// must always be present (even empty, with a "no information" narrative).
export const IPS_SECTION = {
  problemList: { loinc: '11450-4', required: true },
  allergies: { loinc: '48765-2', required: true },
  medications: { loinc: '10160-0', required: true },
  immunizations: { loinc: '11369-6', required: false },
  procedures: { loinc: '47519-4', required: false },
  results: { loinc: '30954-2', required: false },
  vitalSigns: { loinc: '8716-3', required: false },
  medicalDevices: { loinc: '46264-8', required: false },
  pastIllness: { loinc: '11348-0', required: false },
  planOfCare: { loinc: '18776-5', required: false },
  advanceDirectives: { loinc: '42348-3', required: false },
} as const

export type IpsSectionKey = keyof typeof IPS_SECTION

// 匯出預覽的大小警示門檻:序列化後 > 2 MB 顯示黃色警示(部分交換管道 —
// 郵件附件 / QR / 部分 FHIR server payload 上限 — 對大文件不友善)。
export const IPS_SIZE_WARN_BYTES = 2 * 1024 * 1024

// IPS 2.0 empty-section representation: an empty required section carries
// `section.emptyReason` from the standard list-empty-reason code system
// (ips-comp-1: a section SHALL have entries OR an emptyReason). The IPS 1.x
// absent-unknown-uv-ips *entry resources* (no-problem-info …) are retired.
export const SECTION_EMPTY_REASON = {
  system: SYSTEM.listEmptyReason,
  code: 'unavailable',
  display: 'Unavailable',
} as const
/** Application canonical; not yet published as an externally resolvable definition. */
export { CLINICAL_RECORD_VARIANT_EXTENSION, CLINICAL_MEDICATION_CONTENT_EXTENSION } from '@/src/core/services/clinical-record-variant-modifier'
