/** Real imported FHIR → released adapter → host calculators → released AF pack. */
import fs from 'node:fs'
import path from 'node:path'
import { ATRIAL_FIBRILLATION_GUIDELINE_PACK } from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile } from '@voho0000/personalized-care-fhir'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'
import { SCENARIO_NOW } from './scenario-models'

const valves = [
  { code: 'Z95.2', factKey: 'prostheticHeartValve', question: 'mechanicalValve' },
  { code: 'I05.0', factKey: 'rheumaticMitralStenosis', question: 'significantMitralStenosis' },
] as const

function importedProfile(code?: string) {
  const bundle = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app/dev/cdss-scenarios/bundles/p11-af-dabigatran-renal.json'), 'utf8'))
  const patientId = bundle.entry.find((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient').resource.id
  if (code) bundle.entry.push({ resource: {
    resourceType: 'Condition', id: 'coded-valve', subject: { reference: `Patient/${patientId}` },
    clinicalStatus: { coding: [{ code: 'active' }] }, verificationStatus: { coding: [{ code: 'confirmed' }] },
    recordedDate: '2026-09-20', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
  } })
  const parsed = LocalBundleService.parse(bundle)!
  return applyAfCalculatorResults(createFhirCdssPatientProfile({ patient: parsed.patient, ...parsed.collection, now: SCENARIO_NOW }))
}
function build(profile: CdssPatientProfile, locale: 'zh-TW' | 'en' = 'zh-TW') {
  return ATRIAL_FIBRILLATION_GUIDELINE_PACK.build({ profile, locale })
}
function rows(result: ReturnType<typeof build>) {
  return result.recommendations.flatMap(r => r.evidenceTables ?? []).flatMap(t => t.items)
}

describe.each(valves)('released coded valve contract: $code', ({ code, factKey, question }) => {
  it.each(['zh-TW', 'en'] as const)('keeps ambiguous coded history pending and attributable in %s', locale => {
    const profile = importedProfile(code)
    const fact = profile.facts[factKey]!
    const row = rows(build(profile, locale)).find(r => r.id === `af-clinic:${question}`)!
    expect(fact).toBeDefined()
    expect(row).toMatchObject({ derivability: 'record-derived', direction: 'unknown', defaultEnabled: false })
    expect(row.sources).toEqual(fact.sources)
    expect(row.date).toEqual(fact.date)
    expect(row.value).toContain(code)
    expect(['review', 'needs-data']).toContain(build(profile, locale).recommendations.find(r => r.id === 'af-anticoagulant-selection-safety')?.status)
  })

  it.each([true, false])('keeps an explicit clinician answer (%s) authoritative; reset restores pending', answer => {
    const profile = importedProfile(code)
    const answered = rows(build({ ...profile, afClinicalAnswers: { [question]: answer } })).find(r => r.id === `af-clinic:${question}`)!
    expect(answered.direction).toBe(answer ? 'supports' : 'against')
    expect(answered.defaultEnabled).not.toBe(false)
    const reset = rows(build({ ...profile, afClinicalAnswers: { [question]: undefined } })).find(r => r.id === `af-clinic:${question}`)!
    expect(reset).toMatchObject({ derivability: 'record-derived', direction: 'unknown', defaultEnabled: false })
    expect(reset.sources).toEqual(profile.facts[factKey]!.sources)
  })

  it('does not invent a record-derived valve history when the code is absent', () => {
    const profile = importedProfile()
    expect(profile.facts[factKey]).toBeUndefined()
    expect(rows(build(profile)).find(r => r.id === `af-clinic:${question}`)).toMatchObject({
      derivability: 'physician-entered', direction: 'unknown', defaultEnabled: false,
    })
  })
})

it('preserves the real HAS-BLED renal record and permits explicit correction/reset', () => {
  const profile = importedProfile('Z95.2')
  const renal = (p: CdssPatientProfile) => rows(build(applyAfCalculatorResults(p))).find(r => r.id === 'af-hasbled:renal')!
  expect(renal(profile)).toMatchObject({ derivability: 'record-derived', direction: 'supports', defaultEnabled: true })
  expect(renal({ ...profile, afClinicalAnswers: { abnormalRenal: false } }).direction).toBe('against')
  expect(renal({ ...profile, afClinicalAnswers: { abnormalRenal: undefined } }).direction).toBe('supports')
})
