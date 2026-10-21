import { buildClinicalSelects } from '@/features/medical-calculator/hfpef-clinical-autofill'
import { buildEchoAutofill } from '@/features/medical-calculator/echo-autofill'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-09-30T12:00:00Z')
const oldSinus: DiagnosticReportEntity = {
  id: 'older-sinus', status: 'final', effectiveDateTime: '2026-09-01',
  code: { text: 'EKG' }, conclusion: 'Normal sinus rhythm',
}
const recent = (fields: Partial<DiagnosticReportEntity>): DiagnosticReportEntity => ({
  id: 'recent-report', status: 'final', effectiveDateTime: '2026-09-20',
  performer: [{ display: 'Recent hospital' }], ...fields,
})

describe('calculator autofill from reports without display names', () => {
  test.each([
    ['LOINC', { code: { coding: [{ system: 'http://loinc.org', code: '11524-6' }] } }],
    ['NHI', { code: { coding: [{ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '18001C' }] } }],
    ['legacy NHI', { code: { coding: [{ code: '18001C' }] } }],
    ['EC category', { category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'EC' }] }] }],
    ['single EC category', { category: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'EC' }] } }],
    ['legacy EC category', { category: { coding: [{ code: 'EC' }] } }],
  ])('%s ECG retains newer AF and its provenance', (_name, fields) => {
    const result = buildClinicalSelects([oldSinus, recent({ ...fields, conclusion: 'Atrial fibrillation' })], [], now)
    const source = { date: '2026-09-20', obsId: 'recent-report', resourceType: 'DiagnosticReport', facility: 'Recent hospital' }
    expect(result.rhythm).toMatchObject({ ...source, value: 'af' })
    expect(result.afHistory).toMatchObject({ ...source, value: 'yes' })
  })

  test.each([
    ['LOINC TTE', { code: { coding: [{ system: 'http://loinc.org', code: '59281-6' }] } }],
    ['LOINC Doppler', { code: { coding: [{ system: 'http://loinc.org', code: '80859-2' }] } }],
    ['NHI echo', { code: { coding: [{ code: '18005C' }] } }],
    ['NHI Doppler', { code: { coding: [{ code: '18007C' }] } }],
    ['CUS category', { category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'CUS' }] }] }],
  ])('%s echo supplies the latest measurements as one report', (_name, fields) => {
    const result = buildEchoAutofill([
      { ...oldSinus, code: { text: 'Echocardiography' }, conclusion: 'LVEF 60%; PASP 25 mmHg' },
      recent({ ...fields, conclusion: 'LVEF 45%' }),
    ])
    expect(result.lvef).toMatchObject({ value: 45, date: '2026-09-20', obsId: 'recent-report', facility: 'Recent hospital' })
    expect(result.pasp).toBeUndefined()
  })

  test('LOINC digits in another code system do not establish ECG or echo', () => {
    const code = (value: string) => ({ coding: [{ system: 'https://example.test/local-catalog', code: value }] })
    expect(buildClinicalSelects([recent({ code: code('11524-6'), conclusion: 'Normal sinus rhythm' })], [], now).rhythm).toBeUndefined()
    expect(buildEchoAutofill([recent({ code: code('59281-6'), conclusion: 'LVEF 45%' })])).toEqual({})
  })

  test.each(['Normal sinus rhythm', 'No history of atrial fibrillation; Normal sinus rhythm'])('an unclassified AF report blocks an older negative from %s', conclusion => {
    const result = buildClinicalSelects([
      { ...oldSinus, conclusion }, recent({ code: { text: 'Unclassified study' }, conclusion: 'Atrial fibrillation' }),
    ], [], now)
    expect(result.afHistory).toBeUndefined()
  })

  test('newer cancelled and future coded reports cannot displace an eligible tracing', () => {
    const coded = recent({ code: { coding: [{ system: 'http://loinc.org', code: '11524-6' }] }, conclusion: 'Atrial fibrillation' })
    const result = buildClinicalSelects([
      oldSinus, { ...coded, status: 'cancelled' }, { ...coded, id: 'future', effectiveDateTime: '2027-01-01' },
    ], [], now)
    expect(result.rhythm).toMatchObject({ value: 'sr', date: '2026-09-01', obsId: 'older-sinus' })
    expect(result.afHistory?.value).toBe('no')
  })
})
