import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'

// Core Domain Entities: Clinical Data

export interface ConditionEntity {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string; display?: string }> }
  id: string
  code?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  clinicalStatus?: string
  verificationStatus?: string
  recordedDate?: string
  onsetDateTime?: string
  encounter?: {
    reference?: string
  }
  /**
   * IPS Phase 2.2 — provenance marker for an LLM-INFERRED problem (a synthetic
   * Condition the app derived from discharge summaries / outpatient ICDs / meds,
   * NOT present in the source FHIR). Only ever set on app-synthesized conditions
   * and only after the user confirms the suggestion; source conditions never
   * carry it. It is app-internal (underscore prefix) and never written back to
   * the React Query cache — it lives only inside an IPS snapshot. The problem
   * list is text-only: the app attaches NO SNOMED CT / ICD coding to inferred
   * problems. Concrete shapes live in
   * features/ips-export/utils/inferred-problems-types.ts; inlined here to keep
   * the core entity free of a feature-layer import cycle.
   */
  _inferred?: {
    inferenceConfidence: 'high' | 'medium' | 'low'
    evidence: Array<{
      kind: string
      label: string
      sourceId?: string
      icd10?: string
      date?: string
      count?: number
    }>
    rationale?: string
  }
  /**
   * mCODE cancer-staging summary (e.g. "Stage IVB (T2a · N2 · M1c)"), resolved
   * by the Roche DIP expander from Condition.stage.assessment → the TNM stage-
   * group Observation + its hasMember. Staging is a diagnosis attribute, so it
   * rides on the Condition and shows in the problem list, not as a report.
   * App-added (underscore prefix); source bundles without staging omit it.
   */
  _cancerStage?: string
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * Governed ATC hierarchy derived from an exact WHO ATC code carried by the
 * source medication. This is deliberately separate from `drugTerminology`:
 * the latter means the App matched an official, date-effective NHI drug-master
 * record, while this fallback only supports pharmacologic grouping.
 */
export interface MedicationAtcClassification {
  source: 'source-who-atc'
  atcCode: string
  atcNameEn?: string
  atcLevel2Code: string
  atcLevel2NameZh?: string
  atcLevel2NameEn: string
  atcLevel3Code?: string
  atcLevel3NameZh?: string
  atcLevel3NameEn?: string
  atcLevel4Code: string
  atcLevel4NameZh?: string
  atcLevel4NameEn: string
  atcHierarchySnapshotId: string
}

