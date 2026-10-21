import { CARE_PACKS } from '@voho0000/personalized-care'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'
import { buildVisitModel } from '@/features/clinical-decision-support/renderers/visit/visit-model.source'

function profileFor(type: string, confirmed = false, confirmedName = 'Apixaban (Eliquis) FC tab 5 mg') {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }, ...['I50.2', 'I48.91', 'I10'].map(code => ({ resourceType: 'Condition', id: code, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] } }))]
  for (const [code, value, unit] of [['10230-1', 35, '%'], ['33914-3', 60, 'mL/min/1.73m2'], ['2823-3', 4, 'mmol/L'], ['8480-6', 135, 'mmHg'], ['8867-4', 75, '/min']] as const) resources.push({ resourceType: 'Observation', id: code, status: 'final', effectiveDateTime: '2026-10-01', code: { coding: [{ system: 'http://loinc.org', code }] }, valueQuantity: { value, unit } })
  for (const version of ['1', '2']) resources.push({ resourceType: type, id: 'unresolved', meta: { versionId: version }, status: 'active', subject: { reference: 'Patient/synthetic' }, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'N18.4' }], text: 'Unresolved record' }, medicationCodeableConcept: { text: 'Unknown medicine ' + version }, period: { start: '2026-10-01' }, performedDateTime: '2026-10-01' })
  if (confirmed) resources.push({ resourceType: 'MedicationStatement', id: 'confirmed', status: 'active', effectiveDateTime: '2026-09-25', medicationCodeableConcept: { text: confirmedName, coding: [{ system: 'urn:oid:vgh.medication.generic', display: confirmedName }] } })
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  return createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'synthetic', age: 70, gender: 'male' }, now: new Date('2026-10-02') })
}
const pack = (id: string) => CARE_PACKS.find(pack => pack.id === id)!

it('does not invent anticoagulant, NSAID or nephrotoxin exposures from uncertainty and keeps AF map pending', () => {
  const profile = profileFor('MedicationRequest')
  for (const key of ['currentDoac', 'currentVitaminKAntagonist', 'currentOralAnticoagulant', 'currentNsaid', 'currentPotentialNephrotoxin', 'currentHyperkalemiaRiskMedication']) expect(profile.facts[key]).toBeUndefined()
  expect(profile.facts.medicationInventoryUnresolved).toBeDefined()
  const result = buildHospitalAwareCdssResult(pack('atrial-fibrillation-cdss'), profile, 'en')
  const model = buildVisitModel({ packId: result.packId, result, profile, locale: 'en' })!
  const point = model.points.find(point => (point.decisionId ?? point.semanticId) === 'af-oac-whether')!
  expect(point.state).not.toBe('done')
  expect(point.headline).not.toMatch(/on anticoagulation/i)
  expect(point.actions).toEqual([])
  expect(point.scoreTable?.pending).toBe(true)
  expect(point.needsData?.join(' ')).toMatch(/reconcil|medication/i)
})

it('preserves a verified medication overview alongside unresolved records', () => {
  const profile = profileFor('MedicationRequest', true)
  expect(profile.facts.medicationListOverview.en).toMatch(/apixaban/i)
  expect(profile.facts.medicationListOverview.en).toMatch(/unresolved/i)
  expect(profile.facts.currentDoac).toBeDefined()
  expect(profile.afMedicationRegimens?.length).toBeGreaterThan(0)
})

it.each(['Condition', 'AllergyIntolerance', 'Encounter', 'Procedure'])('keeps non-safety therapy decisions pending while %s records are unresolved', type => {
  const profile = profileFor(type)
  const result = buildHospitalAwareCdssResult(pack('heart-failure-cdss'), profile, 'en')
  const therapy = result.recommendations.filter(item => item.domain !== 'safety' && (item.domain === 'medication' || item.presentationType === 'medication' || item.visitDecision?.actions.some(action => action.decisionKind === 'prescribed' || action.decisionKind === 'dose-adjusted')))
  expect(therapy.length).toBeGreaterThan(0)
  expect(therapy.every(item => item.status === 'needs-data' && item.visitDecision === undefined)).toBe(true)
  expect(therapy.every(item => item.missingData?.some(text => /source record|reconcil/i.test(text)))).toBe(true)
  expect(profile.excludedClinicalRecordVariants?.some(item => item.resourceType === type)).toBe(true)
})


it('does not affirm a negative safety scan from unresolved allergies but retains verified NSAID safety alerts', () => {
  const unknown = profileFor('AllergyIntolerance')
  const clear = buildHospitalAwareCdssResult(pack('heart-failure-cdss'), unknown, 'en').recommendations.find(item => item.id === 'heart-failure-medication-safety')!
  expect(clear.status).toBe('needs-data')
  expect(clear.title).not.toMatch(/no medication|no contraindication/i)
  expect(clear.evidenceTables?.flatMap(table => table.items).filter(row => !row.sources?.length).every(row => row.direction !== 'against')).toBe(true)
  const positive = profileFor('AllergyIntolerance', true, 'Diclofenac sodium tab 25 mg')
  const native = pack('heart-failure-cdss').build({ profile: positive, locale: 'en' }).recommendations.find(item => item.id === 'heart-failure-medication-safety')!
  expect(['actionable', 'review']).toContain(native.status)
  const retained = buildHospitalAwareCdssResult(pack('heart-failure-cdss'), positive, 'en').recommendations.find(item => item.id === native.id)!
  expect(retained.status).toBe(native.status)
  expect(retained.title).toBe(native.title)
  expect(retained.evidenceTables?.flatMap(table => table.items).some(row => row.direction === 'supports' && row.sources?.length)).toBe(true)
})
