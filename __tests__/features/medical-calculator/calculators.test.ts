import { CALCULATORS, getCalcInfo, CALC_SCORING, getCalcScoring } from '@/features/medical-calculator/calculators'
import type { CalcValues } from '@/features/medical-calculator/types'

function run(id: string, values: CalcValues) {
  const calc = CALCULATORS.find((c) => c.id === id)
  if (!calc) throw new Error(`calculator not found: ${id}`)
  return calc.compute(values)
}

describe('eGFR (CKD-EPI 2021)', () => {
  it('computes for a 60yo male, Scr 1.0 → G2', () => {
    const r = run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'male' })
    expect(r).not.toBeNull()
    expect(Number(r!.value)).toBeCloseTo(86, 0)
    expect(r!.interpretation!.en).toContain('G2')
    expect(r!.severity).toBe('normal')
  })

  it('applies the female multiplier (lower κ/α)', () => {
    const male = run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'male' })
    const female = run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'female' })
    expect(Number(female!.value)).toBeLessThan(Number(male!.value))
  })

  it('flags severe reduction as high severity (G4/G5)', () => {
    const r = run('egfr-ckd-epi-2021', { scr: '5.0', age: '70', sex: 'male' })
    expect(Number(r!.value)).toBeLessThan(15)
    expect(r!.severity).toBe('high')
  })

  it('returns null without creatinine', () => {
    expect(run('egfr-ckd-epi-2021', { age: '60', sex: 'male' })).toBeNull()
  })
})

describe('Cockcroft-Gault CrCl', () => {
  it('70yo male, 80kg, Scr 1.0 → ~78', () => {
    const r = run('crcl-cockcroft-gault', { scr: '1.0', age: '70', weight: '80', sex: 'male' })
    expect(Number(r!.value)).toBe(78)
  })
  it('applies 0.85 female factor', () => {
    const r = run('crcl-cockcroft-gault', { scr: '1.0', age: '70', weight: '80', sex: 'female' })
    expect(Number(r!.value)).toBe(66)
  })
})

describe('Corrected calcium', () => {
  it('Ca 8.0 with albumin 2.0 → 9.6', () => {
    const r = run('corrected-calcium', { ca: '8.0', alb: '2.0' })
    expect(r!.value).toBe('9.6')
    expect(r!.severity).toBe('normal')
  })
})

describe('Corrected sodium for hyperglycemia', () => {
  it('Na 130 with glucose 600 → 142 (Hillier 2.4)', () => {
    const r = run('corrected-sodium', { na: '130', glucose: '600' })
    expect(r!.value).toBe('142')
  })
})

describe('Anion gap', () => {
  it('Na 140 / Cl 100 / HCO3 24 → 16, elevated', () => {
    const r = run('anion-gap', { na: '140', cl: '100', hco3: '24' })
    expect(r!.value).toBe('16')
    expect(r!.severity).toBe('moderate')
  })
  it('albumin correction adds an extra row', () => {
    const r = run('anion-gap', { na: '140', cl: '100', hco3: '24', alb: '2' })
    expect(r!.extra?.[0]?.value).toBe('21 mmol/L')
  })
  // Boundary coefficients for AG + 2.5 × (4.0 − alb) — guards the constant
  // against accidental edits in refactors.
  it('severe hypoalbuminemia (alb 1.0) → +7.5 correction', () => {
    const r = run('anion-gap', { na: '140', cl: '100', hco3: '24', alb: '1.0' })
    expect(r!.extra?.[0]?.value).toBe('23.5 mmol/L')
  })
  it('high albumin (alb 5.0) → −2.5 correction', () => {
    const r = run('anion-gap', { na: '140', cl: '100', hco3: '24', alb: '5.0' })
    expect(r!.extra?.[0]?.value).toBe('13.5 mmol/L')
  })
  it('alb exactly 4.0 → zero correction', () => {
    const r = run('anion-gap', { na: '140', cl: '100', hco3: '24', alb: '4.0' })
    expect(r!.extra?.[0]?.value).toBe('16 mmol/L')
  })
})

describe('LDL (Friedewald)', () => {
  it('TC 200 / HDL 50 / TG 150 → 120', () => {
    const r = run('ldl-friedewald', { tc: '200', hdl: '50', tg: '150' })
    expect(r!.value).toBe('120')
    expect(r!.severity).toBe('normal')
  })
  it('TG 399 (just below the cutoff) still computes', () => {
    const r = run('ldl-friedewald', { tc: '200', hdl: '50', tg: '399' })
    expect(Number(r!.value)).toBeCloseTo(70, 0)
  })
  it('TG ≥ 400 is rejected (Friedewald constraint)', () => {
    const r = run('ldl-friedewald', { tc: '200', hdl: '50', tg: '400' })
    expect(r!.value).toBe('—')
    expect(r!.interpretation!.en).toContain('Friedewald invalid')
    expect(r!.severity).toBe('moderate')
  })
})

describe('MELD-Na', () => {
  it('bili 2 / INR 1.5 / Scr 1.5 / Na 130 → 22', () => {
    const r = run('meld-na', { bili: '2', inr: '1.5', scr: '1.5', na: '130', dialysis: 'no' })
    expect(Number(r!.value)).toBe(22)
    expect(r!.severity).toBe('high')
  })
  it('dialysis forces creatinine to 4.0', () => {
    const low = run('meld-na', { bili: '1', inr: '1', scr: '0.8', na: '137', dialysis: 'no' })
    const dialysis = run('meld-na', { bili: '1', inr: '1', scr: '0.8', na: '137', dialysis: 'yes' })
    expect(Number(dialysis!.value)).toBeGreaterThan(Number(low!.value))
  })
})

describe('Child-Pugh', () => {
  it('bili 2 / alb 3.0 / INR 1.5 / no ascites / no enceph → 7 (B)', () => {
    const r = run('child-pugh', { bili: '2', alb: '3.0', inr: '1.5', ascites: 'none', enceph: 'none' })
    expect(r!.value).toBe('7 (B)')
    expect(r!.severity).toBe('moderate')
  })
})

describe('FIB-4', () => {
  it('age 60 / AST 40 / ALT 30 / PLT 150 → ~2.92 (indeterminate)', () => {
    const r = run('fib-4', { age: '60', ast: '40', alt: '30', plt: '150' })
    expect(Number(r!.value)).toBeCloseTo(2.92, 1)
    expect(r!.severity).toBe('moderate')
  })
})

describe('BMI', () => {
  it('70kg / 170cm → 24.2 (Taiwan overweight)', () => {
    const r = run('bmi', { weight: '70', height: '170' })
    expect(r!.value).toBe('24.2')
    expect(r!.severity).toBe('moderate')
  })
})

describe('APRI', () => {
  it('AST 80 / ULN 40 / PLT 100 → 2.0 (cirrhosis likely)', () => {
    const r = run('apri', { ast: '80', astUln: '40', plt: '100' })
    expect(Number(r!.value)).toBeCloseTo(2.0, 2)
    expect(r!.severity).toBe('high')
  })
  it('defaults AST-ULN to 40 when blank', () => {
    const withDefault = run('apri', { ast: '80', astUln: '', plt: '100' })
    expect(Number(withDefault!.value)).toBeCloseTo(2.0, 2)
  })
  it('low APRI reads as fibrosis unlikely', () => {
    const r = run('apri', { ast: '20', astUln: '40', plt: '250' })
    expect(Number(r!.value)).toBeLessThan(0.5)
    expect(r!.severity).toBe('normal')
  })
})

