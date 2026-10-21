import { randomUUID } from 'node:crypto'
import { buildMedcloudHfInput, medcloudHfVisits } from '@/src/core/hf-risk/medcloud-input'
import { hfDiagnosisVisits, withPhysicianHfDiagnosis, suggestHfDiagnosis } from '@/src/core/hf-risk/physician-diagnosis'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'
import { hfMedcloudFixture } from './hf-medcloud-fixture'

function prepared() {
  const source = hfMedcloudFixture()
  const visit = source.entry.find((entry: any) => entry.resource.resourceType === 'Encounter').resource
  visit.reasonCode[0].coding[0].code = 'I10'
  const historical = JSON.parse(JSON.stringify(visit))
  historical.id = 'past-visit'
  historical.period.start = '2026-09-01'
  source.entry.push({ fullUrl: 'Encounter/past-visit', resource: historical })
  const chosen = medcloudHfVisits(source)[0]
  return { source, input: buildMedcloudHfInput(source, { provider: chosen.provider, encounter: chosen.reference, claim: 'P1_CD_mortality_1m' }, { uuid: randomUUID }) }
}
it('adds attested Conditions only to selected existing visits and preserves the original record and base projection', () => {
  const { source, input } = prepared()
  const raw = JSON.stringify(source), base = JSON.stringify(input)
  const selected = hfDiagnosisVisits(input)
  const result = withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: Object.fromEntries(selected.map(v => [v.reference, 2])), encounters: selected.map(v => v.reference) }, randomUUID, () => '2026-10-06T03:00:00Z')
  expect(JSON.stringify(source)).toBe(raw)
  expect(JSON.stringify(input)).toBe(base)
  expect(result.counts.Encounter).toBe(input.counts.Encounter)
  expect(result.counts.Condition).toBe(input.counts.Condition + 2)
  expect(result.physicianDiagnosis?.visits.map(v => v.date)).toEqual(['2026-10-01', '2026-09-01'])
  expect(result.physicianDiagnosis?.source).toBe('physician-attestation')
  expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(true)
  expect(JSON.stringify(result.bundle)).not.toMatch(/physician-attestation|Synthetic identity|FAKE-ID|confirmedAt/)
})
it('does not add anything before explicit confirmation', () => {
  const { input } = prepared()
  expect(withPhysicianHfDiagnosis(input, { code: 'I50.9', ranks: {}, encounters: hfDiagnosisVisits(input).map(v => v.reference), confirmed: false })).toBe(input)
})
it.each([{ code: '', ranks: {}, encounters: [], confirmed: true }, { code: 'I10', ranks: {}, encounters: ['foreign-visit'], confirmed: true }, { code: 'I50.9', ranks: {}, encounters: ['foreign-visit'], confirmed: true }])('rejects an invalid code or unknown visit', draft => {
  const { input } = prepared()
  expect(() => withPhysicianHfDiagnosis(input, draft)).toThrow('physician-diagnosis-invalid')
})
it('does not deduplicate by date or borrow another same-day visit to clear the selected-visit gap', () => {
  const { source } = prepared()
  const visit = source.entry.find((e: any) => e.resource.resourceType === 'Encounter').resource
  visit.reasonCode = []
  const other = JSON.parse(JSON.stringify(visit)); other.id = 'same-day-other'
  source.entry.push({ fullUrl: 'Encounter/same-day-other', resource: other })
  const input = buildMedcloudHfInput(source, { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' }, { uuid: randomUUID })
  const otherReference = hfDiagnosisVisits(input).find(v => v.date === input.indexDate && v.reference !== input.indexEncounterReference)!.reference
  const wrong = withPhysicianHfDiagnosis(input, { code: 'I50.9', ranks: { [otherReference]: 2 }, encounters: [otherReference], confirmed: true }, randomUUID)
  expect(wrong.gaps).toContainEqual({ code: 'index-diagnosis-missing', count: 1 })
  const right = withPhysicianHfDiagnosis(input, { code: 'I50.9', ranks: { [input.indexEncounterReference!]: 2 }, encounters: [input.indexEncounterReference!], confirmed: true }, randomUUID)
  expect(right.gaps).not.toContainEqual({ code: 'index-diagnosis-missing', count: 1 })
  expect(validateHfTransportBundle(right.bundle, right.indexDate)).toBe(true)
})
it('does not duplicate an original I50.9 diagnosis', () => {
  const source = hfMedcloudFixture(), chosen = medcloudHfVisits(source)[0]
  const input = buildMedcloudHfInput(source, { ...chosen, encounter: chosen.reference, claim: 'P1_CD_mortality_1m' }, { uuid: randomUUID })
  const result = withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: { [input.indexEncounterReference!]: 2 }, encounters: [input.indexEncounterReference!] }, randomUUID)
  expect(result.counts.Condition).toBe(input.counts.Condition)
})
it('rejects ongoing admission and future visits rather than inventing a completed event', () => {
  const { input } = prepared()
  const visit = input.bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter')
  visit.resource.status = 'in-progress'
  expect(() => withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: { [visit.fullUrl]: 2 }, encounters: [visit.fullUrl] })).toThrow()
  visit.resource.status = 'finished'; visit.resource.period.start = '2026-10-02'
  expect(() => withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: { [visit.fullUrl]: 2 }, encounters: [visit.fullUrl] })).toThrow()
})