export interface ClinicalFhirExtension {
  valueUri?: string
  url?: string
  extension?: ClinicalFhirExtension[]
  valueQuantity?: {
    value?: number
    unit?: string
    system?: string
    code?: string
  }
  valueCoding?: {
    system?: string
    code?: string
    display?: string
  }
  valueCodeableConcept?: {
    text?: string
    coding?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  valueReference?: {
    reference?: string
    display?: string
  }
  valueString?: string
  valueCode?: string
  valueInteger?: number
  valueDate?: string
  valueInstant?: string
}

export interface MedicationEntity {
  identifier?: Array<{ system?: string; value?: string }>
  id: string
  meta?: {
    source?: string
    tag?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  medicationCodeableConcept?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  medicationReference?: {
    reference?: string
    display?: string
  }
  status?: string
  intent?: string
  authoredOn?: string
  dosageInstruction?: Array<{
    text?: string
    route?: {
      text?: string
    }
    timing?: {
      code?: {
        text?: string
        coding?: Array<{
          code?: string
          display?: string
          system?: string
        }>
      }
      repeat?: {
        frequency?: number
        period?: number
        periodUnit?: string
        when?: string[]
      }
    }
    additionalInstruction?: Array<{
      text?: string
      coding?: Array<{
        code?: string
        display?: string
        system?: string
      }>
    }>
    doseAndRate?: Array<{
      doseQuantity?: {
        value?: number
        unit?: string
      }
    }>
  }>
  encounter?: {
    reference?: string
  }
  dispenseRequest?: any
  /**
   * FHIR R4 MedicationRequest.courseOfTherapyType — distinguishes acute vs
   * continuous (chronic refill) therapy. NHI-FHIR-Bridge v0.6.10+ populates
   * this with coding[].code === 'continuous' for 慢性處方箋. Absent for acute.
   */
  courseOfTherapyType?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  /**
   * FHIR R4 MedicationRequest.category — source/administrative category.
   * Bridge v0.6.10+ sends Chinese in `text` (e.g. "降血壓藥") and English
   * in `coding[].display` (e.g. "HYPOTENSIVE AGENTS"). It is useful as a
   * fallback label, but must not override exact NHI ingredient/ATC terminology
   * or be treated by itself as a pharmacologic mechanism.
   */
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  /**
   * FHIR R4 MedicationRequest.requester — prescribing clinic / dispensing
   * pharmacy. The bridge writes the institution short name into
   * `requester.display` (e.g. "益安大藥局").
   */
  requester?: {
    display?: string
    reference?: string
  }
  /** MedicationStatement.informationSource — who supplied the medication list. */
  informationSource?: {
    display?: string
    reference?: string
  }
  /**
   * FHIR R4 MedicationRequest.reasonCode — billing ICD-10 attached to the
   * prescription. NOT a confirmed clinical diagnosis (see billingIcdTooltip).
   */
  reasonCode?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  /** Source-specific structured context retained for non-prescription
   * MedicationRequests such as MediCloud IMUE0120 remaining-supply snapshots. */
  extension?: ClinicalFhirExtension[]
  note?: Array<{ text?: string }>
  reportedBoolean?: boolean
  /**
   * App-side terminology resolved from an exact NHI drug code plus authoredOn
   * date. These fields are derived from the pinned official drug-master
   * snapshot, never copied from or written over the source MedicationRequest.
   */
  drugTerminology?: {
    source: 'nhi-official-drug-master'
    snapshotId: string
    officialNameZh?: string
    officialNameEn?: string
    ingredientText?: string
    doseForm?: string
    atcCode?: string
    atcNameZh?: string
    atcNameEn?: string
    /** Governed three-character ATC therapeutic subgroup. Unlike atcCode,
     *  this is resolved from the versioned hierarchy rather than sliced and
     *  labelled inside the App. */
    atcLevel2Code?: string
    atcLevel2NameZh?: string
    atcLevel2NameEn?: string
    /** Governed four-character ATC pharmacological/therapeutic subgroup. */
    atcLevel3Code?: string
    atcLevel3NameZh?: string
    atcLevel3NameEn?: string
    /** Governed five-character ATC chemical/pharmacological subgroup. */
    atcLevel4Code?: string
    atcLevel4NameZh?: string
    atcLevel4NameEn?: string
    atcHierarchySnapshotId?: string
    officialProductUrl?: string
  }
  /**
   * Strict fallback used only when no official NHI drug-master terminology is
   * available. The full source WHO ATC code must resolve in the App's pinned
   * hierarchy; free-text drug/category labels are never guessed or translated.
   */
  atcClassification?: MedicationAtcClassification
  /**
   * Originating FHIR resource type. 'MedicationRequest' = 醫師處方/健保開立紀錄
   * (bridge default); 'MedicationStatement' = 病人目前服用中的藥物清單 (IPS
   * default). Drives the source hint shown in MedListCard; not part of the
   * raw FHIR shape, hence the underscore prefix.
   */
  _sourceResourceType?: 'MedicationRequest' | 'MedicationStatement'
  /** Source capture instant from Bundle.timestamp; not the local import time. */
  _sourceCapturedAt?: string
  _reconciledSourceReferences?: string[]
  _encounterInferred?: boolean
  _sourceRecordComparison?: import('@/src/shared/utils/source-record-comparison').SourceRecordComparison
  _sourcePrescriptionRecords?: any[]
  /** IPS-only presentation flag; the original source status is never rewritten. */
  exportCurrentnessUnconfirmed?: boolean
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * MediCloud IMUE0120 patient-level summary. One entity represents one Basic
 * resource and one same-ingredient/same-dosage-form group; it is deliberately
 * not a MedicationEntity because it is not a prescription.
 */
export interface MedicationRemainingSummaryEntity {
  id: string
  groupIdentifier?: string
  groupName?: string
  atc5Name?: string
  adherenceExpectedRemainingDays?: number
  sameIngredientDosageFormEndDate?: string
  sourceMedicationDate?: string
  drugGroupCode?: string
  drugType?: string
  prescribedDays?: number
  sourceDiagnosisCode?: string
  calculatedAt?: string
  relatedMedicationRequestReferences: string[]
  anchorMedicationRequestReference?: string
  sourceModule?: string
  sourceSystem?: string
  sourceId?: string
}

export interface AllergyEntity {
  id: string
  code?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  type?: string
  category?: string[]
  clinicalStatus?: string
  verificationStatus?: string
  criticality?: string
  encounter?: {
    reference?: string
    display?: string
  }
  onsetDateTime?: string
  reaction?: Array<{
    substance?: {
      text?: string
      coding?: Array<{
        code?: string
        display?: string
        system?: string
      }>
    }
    manifestation?: Array<{
      text?: string
      coding?: Array<{
        code?: string
        display?: string
        system?: string
      }>
    }>
    description?: string
    onset?: string
    severity?: string
    exposureRoute?: {
      text?: string
      coding?: Array<{
        code?: string
        display?: string
        system?: string
      }>
    }
    note?: Array<{ text?: string }>
  }>
  recordedDate?: string
  recorder?: {
    reference?: string
    display?: string
  }
  asserter?: {
    reference?: string
    display?: string
  }
  lastOccurrence?: string
  note?: Array<{ text?: string }>
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

export interface ObservationEntity {
  /** Opaque identity in the shared source graph; survives query structural sharing. */
  clinicalSourceNodeKey?: string
  /** Explicit hasMember edges produced by a local domain projection. */
  clinicalSourceDerivedMemberKeys?: string[]
  basedOn?: Array<{ reference?: string; display?: string }>
  extension?: ClinicalFhirExtension[]
  method?: { text?: string; coding?: Array<{ system?: string; code?: string; display?: string }> }
  id?: string
  resourceType?: string
  meta?: {
    source?: string
    tag?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  code?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  valueQuantity?: {
    value?: number
    unit?: string
    system?: string
    code?: string
  }
  valueRange?: {
    low?: {
      value?: number
      unit?: string
      system?: string
      code?: string
    }
    high?: {
      value?: number
      unit?: string
      system?: string
      code?: string
    }
  }
  valueString?: string
  valueCodeableConcept?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  interpretation?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
    }>
  }
  referenceRange?: Array<{
    low?: {
      value?: number
      unit?: string
    }
    high?: {
      value?: number
      unit?: string
    }
    text?: string
  }>
  component?: Array<{
    code?: {
      text?: string
      coding?: Array<{
        code?: string
        display?: string
        system?: string
      }>
    }
    valueQuantity?: {
      value?: number
      unit?: string
      system?: string
      code?: string
    }
    valueRange?: {
      low?: {
        value?: number
        unit?: string
        system?: string
        code?: string
      }
      high?: {
        value?: number
        unit?: string
        system?: string
        code?: string
      }
    }
    valueString?: string
    interpretation?: {
      text?: string
      coding?: Array<{
        code?: string
        display?: string
      }>
    }
    referenceRange?: Array<{
      low?: {
        value?: number
        unit?: string
      }
      high?: {
        value?: number
        unit?: string
      }
      text?: string
    }>
  }>
  hasMember?: Array<{
    reference?: string
  }>
  effectiveDateTime?: string
  effectivePeriod?: {
    start?: string
    end?: string
  }
  issued?: string
  status?: string
  category?: Array<{
    coding?: Array<{
      code?: string
      system?: string
      display?: string
    }>
    text?: string
  }>
  encounter?: {
    reference?: string
  }
  performer?: Array<{ display?: string; reference?: string }>
  note?: Array<{ text?: string }>
  // Specimen routing signal (set by NHI-FHIR-Bridge based on the NHI 醫令碼).
  // categorizeObservation uses this as the authoritative blood vs urine
  // boundary; missing this field caused blood-typing / antibody / antigen
  // tests to mis-route to urinalysis via Pass 6 qualitative fallback.
  specimen?: {
    display?: string
    reference?: string
  }
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

export interface DiagnosticReportEntity {
  /** Opaque identity in the shared source graph; survives query structural sharing. */
  clinicalSourceNodeKey?: string
  /** Explicit membership added by a local domain projection, using source node keys. */
  clinicalSourceDerivedMemberKeys?: string[]
  basedOn?: Array<{ reference?: string; display?: string }>
  id: string
  meta?: {
    source?: string
    tag?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  identifier?: Array<{
    system?: string
    value?: string
    use?: string
  }>
  code?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  result?: Array<{
    reference?: string
  }>
  conclusion?: string
  effectiveDateTime?: string
  effectivePeriod?: {
    start?: string
    end?: string
  }
  _observations?: ObservationEntity[]
  status?: string
  issued?: string
  category?: any
  conclusionCode?: any
  imagingStudy?: Array<{
    reference?: string
    display?: string
  }>
  note?: Array<{ text?: string }>
  extension?: Array<{
    url?: string
    extension?: Array<{
      url?: string
      valueInteger?: number
      valueCode?: string
      valueString?: string
    }>
  }>
  // Bridge v0.14.0+ inlines imaging (健保存摺 X-ray / ECG …) as base64 in
  // `data` (JPEG, ~2-3 MB each). `data` carries NO `data:<mime>;base64,` prefix.
  // Never eager-decode (a multi-image bundle can exceed 100 MB); UI decodes to a
  // Blob URL only on demand. On the local-bundle import path the base64 is moved
  // to an off-heap IndexedDB Blob and `data` is replaced by `_imageRef` (the Blob
  // key) — see LocalBundleService.extractAndStoreImages.
  presentedForm?: Array<{ title?: string; contentType?: string; url?: string; data?: string; size?: number; _imageRef?: string }>
  subject?: {
    reference?: string
    display?: string
  }
  encounter?: {
    reference?: string
  }
  /** True only when local import inferred encounter by calendar date. */
  _encounterInferred?: boolean
  performer?: Array<{ display?: string; reference?: string }>
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * FHIR R4 ImagingStudy metadata. This intentionally preserves the human-
 * readable study/series/instance fields and references only; the app does not
 * fetch DICOM bytes or act as a PACS viewer.
 */
export interface ImagingStudyEntity {
  id: string
  identifier?: Array<{
    system?: string
    value?: string
    use?: string
  }>
  status?: string
  modality?: Array<{
    system?: string
    code?: string
    display?: string
  }>
  subject?: { reference?: string; display?: string }
  encounter?: { reference?: string; display?: string }
  started?: string
  basedOn?: Array<{ reference?: string; display?: string }>
  referrer?: { reference?: string; display?: string }
  interpreter?: Array<{ reference?: string; display?: string }>
  endpoint?: Array<{ reference?: string; display?: string }>
  numberOfSeries?: number
  numberOfInstances?: number
  procedureReference?: { reference?: string; display?: string }
  procedureCode?: Array<{
    text?: string
    coding?: Array<{ system?: string; code?: string; display?: string }>
  }>
  location?: { reference?: string; display?: string }
  reasonCode?: Array<{
    text?: string
    coding?: Array<{ system?: string; code?: string; display?: string }>
  }>
  reasonReference?: Array<{ reference?: string; display?: string }>
  note?: Array<{ text?: string }>
  description?: string
  series?: Array<{
    uid?: string
    number?: number
    modality?: { system?: string; code?: string; display?: string }
    description?: string
    numberOfInstances?: number
    endpoint?: Array<{ reference?: string; display?: string }>
    bodySite?: { system?: string; code?: string; display?: string }
    laterality?: { system?: string; code?: string; display?: string }
    specimen?: Array<{ reference?: string; display?: string }>
    started?: string
    performer?: Array<{
      function?: {
        text?: string
        coding?: Array<{ system?: string; code?: string; display?: string }>
      }
      actor?: { reference?: string; display?: string }
    }>
    instance?: Array<{
      uid?: string
      sopClass?: { system?: string; code?: string; display?: string }
      number?: number
      title?: string
    }>
  }>
  sourceSystem?: string
  sourceId?: string
}

export interface ProcedureEntity {
  id: string
  /** Source-derived procedure class from FHIR Procedure.category. */
  category?: {
    text?: string
    coding?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  code?: {
    text?: string
    coding?: Array<{
      system?: string
      code?: string
      display?: string
    }>
  }
  status?: string
  performedDateTime?: string
  performedPeriod?: {
    start?: string
    end?: string
  }
  encounter?: {
    reference?: string
  }
  /** Operating hospital(s) — bridge sends performer[].actor.display. */
  performer?: Array<{
    actor?: { display?: string; reference?: string }
    display?: string
    reference?: string
  }>
  /** Free-text notes — bridge ≥0.18.14 puts the NHI diagnosis reason here. */
  note?: Array<{ text?: string }>
  /**
   * Indication / diagnosis (bridge ≥0.18.15). ICD-10-CM, bilingual: `text` is
   * the 繁中 name, `coding[].display` the English. Earlier bundles carried this
   * as a "Reason: …" note instead.
   */
  reasonCode?: Array<{
    text?: string
    coding?: Array<{ system?: string; code?: string; display?: string }>
  }>
  /**
   * Operative-session linkage (bridge ≥0.20.x). Secondary procedures done in
   * the same session reference the lead procedure here, letting the reports UI
   * collapse them under one title with the lead. FHIR Procedure.partOf.
   */
  partOf?: Array<{ reference?: string; display?: string }>
  /**
   * MediCloud IMUE0200 special materials (特材) whose record points at this
   * Procedure through its `relatedProcedure` extension. Re-attached by the
   * data layer, the way DiagnosticReport carries `_observations`.
   */
  specialMaterials?: ProcedureSpecialMaterialEntity[]
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * One MediCloud special-material claim line linked to a surgery. The source
 * does not record which operation used the material; when
 * `relationshipStatus` is `inferred`, the bridge matched it by patient,
 * facility, date and diagnosis, and `relationshipBasis` says how.
 */
export interface ProcedureSpecialMaterialEntity {
  id: string
  procedureReference: string
  materialCode?: string
  nameZh?: string
  nameEn?: string
  materialType?: string
  quantity?: number
  visitDate?: string
  licenseNumbers: string[]
  dataSource?: string
  relationshipStatus?: string
  relationshipBasis?: string
}

export interface EncounterEntity {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string; display?: string }> }
  _sourceRecordComparison?: import('@/src/shared/utils/source-record-comparison').SourceRecordComparison
  _sourceEncounterRecords?: any[]
  id: string
  status?: string
  class?: {
    code?: string
    display?: string
  }
  type?: Array<{
    text?: string
    coding?: Array<{ code?: string; display?: string; system?: string }>
  }>
  serviceType?: { text?: string; coding?: Array<{ display?: string }> }
  period?: {
    start?: string
    end?: string
  }
  // Bridge populates each entry with the diagnosis in BOTH `text` (zh-TW
  // — usually "<ICD> 中文") and `coding[].display` (en); the documents card
  // picks one based on UI locale to surface the primary diagnosis line.
  reasonCode?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  reasonReference?: Array<{ display?: string }>
  diagnosis?: Array<{
    rank?: number
    condition?: { reference?: string; display?: string }
  }>
  participant?: Array<{
    type?: Array<{ coding?: Array<{ system?: string; code?: string }> }>
    individual?: { display?: string }
    actor?: { display?: string }
  }>
  location?: Array<{
    location?: { display?: string }
  }>
  serviceProvider?: { display?: string }
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

export interface DocumentReferenceEntity {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string; display?: string }> }
  id: string
  status?: string
  type?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  subject?: {
    reference?: string
  }
  date?: string
  author?: Array<{
    display?: string
    reference?: string
  }>
  description?: string
  content?: Array<{
    attachment?: {
      contentType?: string
      data?: string
      url?: string
      title?: string
      size?: number
    }
  }>
  context?: {
    encounter?: Array<{
      reference?: string
    }>
    period?: {
      start?: string
      end?: string
    }
  }
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

export interface CompositionEntity {
  meta?: { source?: string; tag?: Array<{ system?: string; code?: string; display?: string }> }
  id: string
  status?: string
  type?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
    }>
  }>
  subject?: {
    reference?: string
  }
  encounter?: {
    reference?: string
  }
  date?: string
  author?: Array<{
    display?: string
    reference?: string
  }>
  title?: string
  /** Human-readable narrative for the Composition as a whole. FHIR document
   *  Compositions may carry an introductory narrative here before the ordered
   *  section narratives. */
  text?: {
    status?: string
    div?: string
  }
  section?: Array<{
    title?: string
    code?: {
      text?: string
      coding?: Array<{
        code?: string
        display?: string
      }>
    }
    text?: {
      status?: string
      div?: string
    }
    entry?: Array<{
      reference?: string
    }>
  }>
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * FHIR R4 Immunization — vaccination records.
 *
 * Bridge v0.7.x+ ships these alongside MedicationRequest so therapeutic
 * vaccine prescriptions (e.g. tetanus shot for a wound, billed via NHI)
 * stay in the medication list, while genuine preventive-care vaccinations
 * from 疾病管制署 (CDC) surface here.
 */
export interface ImmunizationEntity {
  id: string
  status?: string
  vaccineCode?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  occurrenceDateTime?: string
  performer?: Array<{
    actor?: {
      display?: string
      reference?: string
    }
  }>
  note?: Array<{ text?: string }>
  // FHIR R4: Reference(Organization) — display is the common case, but a
  // bridge may send only `reference`; keep both so consumers can fall back.
  manufacturer?: { display?: string; reference?: string }
  lotNumber?: string
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * FHIR R4 Consent — advance directives / 預立醫療決定.
 *
 * IPS "Advance Directives" section. 健保存摺 surfaces 安寧緩和醫療意願
 * (palliative/DNR), 器官捐贈意願 (organ donation) and 病人自主權利法
 * 預立醫療決定 (AD per Patient Right to Autonomy Act). Bridge work to emit
 * these is in progress — these fields follow the standard R4 shape and will
 * be locked against real bridge samples once they land.
 */
export interface ConsentEntity {
  id: string
  status?: string
  scope?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  dateTime?: string
  /**
   * Consent.provision — `type` is 'deny' | 'permit'. A deny provision
   * (e.g. DNR / refuse CPR) is the clinically load-bearing case and is
   * surfaced with an amber accent in the UI.
   */
  provision?: {
    type?: string
    period?: {
      start?: string
      end?: string
    }
  }
  sourceAttachment?: {
    contentType?: string
    title?: string
    url?: string
  }
  organization?: Array<{
    display?: string
    reference?: string
  }>
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * FHIR R4 Device — implants / durable medical equipment.
 *
 * IPS "Medical Devices" section. 健保存摺 surfaces 植入物 (implants such as
 * 心臟節律器, 人工關節, 支架). Implant date is typically carried on a related
 * Procedure rather than the Device itself, so the card joins on date when
 * available. Field shape follows standard R4 pending bridge samples.
 */
export interface DeviceEntity {
  id: string
  status?: string
  type?: {
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }
  manufacturer?: string
  modelNumber?: string
  serialNumber?: string
  udiCarrier?: Array<{
    deviceIdentifier?: string
    carrierHRF?: string
  }>
  deviceName?: Array<{
    name?: string
    type?: string
  }>
  manufactureDate?: string
  expirationDate?: string
  owner?: {
    display?: string
    reference?: string
  }
  note?: Array<{ text?: string }>
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

/**
 * FHIR R4 CarePlan — plan of care / 照護計畫.
 *
 * IPS "Plan of Care" section. 健保存摺 surfaces 個案管理照護計畫 such as
 * 糖尿病共同照護, 居家醫療整合照護. Status drives the badge (進行中 / 已完成
 * / 已取消). `activity` holds the discrete plan items; `addresses` links the
 * conditions the plan targets. Field shape follows standard R4 pending bridge
 * samples.
 */
export interface CarePlanEntity {
  id: string
  status?: string
  intent?: string
  category?: Array<{
    text?: string
    coding?: Array<{
      code?: string
      display?: string
      system?: string
    }>
  }>
  title?: string
  description?: string
  period?: {
    start?: string
    end?: string
  }
  created?: string
  addresses?: Array<{
    display?: string
    reference?: string
  }>
  activity?: Array<{
    detail?: {
      kind?: string
      code?: {
        text?: string
        coding?: Array<{
          code?: string
          display?: string
        }>
      }
      status?: string
      description?: string
      scheduledString?: string
    }
    outcomeCodeableConcept?: Array<{
      text?: string
      coding?: Array<{
        code?: string
        display?: string
      }>
    }>
  }>
  note?: Array<{ text?: string }>
  author?: {
    display?: string
    reference?: string
  }
  // Multi-hospital support
  sourceSystem?: string
  sourceId?: string
}

export type ClinicalDataQueryKey =
  | 'Condition'
  | 'MedicationRequest'
  | 'MedicationStatement'
  | 'Basic'
  | 'AllergyIntolerance'
  | 'Observation'
  | 'Observation:vital-signs'
  | 'DiagnosticReport'
  | 'ImagingStudy'
  | 'Procedure'
  | 'Encounter'
  | 'DocumentReference'
  | 'Composition'
  | 'Immunization'
  | 'Consent'
  | 'Device'
  | 'CarePlan'

export type ClinicalDataQueryState =
  | 'ok'
  | 'empty'
  | 'unauthorized'
  | 'forbidden'
  | 'unsupported'
  | 'error'

export interface ClinicalDataQueryStatus {
  resourceType: string
  state: ClinicalDataQueryState
  count?: number
  httpStatus?: number
  message?: string
  operationOutcome?: {
    severity?: string
    code?: string
    diagnostics?: string
  }
}

/**
 * The full set of clinical resources loaded for one patient.
 *
 * OBSERVATION SUPERSET INVARIANT — read before adding any feature that lists
 * observations:
 *   `observations` is the COMPLETE set of every Observation for the patient.
 *   `vitalSigns` and each DiagnosticReport's members (referenced via
 *   `report.result[].reference` and/or re-attached as `report._observations`)
 *   are NOT independent collections — they are SUBSETS of `observations`,
 *   re-listed by the same resource id. This is standard FHIR behaviour
 *   (`Observation?patient=X` must return report members and vitals too), so it
 *   holds for both data sources (SMART repository and local-bundle import).
 *
 * Consequence: iterating `observations` directly will double-count anything
 * already shown inside a report or in the vitals section. To list "standalone"
 * observations, do NOT hand-roll the dedup — use the shared selectors in
 * `src/core/utils/observation-selectors.ts`, which are the single source of
 * truth for "is this a report member?" and "is this a vital?". Re-deriving
 * those rules per-feature is exactly what produced duplicate / mislabeled rows.
 */
export interface ClinicalSourceMetadata {
  source: 'health-bank-sdk-json'
  convertedAt: string
  converterVersion: string
  resourceCounts: Record<string, number>
  warnings: Array<{ code: string; count?: number }>
  labDuplicateMerge: {
    sourceCount: number
    convertedCount: number
    mergedCount: number
    conflictingValueGroupCount: number
  }
  unitInference: {
    policyVersion: string
    inferredCount: number
    unitlessCount: number
    unresolvedCount: number
  }
  sourceCapabilities: Array<{
    key: string
    availability: 'provided' | 'not-provided' | 'not-distinguished' | 'embedded' | 'partial'
  }>
}

export interface ClinicalDataCollection {
  /** Complete immutable pre-mapper source graph and shared reconciliation evidence. */
  clinicalSource?: ClinicalReconciliationResult
  conditions: ConditionEntity[]
  medications: MedicationEntity[]
  /** IMUE0120 Basic summaries; never counted as prescriptions or reports. */
  medicationRemainingSummaries: MedicationRemainingSummaryEntity[]
  allergies: AllergyEntity[]
  observations: ObservationEntity[]
  vitalSigns: ObservationEntity[]
  diagnosticReports: DiagnosticReportEntity[]
  imagingStudies: ImagingStudyEntity[]
  procedures: ProcedureEntity[]
  encounters: EncounterEntity[]
  documentReferences: DocumentReferenceEntity[]
  compositions: CompositionEntity[]
  immunizations: ImmunizationEntity[]
  consents: ConsentEntity[]
  devices: DeviceEntity[]
  carePlans: CarePlanEntity[]
  /** Encrypted sidecar describing an SDK→FHIR conversion. It contains counts
   * and source limitations only — never the uploaded SDK JSON or clinical
   * values. */
  sourceMetadata?: ClinicalSourceMetadata
  /**
   * Per-search outcome for SMART data. Optional because imported/local bundles
   * do not perform network searches. This prevents an authorization or server
   * failure from being represented as the clinically different "no records".
   */
  resourceQueryStatus?: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>>
}
