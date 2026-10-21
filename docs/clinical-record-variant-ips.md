# Automatic source selection and legacy IPS modifiers

The application canonical `https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant` is **not yet published** as a resolvable FHIR StructureDefinition. This change does not publish or deploy it. Receivers must not assume that they understand the extension merely because its URL is present.

The normal application path automatically selects an applicable record from each established same-record group before UI, AI, CDSS and IPS export. No source-reconciliation task is presented to the user. Original versions remain in the immutable graph and original download. A legacy explicitly annotated input passed directly to a low-level exporter still places its annotation in `modifierExtension`, never ordinary `extension`; receivers must understand that modifier before interpreting that legacy resource as an independent clinical fact.

Children are `groupId` (string), `classification` (code: revision or conflict), `variantCount` (positiveInt), `reason` (string), and optional `sourceId` (string), `versionId` (string), and `sourceResourceType` (code). Group identity is local to the captured source scope, not a global patient identity.

Explicit legacy annotations and genuinely unavailable medication content include a neutral statement of the available evidence and exported clinical fields in the XHTML narrative. Existing narrative content is preserved. Finalization happens after resource mapping so a later mapper text field cannot overwrite the modifier meaning. Original resource versions remain in the source graph and raw download.

This follows [FHIR R4 modifier extension handling](https://hl7.org/fhir/R4/extensibility.html#modifierExtension). The built-in IPS lite validator checks document structure only; it does not establish full HL7 IPS profile conformance or publish this canonical.

## Import and roundtrip contract

The shared decoder recognizes exactly the two application canonicals below. It validates required child names, value types, supported codes, uniqueness and counts. A malformed recognized modifier, or one moved into ordinary extension, rejects a Local import when it affects a projectable clinical record or referenced clinical content. Source-only unknown resources, audit/history snapshots and foreign-patient nodes remain raw evidence and do not trigger modifier validation as clinical facts. SMART reads quarantine the affected projectable records and expose domain incompleteness with invalidModifierCount, while preserving unrelated records and any independent query failure. No revision count is invented for malformed modifiers. Unrelated modifier vocabularies are not implemented by this decoder.

Validated legacy annotations remain in raw source evidence. The clinical projection automatically selects an applicable available record, including when only one record is present. Original source identifiers and version labels are audit metadata and cannot establish patient ownership or record equivalence. Imported group labels never join different logical resource identities. Comparable meta.lastUpdated values establish update order; clinical event dates and opaque version IDs do not. Without update ordering, retractions remain effective, medication stop/hold states stay conservative, and active Condition/Allergy evidence remains available for safety assessment.

Supported export mapper families are AllergyIntolerance, MedicationStatement (including source MedicationRequest), Condition, Immunization, Procedure, Observation (vital signs and results), DiagnosticReport, Device/DeviceUseStatement, CarePlan and Consent. Other raw source resources remain available in the source graph; this is not a promise that every resource type has an IPS mapper.

## Unresolved medication content

The independent canonical `https://mediprisma.app/fhir/StructureDefinition/medication-content-uncertainty` is also **not yet published**. Its modifier has one required child, `reason` (valueCode), with supported values `ambiguous-reference`, `unresolved-reference` and `missing-medication-code`. It applies only to MedicationRequest and MedicationStatement. On another projectable clinical resource it is invalid and follows the same rejection/quarantine boundary. It says the prescription exists while the referenced drug content is unknown; it does not assert that the prescription itself has multiple versions.

The exporter carries this modifier and a neutral content-unavailable statement, without requesting manual reconciliation. The medication choice carries the standard data-absent-reason extension instead of inventing a drug code or a resolved reference target. Reimport retains the content uncertainty, medication inventory remains unknown in CDSS, and AI/tools cannot conclude medication absence. Original references remain available in the source graph/raw original; this modifier does not fabricate a replacement resolution.

The lite validator remains structural only. These tests verify the application roundtrip and decision boundaries; they are not a full external HL7 IPS validator or proof that another receiver understands unpublished modifier definitions.