describe('NAFLD Fibrosis Score', () => {
  it('computes and exposes BMI; flags advanced fibrosis', () => {
    // 60yo, 90kg/165cm (BMI ~33), diabetic, AST 60 / ALT 30, alb 3.0, PLT 120
    const r = run('nafld-fibrosis', { age: '60', weight: '90', height: '165', dm: 'yes', ast: '60', alt: '30', alb: '3.0', plt: '120' })
    expect(r).not.toBeNull()
    expect(r!.severity).toBe('high')
    expect(r!.extra?.[0]?.value).toContain('kg/m²')
  })
  it('returns null when a lab is missing', () => {
    expect(run('nafld-fibrosis', { age: '60', weight: '90', height: '165', dm: 'no', ast: '60', alt: '30', alb: '3.0' })).toBeNull()
  })
})

describe('Serum osmolality (calculated)', () => {
  it('Na 140 / glucose 90 / BUN 14 → ~290', () => {
    const r = run('serum-osmolality', { na: '140', glucose: '90', bun: '14' })
    expect(Number(r!.value)).toBeCloseTo(290, 0)
    expect(r!.severity).toBe('normal')
  })
})

describe('Free water deficit', () => {
  it('male 70kg, Na 160 → 6.0 L', () => {
    const r = run('free-water-deficit', { na: '160', weight: '70', sex: 'male' })
    expect(Number(r!.value)).toBeCloseTo(6.0, 1)
    expect(r!.severity).toBe('high')
  })
})

describe('LDL (Friedewald)', () => {
  it('TC 200 / HDL 50 / TG 150 → 120', () => {
    const r = run('ldl-friedewald', { tc: '200', hdl: '50', tg: '150' })
    expect(r!.value).toBe('120')
  })
  it('TG ≥ 400 → invalid', () => {
    const r = run('ldl-friedewald', { tc: '200', hdl: '50', tg: '450' })
    expect(r!.value).toBe('—')
    expect(r!.severity).toBe('moderate')
  })
})

describe('eAG from HbA1c', () => {
  it('HbA1c 7% → ~154 mg/dL', () => {
    const r = run('eag-from-a1c', { a1c: '7' })
    expect(Number(r!.value)).toBeCloseTo(154, 0)
    expect(r!.severity).toBe('high')
  })
})

describe('CHA2DS2-VASc', () => {
  it('76yo female with HTN + diabetes → 5', () => {
    const r = run('cha2ds2-vasc', { age: '76', sex: 'female', chf: 'no', htn: 'yes', dm: 'yes', stroke: 'no', vascular: 'no' })
    expect(r!.value).toBe('5')
    expect(r!.severity).toBe('high')
  })
  it('64yo male, no risk factors → 0', () => {
    const r = run('cha2ds2-vasc', { age: '64', sex: 'male', chf: 'no', htn: 'no', dm: 'no', stroke: 'no', vascular: 'no' })
    expect(r!.value).toBe('0')
    expect(r!.severity).toBe('normal')
  })
})

describe('MAP', () => {
  it('120/80 → 93', () => {
    const r = run('map', { sbp: '120', dbp: '80' })
    expect(r!.value).toBe('93')
  })
  it('flags MAP < 65 as high severity', () => {
    const r = run('map', { sbp: '80', dbp: '50' })
    expect(Number(r!.value)).toBeLessThan(65)
    expect(r!.severity).toBe('high')
  })
})

describe('Ideal / adjusted body weight', () => {
  it('male 175cm → ~70.5 kg IBW', () => {
    const r = run('ideal-body-weight', { height: '175', sex: 'male', weight: '' })
    expect(Number(r!.value)).toBeCloseTo(70.5, 0)
  })
  it('adds adjusted body weight when actual weight given', () => {
    const r = run('ideal-body-weight', { height: '175', sex: 'male', weight: '100' })
    expect(r!.extra?.[0]?.label.en).toBe('Adjusted body weight')
  })
})

describe('HAS-BLED', () => {
  const allNo = { htn: 'no', renal: 'no', liver: 'no', stroke: 'no', bleeding: 'no', inr: 'no', elderly: 'no', drugs: 'no', alcohol: 'no' }
  it('stays incomplete until all 9 answered', () => {
    const partial = run('has-bled', { ...allNo, alcohol: '' })
    expect(partial!.value).toBe('0–1')
    expect(partial!.completeness).toMatchObject({complete:false,missingKeys:['alcohol']})
  })
  it('all no → 0/9 low risk', () => {
    const r = run('has-bled', allNo)
    expect(r!.value).toBe('0 / 9')
    expect(r!.severity).toBe('normal')
  })
  it('3 positives → high risk', () => {
    const r = run('has-bled', { ...allNo, htn: 'yes', renal: 'yes', bleeding: 'yes' })
    expect(r!.value).toBe('3 / 9')
    expect(r!.severity).toBe('high')
  })
})

describe('GDS-15', () => {
  // Depressive answers per item (q1/q5/q7/q11/q13 score on "no").
  const noneDepressed = {
    q1: 'yes', q2: 'no', q3: 'no', q4: 'no', q5: 'yes', q6: 'no', q7: 'yes', q8: 'no',
    q9: 'no', q10: 'no', q11: 'yes', q12: 'no', q13: 'yes', q14: 'no', q15: 'no',
  }
  it('all non-depressive answers → 0/15 normal', () => {
    const r = run('gds-15', noneDepressed)
    expect(r!.value).toBe('0 / 15')
    expect(r!.severity).toBe('normal')
  })
  it('scores reverse-keyed items correctly (q1 "no" is depressive)', () => {
    const r = run('gds-15', { ...noneDepressed, q1: 'no', q2: 'yes', q3: 'yes', q4: 'yes', q5: 'no' })
    expect(r!.value).toBe('5 / 15')
    expect(r!.severity).toBe('moderate')
  })
  it('is incomplete until all 15 answered', () => {
    const r = run('gds-15', { ...noneDepressed, q15: '' })
    expect(r!.value).toBe('14 / 15')
  })
})

describe('CURB-65', () => {
  it('all criteria present → 5 (severe)', () => {
    const r = run('curb-65', { confusion: 'yes', bun: '30', rr: 'yes', bp: 'yes', age: '80' })
    expect(r!.value).toBe('5')
    expect(r!.severity).toBe('high')
  })
  it('young, normal BUN, no clinical criteria → 0 (low)', () => {
    const r = run('curb-65', { confusion: 'no', bun: '12', rr: 'no', bp: 'no', age: '40' })
    expect(r!.value).toBe('0')
    expect(r!.severity).toBe('normal')
  })
  it('BUN threshold is > 19 mg/dL', () => {
    const below = run('curb-65', { confusion: 'no', bun: '19', rr: 'no', bp: 'no', age: '40' })
    const above = run('curb-65', { confusion: 'no', bun: '20', rr: 'no', bp: 'no', age: '40' })
    expect(below!.value).toBe('0')
    expect(above!.value).toBe('1')
  })
})

