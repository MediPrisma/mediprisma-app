import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { HFPEF } from '@/features/medical-calculator/calculators/hfpef'
import { buildEchoAutofill, parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'
import { buildAutofill, withCdssWeight } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

// Synthetic values only.
const spaced = "MMode/2D Measurements Aortic root 31 mm LVIDd 46 mm IVSd 9 mm EDV(MOD-sp4) 80.2 ml LAD 35 mm LVIDs 30 mm LVPWd 9 mm ESV(MOD-sp4) 30.1 ml LA Volume 41.5 ml LVEF(MOD-sp4) 62.5 % TR Max PG 22.0 mmHg RVSP 27.0 mmHg"
const glued = "LVIDd:5.0cm IVSd:1.2cm EDV(MOD-sp4):90.5ml LAD:4.8cm LVIDs:3.3cm LVPWd:1.1cm ESV(MOD-sp4):35.2ml LA volume:88.4mlLVEF(Bp):61.1% TR max PG:30.0mmHg RVSP:40.0mmHg"
const report = (conclusion: string): DiagnosticReportEntity => ({ id: 'echo-1', status: 'final', effectiveDateTime: '2026-09-20', code: { text: 'Echocardiography' }, conclusion })
const hfa = HFPEF.find(c => c.id === 'hfa-peff')!
const base = { age: '65', sex: 'male', rhythm: 'sr', e: '80', septalE: '8', lateralE: '12', trv: '2.5', gls: '18', rwt: '0.4', wall: '10', ntprobnp: '100' }

describe('LA volume and LV mass from the echo report', () => {
  test('LA volume: spaced, glued, blank label, index and range', () => {
    expect(parseCalculatorEcho(spaced).laVolume).toBe(41.5)
    expect(parseCalculatorEcho(glued).laVolume).toBe(88.4)
    for (const text of ['LA Volume LVEF(MOD-sp4) 60 %', 'LA Volume Index 30 ml/m2', 'LA volume 40-45 ml', 'LA volume >40 ml', 'LA volume 40', 'LA volume 40 ml/m²'])
      expect(parseCalculatorEcho(text).laVolume).toBeUndefined()
  })

  test('LV mass: stated grams win over the ASE estimate; indices and ranges are not mass', () => {
    expect(parseCalculatorEcho(`${spaced} LV mass 180 g`).lvMass).toBe(180)
    expect(parseCalculatorEcho('LVM(2D): 150.5 g').lvMass).toBe(150.5)
    // 0.8 × 1.04 × [(4.6 + 0.9 + 0.9)³ − 4.6³] + 0.6 = 0.832 × 164.808 + 0.6 = 137.72
    expect(parseCalculatorEcho(spaced).lvMass).toBe(137.7)
    // 0.832 × (7.3³ − 5.0³) + 0.6 = 0.832 × 264.017 + 0.6 = 220.26
    expect(parseCalculatorEcho(glued).lvMass).toBe(220.3)
    for (const text of ['LV mass index 100 g/m2', 'LVMI 100', 'LV mass 150-180 g', 'LV mass 180 g/m²', 'LVIDd 46 mm IVSd 9 mm'])
      expect(parseCalculatorEcho(text).lvMass).toBeUndefined()
  })

  test('captions say which values were estimated', () => {
    const derived = buildEchoAutofill([report(spaced)])
    expect(derived.laVolume).toMatchObject({ value: 41.5, unit: 'mL', testName: 'Echocardiography · LA volume' })
    expect(derived.lvMass).toMatchObject({ value: 137.7, unit: 'g', testName: 'Echocardiography · LV mass（由 LVIDd、IVSd、LVPWd 以 ASE 公式估算）' })
    expect(buildEchoAutofill([report(`${spaced} LV mass 180 g`)]).lvMass).toMatchObject({ value: 180, testName: 'Echocardiography · LV mass' })
  })
})

describe('HFA-PEFF indexes LA volume and LV mass to BSA', () => {
  // Du Bois BSA for 170 cm / 70 kg = 1.8097 m²; 88.4 / 1.8097 = 48.8; 220.3 / 1.8097 = 121.7
  const raw = { ...base, height: '170', weight: '70', laVolume: '88.4', lvMass: '220.3' }
  test('index derived with height and weight, and shown', () => {
    const result = hfa.compute(raw)!
    expect(result.value).toBe('2 / 6')
    expect(result.extra?.slice(3)).toEqual([
      { label: { en: 'BSA (Du Bois)', zh: 'BSA（Du Bois）' }, value: '1.81 m²' },
      { label: { en: 'LAVI (LA volume / BSA)', zh: 'LAVI（左心房容積／BSA）' }, value: '48.8 mL/m²' },
      { label: { en: 'LVMI (LV mass / BSA)', zh: 'LVMI（左心室質量／BSA）' }, value: '121.7 g/m²' },
    ])
  })
  test('a typed index wins over the derived one', () => {
    const result = hfa.compute({ ...raw, lavi: '28' })!
    expect(result.value).toBe('1 / 6') // LVMI 121.7 ≥115 is minor; LAVI 28 adds nothing
    expect(result.extra?.map(r => r.label.en)).toEqual(['Functional', 'Morphological', 'Biomarker', 'BSA (Du Bois)', 'LVMI (LV mass / BSA)'])
    expect(hfa.compute({ ...raw, lavi: '28', lvmi: '90' })!.extra).toHaveLength(3)
  })
  test.each(['height', 'weight'])('without %s the indices stay unknown, as today', missing => {
    const result = hfa.compute({ ...raw, [missing]: '' })!
    expect(result.value).toBe('0–2 / 6')
    expect(result.value).toBe(hfa.compute(base)!.value)
    expect(result.extra).toHaveLength(3)
    expect(hfa.compute({ ...raw, [missing]: '0' })!.value).toBe('0–2 / 6')
  })
  test('height and weight prefill from the record, including the CDSS weight', () => {
    const input = (key: string) => hfa.inputs.find(i => i.key === key)!
    const keys = hfa.inputs.map(i => i.key)
    expect(keys.slice(keys.indexOf('gls') + 1, keys.indexOf('lvmi') + 1)).toEqual(['height', 'weight', 'laVolume', 'lvMass', 'lavi', 'lvmi'])
    const af = buildAutofill([
      { code: { text: 'Body height' }, effectiveDateTime: '2025-01-01', valueQuantity: { value: 1.7, unit: 'm' } },
      { code: { text: 'Body weight' }, effectiveDateTime: '2026-01-01', valueQuantity: { value: 72, unit: 'kg' } },
    ], {}, [report(glued)])
    expect(resolveInput(input('height'), af)).toMatchObject({ value: '170' })
    expect(resolveInput(input('weight'), af)).toMatchObject({ value: '72' })
    expect(resolveInput(input('laVolume'), af)).toMatchObject({ value: '88.4' })
    expect(resolveInput(input('lvMass'), af)).toMatchObject({ value: '220.3' })
    const clinic = withCdssWeight(af, { value: 68, measuredOn: '2026-09-30' } as Parameters<typeof withCdssWeight>[1])
    expect(resolveInput(input('weight'), clinic)).toMatchObject({ value: '68' })
  })
})
