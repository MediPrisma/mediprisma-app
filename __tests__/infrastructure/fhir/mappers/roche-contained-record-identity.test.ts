import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'

it('retains source identity through Roche contained medication normalization and date-attached conditions', () => {
  const contained: any[] = []
  for (const version of ['1', '2']) {
    for (const resourceType of ['MedicationRequest', 'MedicationStatement']) contained.push({ resourceType, id: resourceType.toLowerCase(), meta: { versionId: version }, status: 'active', subject: { reference: 'Patient/synthetic' }, medicationCodeableConcept: { text: 'Synthetic medication' }, effectiveDateTime: '2026-10-01', authoredOn: '2026-10-01', dosage: [{ text: version + ' tablets' }], dosageInstruction: [{ text: version + ' tablets' }] })
    contained.push({ resourceType: 'Condition', id: 'diagnosis', meta: { versionId: version }, subject: { reference: 'Patient/synthetic' }, recordedDate: '2026-10-01', code: { text: 'Synthetic diagnosis ' + version } })
  }
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic' } },
    { resource: { resourceType: 'Encounter', id: 'visit', period: { start: '2026-10-01' } } },
    { resource: { resourceType: 'List', id: 'roche', code: { coding: [{ system: 'https://dip.roche.com/synthetic', code: 'clinical' }] }, contained } },
  ] } as any)!.collection
  expect(data.clinicalSource!.evidence.revision.length).toBeGreaterThan(0)
  expect(data.medications).toHaveLength(4)
  expect(data.conditions).toHaveLength(2)
  for (const row of [...data.medications, ...data.conditions]) {
    expect(row.clinicalSourceNodeKey).toBeDefined()
    expect(row.clinicalRecordVariant).toMatchObject({ classification: 'revision', variantCount: 2 })
    expect(row.sourceVersionId).toMatch(/^[12]$/)
  }
  expect(data.conditions.every(row => row.encounter?.reference === 'Encounter/visit')).toBe(true)
  expect(selectCdssClinicalInputs(data).excluded).toHaveLength(6)
  const scoped = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  expect(scoped.medications).toEqual([])
  expect(scoped.conditions).toEqual([])
  expect(scoped.clinicalRecordVariantExclusions).toHaveLength(6)
})
