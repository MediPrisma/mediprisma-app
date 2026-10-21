// One analyte, one column. These shapes come from real bridge bundles
// (2026-09-27 probe of 健康存摺 + medcloud captures): a LOINC the shared
// package does not know, or a bilingual source name, used to open a second
// column beside the standard one.
import { bilingualNameParts, buildLabPivots, labKeyInCategory, resolveLabTextKey } from '@/src/shared/utils/lab-pivot.utils'

const LOINC = 'http://loinc.org'

function obs(text: string, value: number | string, loinc?: string, date = '2026-09-18') {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { text, ...(loinc ? { coding: [{ system: LOINC, code: loinc }] } : {}) },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    ...(typeof value === 'number' ? { valueQuantity: { value } } : { valueString: value }),
  }
}

/** Columns that hold a result — standard panels also carry empty pinned
 *  placeholder columns. */
function keys(pivots: ReturnType<typeof buildLabPivots>, category: string): string[] {
  return (pivots[category]?.rows ?? []).filter((row) => row.values.size > 0).map((row) => row.testKey)
}

describe('LOINC codes the package table lacks', () => {
  it('puts a bilingual differential into the standard CBC column', () => {
    const pivots = buildLabPivots([
      obs('Basophils %', 0.5, '706-2', '2026-09-01'),
      obs('嗜鹼性白血球 / Basophil', 0.7, '706-2'),
      obs('嗜中性白血球 / Segment', 61, '770-8'),
    ])
    expect(keys(pivots, 'cbc').sort()).toEqual(['BASO', 'NEU'])
  })

  it('merges direct LDL and plasma ammonia into their columns', () => {
    const pivots = buildLabPivots([
      obs('LDL-C', 101, '2089-1', '2026-09-01'),
      obs('低密度脂蛋白膽固醇(direct) / LDL-C(direct)', 99, '18262-6'),
      obs('氨 / Ammonia', 40, '22763-7'),
    ])
    expect(keys(pivots, 'lipid')).toEqual(['LDL'])
    expect(keys(pivots, 'chem')).toContain('AMMONIA')
  })

  it('files urine test-strip and quantitative codes under 尿液 by LOINC', () => {
    const pivots = buildLabPivots([
      obs('尿糖 / Glucose', 'Negative', '25428-4'),
      obs('酮體 / Ketone', 'Negative', '2514-8'),
      obs('U-CRE 尿液肌酸酐', 80, '2161-8'),
      obs('微白蛋白(尿)(半定量)', 30, '14957-5'),
    ])
    expect(keys(pivots, 'urine').sort()).toEqual(['CREA', 'GLUCOSE', 'KETONE', 'MALB'])
    expect(keys(pivots, 'glucose')).toEqual([])
  })

  it('keeps high-sensitivity troponins apart from TROP and from each other', () => {
    const pivots = buildLabPivots([
      obs('Troponin I', 0.01, '10839-9'),
      obs('hs-Troponin I', 5, '89579-7'),
      obs('hs-Troponin T', 12, '67151-1'),
    ])
    const chem = pivots.chem!.rows.filter((row) => row.values.size > 0)
    expect(chem.map((row) => row.testKey).sort()).toEqual(['HS-TROPONIN I', 'HS-TROPONIN T', 'TROP'])
    expect(chem.find((row) => row.testKey === 'HS-TROPONIN T')?.displayName).toBe('hs-TnT')
  })
})

describe('urinalysis spellings', () => {
  it('puts every spelling of specific gravity in one column', () => {
    const pivots = buildLabPivots([
      obs('SP.Gravity', 1.015, '5811-5', '2026-09-01'),
      obs('Gravity', 1.02),
      obs('Specific Gravity 尿液比重', 1.01, undefined, '2026-08-01'),
    ])
    expect(keys(pivots, 'urine')).toEqual(['GRAVIT'])
  })

  it('folds only inside the urine panel', () => {
    expect(labKeyInCategory('PROTEIN', 'urine')).toBe('PROT')
    // A pleural-fluid "Protein" filed under 其他 must not become 尿蛋白.
    expect(labKeyInCategory('PROTEIN', 'other')).toBe('PROTEIN')
    expect(labKeyInCategory('TRASPARANT', 'urine')).toBe('TURBIDITY')
    expect(labKeyInCategory('PCRATIO', 'urine')).toBe('PROT/CR RATIO')
  })

  it('keeps different epithelial cell types apart', () => {
    expect(labKeyInCategory('EPITH CELL', 'urine')).toBe('EPITH')
    expect(labKeyInCategory('SQUAMOUS EPI', 'urine')).toBe('SQUAMOUS EPI')
    expect(labKeyInCategory('RTE-RENAL TUBE', 'urine')).toBe('RTE-RENAL TUBE')
  })
})

