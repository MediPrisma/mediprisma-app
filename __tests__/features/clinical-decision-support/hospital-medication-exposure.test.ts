import { CARE_PACKS } from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile, type FhirCdssProfileInput } from '@voho0000/personalized-care-fhir'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import type { CdssLocale, CdssResult } from '@/features/clinical-decision-support/types'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'

const now = new Date('2026-10-01T04:00:00Z')
const condition = (code: string) => ({ id: `fictional-${code}`, clinicalStatus: 'active', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] } })
const observation = (id: string, code: string, value: number, unit: string) => ({
  id, status: 'final', effectiveDateTime: '2026-09-30',
  code: { coding: [{ system: 'http://loinc.org', code }] }, valueQuantity: { value, unit },
})
const input: FhirCdssProfileInput = {
  patient: { id: 'fictional-review-patient', age: 79, gender: 'male' },
  conditions: [condition('I48.91'), condition('I50.22'), condition('I10'), condition('E11.9')],
  observations: [observation('fictional-lvef', '10230-1', 32, '%'), observation('fictional-k', '2823-3', 6.1, 'mmol/L'), observation('fictional-egfr', '33914-3', 65, 'mL/min/1.73m2')],
  medications: [], encounters: [], allergies: [], carePlans: [], now,
}
const order = (name: string, overrides: Partial<MedicationEntity> = {}): MedicationEntity => ({
  id: `fictional-${name.split(' ')[0].toLowerCase()}`, _sourceResourceType: 'MedicationRequest',
  status: 'active', authoredOn: '2026-09-25',
  medicationCodeableConcept: { text: name, coding: [{ system: 'urn:oid:vgh.medication.generic', display: name }] },
  dosageInstruction: [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } }, doseAndRate: [{ doseQuantity: { value: 5, unit: 'mg' } }] }],
  ...overrides,
})
const apixaban = () => order('Apixaban (Eliquis) FC tab 5 mg')
const spironolactone = () => order('Spironolactone tab 25 mg', { dosageInstruction: [] })
const pack = (id: string) => CARE_PACKS.find((candidate) => candidate.id === id)!
const afPack = pack('atrial-fibrillation-cdss')
const hfPack = pack('heart-failure-cdss')
const modules = (result: CdssResult) => [...result.recommendations, ...(result.automatedChecks ?? []).flatMap((check) => check.recommendation ? [check.recommendation] : [])]
const moduleOf = (result: CdssResult, id: string) => modules(result).find((item) => item.id === id)
const build = (medications: MedicationEntity[]) => createHospitalAwareCdssPatientProfile({ ...input, medications })

