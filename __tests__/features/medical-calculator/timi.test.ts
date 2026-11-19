/**
 * TRS 2°P for the CAD page (owner request 2026-11-19): Bohula, Circulation
 * 2016; groups from IMPROVE-IT, JACC 2017.
 */
import { CALCULATORS, getCalcInfo, getCalcScoring, getCalcTags } from '@/features/medical-calculator/calculators'

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

it('describes it in the calculator list', () => {
  for (const id of ['timi-trs2p']) {
    expect(getCalcInfo(id)?.useWhen?.zh).toBeTruthy()
    expect(getCalcScoring(id)?.formula?.zh).toBeTruthy()
    expect(getCalcTags(id)?.purpose).toContain('risk')
  }
})
