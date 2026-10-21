// FHIR Mapper
// Maps FHIR R4 resources to domain entities
// Implements IDataMapper interface for multi-hospital support
import type {
  ConditionEntity,
  MedicationEntity,
  AllergyEntity,
  ObservationEntity,
  DiagnosticReportEntity,
  ImagingStudyEntity,
  ProcedureEntity,
  EncounterEntity,
  DocumentReferenceEntity,
  CompositionEntity,
  ImmunizationEntity,
  ConsentEntity,
  DeviceEntity,
  CarePlanEntity,
  MedicationRemainingSummaryEntity,
  ProcedureSpecialMaterialEntity,
} from '@/src/core/entities/clinical-data.entity'
import type { IDataMapper } from '@/src/core/interfaces/data-mapper.interface'
import { dataMapperRegistry } from '@/src/core/interfaces/data-mapper.interface'
import type {
  Condition,
  MedicationRequest,
  MedicationStatement,
  AllergyIntolerance,
  Observation,
  DiagnosticReport,
  ImagingStudy,
  Procedure,
  CodeableConcept,
  Reference,
  Basic,
  FhirExtension,
} from '@/src/shared/types/fhir.types'
import {
  MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM,
  MEDCLOUD_DRUG_GROUP_IDENTIFIER_SYSTEM,
  MEDCLOUD_REMAINING_SUMMARY_CODE,
  MEDCLOUD_REMAINING_SUMMARY_EXTENSION_URL,
  MEDCLOUD_SPECIAL_MATERIAL_CODE,
  MEDCLOUD_SPECIAL_MATERIAL_EXTENSION_URL,
} from '@/src/shared/constants/medcloud.constants'

// Source system identifier for FHIR data
const FHIR_SOURCE_SYSTEM = 'fhir'

function extensionChild(
  extension: FhirExtension | undefined,
  url: string,
): FhirExtension | undefined {
  return extension?.extension?.find((candidate) => candidate.url === url)
}

export function isMedicationRemainingSummaryBasic(resource: Basic): boolean {
  return resource.resourceType === 'Basic'
    && resource.code?.coding?.some((coding) =>
      coding.system === MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM
      && coding.code === MEDCLOUD_REMAINING_SUMMARY_CODE,
    ) === true
}

export function isSpecialMaterialRecordBasic(resource: Basic): boolean {
  return resource?.resourceType === 'Basic'
    && resource.code?.coding?.some((coding) =>
      coding.system === MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM
      && coding.code === MEDCLOUD_SPECIAL_MATERIAL_CODE,
    ) === true
}

/**
 * Map one IMUE0200 special-material Basic to the material it records. Returns
 * undefined when the record names no Procedure: the reports UI shows materials
 * only under the surgery they belong to.
 */
export function toProcedureSpecialMaterial(
  resource: Basic,
): ProcedureSpecialMaterialEntity | undefined {
  const record = resource.extension?.find(
    (extension) => extension.url === MEDCLOUD_SPECIAL_MATERIAL_EXTENSION_URL,
  )
  const procedureReference = extensionChild(record, 'relatedProcedure')
    ?.valueReference?.reference?.trim()
  if (!procedureReference) return undefined
  const text = (url: string) => extensionChild(record, url)?.valueString?.trim() || undefined
  const quantity = extensionChild(record, 'quantity')?.valueDecimal
  return {
    id: resource.id || '',
    procedureReference,
    materialCode: text('materialCode'),
    nameZh: text('nameZh'),
    nameEn: text('nameEn'),
    materialType: text('materialType'),
    quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : undefined,
    visitDate: extensionChild(record, 'visitDate')?.valueDate,
    // The source joins several licences with '+'.
    licenseNumbers: (text('licenseNumber') ?? '')
      .split('+')
      .map((value) => value.trim())
      .filter(Boolean),
    dataSource: text('dataSource'),
    relationshipStatus: extensionChild(record, 'relationshipStatus')?.valueCode,
    relationshipBasis: text('relationshipBasis'),
  }
}