// These records deliberately fall outside the exact-name catalogue. Native
// ingredient/exposure evidence must survive even when display mapping is unresolved.
describe('hospital prescription exposure review regressions', () => {
  it.each<CdssLocale>(['zh-TW', 'en'])('does not suggest an absent OAC after a recent hospital apixaban order (%s)', (locale) => {
    const source = apixaban()
    const native = afPack.build({ profile: createFhirCdssPatientProfile({ ...input, medications: [source] }), locale: 'en' })
    expect(moduleOf(native, 'af-anticoagulation-concordance')).toMatchObject({ status: 'review', title: 'On anticoagulation: check agent and dose' })
    const profile = build([source])
    const result = buildHospitalAwareCdssResult(afPack, profile, locale)
    const recommendation = moduleOf(result, 'af-anticoagulation-concordance')!
    expect(['needs-data', 'review']).toContain(recommendation.status)
    expect(recommendation.title).not.toMatch(/not taking|未使用/)
    const row = recommendation.evidenceTables?.flatMap((table) => table.items).find((item) => item.id === 'af-medication:oac')
    expect(row?.direction).toBe('unknown')
    expect(row?.value).not.toMatch(/Not taking|未使用/)
    expect(row?.sources?.[0]).toMatchObject({ resourceId: source.id, status: 'active', date: '2026-09-25' })
    expect(profile.afMedicationRegimens?.[0]).toMatchObject({ ingredient: 'apixaban', doseMg: 5, timesPerDay: 2 })
    expect(profile.facts.currentDoac.sources?.[0].resourceId).toBe(source.id)
    expect(profile.facts.currentOralAnticoagulant.zh).toContain('院內使用待確認')
    expect(profile.hospitalMedicationEvidence?.[0].useState).toBe('active-order-unconfirmed')
    expect(recommendation.visitDecision).toBeUndefined()
  })

  it.each<CdssLocale>(['zh-TW', 'en'])('retains the native high-priority MRA severe-hyperkalemia card (%s)', (locale) => {
    const source = spironolactone()
    const native = hfPack.build({ profile: createFhirCdssPatientProfile({ ...input, medications: [source] }), locale })
    const baseline = moduleOf(native, 'heart-failure-mra-safety')!
    expect(baseline).toMatchObject({ status: 'actionable', priority: 'high' })
    const profile = build([source])
    expect(profile.medicationClassContexts?.['mineralocorticoid-receptor-antagonist']?.state).toBe('active-order-unconfirmed')
    const safety = moduleOf(buildHospitalAwareCdssResult(hfPack, profile, locale), 'heart-failure-mra-safety')!
    expect(safety).toMatchObject({ status: baseline.status, priority: baseline.priority, title: baseline.title })
    expect(safety.nextActions).toEqual(expect.arrayContaining(baseline.nextActions))
    expect(safety.patientEvidence.find((entry) => entry.factKeys.includes('mraTherapy'))?.value).toMatch(/使用待確認|use needs confirmation/)
    expect(safety.recommendation).toMatch(/可能|may still be in use/)
  })

  it('evaluates current physician-entered potassium rather than a cached exposure profile', () => {
    const profile = build([spironolactone()])
    const updated = { ...profile, facts: { ...profile.facts, potassium: { zh: 'K 4.3 mmol/L', en: 'K 4.3 mmol/L', numericValue: 4.3, unit: 'mmol/L' } } }
    expect(moduleOf(buildHospitalAwareCdssResult(hfPack, updated, 'en'), 'heart-failure-mra-safety')).toBeUndefined()
    expect(moduleOf(buildHospitalAwareCdssResult(hfPack, profile, 'en'), 'heart-failure-mra-safety')?.priority).toBe('high')
  })

  it('retains an AF anticoagulant interaction and its native instruction with pending prescriptions', () => {
    const source = order('Ketoconazole tab 200 mg', { dosageInstruction: [] })
    const profile = build([apixaban(), source])
    const baseline = moduleOf(afPack.build({ profile: createFhirCdssPatientProfile({ ...input, medications: [apixaban(), source] }), locale: 'en' }), 'af-drug-interactions')!
    const interaction = moduleOf(buildHospitalAwareCdssResult(afPack, profile, 'en'), 'af-drug-interactions')!
    expect(interaction).toMatchObject({ status: baseline.status, priority: baseline.priority })
    expect(interaction.status).toBe('actionable')
    const row = (interaction.evidenceTables?.flatMap((table) => table.items) ?? []).find((item) => item.id === 'af-ddi:apixaban:ketoconazole')!
    expect(row.direction).toBe('supports')
    expect(row.value).toContain('Verify Taiwan labeling before dosing')
    expect(row.value).toContain('Current use needs confirmation')
    expect(row.sources?.map((citation) => citation.resourceId)).toEqual(['fictional-apixaban', source.id])
  })

  it.each([
    ['Meitifen SR FC * tab 75 mg', 'currentNsaid'],
    ['Spironolactone tab 25 mg', 'currentHyperkalemiaRiskMedication'],
    ['Meitifen SR FC * tab 75 mg', 'currentPotentialNephrotoxin'],
    ['Aspirin tab 100 mg', 'currentAntiplatelet'],
    ['Warfarin tab 2.5 mg', 'currentVitaminKAntagonist'],
    ['Apixaban (Eliquis) FC tab 5 mg', 'medicationListOverview'],
  ])('keeps the native direct exposure fact %s -> %s and its original citation', (name, key) => {
    const source = order(name)
    if (name.startsWith('Meitifen')) source.medicationCodeableConcept!.coding![0].system = 'urn:oid:vgh.medication.product'
    const before = JSON.stringify(source)
    const native = createFhirCdssPatientProfile({ ...input, medications: [source] })
    // The verified product alias is injected only on the derived copy.
    const profile = build([source])
    expect(profile.facts[key]).toBeDefined()
    if (!name.startsWith('Meitifen')) expect(native.facts[key]).toBeDefined()
    expect(profile.facts[key].zh).toContain('院內使用待確認')
    expect(profile.facts[key].sources?.[0]).toMatchObject({ resourceId: source.id, status: 'active', date: '2026-09-25' })
    expect(source.drugTerminology).toBeUndefined()
    expect(JSON.stringify(source)).toBe(before)
  })

  it('does not turn a stopped/completed/cancelled hospital order into possible exposure, even inside the supply grace period', () => {
    for (const status of ['stopped', 'completed', 'cancelled', 'entered-in-error', 'draft']) {
      const source = spironolactone()
      source.status = status
      source.dispenseRequest = { expectedSupplyDuration: { value: 30, unit: 'days' } }
      const profile = build([source])
      expect(profile.facts.currentHyperkalemiaRiskMedication).toBeUndefined()
      expect(moduleOf(buildHospitalAwareCdssResult(hfPack, profile, 'en'), 'heart-failure-mra-safety')).toBeUndefined()
    }
  })

  it('does not declare OAC absent when an unresolved hospital ingredient might be an anticoagulant', () => {
    const profile = build([order('Unlisted tablet')])
    const recommendation = moduleOf(buildHospitalAwareCdssResult(afPack, profile, 'en'), 'af-anticoagulation-concordance')!
    expect(recommendation.status).toBe('needs-data')
    expect(recommendation.title).not.toMatch(/not taking/)
    expect(recommendation.evidenceTables?.flatMap((table) => table.items).find((row) => row.id === 'af-medication:oac')).toMatchObject({ direction: 'unknown' })
  })

  it('includes a hospital unknown-status OAC as possible exposure without claiming confirmed use', () => {
    const source = apixaban()
    source.status = 'unknown'
    const profile = build([source])
    expect(profile.facts.currentOralAnticoagulant.sources?.[0].status).toBe('unknown')
    expect(profile.hospitalMedicationEvidence?.[0].useState).toBe('active-order-unconfirmed')
    expect(moduleOf(buildHospitalAwareCdssResult(afPack, profile, 'en'), 'af-anticoagulation-concordance')?.title).not.toMatch(/not taking/)
  })

  it('restores native dedicated-medication context status without leaking an internal marker', () => {
    const source = order('Dapagliflozin (Forxiga) FC tab 10 mg')
    // This fictional source already carries the native coverage module's NHI code.
    source.medicationCodeableConcept!.coding!.push({ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code', code: 'BC26476100' })
    const profile = build([source])
    expect(profile.medicationContexts?.forxiga).toMatchObject({ status: 'active', useState: 'active_order_unconfirmed' })
    expect(JSON.stringify(profile)).not.toContain('draft:mediprisma-hospital:')
  })

  it('keeps confirmed national-cloud SU evidence when hospital insulin use is pending', () => {
    const official: MedicationEntity = { id: 'fictional-nhi-su', status: 'active', authoredOn: '2026-09-25',
      drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 'fictional', ingredientText: 'GLICLAZIDE', atcCode: 'A10BB09' } }
    const native = createFhirCdssPatientProfile({ ...input, medications: [official] })
    const profile = build([official, order('Insulin aspart inj 100 units/ml')])
    expect(profile.medicationClassContexts?.insulin?.state).toBe('active-order-unconfirmed')
    expect(profile.medicationClassContexts?.sulfonylurea?.state).toBe('confirmed-current')
    expect(profile.facts.hypoglycemiaRiskMedications).toEqual(native.facts.hypoglycemiaRiskMedications)
  })

  it.each(['active', 'completed'])('leaves native AF evaluation identical for a national-cloud %s prescription', (status) => {
    const source: MedicationEntity = { id: 'fictional-nhi-apixaban', status, authoredOn: '2026-09-25',
      dispenseRequest: { expectedSupplyDuration: { value: 30, unit: 'days' } },
      drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 'fictional', ingredientText: 'APIXABAN', atcCode: 'B01AF02' } }
    const nativeProfile = createFhirCdssPatientProfile({ ...input, medications: [source] })
    const profile = build([source])
    expect(profile).toEqual(nativeProfile)
    expect(buildHospitalAwareCdssResult(afPack, profile, 'en')).toEqual(afPack.build({ profile: nativeProfile, locale: 'en' }))
  })
})