describe('names that used to fall to 其他 or split the urine panel (2026-09-27 reports)', () => {
  it('files post-prandial and random glucose under 血糖, fasting sugar as Glu-AC', () => {
    const pivots = buildLabPivots([
      obs('PC-Sug 飯後兩小時血糖', 180, undefined, '2026-09-01'),
      obs('Glucose PC', 170, undefined, '2026-08-01'),
      obs('Glucose Random 血糖-急診', 160, undefined, '2026-07-01'),
      obs('AC-Sug', 110),
    ])
    expect(keys(pivots, 'glucose').sort()).toEqual(['GLUCOSE', 'GLUCOSE-AC'])
    expect(keys(pivots, 'other')).toEqual([])
    const fasting = pivots.glucose!.rows.find((row) => row.testKey === 'GLUCOSE-AC')!
    expect(fasting.values.size).toBe(1)
  })

  it('reads every AC-sugar spelling as fasting, never ACTH', () => {
    const pivots = buildLabPivots([
      obs('Glucose AC', 100, undefined, '2026-09-01'),
      obs('AC Sugar', 105, undefined, '2026-08-01'),
      obs('Glucose(AC)', 98, undefined, '2026-07-01'),
    ])
    expect(keys(pivots, 'glucose')).toEqual(['GLUCOSE-AC'])
    expect(keys(buildLabPivots([obs('PC Sugar', 150)]), 'glucose')).toEqual(['GLUCOSE'])
  })

  it('reads "Cre" as serum creatinine and 9830-1 as its own TC/HDL column', () => {
    const pivots = buildLabPivots([
      obs('Cre', 0.8),
      obs('Total Cholesterol/HDL-C Ratio', 3.8, '9830-1'),
    ])
    expect(keys(pivots, 'chem')).toEqual(['CREA'])
    expect(keys(pivots, 'lipid')).toEqual(['TC/HDL RATIO'])
  })

  it('folds the urinalysis names seen in a clinic screenshot', () => {
    expect(labKeyInCategory(resolveLabTextKey('Cast'), 'urine')).toBe('CASTS')
    expect(labKeyInCategory(resolveLabTextKey('Ketone Body'), 'urine')).toBe('KETONE')
    expect(labKeyInCategory(resolveLabTextKey('Leucocyte Ester'), 'urine')).toBe('LE')
    expect(labKeyInCategory(resolveLabTextKey('PRO'), 'urine')).toBe('PROT')
    expect(labKeyInCategory(resolveLabTextKey('BIL'), 'urine')).toBe('BILI')
  })
})

describe('bilingual and spelling variants without LOINC', () => {
  it('resolves either half of a bilingual name', () => {
    const pivots = buildLabPivots([obs('Basophil', 0.5, undefined, '2026-09-01'), obs('嗜鹼性白血球 / Basophil', 0.7)])
    expect(keys(pivots, 'cbc')).toEqual(['BASO'])
  })

  it('folds pure spelling variants only', () => {
    expect(resolveLabTextKey('DHEAS')).toBe('DHEA-S')
    expect(resolveLabTextKey('IGF1')).toBe('IGF-1')
    expect(resolveLabTextKey('25(OH)D')).toBe('25-OH-D')
    // Could be 1,25-(OH)2 D — never assumed to be 25-OH D.
    expect(resolveLabTextKey('Vitamin D')).not.toBe('25-OH-D')
  })

  it('splits only on a spaced slash or a "；(English)" suffix', () => {
    expect(bilingualNameParts('LDL/HDL')).toEqual([])
    expect(bilingualNameParts('微白蛋白/肌酐酸比值')).toEqual([])
    expect(bilingualNameParts('嗜鹼性白血球 / Basophil')).toEqual(['Basophil', '嗜鹼性白血球'])
    expect(bilingualNameParts('肌酐、尿 ;(Creatinine (U) CRTN)')).toEqual(['Creatinine (U) CRTN', '肌酐、尿'])
  })
})