/** Special materials keyed by the id of the Procedure each one points at. */
export function groupSpecialMaterialsByProcedure(
  resources: readonly Basic[],
): Map<string, ProcedureSpecialMaterialEntity[]> {
  const byProcedure = new Map<string, ProcedureSpecialMaterialEntity[]>()
  const seen = new Set<string>()
  for (const resource of resources) {
    if (!isSpecialMaterialRecordBasic(resource)) continue
    if (resource.id) {
      if (seen.has(resource.id)) continue
      seen.add(resource.id)
    }
    const material = toProcedureSpecialMaterial(resource)
    if (!material) continue
    const procedureId = material.procedureReference.split('/').pop()
    if (!procedureId) continue
    const list = byProcedure.get(procedureId) ?? []
    list.push(material)
    byProcedure.set(procedureId, list)
  }
  return byProcedure
}

/**
 * FhirMapper - FHIR R4 資料轉換器
 * 
 * 實作 IDataMapper 接口，將 FHIR R4 資源轉換為 Domain Entities
 * 
 * 使用方式：
 * 1. 透過 registry: dataMapperRegistry.getMapper('fhir')
 * 2. 透過 singleton: fhirMapper.mapObservation(resource)
 * 3. 透過 static 方法: FhirMapper.toObservation(resource) (向後相容)
 */
export class FhirMapper implements IDataMapper {
  readonly sourceType = FHIR_SOURCE_SYSTEM

  // Instance methods for IDataMapper interface
  mapCondition(source: Condition): ConditionEntity {
    return FhirMapper.toCondition(source)
  }

  mapMedication(source: MedicationRequest): MedicationEntity {
    return FhirMapper.toMedication(source)
  }

  mapAllergy(source: AllergyIntolerance): AllergyEntity {
    return FhirMapper.toAllergy(source)
  }

  mapObservation(source: Observation): ObservationEntity {
    return FhirMapper.toObservation(source)
  }

  mapDiagnosticReport(source: DiagnosticReport, observations?: ObservationEntity[]): DiagnosticReportEntity {
    return FhirMapper.toDiagnosticReport(source, observations || [])
  }

  mapImagingStudy(source: ImagingStudy): ImagingStudyEntity {
    return FhirMapper.toImagingStudy(source)
  }

  mapProcedure(source: Procedure): ProcedureEntity {
    return FhirMapper.toProcedure(source)
  }

  mapEncounter(source: any): EncounterEntity {
    return FhirMapper.toEncounter(source)
  }

  mapDocumentReference(source: any): DocumentReferenceEntity {
    return FhirMapper.toDocumentReference(source)
  }

  mapComposition(source: any): CompositionEntity {
    return FhirMapper.toComposition(source)
  }