describe('qSOFA', () => {
  it('all three criteria → 3/3 high', () => {
    const r = run('qsofa', { rr: 'yes', ams: 'yes', sbp: 'yes' })
    expect(r!.value).toBe('3 / 3')
    expect(r!.severity).toBe('high')
  })
  it('one criterion → moderate', () => {
    const r = run('qsofa', { rr: 'yes', ams: 'no', sbp: 'no' })
    expect(r!.value).toBe('1 / 3')
    expect(r!.severity).toBe('moderate')
  })
})

describe('SIRS', () => {
  it('temp 39 / HR 100 / RR 24 / WBC 15 → 4/4', () => {
    const r = run('sirs', { temp: '39', hr: '100', rr: '24', wbc: '15' })
    expect(r!.value).toBe('4 / 4')
    expect(r!.severity).toBe('moderate')
  })
  it('requires all four inputs', () => {
    expect(run('sirs', { temp: '39', hr: '100', rr: '24' })).toBeNull()
  })
})

describe('GCS', () => {
  it('best responses → 15 (mild)', () => {
    const r = run('gcs', { eye: '0', verbal: '0', motor: '0' })
    expect(r!.value).toBe('15 / 15')
    expect(r!.severity).toBe('normal')
  })
  it('worst responses → 3 (severe)', () => {
    const r = run('gcs', { eye: '3', verbal: '4', motor: '5' })
    expect(r!.value).toBe('3 / 15')
    expect(r!.severity).toBe('high')
  })
})

describe('QTc', () => {
  it('QT 400 / HR 60 → 400 ms normal', () => {
    const r = run('qtc', { qt: '400', hr: '60' })
    expect(Number(r!.value)).toBe(400)
    expect(r!.severity).toBe('normal')
  })
  it('flags QTc > 500 as high risk', () => {
    const r = run('qtc', { qt: '480', hr: '75' })
    expect(Number(r!.value)).toBeGreaterThan(500)
    expect(r!.severity).toBe('high')
  })
})

describe("Winter's formula", () => {
  it('HCO3 12 → expected PaCO2 24–28', () => {
    const r = run('winters', { hco3: '12' })
    expect(r!.value).toBe('24–28')
  })
})

describe('ANC', () => {
  it('WBC 5 / neut 50% → 2500/µL normal', () => {
    const r = run('anc', { wbc: '5', neut: '50', bands: '0' })
    expect(r!.value).toBe('2500')
    expect(r!.severity).toBe('normal')
  })
  it('WBC 2 / neut 20% → 400/µL severe', () => {
    const r = run('anc', { wbc: '2', neut: '20', bands: '0' })
    expect(r!.value).toBe('400')
    expect(r!.severity).toBe('high')
  })
})

describe('HEART Score', () => {
  it('all max + age ≥65 → 10 high', () => {
    const r = run('heart', { history: '2', ecg: '2', age: '70', risk: '2', trop: '2' })
    expect(r!.value).toBe('10 / 10')
    expect(r!.severity).toBe('high')
  })
  it('all min + young → 0 low', () => {
    const r = run('heart', { history: '0', ecg: '0', age: '40', risk: '0', trop: '0' })
    expect(r!.value).toBe('0 / 10')
    expect(r!.severity).toBe('normal')
  })
})

describe("Wells' DVT", () => {
  const allNo = { cancer: '0', paralysis: '0', bedridden: '0', tenderness: '0', swollenleg: '0', calf: '0', edema: '0', collateral: '0', priordvt: '0', altdx: '0' }
  it('three positives → 3 (likely)', () => {
    const r = run('wells-dvt', { ...allNo, cancer: '1', paralysis: '1', bedridden: '1' })
    expect(r!.value).toBe('3')
    expect(r!.severity).toBe('high')
  })
  it('alternative diagnosis subtracts 2', () => {
    const r = run('wells-dvt', { ...allNo, cancer: '1', altdx: '1' })
    expect(r!.value).toBe('-1')
    expect(r!.severity).toBe('normal')
  })
})

describe("Wells' PE", () => {
  it('DVT signs + PE most likely → 6 (moderate)', () => {
    const r = run('wells-pe', { dvt: '1', altdx: '1', hr: '0', immob: '0', prior: '0', hemoptysis: '0', cancer: '0' })
    expect(r!.value).toBe('6')
    expect(r!.severity).toBe('moderate')
  })
})

describe('PHQ-9 / GAD-7', () => {
  it('PHQ-9 all "nearly every day" → 27 severe', () => {
    const v = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i + 1}`, '3']))
    const r = run('phq-9', v)
    expect(r!.value).toBe('27 / 27')
    expect(r!.severity).toBe('high')
  })
  it('GAD-7 all "not at all" → 0 minimal', () => {
    const v = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q${i + 1}`, '0']))
    const r = run('gad-7', v)
    expect(r!.value).toBe('0 / 21')
    expect(r!.severity).toBe('normal')
  })
})

describe('CAGE / AUDIT-C / Epworth', () => {
  it('CAGE 2 yes → clinically significant', () => {
    const r = run('cage', { c: 'yes', a: 'yes', g: 'no', e: 'no' })
    expect(r!.value).toBe('2 / 4')
    expect(r!.severity).toBe('high')
  })
  it('AUDIT-C max → 12 hazardous', () => {
    const r = run('audit-c', { freq: '4', amount: '4', binge: '4' })
    expect(r!.value).toBe('12 / 12')
    expect(r!.severity).toBe('high')
  })
  it('Epworth all high chance → 24 severe', () => {
    const v = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`q${i + 1}`, '3']))
    const r = run('epworth', v)
    expect(r!.value).toBe('24 / 24')
    expect(r!.severity).toBe('high')
  })
})

describe('FENa', () => {
  it('prerenal example → < 1%', () => {
    // UNa 10, PNa 140, UCr 100, PCr 2 → (10*2)/(140*100)*100 = 0.14%
    const r = run('fena', { uNa: '10', pNa: '140', uCr: '100', pCr: '2' })
    expect(Number(r!.value)).toBeCloseTo(0.1, 1)
    expect(r!.severity).toBe('normal')
  })
  it('ATN example → > 2%', () => {
    // UNa 60, PNa 140, UCr 30, PCr 3 → (60*3)/(140*30)*100 = 4.29%
    const r = run('fena', { uNa: '60', pNa: '140', uCr: '30', pCr: '3' })
    expect(Number(r!.value)).toBeGreaterThan(2)
    expect(r!.severity).toBe('high')
  })
  it('requires all four inputs', () => {
    expect(run('fena', { uNa: '10', pNa: '140', uCr: '100' })).toBeNull()
  })
})

describe('FEUrea', () => {
  it('prerenal example → < 35%', () => {
    // UUrea 300, BUN 40, UCr 100, PCr 2 → (300*2)/(40*100)*100 = 15%
    const r = run('feurea', { uUrea: '300', pBun: '40', uCr: '100', pCr: '2' })
    expect(Number(r!.value)).toBeLessThan(35)
    expect(r!.severity).toBe('normal')
  })
})

