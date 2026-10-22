import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { hfFollowUpHistory } from '@/features/clinical-decision-support/utils/hf-follow-up'
import { GenerateClinicalContextUseCase } from '@/src/core/use-cases/clinical-context/generate-clinical-context.use-case'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { excludeUnresolvedGenericVariants } from '@/src/core/utils/clinical-variant-inputs'

it('keeps raw UI measurements but excludes source variants from actual history, calculator and AI context decisions', () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }, { resourceType: 'Observation', id: 'normal', code: { coding: [{ system: 'http://loinc.org', code: '2093-3' }] }, valueQuantity: { value: 200, unit: 'mg/dL' }, effectiveDateTime: '2026-10-01', status: 'final' }]
  for (const version of ['1', '2']) resources.push({ resourceType: 'Observation', id: 'private-source-weight', meta: { versionId: version }, status: 'final', code: { text: 'Weight', coding: [{ system: 'http://loinc.org', code: '29463-7' }] }, category: [{ coding: [{ code: 'vital-signs' }] }], valueQuantity: { value: Number(version) * 70, unit: 'kg' }, effectiveDateTime: '2026-10-01' })
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  expect(data.observations).toHaveLength(2)
  const value=data.observations.find(row=>row.code?.text==='Weight')!.valueQuantity!.value
  expect(hfFollowUpHistory(data.observations).weights.map(row=>row.value)).toEqual([value])
  const autofill = buildAutofill(data.observations, {})
  expect(autofill.resolve({ kind: 'vital', loinc: ['29463-7'] })?.value).toBe(value)
  expect(autofill.resolve({ kind: 'lab', keys: ['CHOL'] })?.value).toBe(200)
  const formatter = new GenerateClinicalContextUseCase()
  const text = formatter.formatSections(formatter.execute(null, data, { selection: ALL_DATA_SELECTION, filters: ALL_DATA_FILTERS }))
  expect(text).not.toContain('These records exist but their versions or conflicts are unresolved')
  expect(text).not.toContain('private-source-weight')
  expect(text).toContain(`${value} kg`)
})

it('preserves no-op collection and document-array identity at the AI boundary', () => {
  const input = { conditions: [{ id: 'normal' }], medications: [], documentReferences: [{ id: 'doc', content: [] }] }
  const selected = excludeUnresolvedGenericVariants(input)
  expect(selected).toBe(input)
  expect(selected.documentReferences).toBe(input.documentReferences)
})
