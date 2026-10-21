# Unresolved source records in IPS exports

The application canonical `https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant` is **not yet published** as a resolvable FHIR StructureDefinition. This change does not publish or deploy it. Receivers must not assume that they understand the extension merely because its URL is present.

Exports place this complex extension in `modifierExtension`, never ordinary `extension`. It means the resource is one unresolved revision or conflicting representation of a source record, not a confirmed independent concurrent clinical event. No preferred version or chronology is asserted. A receiver that cannot interpret this modifier must not use the resource as an ordinary clinical fact.

Children are `groupId` (string), `classification` (code: revision or conflict), `variantCount` (positiveInt), `reason` (string), and optional `sourceId` (string), `versionId` (string), and `sourceResourceType` (code). Group identity is local to the captured source scope, not a global patient identity.

Every affected exported resource includes a human-readable reconciliation notice and its exported clinical fields in its XHTML narrative. Existing narrative content is preserved. Finalization happens after resource mapping so a later mapper text field cannot overwrite the modifier meaning. Original resource versions remain in the source graph and raw download.

This follows [FHIR R4 modifier extension handling](https://hl7.org/fhir/R4/extensibility.html#modifierExtension). The built-in IPS lite validator checks document structure only; it does not establish full HL7 IPS profile conformance or publish this canonical.

## Import and roundtrip contract

The shared decoder recognizes exactly the two application canonicals below. It validates required child names, value types, supported codes, uniqueness and counts. A malformed recognized modifier, or one moved into ordinary extension, rejects the import rather than silently restoring a confirmed fact. Unrelated modifier vocabularies are not implemented by this decoder.

Validated record-variant annotations survive IPS reimport, aggregate projection and AI/CDSS quarantine, including when only one of an originally larger unresolved group is present. Original source identifiers and version labels are restored as audit metadata; they do not establish patient ownership or record equivalence. Imported group labels are scoped to the new captured source and patient. No latest version is selected.

Supported export mapper families are AllergyIntolerance, MedicationStatement (including source MedicationRequest), Condition, Immunization, Procedure, Observation (vital signs and results), DiagnosticReport, Device/DeviceUseStatement, CarePlan and Consent. Other raw source resources remain available in the source graph; this is not a promise that every resource type has an IPS mapper.

## Unresolved medication content

The independent canonical `https://mediprisma.app/fhir/StructureDefinition/medication-content-uncertainty` is also **not yet published**. Its modifier has one required child, `reason` (valueCode), with supported values `ambiguous-reference`, `unresolved-reference` and `missing-medication-code`. It says the prescription exists while the referenced drug content is unknown; it does not assert that the prescription itself has multiple versions.

The exporter carries this modifier and a human-readable reconciliation notice. The medication choice carries the standard data-absent-reason extension instead of inventing a drug code or a resolved reference target. Reimport retains the content uncertainty, medication inventory remains unknown in CDSS, and AI/tools cannot conclude medication absence. Original references remain available in the source graph/raw original; this modifier does not fabricate a replacement resolution.

The lite validator remains structural only. These tests verify the application roundtrip and decision boundaries; they are not a full external HL7 IPS validator or proof that another receiver understands unpublished modifier definitions.