describe('Urine anion gap', () => {
  it('negative → GI cause', () => {
    const r = run('urine-anion-gap', { uNa: '20', uK: '10', uCl: '50' })
    expect(r!.value).toBe('-20')
    expect(r!.severity).toBe('normal')
  })
  it('positive → RTA', () => {
    const r = run('urine-anion-gap', { uNa: '40', uK: '30', uCl: '40' })
    expect(r!.value).toBe('30')
    expect(r!.severity).toBe('moderate')
  })
})

describe('TTKG', () => {
  it('computes when urine osm > serum osm', () => {
    // UK 40, PK 5, Uosm 600, Posm 290 → (40*290)/(5*600) = 3.87
    const r = run('ttkg', { uK: '40', pK: '5', uOsm: '600', pOsm: '290' })
    expect(Number(r!.value)).toBeCloseTo(3.9, 1)
  })
  it('flags unreliable when urine osm ≤ serum osm', () => {
    const r = run('ttkg', { uK: '40', pK: '5', uOsm: '250', pOsm: '290' })
    expect(r!.interpretation!.en).toContain('unreliable')
  })
})

describe('Osmolar gap', () => {
  it('normal gap ≤ 10', () => {
    // measured 290, Na 140, glu 90, BUN 14 → calc 290.6 → gap ≈ -0.6
    const r = run('osmolar-gap', { measured: '290', na: '140', glucose: '90', bun: '14' })
    expect(Number(r!.value)).toBeLessThan(10)
    expect(r!.severity).toBe('normal')
  })
  it('elevated gap flags toxic alcohols', () => {
    const r = run('osmolar-gap', { measured: '320', na: '140', glucose: '90', bun: '14' })
    expect(Number(r!.value)).toBeGreaterThan(10)
    expect(r!.severity).toBe('high')
  })
})

describe('A-a gradient', () => {
  it('room air, normal ABG → low gradient', () => {
    // FiO2 21, PaCO2 40, PaO2 95 → PAO2 = 0.21*713 - 50 = 99.73; A-a ≈ 5
    const r = run('aa-gradient', { fio2: '21', paco2: '40', pao2: '95', age: '40' })
    expect(Number(r!.value)).toBeCloseTo(5, 0)
  })
  it('elevated gradient flagged vs age-expected', () => {
    const r = run('aa-gradient', { fio2: '21', paco2: '40', pao2: '60', age: '40' })
    expect(r!.severity).toBe('moderate')
  })
})

describe('P/F ratio', () => {
  it('PaO2 80 on FiO2 100% → 80 (severe ARDS)', () => {
    const r = run('pf-ratio', { pao2: '80', fio2: '100' })
    expect(r!.value).toBe('80')
    expect(r!.severity).toBe('high')
  })
  it('PaO2 95 on room air → ~452 (normal)', () => {
    const r = run('pf-ratio', { pao2: '95', fio2: '21' })
    expect(Number(r!.value)).toBeGreaterThan(300)
    expect(r!.severity).toBe('normal')
  })
})

describe('eGFR (MDRD)', () => {
  it('60yo male, Scr 1.0 → ~76', () => {
    const r = run('egfr-mdrd', { scr: '1.0', age: '60', sex: 'male' })
    expect(Number(r!.value)).toBeCloseTo(76, 0)
  })
  it('female multiplier lowers eGFR', () => {
    const m = run('egfr-mdrd', { scr: '1.0', age: '60', sex: 'male' })
    const f = run('egfr-mdrd', { scr: '1.0', age: '60', sex: 'female' })
    expect(Number(f!.value)).toBeLessThan(Number(m!.value))
  })
})

describe('MELD 3.0', () => {
  it('computes within 6–40 and rises with worse labs', () => {
    const mild = run('meld-3', { bili: '1', inr: '1', scr: '1', na: '137', alb: '3.5', sex: 'male', dialysis: 'no' })
    const sick = run('meld-3', { bili: '8', inr: '2.5', scr: '3', na: '128', alb: '2.2', sex: 'female', dialysis: 'no' })
    expect(Number(mild!.value)).toBeGreaterThanOrEqual(6)
    expect(Number(sick!.value)).toBeGreaterThan(Number(mild!.value))
    expect(Number(sick!.value)).toBeLessThanOrEqual(40)
    expect(sick!.severity).toBe('high')
  })
  it('dialysis caps creatinine at 3.0', () => {
    const noHd = run('meld-3', { bili: '2', inr: '1.5', scr: '1.2', na: '135', alb: '3', sex: 'male', dialysis: 'no' })
    const hd = run('meld-3', { bili: '2', inr: '1.5', scr: '1.2', na: '135', alb: '3', sex: 'male', dialysis: 'yes' })
    expect(Number(hd!.value)).toBeGreaterThan(Number(noHd!.value))
  })
})

describe("Maddrey's DF", () => {
  it('PT 20 / control 12 / bili 15 → 51.8 (severe)', () => {
    const r = run('maddrey-df', { pt: '20', control: '12', bili: '15' })
    expect(Number(r!.value)).toBeCloseTo(51.8, 1)
    expect(r!.severity).toBe('high')
  })
  it('defaults control PT to 12', () => {
    const r = run('maddrey-df', { pt: '13', control: '', bili: '2' })
    expect(Number(r!.value)).toBeCloseTo(6.6, 1)
    expect(r!.severity).toBe('normal')
  })
})

describe('Glasgow-Blatchford', () => {
  it('all normal → 0 (very low risk)', () => {
    const r = run('glasgow-blatchford', { bun: '14', hb: '15', sbp: '120', sex: 'male', hr: 'no', melena: 'no', syncope: 'no', hepatic: 'no', cardiac: 'no' })
    expect(r!.value).toBe('0 / 23')
    expect(r!.severity).toBe('normal')
  })
  it('high-risk bleed scores high', () => {
    const r = run('glasgow-blatchford', { bun: '80', hb: '9', sbp: '85', sex: 'male', hr: 'yes', melena: 'yes', syncope: 'yes', hepatic: 'no', cardiac: 'no' })
    // BUN≥70=6, Hb<10=6, SBP<90=3, HR=1, melena=1, syncope=2 → 19
    expect(r!.value).toBe('19 / 23')
    expect(r!.severity).toBe('high')
  })
  it('applies sex-specific hemoglobin thresholds', () => {
    // Hb 11: male → 3 pts, female → 1 pt
    const male = run('glasgow-blatchford', { bun: '14', hb: '11', sbp: '120', sex: 'male', hr: 'no', melena: 'no', syncope: 'no', hepatic: 'no', cardiac: 'no' })
    const female = run('glasgow-blatchford', { bun: '14', hb: '11', sbp: '120', sex: 'female', hr: 'no', melena: 'no', syncope: 'no', hepatic: 'no', cardiac: 'no' })
    expect(male!.value).toBe('3 / 23')
    expect(female!.value).toBe('1 / 23')
  })
})

