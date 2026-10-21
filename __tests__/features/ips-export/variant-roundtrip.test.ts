import { validateIpsBundle } from '@/features/ips-export/utils/ips-lite-validator'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalRecordVariants } from '@/src/core/services/clinical-record-variants'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { CLINICAL_MEDICATION_CONTENT_EXTENSION } from '@/features/ips-export/utils/ips-constants'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { buildIpsBundle } from '@/features/ips-export/utils/ips-builder'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { CLINICAL_RECORD_VARIANT_EXTENSION } from '@/features/ips-export/utils/ips-constants'

function original() {
 const patient = { resourceType: 'Patient', id: 'synthetic', name: [{ family: 'Synthetic' }] }
 const resources = [patient, { resourceType: 'Condition', id: 'unrelated', code: { text: 'Independent condition' } }, ...['1', '2'].flatMap(versionId => [
  { resourceType: 'Condition', id: 'condition', meta: { versionId }, code: { text: 'Condition version ' + versionId } },
  { resourceType: 'MedicationRequest', id: 'medication', meta: { versionId }, status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Medication version ' + versionId } },
  { resourceType: 'Observation', id: 'potassium', meta: { versionId }, status: 'final', effectiveDateTime: '2026-10-01', code: { coding: [{ system: 'http://loinc.org', code: '2823-3' }], text: 'Potassium' }, valueQuantity: { value: versionId === '1' ? 5 : 6.2, unit: 'mmol/L' } },
 ])]
 return LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!
}
it('retains unresolved modifiers through actual IPS export, reimport, aggregate and AI/CDSS selection', () => {
 const parsed = original()
 const bundle = buildIpsBundle({ patient: parsed.patient!, data: parsed.collection })
 const roundtrip = LocalBundleService.parse(bundle as any)!
 expect(roundtrip).not.toBeNull()
 const projected = projectClinicalAggregate(roundtrip.collection)
 const uncertain = [...projected.conditions, ...projected.medications, ...projected.observations].filter(row => row.clinicalRecordVariant)
 expect(uncertain).toHaveLength(6)
 expect(projected.medications.every(row => row._sourceResourceType === 'MedicationRequest')).toBe(true)
 expect(uncertain.every(row => row.clinicalRecordVariant!.variantCount === 2)).toBe(true)
 expect(new Set(uncertain.map(row => row.sourceVersionId))).toEqual(new Set(['1', '2']))
 const selected = selectCdssClinicalInputs(projected)
 expect(selected.input.conditions.map(row => row.code?.text)).toEqual(['Independent condition'])
 expect(selected.input.medications).toEqual([])
 expect(selected.input.observations).toEqual([])
 const ai = scopeClinicalDataForAi(projected, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
 expect(ai.medications).toEqual([])
 expect(ai.observations).toEqual([])
 expect(ai.conditions?.map(row => row.code?.text)).toEqual(['Independent condition'])
})
it('keeps a single exported unresolved variant quarantined and rejects a malformed known modifier', () => {
 const parsed = original()
 const bundle = buildIpsBundle({ patient: parsed.patient!, data: parsed.collection })
 const first = bundle.entry.find(entry => entry.resource.resourceType === 'Condition' && (entry.resource.modifierExtension as any[])?.some(extension => extension.url === CLINICAL_RECORD_VARIANT_EXTENSION))!
 const patient = bundle.entry.find(entry => entry.resource.resourceType === 'Patient')!
 const one = { resourceType: 'Bundle', entry: [patient, first] }
 const imported = LocalBundleService.parse(one as any)!
 expect(projectClinicalAggregate(imported.collection).conditions[0].clinicalRecordVariant?.variantCount).toBe(2)
 const malformed = JSON.parse(JSON.stringify(one))
 malformed.entry[1].resource.modifierExtension[0].extension.find((field: any) => field.url === 'classification').valueCode = 'resolved'
 expect(() => LocalBundleService.parse(malformed)).toThrow(/modifier|variant/i)
})

it.each([
 ['allergies', 'AllergyIntolerance', { clinicalStatus: { coding: [{ code: 'active' }] }, code: { text: 'Synthetic allergy' } }],
 ['medications', 'MedicationRequest', { status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Synthetic medication' } }],
 ['conditions', 'Condition', { code: { text: 'Synthetic condition' } }],
 ['immunizations', 'Immunization', { status: 'completed', vaccineCode: { text: 'Synthetic vaccine' }, occurrenceDateTime: '2026-10-01' }],
 ['procedures', 'Procedure', { status: 'completed', code: { text: 'Synthetic procedure' }, performedDateTime: '2026-10-01' }],
 ['observations', 'Observation', { status: 'final', category: [{ coding: [{ code: 'vital-signs' }] }], code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] }, effectiveDateTime: '2026-10-01', valueQuantity: { value: 70, unit: 'kg' } }],
 ['diagnosticReports', 'DiagnosticReport', { status: 'final', category: [{ coding: [{ code: 'LAB' }] }], code: { text: 'Synthetic report' }, conclusion: 'Synthetic conclusion', effectiveDateTime: '2026-10-01' }],
 ['devices', 'Device', { status: 'active', type: { text: 'Synthetic device' } }],
 ['carePlans', 'CarePlan', { status: 'active', intent: 'plan', title: 'Synthetic care plan' }],
 ['consents', 'Consent', { status: 'active', scope: { text: 'Synthetic consent' } }],
] as const)('preserves the modifier across the supported %s mapper family', (key, resourceType, fields) => {
 const patient = { resourceType: 'Patient', id: 'synthetic' }
 const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: [patient, ...['1', '2'].map(versionId => ({ ...fields, resourceType, id: 'record', meta: { versionId } }))].map(resource => ({ resource })) } as any)!
 const exported = buildIpsBundle({ patient: data.patient!, data: data.collection })
 const imported = LocalBundleService.parse(exported as any)!
 const rows = projectClinicalAggregate(imported.collection)[key]
 expect(rows).toHaveLength(2)
 expect(rows.every(row => row.clinicalRecordVariant?.variantCount === 2)).toBe(true)
 expect(new Set(rows.map(row => row.sourceVersionId))).toEqual(new Set(['1', '2']))
})
it('preserves independent unresolved medication content through export, reimport, AI and CDSS', async () => {
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resourceType: 'Patient', id: 'synthetic' }, { resourceType: 'MedicationRequest', id: 'prescription', status: 'active', intent: 'order', medicationReference: { reference: 'Medication/drug' } }, ...['1', '2'].map(versionId => ({ resourceType: 'Medication', id: 'drug', meta: { versionId }, code: { text: 'Unresolved drug ' + versionId } }))].map(resource => ({ resource })) } as any)!
 const bundle = buildIpsBundle({ patient: parsed.patient!, data: parsed.collection })
 const statement = bundle.entry.find(entry => entry.resource.resourceType === 'MedicationStatement')!.resource
 expect(validateIpsBundle(bundle).ok).toBe(true)
 expect(statement.modifierExtension).toContainEqual(expect.objectContaining({ url: CLINICAL_MEDICATION_CONTENT_EXTENSION }))
 expect(statement.modifierExtension).not.toContainEqual(expect.objectContaining({ url: CLINICAL_RECORD_VARIANT_EXTENSION }))
 expect((statement.text as any).div).toMatch(/prescription exists.*medication content is unresolved/)
 expect((statement.medicationCodeableConcept as any).coding).toBeUndefined()
 const imported = projectClinicalAggregate(LocalBundleService.parse(bundle as any)!.collection)
 expect(imported.medications).toHaveLength(1)
 expect(imported.medications[0].clinicalMedicationContentUncertainty?.reason).toBe('ambiguous-reference')
 expect(imported.medications[0].clinicalRecordVariant).toBeUndefined()
 expect(imported.medications[0].medicationCodeableConcept).toBeUndefined()
 const profile = createHospitalAwareCdssPatientProfile({ ...imported, patient: { id: 'synthetic', age: 70, gender: 'male' } })
 expect(profile.hospitalMedicationInventoryUnresolved).toBeDefined()
 const ai = scopeClinicalDataForAi(imported, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
 expect(ai.medications?.[0].clinicalMedicationContentUncertainty).toEqual({ reason: 'ambiguous-reference' })
 const overview: any = await createFhirTools(() => ({ patient: null, collection: imported })).getDataOverview.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(overview.data.medications).toMatchObject({ incomplete: true, canConcludeAbsence: false })
 const malformed = JSON.parse(JSON.stringify(bundle))
 malformed.entry.find((entry: any) => entry.resource.resourceType === 'MedicationStatement').resource.modifierExtension[0].extension[0].valueCode = 'resolved'
 expect(() => LocalBundleService.parse(malformed)).toThrow(/medication content.*modifier/i)
})

