// Thyroid antibody / thyroglobulin LOINCs (verified 2026-10-09 against
// tx.fhir.org LOINC 2.82 and NLM Clinical Table Search). The endocrine list
// used to carry '8099-6' and '8100-2', neither of which is a LOINC code (bad
// Mod-10 check digits; not found in 2.82), so real anti-TPO / anti-Tg rows
// never reached 內分泌 by LOINC — and a thyroglobulin row named "Tg" was read
// as triglyceride (血脂).
import { categorizeObservationWithReason, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'
import { IMMUNOLOGY_LOINC_TO_KEY } from '@/src/shared/utils/immunology-analytes'

const LOINC = 'http://loinc.org'

function loincObs(code: string, text: string, value: any = { valueQuantity: { value: 12, unit: 'IU/mL' } }) {
  return {
    resourceType: 'Observation',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text, coding: [{ system: LOINC, code }] },
    effectiveDateTime: '2026-01-01T08:00:00+08:00',
    ...value,
  }
}

const endocrine = LAB_CATEGORIES.find((c) => c.id === 'endocrine')!

describe('内分泌 thyroid antibody / thyroglobulin LOINCs', () => {
  it('drops the two non-existent codes and lists the verified ones', () => {
    expect(endocrine.loincCodes).not.toContain('8099-6')
    expect(endocrine.loincCodes).not.toContain('8100-2')
    // 8100-0 is "Specimen preparation", not anti-Tg.
    expect(endocrine.loincCodes).not.toContain('8100-0')
    for (const code of ['8099-4', '32042-4', '56477-3', '32786-6', '8098-6', '3013-0']) {
      expect(endocrine.loincCodes).toContain(code)
    }
  })

  it.each([
    ['8099-4', 'TPO Ab', 'ANTI-TPO', 'Anti-TPO', undefined],
    ['32042-4', 'Anti-TPO', 'ANTI-TPO', 'Anti-TPO', { valueString: 'Negative' }],
    ['56477-3', '抗甲狀腺過氧化酶抗體', 'ANTI-TPO', 'Anti-TPO', undefined],
    ['32786-6', 'Microsome Ab', 'ANTI-TPO', 'Anti-TPO', { valueString: '1:100' }],
    ['8098-6', '甲狀腺球蛋白抗體', 'ANTI-TG', 'Anti-Tg', undefined],
    ['8098-6', 'Tg Ab', 'ANTI-TG', 'Anti-Tg', undefined],
    ['3013-0', '甲狀腺球蛋白', 'THYROGLOBULIN', 'Thyroglobulin', undefined],
    // "Tg" is also triglyceride's short name; the LOINC decides.
    ['3013-0', 'Tg', 'THYROGLOBULIN', 'Thyroglobulin', undefined],
  ] as Array<[string, string, string, string, any]>)('%s "%s" → 內分泌 / %s', (code, text, key, display, value) => {
    const obs = loincObs(code, text, value)
    const decision = categorizeObservationWithReason(obs)
    expect(decision.category?.id).toBe('endocrine')
    expect(decision.decidedBy).toBe('loinc')
    expect(getLabPivotTestIdentity(obs, 'endocrine')).toMatchObject({ testKey: key, mapKey: key, displayName: display })
  })

  it('keeps thyroglobulin and anti-Tg in separate columns', () => {
    const tg = getLabPivotTestIdentity(loincObs('3013-0', 'Thyroglobulin'), 'endocrine')
    const antiTg = getLabPivotTestIdentity(loincObs('8098-6', 'Thyroglobulin Ab'), 'endocrine')
    expect(tg.mapKey).not.toBe(antiTg.mapKey)
  })

  it('leaves a triglyceride row without the thyroglobulin LOINC in 血脂', () => {
    const tg = loincObs('2571-8', 'TG', { valueQuantity: { value: 120, unit: 'mg/dL' } })
    expect(categorizeObservationWithReason(tg).category?.id).toBe('lipid')
  })
})

describe('免疫 LOINCs the nhi-clinical-mapper emits (verified LOINC 2.82)', () => {
  it.each([
    ['29953-7', 'ANA', 'ANA', { valueString: '1:160' }],
    ['105551-6', 'PL-7', 'ANTI-PL-7', undefined],
    ['105552-4', 'PL-12', 'ANTI-PL-12', undefined],
    ['105547-4', 'EJ', 'ANTI-EJ', undefined],
    ['105548-2', 'OJ', 'ANTI-OJ', undefined],
    ['53031-1', 'SRP', 'ANTI-SRP', undefined],
    ['105529-2', 'MDA5', 'ANTI-MDA5', undefined],
    ['105555-7', 'TIF1γ', 'ANTI-TIF1G', undefined],
    ['105528-4', 'NXP2', 'ANTI-NXP2', undefined],
    ['105554-0', 'PM-Scl100', 'ANTI-PM-SCL100', undefined],
  ] as Array<[string, string, string, any]>)('%s (%s) → 免疫 / %s', (code, text, key, value) => {
    expect(IMMUNOLOGY_LOINC_TO_KEY[code]).toBe(key)
    // Name-independent: an unhelpful source label still lands in the column.
    const obs = loincObs(code, `Item ${code}`, value ?? { valueQuantity: { value: 8, unit: 'U/mL' } })
    const decision = categorizeObservationWithReason(obs)
    expect(decision.category?.id).toBe('immuno')
    expect(decision.decidedBy).toBe('loinc')
    expect(getLabPivotTestIdentity(obs, 'immuno').testKey).toBe(key)
  })
})

describe('thyroid column headers through the shared display resolver', () => {
  it.each([
    ['3013-0', 'Tg', 'Thyroglobulin'],
    ['8098-6', 'Tg Ab', 'Anti-Tg'],
    ['8099-4', 'TPO Ab', 'Anti-TPO'],
  ])('%s "%s" renders as %s in every audience and language', (code, text, header) => {
    const row = buildLabPivots([loincObs(code, text)]).endocrine.rows.find((r) => r.values.size > 0)!
    expect(row).toBeDefined()
    for (const audience of ['medical', 'patient'] as const) {
      for (const language of ['zh-TW', 'en'] as const) {
        expect(getLabRowDisplayParts(row, audience, language).name).toBe(header)
      }
    }
  })
})