describe('Reticulocyte Production Index', () => {
  it('retic 5% / Hct 30 → RPI ~2.2 (adequate)', () => {
    // corrected = 5*(30/45)=3.33; mat(Hct 30)=1.5; RPI=2.22
    const r = run('reticulocyte-index', { retic: '5', hct: '30' })
    expect(Number(r!.value)).toBeCloseTo(2.2, 1)
    expect(r!.severity).toBe('normal')
  })
  it('low RPI flags inadequate response', () => {
    const r = run('reticulocyte-index', { retic: '1', hct: '30' })
    expect(Number(r!.value)).toBeLessThan(2)
    expect(r!.severity).toBe('moderate')
  })
})

describe('NIHSS', () => {
  const items = ['loc','locq','locc','gaze','visual','facial','armL','armR','legL','legR','ataxia','sensory','language','dysarthria','extinction']
  it('all best responses → 0 (no stroke)', () => {
    const v = Object.fromEntries(items.map(k => [k, '0']))
    const r = run('nihss', v)
    expect(r!.value).toBe('0 / 42')
    expect(r!.severity).toBe('normal')
  })
  it('moderate example scores in 5–15 band', () => {
    const v = Object.fromEntries(items.map(k => [k, '0']))
    v.loc = '1'; v.facial = '2'; v.armL = '3'; v.language = '2' // 1+2+3+2 = 8
    const r = run('nihss', v)
    expect(r!.value).toBe('8 / 42')
    expect(r!.severity).toBe('high')
  })
  it('is incomplete until all 15 items answered', () => {
    const v = Object.fromEntries(items.slice(0, 14).map(k => [k, '0']))
    const r = run('nihss', v)
    expect(r!.value).toBe('14 / 15')
  })
})

describe('ABCD²', () => {
  it('high-risk TIA → 6–7 band', () => {
    // age≥60 (1) + BP (1) + unilateral weakness (2) + ≥60min (2) + diabetes (1) = 7
    const r = run('abcd2', { age: '1', bp: '1', clinical: '2', duration: '2', diabetes: '1' })
    expect(r!.value).toBe('7 / 7')
    expect(r!.severity).toBe('high')
  })
  it('low-risk TIA → 0–3 band', () => {
    const r = run('abcd2', { age: '0', bp: '0', clinical: '1', duration: '1', diabetes: '0' })
    expect(r!.value).toBe('2 / 7')
    expect(r!.severity).toBe('normal')
  })
})

describe('modified Rankin Scale', () => {
  it('grade 0 → normal', () => {
    const r = run('mrs', { grade: '0' })
    expect(r!.value).toBe('0')
    expect(r!.severity).toBe('normal')
  })
  it('grade 5 → high severity', () => {
    const r = run('mrs', { grade: '5' })
    expect(r!.value).toBe('5')
    expect(r!.severity).toBe('high')
  })
  it('returns null when unselected', () => {
    expect(run('mrs', { grade: '' })).toBeNull()
  })
})

describe('BISAP', () => {
  it('all criteria → 5 (high mortality)', () => {
    const r = run('bisap', { bun: '30', age: '70', mental: 'yes', sirs: 'yes', effusion: 'yes' })
    expect(r!.value).toBe('5 / 5')
    expect(r!.severity).toBe('high')
  })
  it('BUN threshold is > 25 mg/dL', () => {
    const below = run('bisap', { bun: '25', age: '40', mental: 'no', sirs: 'no', effusion: 'no' })
    const above = run('bisap', { bun: '26', age: '40', mental: 'no', sirs: 'no', effusion: 'no' })
    expect(below!.value).toBe('0 / 5')
    expect(above!.value).toBe('1 / 5')
  })
})

describe("Ranson's Criteria", () => {
  it('counts admission criteria met', () => {
    // age 60>55, WBC 18>16, glucose 250>200, AST 300>250, LDH 400>350 → 5
    const r = run('ranson', { age: '60', wbc: '18', glucose: '250', ast: '300', ldh: '400' })
    expect(r!.value).toBe('5 / 11')
    expect(r!.severity).toBe('high')
  })
  it('adds 48h criteria when provided', () => {
    const r = run('ranson', { age: '40', wbc: '10', glucose: '120', ast: '50', ldh: '200', ca: '7', pao2: '55', hctFall: '12' })
    // ca<8, pao2<60, hctFall>10 → 3
    expect(r!.value).toBe('3 / 11')
  })
  it('requires the admission labs', () => {
    expect(run('ranson', { age: '60', wbc: '18', glucose: '250', ast: '300' })).toBeNull()
  })
})

describe('AIMS65', () => {
  it('all criteria → 5 (high mortality)', () => {
    const r = run('aims65', { alb: '2.5', inr: '2.0', sbp: '85', age: '80', mental: 'yes' })
    expect(r!.value).toBe('5 / 5')
    expect(r!.severity).toBe('high')
  })
  it('all normal → 0', () => {
    const r = run('aims65', { alb: '4', inr: '1', sbp: '120', age: '40', mental: 'no' })
    expect(r!.value).toBe('0 / 5')
    expect(r!.severity).toBe('normal')
  })
})

describe('Rockall', () => {
  it('high-risk combination → ≥ 6', () => {
    // age≥80 (2) + hypotension (2) + renal/liver (3) + malignancy (2) + stigmata (2) = 11
    const r = run('rockall', { age: '2', shock: '2', comorbid: '2', diagnosis: '2', stigmata: '1' })
    expect(r!.value).toBe('11 / 11')
    expect(r!.severity).toBe('high')
  })
  it('low-risk → ≤ 2', () => {
    const r = run('rockall', { age: '0', shock: '0', comorbid: '0', diagnosis: '0', stigmata: '0' })
    expect(r!.value).toBe('0 / 11')
    expect(r!.severity).toBe('normal')
  })
})

describe('RPI maturation-factor boundaries (audit fix)', () => {
  it('Hct 35 uses maturation factor 1.5 (not 1.0)', () => {
    // retic 5, Hct 35 → corrected 5*35/45=3.889; mat(35)=1.5 → RPI 2.59
    const r = run('reticulocyte-index', { retic: '5', hct: '35' })
    expect(Number(r!.value)).toBeCloseTo(2.6, 1)
  })
  it('Hct 25 uses maturation factor 2.0 (not 1.5)', () => {
    // retic 6, Hct 25 → corrected 6*25/45=3.333; mat(25)=2.0 → RPI 1.67
    const r = run('reticulocyte-index', { retic: '6', hct: '25' })
    expect(Number(r!.value)).toBeCloseTo(1.7, 1)
  })
})

describe('AIMS65 mortality figures (audit fix)', () => {
  it('score 4 → 21.8% in-hospital mortality', () => {
    const r = run('aims65', { alb: '2.5', inr: '2.0', sbp: '85', age: '80', mental: 'no' })
    expect(r!.value).toBe('4 / 5')
    expect(r!.extra?.[0]?.value).toBe('21.8%')
  })
})

describe('CHA2DS2-VASc risk table (audit-verified Friberg 2012)', () => {
  it('score 2 → 2.2% adjusted annual ischemic stroke rate', () => {
    const r = run('cha2ds2-vasc', { age: '65', sex: 'male', chf: 'yes', htn: 'no', dm: 'no', stroke: 'no', vascular: 'no' })
    expect(r!.value).toBe('2')
    expect(r!.extra?.[0]?.value).toBe('2.2%')
  })
})

