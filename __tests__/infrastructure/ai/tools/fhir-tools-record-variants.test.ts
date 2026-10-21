/** @jest-environment node */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

it.each(['MedicationRequest', 'Observation', 'Procedure'])('marks recent visit counts incomplete when linked %s versions were excluded', async resourceType => {
  const resources: any[] = [
    { resourceType: 'Patient', id: 'synthetic' },
    { resourceType: 'Encounter', id: 'visit', status: 'finished', period: { start: '2026-10-01' }, subject: { reference: 'Patient/synthetic' } },
    ...['1', '2'].map(version => ({ resourceType, id: 'record', meta: { versionId: version }, status: 'active',
      encounter: { reference: 'Encounter/visit' }, code: { text: 'Unresolved ' + version },
      medicationCodeableConcept: { text: 'Unresolved ' + version }, valueQuantity: { value: Number(version) },
    })),
  ]
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  const result = await (tools.getRecentVisits as any).execute({ limit: 5 })
  expect(result).toMatchObject({ success: true, count: 1, incomplete: true, canConcludeAbsence: false })
  expect(result.clinicalRecordVariantExclusions).toHaveLength(2)
  expect(result.clinicalRecordVariantExclusions.every((row: any) => row.resourceType === resourceType)).toBe(true)
})

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
    expect(result.clinicalRecordVariantExclusions).toHaveLength(2)
    expect(result.sourceRecordUncertainty).toContain('Do not infer absent disease, negative history, no medication')
    expect(JSON.stringify(result)).not.toContain('clinicalSourceNodeKey')
  }
})

it('reports domain uncertainty machine-readably when actual condition and medication versions are excluded', async () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'Condition', id: 'sensitive-source-condition', meta: { versionId: version }, code: { text: version } })
    resources.push({ resourceType: 'MedicationRequest', id: 'sensitive-source-order', meta: { versionId: version }, status: 'active', medicationCodeableConcept: { text: version } })
  }
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  const result = await (tools.getDataOverview as any).execute({})
  expect(result).toMatchObject({ incomplete: true, canConcludeAbsence: false })
  for (const field of ['conditions', 'medications']) expect(result.data[field]).toMatchObject({ count: 0, incomplete: true, canConcludeAbsence: false, recordState: 'unresolved-variants', unresolvedVariantCount: 2 })
  expect(result.data.allergies).toMatchObject({ count: 0, incomplete: false, canConcludeAbsence: true, recordState: 'complete' })
  const allergies = await (tools.queryAllergies as any).execute({})
  expect(allergies.clinicalRecordVariantExclusions).toBeUndefined()
  expect(allergies.incomplete).not.toBe(true)
  const medications = await (tools.queryMedications as any).execute({})
  expect(medications).toMatchObject({ incomplete: true, canConcludeAbsence: false })
  expect(medications.clinicalRecordVariantExclusions.every((row: any) => row.resourceType === 'MedicationRequest')).toBe(true)
  expect(JSON.stringify(result)).not.toContain('sensitive-source')
})

it('does not expose unresolved Observation or DiagnosticReport variants as tool facts', async () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'Observation', id: 'lab', meta: { versionId: version }, status: 'final', code: { text: 'Weight' }, valueQuantity: { value: Number(version) * 70, unit: 'kg' } })
    resources.push({ resourceType: 'DiagnosticReport', id: 'report', meta: { versionId: version }, code: { text: 'Echo' }, conclusion: 'EF ' + Number(version) * 30 + '%' })
  }
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection: parsed.collection }))
  for (const tool of [tools.queryObservations, tools.queryDiagnosticReports]) {
    const result = await (tool as any).execute({})
    expect(result).toMatchObject({ count: 0, incomplete: true, canConcludeAbsence: false })
    expect(result.clinicalRecordVariantExclusions).toHaveLength(4)
    expect(JSON.stringify(result.data)).not.toMatch(/70|140|EF/)
  }
})
