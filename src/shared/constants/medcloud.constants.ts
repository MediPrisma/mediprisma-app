export const MEDCLOUD_FHIR_BASE = 'https://cloud-wildcatch.invalid/fhir'

export const MEDCLOUD_SINGLE_PRESCRIPTION_REMAINING_DAYS_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-single-prescription-remaining-days`

/** Three-character ATC group carried by MediCloud IMUE0008 prescriptions.
 * The App's governed ATC model calls this WHO hierarchy level 2 because ATC
 * levels and code length use different numbering. */
export const MEDCLOUD_ATC_LEVEL_3_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-atc-level-3`

/** Source ATC/drug-class display retained when MediCloud's nominal ATC3 code
 * field contains a human-readable class name instead of a WHO code. */
export const MEDCLOUD_SOURCE_DRUG_CLASS_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-source-drug-class`

export const MEDCLOUD_SOURCE_SETTING_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-source-setting`

export const MEDCLOUD_RELATED_REMAINING_SUMMARY_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-related-medication-remaining-summary`

export const MEDCLOUD_REMAINING_SUMMARY_EXTENSION_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-medication-remaining-summary`

export const MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM =
  `${MEDCLOUD_FHIR_BASE}/CodeSystem/medcloud-basic-resource-type`

export const MEDCLOUD_REMAINING_SUMMARY_CODE = 'medication-remaining-summary'

export const MEDCLOUD_DRUG_GROUP_IDENTIFIER_SYSTEM =
  `${MEDCLOUD_FHIR_BASE}/IdentifierSystem/medcloud-drug-group`

/** MediCloud IMUE0200 special-material (特材) claim record, kept as a Basic. */
export const MEDCLOUD_SPECIAL_MATERIAL_CODE = 'special-material-record'

export const MEDCLOUD_SPECIAL_MATERIAL_EXTENSION_URL =
  `${MEDCLOUD_FHIR_BASE}/StructureDefinition/medcloud-special-material-record`