describe('Liver-cancer (HCC) risk — REACH-B / 健保存摺', () => {
  it('55–59 male, ALT 50, HBeAg+ → 14 pts, 30–50% band, high', () => {
    // sex M=2, age 55–59=5, ALT≥45=3, HBeAg+=4 = 14
    const r = run('hcc-risk-reveal', { sex: 'male', age: '57', alt: '50', hbeag: 'pos' })
    expect(r!.value).toBe('14 / 15')
    expect(r!.severity).toBe('high')
    expect(r!.extra?.[0]?.value).toBe('30–50%')
  })
  it('young female, normal ALT, HBeAg− → 0 pts, <1%, normal', () => {
    const r = run('hcc-risk-reveal', { sex: 'female', age: '30', alt: '10', hbeag: 'neg' })
    expect(r!.value).toBe('0 / 15')
    expect(r!.severity).toBe('normal')
    expect(r!.extra?.[0]?.value).toBe('< 1%')
  })
  it('max score 15 → ~65%', () => {
    // sex M=2, age ≥60=6, ALT≥45=3, HBeAg+=4 = 15
    const r = run('hcc-risk-reveal', { sex: 'male', age: '65', alt: '80', hbeag: 'pos' })
    expect(r!.value).toBe('15 / 15')
    expect(r!.extra?.[0]?.value).toBe('~65%')
  })
  it('age-60 band and ALT 15–44 band (male 60, ALT 20, HBeAg−) → 9 pts, 1–10%', () => {
    // M=2, age≥60=6, ALT 15–44=1, HBeAg−=0 = 9
    const r = run('hcc-risk-reveal', { sex: 'male', age: '60', alt: '20', hbeag: 'neg' })
    expect(r!.value).toBe('9 / 15')
    expect(r!.severity).toBe('moderate')
    expect(r!.extra?.[0]?.value).toBe('1–10%')
  })
  it('returns null until HBeAg is answered', () => {
    expect(run('hcc-risk-reveal', { sex: 'male', age: '57', alt: '50', hbeag: '' })).toBeNull()
  })
})

describe('CKD prognosis / follow-up (KDIGO 健保存摺)', () => {
  it('eGFR 50 (G3a) + ACR 50 (A2) → orange / moderate', () => {
    const r = run('ckd-kdigo-risk', { egfr: '50', acr: '50' })
    expect(r!.value).toBe('G3a · A2')
    expect(r!.severity).toBe('moderate')
    expect(r!.interpretation!.en).toContain('orange')
  })
  it('eGFR 10 (G5) + ACR 10 (A1) → deep-red ESRD / high', () => {
    const r = run('ckd-kdigo-risk', { egfr: '10', acr: '10' })
    expect(r!.value).toBe('G5 · A1')
    expect(r!.severity).toBe('high')
    expect(r!.interpretation!.en).toContain('ESRD')
    expect(r!.notes!.zh).toContain('每年至少 4 次')
  })
  it('G4 + A3 is the deep-red ESRD cell (≥4×/yr)', () => {
    const r = run('ckd-kdigo-risk', { egfr: '20', acr: '400' })
    expect(r!.value).toBe('G4 · A3')
    expect(r!.interpretation!.en).toContain('ESRD')
  })
  it('eGFR 100 (G1) + ACR 10 (A1) → green / normal', () => {
    const r = run('ckd-kdigo-risk', { egfr: '100', acr: '10' })
    expect(r!.value).toBe('G1 · A1')
    expect(r!.severity).toBe('normal')
  })
  it('PCR fallback: eGFR 40 (G3b) + PCR 600 (A3) → red / high', () => {
    const r = run('ckd-kdigo-risk', { egfr: '40', pcr: '600' })
    expect(r!.value).toBe('G3b · A3')
    expect(r!.severity).toBe('high')
  })
  it('ACR >300 boundary is A3 (400 → A3, 300 → A2)', () => {
    expect(run('ckd-kdigo-risk', { egfr: '70', acr: '400' })!.value).toBe('G2 · A3')
    expect(run('ckd-kdigo-risk', { egfr: '70', acr: '300' })!.value).toBe('G2 · A2')
  })
  it('eGFR alone prompts for albuminuria (no ACR/PCR)', () => {
    const r = run('ckd-kdigo-risk', { egfr: '50' })
    expect(r!.value).toBe('G3a')
    expect(r!.interpretation!.en).toContain('Enter ACR or PCR')
  })
  it('returns null without eGFR', () => {
    expect(run('ckd-kdigo-risk', { acr: '50' })).toBeNull()
  })
})

describe('Kidney Failure Risk Equation (KFRE)', () => {
  it('returns 2- and 5-year risks using the non-North-American calibration', () => {
    const r = run('kfre-4-variable', {
      age: '72',
      sex: 'male',
      egfr: '35',
      acr: '450',
    })

    expect(r).not.toBeNull()
    expect(r!.value).toBe('3.1% / 11.6%')
    expect(r!.extra).toEqual([
      expect.objectContaining({ value: '3.1%' }),
      expect.objectContaining({ value: '11.6%' }),
    ])
    expect(r!.notes!.en).toContain('non–North American')
  })

  it('maps KDIGO action thresholds from the unrounded risk', () => {
    const r = run('kfre-4-variable', {
      age: '50',
      sex: 'male',
      egfr: '10',
      acr: '2000',
    })

    expect(r!.severity).toBe('high')
    expect(r!.interpretation!.en).toContain('KRT')
  })

  it('requires confirmed sex, positive quantitative ACR, and eGFR below 60', () => {
    const base = { age: '72', sex: 'male', egfr: '35', acr: '450' }
    expect(run('kfre-4-variable', { ...base, sex: '' })).toBeNull()
    expect(run('kfre-4-variable', { ...base, acr: '0' })).toBeNull()
    expect(run('kfre-4-variable', { ...base, egfr: '60' })).toBeNull()
  })
})

describe('sex is required — no silent male default', () => {
  it('eGFR (CKD-EPI) returns null when sex is blank/unknown, computes when set', () => {
    expect(run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: '' })).toBeNull()
    expect(run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'other' })).toBeNull()
    expect(run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'male' })).not.toBeNull()
    expect(run('egfr-ckd-epi-2021', { scr: '1.0', age: '60', sex: 'female' })).not.toBeNull()
  })
  it('Cockcroft-Gault, MDRD, IBW, free-water, MELD-3, HCC, CHA2DS2-VASc, Glasgow-Blatchford all require sex', () => {
    expect(run('crcl-cockcroft-gault', { scr: '1', age: '70', weight: '80', sex: '' })).toBeNull()
    expect(run('egfr-mdrd', { scr: '1', age: '60', sex: '' })).toBeNull()
    expect(run('ideal-body-weight', { height: '170', sex: '' })).toBeNull()
    expect(run('free-water-deficit', { na: '150', weight: '70', sex: '' })).toBeNull()
    expect(run('meld-3', { bili: '2', inr: '1.5', scr: '1.5', na: '135', alb: '3', sex: '' })).toBeNull()
    expect(run('hcc-risk-reveal', { sex: '', age: '57', alt: '50', hbeag: 'pos' })).toBeNull()
    expect(run('cha2ds2-vasc', { age: '70', sex: '' })).toBeNull()
    expect(run('glasgow-blatchford', { bun: '30', hb: '11', sbp: '110', sex: '' })).toBeNull()
  })
})