it.each(['duplicate-child', 'missing-reason', 'invalid-count', 'unknown-child', 'ordinary-extension', 'wrong-container'])('rejects malformed known record modifiers: %s', malformedCase => {
 const parsed = original()
 const bundle: any = buildIpsBundle({ patient: parsed.patient!, data: parsed.collection })
 const resource = bundle.entry.find((entry: any) => entry.resource.resourceType === 'Condition' && entry.resource.modifierExtension)?.resource
 const modifier = resource.modifierExtension[0]
 if (malformedCase === 'duplicate-child') modifier.extension.push({ ...modifier.extension[0] })
 if (malformedCase === 'missing-reason') modifier.extension = modifier.extension.filter((field: any) => field.url !== 'reason')
 if (malformedCase === 'invalid-count') modifier.extension.find((field: any) => field.url === 'variantCount').valuePositiveInt = 1
 if (malformedCase === 'unknown-child') modifier.extension.push({ url: 'preferred-version', valueBoolean: true })
 if (malformedCase === 'ordinary-extension') { resource.extension = resource.modifierExtension; delete resource.modifierExtension }
 if (malformedCase === 'wrong-container') resource.modifierExtension = modifier
 expect(() => LocalBundleService.parse(bundle)).toThrow(/modifier/i)
})
it('scopes imported group labels to the actual source and patient rather than trusting audit ids as equivalence', () => {
 const modifier = { url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: [{ url: 'groupId', valueString: 'same-exported-label' }, { url: 'classification', valueCode: 'conflict' }, { url: 'variantCount', valuePositiveInt: 2 }, { url: 'reason', valueString: 'Original unresolved content' }, { url: 'sourceId', valueString: 'same-audit-id' }] }
 const source = reconcileClinicalSources(['one', 'two'].map(sourceId => ({ sourceId, patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'Condition', id: 'same', modifierExtension: [modifier] }] })))
 const variants = createClinicalRecordVariants(source)
 expect(new Set([...variants.values()].map(item => item.groupId)).size).toBe(2)
 expect(source.evidence.sameRecord).toHaveLength(0)
})
