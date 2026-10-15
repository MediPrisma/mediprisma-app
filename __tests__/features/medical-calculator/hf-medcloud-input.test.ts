import { randomUUID } from 'node:crypto'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import { buildMedcloudHfInput, medcloudHfVisits } from '@/src/core/hf-risk/medcloud-input'
import { fhirDay, HF_NAMESPACE, parseHfDryRunResponse, type FhirRecord } from '@/src/core/hf-risk/contract'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'

const selection = { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' as const }
const build = (bundle = hfMedcloudFixture()) => buildMedcloudHfInput(bundle, selection, { today: '2026-10-04', uuid: randomUUID })
const resources = (bundle: FhirRecord, type: string): FhirRecord[] => bundle.entry.map((item: FhirRecord) => item.resource).filter((item: FhirRecord) => item.resourceType === type)
const add = (bundle: FhirRecord, resource: FhirRecord) => bundle.entry.push({ fullUrl: resource.resourceType + '/' + resource.id, resource })

describe('NHI cloud HF input preparation', () => {
  it.each([
    ['6690-2', 7200, '/uL', 7.2, 'WBC', '10*3/uL'],
    ['777-3', 210000, '/uL', 210, 'PLT', '10*3/uL'],
    ['6690-2', 7200, 'cells/µL', 7.2, 'WBC', '10*3/uL'],
    ['777-3', 210000, '#/μL', 210, 'PLT', '10*3/uL'],
    ['6690-2', 7.2, 'K/μL', 7.2, 'WBC', '10*3/uL'],
    ['777-3', 210, 'K/µL', 210, 'PLT', '10*3/uL'],
    ['6690-2', 7.2, '10*9/L', 7.2, 'WBC', '10*3/uL'],
    ['1558-6', 110, 'mg/dL', 110, 'GLU', 'mg/dL'],
    ['1558-6', 5, 'mmol/L', 90.08, 'GLU', 'mg/dL'],
  ])('projects bridge lab %s with %s %s into the existing model feature', (loinc, value, unit, expected, key, modelUnit) => {
    const bundle = hfMedcloudFixture()
    const lab = resources(bundle, 'Observation')[0]
    lab.code = { coding: [{ system: 'http://loinc.org', code: loinc }] }
    lab.valueQuantity = { value, unit, code: unit }
    const result = build(bundle)
    const projected = resources(result.bundle, 'Observation')
    expect(projected).toHaveLength(1)
    expect(projected[0].valueQuantity).toMatchObject({ value: expected, unit: modelUnit, code: modelUnit })
    expect(projected[0].code.coding).toContainEqual({ system: HF_NAMESPACE + '/CodeSystem/hf-source-lab-item', code: key })
    expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(true)
  })
  it('keeps specimen, unit and historical-date exclusions for newly supported inputs', () => {
    for (const [loinc, unit, date, gap] of [
      ['5821-4', '/uL', '2026-09-30', 'lab-unmapped'], // urine WBC is not blood WBC
      ['2350-7', 'mg/dL', '2026-09-30', 'lab-unmapped'], // urine glucose is not serum glucose
      ['6690-2', '/HPF', '2026-09-30', 'lab-value-unit'],
      ['777-3', '', '2026-09-30', 'lab-value-unit'],
      ['1558-6', 'mg/dL', '2026-10-02', 'future-omitted'],
    ]) {
      const bundle = hfMedcloudFixture()
      const lab = resources(bundle, 'Observation')[0]
      lab.code = { coding: [{ system: 'http://loinc.org', code: loinc }] }
      lab.valueQuantity = { value: 100, unit }
      lab.effectiveDateTime = date
      const result = build(bundle)
      expect(result.counts.Observation).toBeUndefined()
      expect(result.gaps).toContainEqual({ code: gap, count: 1 })
    }
  })
  it('projects an immutable single-patient Bundle, converts explicit units and strips identity/narrative', () => {
    const original = hfMedcloudFixture()
    const before = JSON.stringify(original)
    const result = build(original)
    expect(JSON.stringify(original)).toBe(before)
    expect(result.indexDate).toBe('2026-10-01')
    expect(result.counts).toMatchObject({ Patient: 1, Encounter: 1, Condition: 1, Observation: 1 })
    expect(resources(result.bundle, 'Observation')[0].valueQuantity).toMatchObject({ value: 1, code: 'mg/dL' })
    expect(JSON.stringify(result.bundle)).not.toMatch(/FAKE-ID|PRIVATE|synthetic-patient|Synthetic identity/)
    expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(true)
  })
  it('does not invent a full birth date or take a demographic overlay', () => {
    const bundle = hfMedcloudFixture()
    resources(bundle, 'Patient')[0].birthDate = '1960'
    const result = build(bundle)
    expect(resources(result.bundle, 'Patient')[0].birthDate).toBeUndefined()
    expect(result.gaps).toContainEqual({ code: 'patient-birthdate', count: 1 })
    expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(true)
  })
  it('rejects invalid calendar dates and unknown or multi-patient imports', () => {
    for (const date of ['2026-02-30', '2026-13-01', '1960', '2026-10-01Tgarbage']) expect(fhirDay(date)).toBeUndefined()
    expect(fhirDay('2024-02-29')).toBe('2024-02-29')
    const bundle = hfMedcloudFixture()
    delete bundle.meta
    expect(() => build(bundle)).toThrow('source-unsupported')
    const multiple = hfMedcloudFixture()
    add(multiple, { resourceType: 'Patient', id: 'other-patient' })
    expect(() => build(multiple)).toThrow('patient-count')
  })
  it('does not use a site label as record provenance, mix hospitals or accept conflicting performers', () => {
    const bundle = hfMedcloudFixture()
    const observation = resources(bundle, 'Observation')[0]
    observation.encounter = { reference: 'Encounter/synthetic-visit' }
    observation.performer = [{ reference: 'Organization/other-hospital' }]
    expect(build(bundle).counts.Observation).toBeUndefined()
    observation.performer = []
    delete observation.encounter
    expect(build(bundle).counts.Observation).toBeUndefined()
    resources(bundle, 'Encounter')[0].serviceProvider = { display: 'TVGH' }
    expect(medcloudHfVisits(bundle)).toEqual([])
  })
  it('uses the selected encounter date and excludes future, foreign-patient and void records', () => {
    const bundle = hfMedcloudFixture()
    const base = resources(bundle, 'Observation')[0]
    add(bundle, { ...base, id: 'future', effectiveDateTime: '2026-10-02' })
    add(bundle, { ...base, id: 'void', status: 'entered-in-error' })
    add(bundle, { ...base, id: 'foreign', subject: { reference: 'Patient/foreign' } })
    expect(build(bundle).counts.Observation).toBe(1)
    expect(build(bundle).gaps).toEqual(expect.arrayContaining([{ code: 'future-omitted', count: 1 }, { code: 'void-omitted', count: 1 }]))
  })
  it('never treats report date as collection date, missing unit as standard, or BNP as NT-proBNP', () => {
    const bundle = hfMedcloudFixture()
    const observation = resources(bundle, 'Observation')[0]
    delete observation.effectiveDateTime
    observation.issued = '2026-09-30'
    expect(build(bundle).counts.Observation).toBeUndefined()
    observation.effectiveDateTime = '2026-09-30'
    delete observation.valueQuantity.unit
    expect(build(bundle).counts.Observation).toBeUndefined()
    observation.code.coding[0].code = '30934-4'
    observation.valueQuantity.unit = 'pg/mL'
    expect(build(bundle).counts.Observation).toBeUndefined()
    observation.code.coding[0].code = '33762-6'
    const mapped = resources(build(bundle).bundle, 'Observation')[0]
    expect(mapped.code.coding[0]).toEqual({ system: HF_NAMESPACE + '/CodeSystem/hf-source-lab-item', code: 'BNP' })
  })
  it('reports module failures separately from empty and never equates capture completion with coverage', () => {
    const result = build()
    expect(result.gaps).toEqual(expect.arrayContaining([{ code: 'module-incomplete:imue0008', count: 1 }, { code: 'history-coverage-unverified', count: 1 }, { code: 'source-validation-pending', count: 1 }]))
    expect(result.gaps.some(gap => gap.code === 'module-incomplete:imue0060')).toBe(false)
  })
  it('uses diagnoses from Encounter.reasonCode without inventing diagnosis rank', () => {
    const result = build()
    expect(resources(result.bundle, 'Condition')[0].code.coding[0].code).toBe('I50.9')
    expect(resources(result.bundle, 'Encounter')[0].diagnosis[0].rank).toBeUndefined()
  })
  it('deduplicates exact inpatient episodes but preserves separate same-day outpatient encounters', () => {
    const bundle = hfMedcloudFixture()
    const outpatient = resources(bundle, 'Encounter')[0]
    add(bundle, { ...outpatient, id: 'second-visit' })
    for (const id of ['inpatient-a', 'inpatient-b']) add(bundle, { ...outpatient, id, class: { code: 'IMP' }, period: { start: '2026-08-01', end: '2026-08-05' } })
    const result = build(bundle)
    expect(result.counts.Encounter).toBe(3)
    expect(result.gaps).toContainEqual({ code: 'encounter-duplicate', count: 1 })
  })
  it('does not send future discharge dates or diagnoses from ongoing admissions', () => {
    const bundle = hfMedcloudFixture()
    add(bundle, { ...resources(bundle, 'Encounter')[0], id: 'ongoing-admission', class: { code: 'IMP' }, period: { start: '2026-09-30', end: '2026-10-05' } })
    const mapped = resources(build(bundle).bundle, 'Encounter').find(item => item.class.code === 'IMP')!
    expect(mapped.period.end).toBeUndefined()
    expect(mapped.diagnosis).toBeUndefined()
  })
  it('does not relabel a NHI procedure code as ICD', () => {
    const bundle = hfMedcloudFixture()
    const outpatient = resources(bundle, 'Encounter')[0]
    add(bundle, { ...outpatient, id: 'admission', class: { code: 'IMP' }, period: { start: '2026-08-01', end: '2026-08-05' } })
    add(bundle, { resourceType: 'Procedure', id: 'nhi-order', status: 'completed', subject: outpatient.subject,
      encounter: { reference: 'Encounter/admission' }, performedDateTime: '2026-08-03',
      code: { coding: [{ system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw', code: '86008C' }] } })
    expect(build(bundle).counts.Procedure).toBeUndefined()
    expect(build(bundle).gaps).toContainEqual({ code: 'procedure-unmapped', count: 1 })
  })
})

describe('HF transport boundary and dry-run answers', () => {
  it('rejects nested identity/narrative, dangling references, future dates and arbitrary resource types', () => {
    const mutate = (change: (bundle: FhirRecord) => void) => {
      const result = build()
      change(result.bundle)
      expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(false)
    }
    mutate(bundle => { resources(bundle, 'Patient')[0].name = [{ text: 'identity' }] })
    mutate(bundle => { resources(bundle, 'Observation')[0].valueQuantity.display = 'identity' })
    mutate(bundle => { resources(bundle, 'Condition')[0].code.text = 'identity' })
    mutate(bundle => { resources(bundle, 'Encounter')[0].diagnosis[0].condition.reference = 'Condition/missing' })
    mutate(bundle => { resources(bundle, 'Observation')[0].effectiveDateTime = '2026-10-02' })
    mutate(bundle => { resources(bundle, 'Observation')[0].resourceType = 'DocumentReference' })
  })
  it('uses fresh pseudonymous IDs on every preparation', () => {
    expect(resources(build().bundle, 'Patient')[0].id).not.toBe(resources(build().bundle, 'Patient')[0].id)
  })
  it('accepts input outcomes only and rejects probabilities even embedded in a valueString', () => {
    const outcome = { resourceType: 'OperationOutcome', issue: [{ severity: 'information', code: 'informational', details: { text: 'Input checked' } }] }
    expect(parseHfDryRunResponse(200, outcome).verdict).toBe('accepted')
    expect(parseHfDryRunResponse(422, { ...outcome, issue: [{ severity: 'error', code: 'required' }] }).verdict).toBe('refused')
    expect(() => parseHfDryRunResponse(200, { resourceType: 'Bundle' })).toThrow()
    expect(() => parseHfDryRunResponse(200, { ...outcome, extension: [{ valueString: '{"probabilityDecimal":0.3}' }] })).toThrow()
    expect(() => parseHfDryRunResponse(200, { ...outcome, issue: [{ severity: 'fatal' }] })).toThrow()
  })
})

it('preserves a recognized diagnosis edition and records unsupported diagnosis codes', () => {
  const fixture=hfMedcloudFixture()
  const visit=fixture.entry.find((e: any) => e.resource.resourceType==='Encounter').resource
  visit.reasonCode[0].coding[0].system='https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2014-tw'
  visit.reasonCode[0].coding.push({system:'http://hl7.org/fhir/sid/icd-10',code:'I50.9'})
  const result=buildMedcloudHfInput(fixture,{provider:'SYNTHETIC-HOSPITAL',encounter:'Encounter/synthetic-visit',claim:'P1_CD_mortality_1m'},{today:'2026-10-05',uuid:randomUUID})
  expect(result.bundle.entry.find((e: any) => e.resource.resourceType==='Condition').resource.code.coding[0].system).toBe('https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2014-tw')
  expect(result.gaps).toContainEqual({code:'diagnosis-unmapped',count:1})
})

it('deduplicates one diagnosis across recognized code-system aliases and editions', () => {
  const fixture=hfMedcloudFixture()
  fixture.entry.find((e: any) => e.resource.resourceType==='Encounter').resource.reasonCode[0].coding.push({system:'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw',code:'I50.9'})
  const result=build(fixture)
  expect(result.counts.Condition).toBe(1)
})

describe('cloud laboratory results without a source status', () => {
  const lab = (bundle: FhirRecord) => resources(bundle, 'Observation')[0]
  it('sends an unknown-status cloud result that has a value and collection date, and says so', () => {
    const bundle = hfMedcloudFixture()
    lab(bundle).status = 'unknown'
    const result = build(bundle)
    expect(result.counts.Observation).toBe(1)
    expect(resources(result.bundle, 'Observation')[0].status).toBe('final')
    expect(result.gaps).toContainEqual({ code: 'lab-status-unreported', count: 1 })
    expect(result.gaps.map(gap => gap.code)).not.toContain('lab-status')
    expect(validateHfTransportBundle(result.bundle, result.indexDate)).toBe(true)
  })
  it('still excludes preliminary or registered results', () => {
    for (const status of ['preliminary', 'registered']) {
      const bundle = hfMedcloudFixture()
      lab(bundle).status = status
      const result = build(bundle)
      expect(result.counts.Observation ?? 0).toBe(0)
      expect(result.gaps).toContainEqual({ code: 'lab-status', count: 1 })
    }
  })
  it('does not count an unknown-status result that is dropped for its unit', () => {
    const bundle = hfMedcloudFixture()
    lab(bundle).status = 'unknown'
    lab(bundle).valueQuantity = { value: 1, unit: 'furlong' }
    const result = build(bundle)
    expect(result.gaps.map(gap => gap.code)).toEqual(expect.arrayContaining(['lab-value-unit']))
    expect(result.gaps.map(gap => gap.code)).not.toContain('lab-status-unreported')
  })
  it('accepts a unit written with spaces, such as "g /dL" for hemoglobin', () => {
    const bundle = hfMedcloudFixture()
    Object.assign(lab(bundle), { code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] }, valueQuantity: { value: 11.2, unit: 'g /dL' } })
    const result = build(bundle)
    expect(resources(result.bundle, 'Observation')[0].valueQuantity).toMatchObject({ value: 11.2, code: 'g/dL' })
  })
})

describe('HF diagnosis presence', () => {
  it('recognizes ICD-10-CM I50.x and rejects unrelated codes', () => {
    const { hasHfDiagnosis } = jest.requireActual('@/src/core/hf-risk/input-summary')
    const withCode = (code: string) => { const bundle = hfMedcloudFixture(); resources(bundle, 'Encounter')[0].reasonCode[0].coding[0].code = code; return build(bundle) }
    expect(hasHfDiagnosis(withCode('I50.9'))).toBe(true)
    expect(hasHfDiagnosis(withCode('I50.22'))).toBe(true)
    expect(hasHfDiagnosis(withCode('I10'))).toBe(false)
  })
})
