/** @jest-environment node */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

it('keeps unresolved medication and condition versions out of actual tool facts and reports why', async () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'MedicationRequest', id: 'med', meta: { versionId: version }, status: 'active', medicationCodeableConcept: { text: 'Synthetic medication ' + version } })
    resources.push({ resourceType: 'Condition', id: 'condition', meta: { versionId: version }, code: { text: 'Synthetic condition ' + version } })
  }
  resources.push({ resourceType: 'MedicationRequest', id: 'normal-med', status: 'active', medicationCodeableConcept: { text: 'Normal medication' } })
  resources.push({ resourceType: 'Condition', id: 'normal-condition', code: { text: 'Normal condition' } })
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  for (const name of ['queryMedications', 'queryConditions'] as const) {
    const result = await (tools[name] as any).execute({})
    expect(result.count).toBe(1)
    expect(result.clinicalRecordVariantExclusions).toHaveLength(4)
    expect(result.sourceRecordUncertainty).toContain('Do not infer absent disease, negative history, no medication')
    expect(JSON.stringify(result)).not.toContain('clinicalSourceNodeKey')
  }
})
