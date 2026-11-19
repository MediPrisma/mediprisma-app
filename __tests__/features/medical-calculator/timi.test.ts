/**
 * The TIMI scores for the CAD page (owner request 2026-11-19): TRS 2°P
 * (Bohula, Circulation 2016; groups from IMPROVE-IT, JACC 2017) and TIMI
 * UA/NSTEMI (Antman, JAMA 2000).
 */
import { CALCULATORS, getCalcInfo, getCalcScoring, getCalcTags } from '@/features/medical-calculator/calculators'
import { buildClinicalSelects } from '@/features/medical-calculator/hfpef-clinical-autofill'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'

const calc = (id: string) => CALCULATORS.find((item) => item.id === id)!
const NO = { chf: 'no', htn: 'no', dm: 'no', stroke: 'no', cabg: 'no', pad: 'no', smoking: 'no' }

describe('TIMI Risk Score for Secondary Prevention', () => {
  const trs = calc('timi-trs2p')

  it('scores one point each and reads 0–1 low, 2 intermediate, ≥3 high', () => {
    expect(trs.compute({ age: '60', egfr: '90', ...NO })).toMatchObject({ value: '0 / 9', numericValue: 0, interpretation: { zh: '低風險（0–1 分）' }, severity: 'normal' })
    expect(trs.compute({ age: '75', egfr: '90', ...NO })).toMatchObject({ numericValue: 1, interpretation: { zh: '低風險（0–1 分）' } })
    expect(trs.compute({ age: '60', egfr: '59', ...NO, htn: 'yes' })).toMatchObject({ numericValue: 2, interpretation: { zh: '中風險（2 分）' }, severity: 'moderate' })
    expect(trs.compute({ age: '80', egfr: '45', ...NO, chf: 'yes', htn: 'yes', dm: 'yes', stroke: 'yes', cabg: 'yes', pad: 'yes', smoking: 'yes' }))
      .toMatchObject({ value: '9 / 9', numericValue: 9, interpretation: { zh: '高風險（≥3 分）' }, severity: 'high' })
  })

  it('gives a range, not a low score, while an item is blank', () => {
    const result = trs.compute({ age: '60', egfr: '', ...NO, pad: '' })!
    expect(result).toMatchObject({ value: '0–2 / 9', completeness: { complete: false, upperBound: 2, missingKeys: ['egfr', 'pad'] } })
    expect(result.interpretation?.zh).toBe('資料未齊 — 可能分數範圍')
  })

  it('reads its histories from the record and presumes 無 where the record is silent', () => {
    const sources = Object.fromEntries(trs.inputs.filter((input) => input.type === 'select').map((input) => [input.key, input.type === 'select' ? [input.source, input.presumed] : []]))
    expect(sources.pad).toEqual([{ kind: 'hfpefClinical', key: 'pad' }, 'no'])
    expect(sources.cabg).toEqual([{ kind: 'hfpefClinical', key: 'priorCabg' }, 'no'])
    expect(sources.smoking).toEqual([{ kind: 'hfpefClinical', key: 'smoker' }, 'no'])
    expect(trs.inputs.find((input) => input.key === 'egfr')).toMatchObject({ source: { kind: 'lab', keys: ['EGFR(EPI)', 'EGFR(M)'] } })
  })
})

describe('TIMI Risk Score for UA/NSTEMI', () => {
  const timi = calc('timi-ua-nstemi')
  const none = { riskFactors: 'no', knownCad: 'no', aspirin: 'no', angina: 'no', st: 'no', marker: 'no' }

  it.each([
    [{ age: '50', ...none }, 0, '4.7%', '低風險（0–2 分）'],
    [{ age: '70', ...none, knownCad: 'yes' }, 2, '8.3%', '低風險（0–2 分）'],
    [{ age: '70', ...none, knownCad: 'yes', aspirin: 'yes' }, 3, '13.2%', '中風險（3–4 分）'],
    [{ age: '70', ...none, knownCad: 'yes', aspirin: 'yes', st: 'yes', marker: 'yes' }, 5, '26.2%', '高風險（5–7 分）'],
    [{ age: '70', riskFactors: 'yes', knownCad: 'yes', aspirin: 'yes', angina: 'yes', st: 'yes', marker: 'yes' }, 7, '40.9%', '高風險（5–7 分）'],
  ])('%o scores %i with the TIMI 11B 14-day rate', (values, score, rate, band) => {
    const result = timi.compute(values)!
    expect(result.numericValue).toBe(score)
    expect(result.interpretation?.zh).toBe(band)
    expect(result.extra?.[0]).toEqual({ label: { zh: '14 天死亡、心肌梗塞或需緊急血行重建', en: '14-day death, MI or urgent revascularisation' }, value: rate })
  })

  it('shows no event rate until every item is answered', () => {
    const result = timi.compute({ age: '70', ...none, st: '' })!
    expect(result.value).toBe('1–2 / 7')
    expect(result.extra?.some((row) => row.value.endsWith('%'))).toBe(false)
  })

  it('reads aspirin from a current prescription', () => {
    const now = new Date('2026-11-19')
    const aspirin = { id: 'm1', status: 'active', authoredOn: '2026-11-01', medicationCodeableConcept: { text: 'Aspirin 100 mg' }, drugTerminology: { ingredientText: 'aspirin' }, atcClassification: { atcCode: 'B01AC06' }, dispenseRequest: { validityPeriod: { end: '2026-12-31' } } } as unknown as MedicationEntity
    expect(buildClinicalSelects([], [aspirin], now).aspirin).toMatchObject({ value: 'yes', testName: expect.stringContaining('aspirin') })
  })
})

it('describes both in the calculator list', () => {
  for (const id of ['timi-trs2p', 'timi-ua-nstemi']) {
    expect(getCalcInfo(id)?.useWhen?.zh).toBeTruthy()
    expect(getCalcScoring(id)?.formula?.zh).toBeTruthy()
    expect(getCalcTags(id)?.purpose).toContain('risk')
  }
})
