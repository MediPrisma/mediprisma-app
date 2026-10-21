# Unresolved source records in IPS exports

The application canonical `https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant` is **not yet published** as a resolvable FHIR StructureDefinition. This change does not publish or deploy it. Receivers must not assume that they understand the extension merely because its URL is present.

Exports place this complex extension in `modifierExtension`, never ordinary `extension`. It means the resource is one unresolved revision or conflicting representation of a source record, not a confirmed independent concurrent clinical event. No preferred version or chronology is asserted. A receiver that cannot interpret this modifier must not use the resource as an ordinary clinical fact.

Children are `groupId` (string), `classification` (code: revision or conflict), `variantCount` (positiveInt), `reason` (string), and optional `sourceId` (string), `versionId` (string), and `sourceResourceType` (code). Group identity is local to the captured source scope, not a global patient identity.

Every affected exported resource includes a human-readable reconciliation notice and its exported clinical fields in its XHTML narrative. Existing narrative content is preserved. Finalization happens after resource mapping so a later mapper text field cannot overwrite the modifier meaning. Original resource versions remain in the source graph and raw download.

This follows [FHIR R4 modifier extension handling](https://hl7.org/fhir/R4/extensibility.html#modifierExtension). The built-in IPS lite validator checks document structure only; it does not establish full HL7 IPS profile conformance or publish this canonical.