it('requires an explicit diagnosis rank and refuses conflicts with original ranks', () => {
  const { input } = prepared(), reference = input.indexEncounterReference!
  expect(() => withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: {}, encounters: [reference] })).toThrow('physician-diagnosis-invalid')
  const encounter = input.bundle.entry.find((e: any) => e.fullUrl === reference).resource
  encounter.diagnosis[0].rank = 1
  expect(() => withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: { [reference]: 1 }, encounters: [reference] }, randomUUID)).toThrow('physician-diagnosis-rank-conflict')
  const result = withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, ranks: { [reference]: 2 }, encounters: [reference] }, randomUUID)
  expect(result.bundle.entry.find((e: any) => e.fullUrl === reference).resource.diagnosis.map((d: any) => d.rank)).toEqual([1, 2])
})

it('suggests two actual recent outpatient encounters with secondary ranks, without applying diagnoses', () => {
  const { input } = prepared(), before = JSON.stringify(input)
  const draft = suggestHfDiagnosis(input, 'outpatient')!
  expect(draft.confirmed).toBe(false)
  expect(draft.encounters).toHaveLength(2)
  expect(Object.values(draft.ranks)).toEqual([2, 2])
  expect(JSON.stringify(input)).toBe(before)
  expect(suggestHfDiagnosis(input, 'inpatient')).toBeNull()
})
it('does not invent a second outpatient visit and uses only an existing completed admission', () => {
  const { input } = prepared()
  const past = input.bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter' && e.resource.period.start < input.indexDate).resource
  past.class.code = 'IMP'
  expect(suggestHfDiagnosis(input, 'outpatient')).toBeNull()
  expect(suggestHfDiagnosis(input, 'inpatient')!.encounters).toHaveLength(1)
  past.status = 'in-progress'
  expect(suggestHfDiagnosis(input, 'inpatient')).toBeNull()
})
it('keeps an existing primary HF rank and avoids occupied ranks for an additional secondary diagnosis', () => {
  const { input } = prepared()
  const index = input.bundle.entry.find((e: any) => e.fullUrl === input.indexEncounterReference).resource
  index.diagnosis[0].rank = 3
  const past = input.bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter' && e.resource.period.start < input.indexDate).resource
  const dx = input.bundle.entry.find((e: any) => e.fullUrl === past.diagnosis[0].condition.reference).resource
  dx.code.coding[0].code = 'I50.9'; past.diagnosis[0].rank = 1
  const draft = suggestHfDiagnosis(input, 'outpatient')!
  expect(draft.ranks[input.indexEncounterReference!]).toBe(4)
  const pastReference = input.bundle.entry.find((e: any) => e.resource === past).fullUrl
  expect(draft.ranks[pastReference]).toBe(1)
  expect(Object.values(draft.ranks)).toEqual([4, 1])
})

it('excludes case-type 08 records from shortcuts and manual supplementation', () => {
  const { input } = prepared()
  const past = input.bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter' && e.resource.period.start < input.indexDate)
  past.resource.type = [{ coding: [{ system: 'https://mediprisma.tw/CodeSystem/nhi-case-type', code: '08' }] }]
  expect(hfDiagnosisVisits(input).some(v => v.reference === past.fullUrl)).toBe(false)
  expect(suggestHfDiagnosis(input, 'outpatient')).toBeNull()
  expect(() => withPhysicianHfDiagnosis(input, { code: 'I50.9', confirmed: true, encounters: [past.fullUrl], ranks: { [past.fullUrl]: 2 } })).toThrow('physician-diagnosis-invalid')
})
it('anchors the outpatient shortcut to the exact index encounter on same-day ties', () => {
  const { input } = prepared()
  const index = input.bundle.entry.find((e: any) => e.fullUrl === input.indexEncounterReference)
  const other = [0, 1].map(i => ({ fullUrl: 'same-day-' + i, resource: { ...index.resource, id: 'same-day-' + i, diagnosis: undefined } }))
  input.bundle.entry.unshift(...other)
  const draft = suggestHfDiagnosis(input, 'outpatient')!
  expect(draft.encounters[0]).toBe(input.indexEncounterReference)
  expect(draft.encounters).toHaveLength(2)
  expect(new Set(draft.encounters).size).toBe(2)
})