describe('WHO 2019 CVD 10-year risk', () => {
  it('male 60, chol 232 mg/dL (6.0 mmol/L), SBP 120, no DM/smoke → ~6.0%, moderate band', () => {
    const r = run('who-cvd-2019', { sex: 'male', age: '60', sbp: '120', chol: '232', dm: 'no', smk: 'no' })
    expect(Number(r!.value)).toBeCloseTo(6.0, 1)
    expect(r!.unit).toBe('%')
    expect(r!.severity).toBe('low') // 5–<10% band
  })
  it('female 60, same inputs → lower risk than male (~2.2%), low band', () => {
    const m = run('who-cvd-2019', { sex: 'male', age: '60', sbp: '120', chol: '232', dm: 'no', smk: 'no' })
    const f = run('who-cvd-2019', { sex: 'female', age: '60', sbp: '120', chol: '232', dm: 'no', smk: 'no' })
    expect(Number(f!.value)).toBeLessThan(Number(m!.value))
    expect(Number(f!.value)).toBeCloseTo(2.2, 1)
    expect(f!.severity).toBe('normal') // <5%
  })
  it('high-risk 70yo male, chol 270.7 (7.0), SBP 160, DM + smoker → ~46.9%, high', () => {
    const r = run('who-cvd-2019', { sex: 'male', age: '70', sbp: '160', chol: '270.7', dm: 'yes', smk: 'yes' })
    expect(Number(r!.value)).toBeCloseTo(46.9, 0)
    expect(r!.severity).toBe('high')
  })
  it('mg/dL → mmol/L conversion: chol 232 ≈ 6.0 mmol/L (centered → S0-only risk)', () => {
    // at all-centered inputs L=0, so p = 1-(S0mi*S0stroke) for males = 1-0.954*0.9849
    const r = run('who-cvd-2019', { sex: 'male', age: '60', sbp: '120', chol: '232.02', dm: 'no', smk: 'no' })
    expect(Number(r!.value)).toBeCloseTo((1 - 0.954 * 0.9849) * 100, 1)
  })
  it('flags extrapolation outside 40–80 y in the notes', () => {
    const r = run('who-cvd-2019', { sex: 'male', age: '85', sbp: '120', chol: '232', dm: 'no', smk: 'no' })
    expect(r!.notes!.en).toContain('extrapolation')
  })
  it('returns null until diabetes and smoking are answered', () => {
    expect(run('who-cvd-2019', { sex: 'male', age: '60', sbp: '120', chol: '200', dm: '', smk: '' })).toBeNull()
    expect(run('who-cvd-2019', { sex: 'male', age: '60', sbp: '120', chol: '200', dm: 'no', smk: '' })).toBeNull()
  })
})

describe('Transferrin saturation (TSAT)', () => {
  it('is serum iron over TIBC: 45 / 300 → 15%, iron deficient', () => {
    const r = run('tsat', { iron: '45', tibc: '300' })
    expect(r!.value).toBe('15')
    expect(r!.unit).toBe('%')
    expect(r!.numericValue).toBeCloseTo(15, 5)
    expect(r!.interpretation!.zh).toContain('缺鐵')
    expect(r!.severity).toBe('moderate')
  })
  it('reads 20% as not deficient and above 45% as high', () => {
    expect(run('tsat', { iron: '60', tibc: '300' })!.severity).toBe('normal')
    expect(run('tsat', { iron: '135', tibc: '300' })!.severity).toBe('normal')
    const high = run('tsat', { iron: '180', tibc: '300' })
    expect(high!.value).toBe('60')
    expect(high!.interpretation!.zh).toContain('鐵過載')
  })
  // Auto-review round 1: thresholds read the unrounded value, never the displayed one.
  it('reads a value just under 20% as deficient, and just over 45% as high', () => {
    const low = run('tsat', { iron: '67', tibc: '335.5', ferritin: '200' })
    expect(low!.value).toBe('19.97')
    expect(low!.interpretation!.zh).toContain('偏低')
    expect(low!.extra![0].value).toBe('✓ ferritin 200')
    const high = run('tsat', { iron: '149', tibc: '331' })
    expect(high!.value).toBe('45.02')
    expect(high!.interpretation!.zh).toContain('偏高')
    expect(run('tsat', { iron: '60.1', tibc: '300' })!.interpretation!.zh).toContain('一般範圍')
  })
  it('marks the older heart-failure definition when ferritin is given', () => {
    const row = (values: CalcValues) => run('tsat', values)!.extra!.find((e) => e.label.en.startsWith('Older HF definition'))?.value
    expect(row({ iron: '90', tibc: '300', ferritin: '80' })).toBe('✓ ferritin 80')
    expect(row({ iron: '45', tibc: '300', ferritin: '250' })).toBe('✓ ferritin 250')
    expect(row({ iron: '90', tibc: '300', ferritin: '250' })).toBe('✗ ferritin 250')
    expect(row({ iron: '45', tibc: '300', ferritin: '300' })).toBe('✗ ferritin 300')
    expect(row({ iron: '45', tibc: '300' })).toBeUndefined()
  })
  it('gives no result without iron or a binding capacity, and flags iron above TIBC', () => {
    expect(run('tsat', { iron: '45', tibc: '' })).toBeNull()
    expect(run('tsat', { iron: '', tibc: '300' })).toBeNull()
    expect(run('tsat', { iron: '45', tibc: '0' })).toBeNull()
    expect(run('tsat', { iron: '400', tibc: '300' })!.notes!.zh).toContain('核對')
  })
})

describe('Iron deficit (Ganzoni)', () => {
  it('70 kg, Hb 8 → target 15, stores 500: 70 × 7 × 2.4 + 500 = 1676 mg', () => {
    const r = run('iron-deficit-ganzoni', { weight: '70', hb: '8', target: '15', stores: '500' })
    expect(r!.value).toBe('1676')
    expect(r!.unit).toBe('mg')
    expect(r!.extra!.map((e) => e.value)).toEqual(['1176 mg', '500 mg'])
  })
  it('leaves only the stores once hemoglobin is at the target', () => {
    expect(run('iron-deficit-ganzoni', { weight: '70', hb: '16', target: '15', stores: '500' })!.value).toBe('500')
  })
  it('gives no result while weight or hemoglobin is missing', () => {
    expect(run('iron-deficit-ganzoni', { weight: '', hb: '8', target: '15', stores: '500' })).toBeNull()
    expect(run('iron-deficit-ganzoni', { weight: '70', hb: '', target: '15', stores: '500' })).toBeNull()
  })
})

