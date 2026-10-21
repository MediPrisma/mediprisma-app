import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { excludeUnresolvedDecisionVariants, formatClinicalVariantExclusions } from '@/src/core/utils/clinical-variant-inputs'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { hfFollowUpHistory } from '@/features/clinical-decision-support/utils/hf-follow-up'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'

function collection(code = '2823-3') {
 const obs = (id: string, date: string, value: number, version?: string) => ({ resourceType: 'Observation', id, status: 'final', code: { coding: [{ system: 'http://loinc.org', code }] }, effectiveDateTime: date, valueQuantity: { value, unit: code === '29463-7' ? 'kg' : 'mmol/L' }, ...(version ? { meta: { versionId: version } } : {}) })
 return LocalBundleService.parse({ resourceType: 'Bundle', entry: [ { resourceType: 'Patient', id: 'synthetic' }, obs('old', '2026-07-01', 4.1), obs('pending', '2026-10-01', 5, '1'), obs('pending', '2026-10-01', 6.2, '2'), { ...obs('unrelated', '2026-07-01', 140), code: { coding: [{ system: 'http://loinc.org', code: '2951-2' }] } } ].map(resource => ({ resource })) } as any)!.collection
}
it('does not resurrect an old potassium value through actual Local, CDSS, autofill or AI inputs', () => {
 const data = collection()
 expect(data.observations).toHaveLength(4)
 const selected = excludeUnresolvedDecisionVariants(data)
 expect(selected.observations.map(row => row.valueQuantity?.value)).toEqual([140])
 expect(selected.clinicalRecordVariantExclusions).toHaveLength(2)
 expect(JSON.stringify(selected.clinicalRecordVariantExclusions)).not.toMatch(/valueQuantity/)
 expect(formatClinicalVariantExclusions(selected)).toMatch(/2823-3.*2026-10-01/)
 const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'synthetic', age: 70, gender: 'male' } })
 expect(JSON.stringify(profile.facts)).not.toContain('4.1')
 expect(profile.excludedClinicalRecordVariants?.filter(row => row.resourceType === 'Observation')).toHaveLength(2)
 const autofill = buildAutofill(data.observations, {})
 expect(JSON.stringify(autofill)).not.toContain('4.1')
 const ai = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [], Date.parse('2026-10-02'))
 expect(ai.observations?.some(row => row.valueQuantity?.value === 4.1)).toBe(false)
 expect(JSON.stringify(ai.clinicalRecordVariantExclusions)).toContain('2823-3')
})
it('does not resurrect an old HF weight, but a later resolved measurement can supersede pending evidence', () => {
 const data = collection('29463-7')
 expect(hfFollowUpHistory(data.observations).weights).toEqual([])
 const resolved = { ...data.observations.find(row => !row.clinicalRecordVariant)!, id: 'later', effectiveDateTime: '2026-10-02', valueQuantity: { value: 75, unit: 'kg' } }
 expect(hfFollowUpHistory([...data.observations, resolved]).weights.map(row => row.value)).toEqual([75])
})

it.each([{ effectivePeriod: { start: '2026-10-03' } }, { issued: '2026-10-03' }])('accepts a later resolved measurement with its supported date shape %p', date => {
 const data = collection()
 const prior = data.observations.find(row => !row.clinicalRecordVariant)!
 const later = { ...prior, id: 'resolved-later', effectiveDateTime: undefined, ...date, valueQuantity: { value: 4.3, unit: 'mmol/L' } }
 expect(excludeUnresolvedDecisionVariants({ observations: [...data.observations, later] }).observations).toContain(later)
})