  // Static methods for backward compatibility
  static toCondition(fhirResource: Condition): ConditionEntity {
    return {
      meta: fhirResource.meta,
      id: fhirResource.id || '',
      code: fhirResource.code,
      category: fhirResource.category,
      clinicalStatus: (fhirResource.clinicalStatus as CodeableConcept | undefined)?.coding?.[0]?.code,
      verificationStatus: (fhirResource.verificationStatus as CodeableConcept | undefined)?.coding?.[0]?.code,
      recordedDate: fhirResource.recordedDate || fhirResource.dateRecorded,
      onsetDateTime: fhirResource.onsetDateTime,
      encounter: fhirResource.encounter,
      // mCODE cancer-staging summary stamped by the Roche DIP expander. Must be
      // listed explicitly — the mapper drops any field not named here.
      _cancerStage: (fhirResource as { _cancerStage?: string })._cancerStage,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toMedication(fhirResource: MedicationRequest | MedicationStatement): MedicationEntity {
    const statement = fhirResource as MedicationStatement
    const request = fhirResource as MedicationRequest
    const drugTerminology = (
      fhirResource as MedicationRequest & {
        drugTerminology?: MedicationEntity['drugTerminology']
      }
    ).drugTerminology
    const atcClassification = (
      fhirResource as MedicationRequest & {
        atcClassification?: MedicationEntity['atcClassification']
      }
    ).atcClassification
    const isStatement = fhirResource.resourceType === 'MedicationStatement'
      || request._sourceResourceType === 'MedicationStatement'

    return {
      id: fhirResource.id || '',
      meta: request.meta,
      identifier: request.identifier,
      medicationCodeableConcept: fhirResource.medicationCodeableConcept,
      medicationReference: fhirResource.medicationReference,
      status: fhirResource.status,
      intent: request.intent,
      authoredOn: request.authoredOn
        ?? statement.effectivePeriod?.start
        ?? statement.effectiveDateTime
        ?? statement.dateAsserted,
      dosageInstruction: request.dosageInstruction ?? statement.dosage,
      encounter: request.encounter ?? statement.context,
      dispenseRequest: request.dispenseRequest,
      courseOfTherapyType: request.courseOfTherapyType,
      category: fhirResource.category,
      requester: request.requester,
      informationSource: statement.informationSource,
      reasonCode: fhirResource.reasonCode,
      extension: request.extension,
      note: request.note,
      reportedBoolean: request.reportedBoolean,
      ...(drugTerminology ? { drugTerminology } : {}),
      ...(atcClassification ? { atcClassification } : {}),
      _sourceResourceType: isStatement ? 'MedicationStatement' : 'MedicationRequest',
      _sourceCapturedAt: request._sourceCapturedAt,
      _reconciledSourceReferences: request._reconciledSourceReferences,
      _encounterInferred: request._encounterInferred,
      _sourceRecordComparison: request._sourceRecordComparison,
      _sourcePrescriptionRecords: request._sourcePrescriptionRecords,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toMedicationRemainingSummary(
    resource: Basic,
    fallbackCapturedAt?: string,
  ): MedicationRemainingSummaryEntity {
    const summary = resource.extension?.find(
      (extension) => extension.url === MEDCLOUD_REMAINING_SUMMARY_EXTENSION_URL,
    )
    const references = summary?.extension
      ?.filter((extension) => extension.url === 'relatedMedicationRequest')
      .map((extension) => extension.valueReference?.reference?.trim())
      .filter((reference): reference is string => Boolean(reference)) ?? []
    const remainingDays = extensionChild(summary, 'adherenceExpectedRemainingDays')
      ?.valueQuantity?.value
    const prescribedDays = extensionChild(summary, 'prescribedDays')
      ?.valueQuantity?.value

    return {
      id: resource.id || '',
      groupIdentifier: resource.identifier?.find(
        (identifier) => identifier.system === MEDCLOUD_DRUG_GROUP_IDENTIFIER_SYSTEM,
      )?.value,
      groupName: extensionChild(summary, 'medicationGroupName')?.valueString
        || resource.code?.text,
      atc5Name: extensionChild(summary, 'atc5Name')?.valueString,
      adherenceExpectedRemainingDays:
        typeof remainingDays === 'number' && Number.isFinite(remainingDays) && remainingDays >= 0
          ? remainingDays
          : undefined,
      sameIngredientDosageFormEndDate:
        extensionChild(summary, 'sameIngredientDosageFormEndDate')?.valueDate,
      sourceMedicationDate: extensionChild(summary, 'sourceMedicationDate')?.valueDate,
      drugGroupCode: extensionChild(summary, 'drugGroupCode')?.valueString,
      drugType: extensionChild(summary, 'drugType')?.valueString,
      prescribedDays:
        typeof prescribedDays === 'number' && Number.isFinite(prescribedDays) && prescribedDays >= 0
          ? prescribedDays
          : undefined,
      sourceDiagnosisCode: extensionChild(summary, 'sourceDiagnosis')?.valueCoding?.code,
      calculatedAt: extensionChild(summary, 'calculatedAt')?.valueInstant || fallbackCapturedAt,
      relatedMedicationRequestReferences: [...new Set(references)],
      anchorMedicationRequestReference:
        extensionChild(summary, 'anchorMedicationRequest')?.valueReference?.reference,
      sourceModule: extensionChild(summary, 'sourceModule')?.valueCode,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: resource.id,
    }
  }

  static toAllergy(fhirResource: AllergyIntolerance): AllergyEntity {
    return {
      id: fhirResource.id || '',
      code: fhirResource.code,
      type: fhirResource.type,
      category: fhirResource.category,
      clinicalStatus: fhirResource.clinicalStatus?.coding?.[0]?.code,
      verificationStatus: fhirResource.verificationStatus?.coding?.[0]?.code,
      criticality: fhirResource.criticality,
      encounter: fhirResource.encounter,
      onsetDateTime: fhirResource.onsetDateTime,
      reaction: fhirResource.reaction,
      recordedDate: fhirResource.recordedDate || fhirResource.recorded,
      recorder: fhirResource.recorder,
      asserter: fhirResource.asserter,
      lastOccurrence: fhirResource.lastOccurrence,
      note: fhirResource.note,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toObservation(fhirResource: Observation): ObservationEntity {
    return {
      basedOn: fhirResource.basedOn,
      extension: fhirResource.extension,
      method: fhirResource.method,
      id: fhirResource.id || '',
      meta: fhirResource.meta,
      code: fhirResource.code,
      valueQuantity: fhirResource.valueQuantity,
      valueRange: fhirResource.valueRange,
      valueString: fhirResource.valueString,
      valueCodeableConcept: fhirResource.valueCodeableConcept,
      component: fhirResource.component,
      effectiveDateTime: fhirResource.effectiveDateTime,
      effectivePeriod: fhirResource.effectivePeriod,
      issued: fhirResource.issued,
      status: fhirResource.status,
      category: fhirResource.category,
      // Specimen is the authoritative blood/urine signal — bridge sets
      // specimen.display='Blood' for serum analytes and ='Urine' for
      // urinalysis. Without preserving this, categorizeObservation's
      // Pass 1 specimen routing AND its specimenSaysBlood guard (for
      // Pass 5 text-urine / Pass 6 qualitative fallbacks) both fail open,
      // causing blood-typing/antibody/antigen tests like ABO, ANA,
      // Influenza-Ag, SARS-CoV-2-Ag, 隱球菌抗原 with qualitative values
      // (`+`, `Negative`) to mis-route to the urinalysis tab.
      specimen: fhirResource.specimen,
      encounter: fhirResource.encounter,
      performer: fhirResource.performer,
      note: fhirResource.note,
      referenceRange: fhirResource.referenceRange,
      interpretation: fhirResource.interpretation,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toDiagnosticReport(fhirResource: DiagnosticReport, observations: ObservationEntity[]): DiagnosticReportEntity {
    const report: DiagnosticReportEntity = {
      basedOn: fhirResource.basedOn,
      id: fhirResource.id || '',
      meta: fhirResource.meta,
      identifier: fhirResource.identifier,
      code: fhirResource.code,
      subject: fhirResource.subject,
      result: fhirResource.result,
      conclusion: fhirResource.conclusion,
      effectiveDateTime: fhirResource.effectiveDateTime,
      effectivePeriod: fhirResource.effectivePeriod,
      status: fhirResource.status,
      issued: fhirResource.issued,
      category: fhirResource.category,
      conclusionCode: fhirResource.conclusionCode,
      imagingStudy: fhirResource.imagingStudy,
      note: fhirResource.note,
      extension: fhirResource.extension,
      presentedForm: fhirResource.presentedForm,
      encounter: fhirResource.encounter,
      _encounterInferred: fhirResource._encounterInferred,
      performer: fhirResource.performer,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }

    // Attach related observations with expansion of hasMember
    if (fhirResource.result && observations.length > 0) {
      const resultIds = fhirResource.result
        .map((ref: Reference) => ref.reference?.split('/').pop())
        .filter(Boolean)
      
      // Create a map of observations by ID for easy lookup
      const obsMap = new Map(observations.map(obs => [obs.id, obs]))
      
      // Get the actual observation objects
      const reportObservations = resultIds
        .map((id) => (id ? obsMap.get(id) : undefined))
        .filter(Boolean)
      
      // Expand any observations that have members
      const expandedObservations = reportObservations.flatMap((obs: any) => {
        if (!obs?.hasMember?.length) return [obs]
        
        const members = obs.hasMember
          .map((m: any) => {
            const memberId = m.reference?.split('/').pop()
            return memberId ? obsMap.get(memberId) : null
          })
          .filter(Boolean)
          
        return [obs, ...members]
      })
      
      report._observations = expandedObservations as ObservationEntity[]
    }

    return report
  }

  static toImagingStudy(fhirResource: ImagingStudy): ImagingStudyEntity {
    return {
      id: fhirResource.id || '',
      identifier: fhirResource.identifier,
      status: fhirResource.status,
      modality: fhirResource.modality,
      subject: fhirResource.subject,
      encounter: fhirResource.encounter,
      started: fhirResource.started,
      basedOn: fhirResource.basedOn,
      referrer: fhirResource.referrer,
      interpreter: fhirResource.interpreter,
      endpoint: fhirResource.endpoint,
      numberOfSeries: fhirResource.numberOfSeries,
      numberOfInstances: fhirResource.numberOfInstances,
      procedureReference: fhirResource.procedureReference,
      procedureCode: fhirResource.procedureCode,
      location: fhirResource.location,
      reasonCode: fhirResource.reasonCode,
      reasonReference: fhirResource.reasonReference,
      note: fhirResource.note,
      description: fhirResource.description,
      series: fhirResource.series,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id,
    }
  }

  static toProcedure(
    fhirResource: Procedure,
    specialMaterialsByProcedure?: ReadonlyMap<string, ProcedureSpecialMaterialEntity[]>,
  ): ProcedureEntity {
    const src = fhirResource as Procedure & {
      performer?: ProcedureEntity['performer']
      note?: ProcedureEntity['note']
      reasonCode?: ProcedureEntity['reasonCode']
      partOf?: ProcedureEntity['partOf']
    }
    const specialMaterials = fhirResource.id
      ? specialMaterialsByProcedure?.get(fhirResource.id)
      : undefined
    return {
      ...(specialMaterials?.length ? { specialMaterials } : {}),
      id: fhirResource.id || '',
      category: fhirResource.category,
      code: fhirResource.code,
      status: fhirResource.status,
      performedDateTime: fhirResource.performedDateTime,
      performedPeriod: fhirResource.performedPeriod,
      encounter: fhirResource.encounter,
      // Operating hospital + NHI diagnosis reason (bridge ≥0.18.14). Without
      // these the procedure row showed no performer / reason. ≥0.18.15 moves the
      // reason from a note to a structured (bilingual) reasonCode.
      performer: src.performer,
      note: src.note,
      reasonCode: src.reasonCode,
      // Same-session linkage (bridge ≥0.20.x) — drives the collapsible grouping
      // of secondary procedures under their lead in the reports UI.
      partOf: src.partOf,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toEncounter(fhirResource: any): EncounterEntity {
    return {
      meta: fhirResource.meta,
      _sourceRecordComparison: fhirResource._sourceRecordComparison,
      _sourceEncounterRecords: fhirResource._sourceEncounterRecords,
      id: fhirResource.id || '',
      status: fhirResource.status,
      class: fhirResource.class,
      type: fhirResource.type,
      serviceType: fhirResource.serviceType,
      period: fhirResource.period,
      reasonCode: fhirResource.reasonCode,
      reasonReference: fhirResource.reasonReference,
      diagnosis: fhirResource.diagnosis,
      participant: fhirResource.participant,
      location: fhirResource.location,
      serviceProvider: fhirResource.serviceProvider,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toDocumentReference(fhirResource: any): DocumentReferenceEntity {
    return {
      meta: fhirResource.meta ? { source: fhirResource.meta.source, tag: fhirResource.meta.tag } : undefined,
      id: fhirResource.id || '',
      status: fhirResource.status,
      type: fhirResource.type,
      category: fhirResource.category,
      subject: fhirResource.subject,
      date: fhirResource.date,
      author: fhirResource.author,
      description: fhirResource.description,
      content: fhirResource.content,
      context: fhirResource.context,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toComposition(fhirResource: any): CompositionEntity {
    return {
      meta: fhirResource.meta,
      id: fhirResource.id || '',
      status: fhirResource.status,
      type: fhirResource.type,
      category: fhirResource.category,
      subject: fhirResource.subject,
      encounter: fhirResource.encounter,
      date: fhirResource.date,
      author: fhirResource.author,
      title: fhirResource.title,
      text: fhirResource.text,
      section: fhirResource.section,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id
    }
  }

  static toImmunization(fhirResource: any): ImmunizationEntity {
    return {
      id: fhirResource.id || '',
      status: fhirResource.status,
      vaccineCode: fhirResource.vaccineCode,
      occurrenceDateTime: fhirResource.occurrenceDateTime,
      performer: fhirResource.performer,
      note: fhirResource.note,
      manufacturer: fhirResource.manufacturer,
      lotNumber: fhirResource.lotNumber,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id,
    }
  }

  static toConsent(fhirResource: any): ConsentEntity {
    // FHIR R4 Consent. `provision` may be a single object (R4) — keep the
    // first level only; nested sub-provisions aren't surfaced in the card.
    return {
      id: fhirResource.id || '',
      status: fhirResource.status,
      scope: fhirResource.scope,
      category: fhirResource.category,
      dateTime: fhirResource.dateTime,
      provision: fhirResource.provision
        ? {
            type: fhirResource.provision.type,
            period: fhirResource.provision.period,
          }
        : undefined,
      sourceAttachment: fhirResource.sourceAttachment,
      organization: fhirResource.organization,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id,
    }
  }

  static toDevice(fhirResource: any): DeviceEntity {
    return {
      id: fhirResource.id || '',
      status: fhirResource.status,
      type: fhirResource.type,
      manufacturer: fhirResource.manufacturer,
      modelNumber: fhirResource.modelNumber,
      serialNumber: fhirResource.serialNumber,
      udiCarrier: fhirResource.udiCarrier,
      deviceName: fhirResource.deviceName,
      manufactureDate: fhirResource.manufactureDate,
      expirationDate: fhirResource.expirationDate,
      owner: fhirResource.owner,
      note: fhirResource.note,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id,
    }
  }

  static toCarePlan(fhirResource: any): CarePlanEntity {
    return {
      id: fhirResource.id || '',
      status: fhirResource.status,
      intent: fhirResource.intent,
      category: fhirResource.category,
      title: fhirResource.title,
      description: fhirResource.description,
      period: fhirResource.period,
      created: fhirResource.created,
      addresses: fhirResource.addresses,
      activity: fhirResource.activity,
      note: fhirResource.note,
      author: fhirResource.author,
      sourceSystem: FHIR_SOURCE_SYSTEM,
      sourceId: fhirResource.id,
    }
  }
}

// Singleton instance for the mapper registry pattern
export const fhirDataMapper = new FhirMapper()

// Auto-register to the mapper registry
dataMapperRegistry.register(fhirDataMapper)