describe('IV iron label dose', () => {
  const dose = (product: string, weight: number, hb: number) => run('iv-iron-label-dose', { product, weight: String(weight), hb: String(hb) })!
  // Every cell of the Ferinject SmPC 4.2 Table 1, band edges included.
  it.each([
    [30, 9.9, '900'], [30, 10, '450'], [30, 14, '450'],
    [35, 9.9, '1500'], [35, 10, '1000'], [69.9, 13.9, '1000'], [35, 14, '500'],
    [70, 9.9, '2000'], [70, 10, '1500'], [70, 13.9, '1500'], [70, 14, '500'],
  ])('Ferinject %s kg, Hb %s → %s mg', (weight, hb, total) => {
    expect(dose('fcm', weight, hb).value).toBe(total)
  })
  // Every cell of the Monofer SmPC 4.2 Table 1.
  it.each([
    [49.9, 9.9, '500'], [49.9, 10, '500'],
    [50, 9.9, '1500'], [50, 10, '1000'], [69.9, 10, '1000'],
    [70, 9.9, '2000'], [70, 10, '1500'],
  ])('Monofer %s kg, Hb %s → %s mg', (weight, hb, total) => {
    expect(dose('fdi', weight, hb).value).toBe(total)
  })
  it('caps a single Ferinject dose at 20 mg/kg by infusion, 15 mg/kg by injection, and 1000 mg', () => {
    expect(dose('fcm', 40, 8).extra!.map((e) => e.value)).toEqual(['800 mg', '600 mg', '1000 mg'])
    expect(dose('fcm', 80, 8).extra!.map((e) => e.value)).toEqual(['1000 mg', '1000 mg', '1000 mg'])
  })
  it('caps a single Monofer infusion and a week at 20 mg/kg, a bolus at 500 mg', () => {
    expect(dose('fdi', 60, 8).extra!.map((e) => e.value)).toEqual(['1200 mg', '500 mg', '1200 mg'])
  })
  it('gives no result while weight or hemoglobin is missing', () => {
    expect(run('iv-iron-label-dose', { product: 'fcm', weight: '', hb: '8' })).toBeNull()
    expect(run('iv-iron-label-dose', { product: 'fdi', weight: '70', hb: '' })).toBeNull()
  })
})

describe('Mentzer index', () => {
  it('MCV 65 / RBC 6.0 → 10.8, thalassemia trait more likely', () => {
    const r = run('mentzer-index', { mcv: '65', rbc: '6.0' })
    expect(r!.value).toBe('10.8')
    expect(r!.interpretation!.zh).toContain('地中海型貧血')
  })
  it('MCV 70 / RBC 3.8 → 18.4, iron deficiency more likely', () => {
    const r = run('mentzer-index', { mcv: '70', rbc: '3.8' })
    expect(r!.value).toBe('18.4')
    expect(r!.interpretation!.zh).toContain('缺鐵')
  })
  it('reads the unrounded index beside 13', () => {
    const r = run('mentzer-index', { mcv: '65', rbc: '5.01' })
    expect(r!.value).toBe('12.97')
    expect(r!.interpretation!.zh).toContain('地中海型貧血')
    expect(run('mentzer-index', { mcv: '65', rbc: '5' })!.interpretation!.zh).toContain('無法區分')
  })
  it('gives no result without both values', () => {
    expect(run('mentzer-index', { mcv: '70', rbc: '' })).toBeNull()
  })
})

describe('CALC_SCORING (計算說明 breakdown)', () => {
  const okL = (l?: { en: string; zh: string }) => !!(l && l.en.trim() && l.zh.trim())

  it('EVERY calculator has a scoring entry', () => {
    const missing = CALCULATORS.filter((c) => !getCalcScoring(c.id)).map((c) => c.id)
    expect(missing).toEqual([])
  })

  it('every scoring entry keys a real calc, has formula or factors, and is bilingual', () => {
    for (const id of Object.keys(CALC_SCORING)) {
      expect(CALCULATORS.some((c) => c.id === id)).toBe(true)
      const s = getCalcScoring(id)!
      // must carry SOMETHING renderable
      expect(!!s.formula || !!(s.factors && s.factors.length) || !!s.grid).toBe(true)
      if (s.grid) {
        const g = s.grid
        expect(g.rows.length).toBeGreaterThan(0)
        expect(g.cols.length).toBeGreaterThan(0)
        // cells must be a full rows × cols matrix, all bilingual with a colour
        expect(g.cells.length).toBe(g.rows.length)
        for (const row of g.cells) {
          expect(row.length).toBe(g.cols.length)
          for (const cell of row) {
            expect(okL(cell.text)).toBe(true)
            expect(['green', 'yellow', 'orange', 'red', 'deepred']).toContain(cell.color)
          }
        }
        for (const sr of g.colSubRows ?? []) expect(sr.cells.length).toBe(g.cols.length)
      }
      if (s.formula) expect(okL(s.formula)).toBe(true)
      for (const f of s.factors ?? []) {
        expect(okL(f.label)).toBe(true)
        expect(f.options.length).toBeGreaterThan(0)
        for (const o of f.options) expect(okL(o.label)).toBe(true)
      }
      if (s.outcome) {
        expect(okL(s.outcome.scoreHeader)).toBe(true)
        expect(okL(s.outcome.outcomeHeader)).toBe(true)
        for (const r of s.outcome.rows) {
          expect(typeof r.score).toBe('string')
          expect(okL(r.outcome)).toBe(true)
        }
      }
      if (s.note) expect(okL(s.note)).toBe(true)
    }
  })

  it('HCC scoring: max points sum to 15 and the outcome table covers it', () => {
    const s = getCalcScoring('hcc-risk-reveal')!
    const maxPoints = s.factors!.reduce(
      (sum, f) => sum + Math.max(...f.options.map((o) => Number(o.points))),
      0,
    )
    expect(maxPoints).toBe(15)
    // the max-score branch of compute (15 → ~65%) matches the table's last row
    expect(s.outcome!.rows[s.outcome!.rows.length - 1]).toEqual({ score: '15', outcome: { en: '65%', zh: '65%' } })
  })

  it('HCC scoring points match the compute for a worked case (male 57, ALT 50, HBeAg+)', () => {
    // sex M=2, age 55–59=5, ALT≥45=3, HBeAg+=4 = 14 → detail rubric agrees
    const s = getCalcScoring('hcc-risk-reveal')!
    const male = s.factors![0].options.find((o) => o.label.en === 'Male')!.points
    const age = s.factors![1].options.find((o) => o.label.en === '55–59 y')!.points
    const alt = s.factors![2].options.find((o) => o.label.en === '≥ 45')!.points
    const hbeag = s.factors![3].options.find((o) => o.label.en === 'Positive')!.points
    expect(Number(male) + Number(age) + Number(alt) + Number(hbeag)).toBe(14)
  })
})

describe('CALC_INFO coverage (When-to-use / Pearls-Pitfalls)', () => {
  it('every calculator has both a useWhen and a caveats entry', () => {
    const missing = CALCULATORS.filter((c) => {
      const info = getCalcInfo(c.id)
      return !info.useWhen || !info.caveats
    }).map((c) => c.id)
    expect(missing).toEqual([])
  })
  it('both fields are bilingual (en + zh present and non-empty)', () => {
    const bad = CALCULATORS.filter((c) => {
      const { useWhen, caveats } = getCalcInfo(c.id)
      const ok = (l?: { en: string; zh: string }) => l && l.en.trim() && l.zh.trim()
      return !ok(useWhen) || !ok(caveats)
    }).map((c) => c.id)
    expect(bad).toEqual([])
  })
})
