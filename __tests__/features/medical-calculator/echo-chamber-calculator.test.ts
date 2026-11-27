import { CALCULATORS, getCalcInfo, getCalcScoring, getCalcTags } from '@/features/medical-calculator/calculators'
import { buildEchoAutofill, parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

// Measurement text of the echo-calculator skill's three synthetic fixtures.
const fixture01 = `MMode/2D Measurements
Aortic root 39 mm    LVIDd 48 mm    IVSd 13 mm    EDV(MOD-sp4) 130.0 ml
LAD 40 mm            LVIDs 32 mm    LVPWd 11 mm   ESV(MOD-sp4) 75.0 ml
LA Volume 62.0 ml                                 LVEF(MOD-sp4) 42.3 %
Doppler and color Doppler Measurements
MV E 90 cm/sec        E'_Med 6.0 cm/sec      MR ERO
MV A                  E/E'_Med 15             MVA(P1/2t)
MV dec time           E'_Lat 8.0 cm/sec      MV max PG
MV E/A                E/E'_Lat 11             MV mean PG
AVA(I,D)              TR Max PG 30.0 mmHg    CO(LVOT)
Ao max PG             RVSP 33.0 mmHg         CO(PV)
Conclusion & Comments
1. Concentric LV hypertrophy with mild LV systolic dysfunction.`
const fixture02 = `MMode/2D Measurements
Aortic root 30 mm    LVIDd 44 mm    IVSd 8 mm     EDV(MOD-bp) 80.0 ml
LAD 33 mm            LVIDs 28 mm    LVPWd 8 mm    ESV(MOD-bp) 30.0 ml
LA Volume 45.0 ml                                 LVEF(MOD-bp) 62.5 %
Doppler and color Doppler Measurements
MV E 70 cm/sec        E'_Med 9.0 cm/sec
MV A 60 cm/sec        E/E'_Med 7.8
MV dec time 190 msec  E'_Lat 12.0 cm/sec
TR Max PG 20.0 mmHg
Conclusion & Comments
1. Normal LV size and systolic function.`
const fixture03 = `MMode/2D Measurements
Aortic root 35 mm    LVIDd 62 mm    IVSd 9 mm     EDV(MOD-sp4) 210.0 ml
LAD 46 mm            LVIDs 52 mm    LVPWd 9 mm    ESV(MOD-sp4) 150.0 ml
LA Volume 90.0 ml                                 LVEF(MOD-sp4) 28.6 %
Doppler and color Doppler Measurements
MV E 110 cm/sec       E'_Med 4.0 cm/sec
TR Max PG 45.0 mmHg
Conclusion & Comments
1. Dilated LV with severe systolic dysfunction.`

const calc = CALCULATORS.find(c => c.id === 'echo-chamber')!
const report = (conclusion: string): DiagnosticReportEntity => ({ id: 'echo-1', status: 'final', effectiveDateTime: '2026-09-20', code: { text: 'Echocardiography' }, conclusion })
/** The calculator's values as the echo autofill would fill them. */
function fromReport(text: string, extra: CalcValues = {}): CalcValues {
  const af = buildEchoAutofill([report(text)])
  const values: CalcValues = {}
  for (const input of calc.inputs) {
    if (input.source?.kind === 'echo' && af[input.source.key]) values[input.key] = String(af[input.source.key]!.value)
  }
  return { ...values, ...extra }
}
const rows = (values: CalcValues) => calc.compute(values)!.extra!.map(r => `${r.label.zh}｜${r.value}`)

describe('echo chamber calculator', () => {
  test('is registered once with tags, info and scoring', () => {
    expect(CALCULATORS.filter(c => c.id === 'echo-chamber')).toHaveLength(1)
    expect(calc.category).toBe('cardiac')
    expect(getCalcTags('echo-chamber')?.purpose.length).toBeGreaterThan(0)
    expect(getCalcInfo('echo-chamber').caveats?.zh).toMatch(/LVEF/)
    expect(getCalcScoring('echo-chamber')?.formula).toBeDefined()
  })

  test('01: male 170 cm / 70 kg — concentric hypertrophy, LA mildly enlarged', () => {
    const result = calc.compute(fromReport(fixture01, { sex: 'male', height: '170', weight: '70' }))!
    // LV mass is not graded once LVMI is: 7 graded rows.
    expect(result.value).toBe('▲ 5 / 7')
    expect(result.interpretation!.zh).toBe('向心性肥厚｜超出範圍：IVSd、LVPWd、LVMI、RWT、LAVI')
    expect(result.severity).toBe('moderate')
    expect(rows(fromReport(fixture01, { sex: 'male', height: '170', weight: '70' }))).toEqual([
      'LVIDd｜48.0 mm (42.0–58.4)',
      '▲ IVSd · 異常｜13.0 mm (6–10)',
      '▲ LVPWd · 異常｜11.0 mm (6–10)',
      '▲ LVMI · 異常｜121.1 g/m² (49–115) [219.1 g]',
      '▲ RWT · 異常｜0.458 (≤0.42)',
      'LVEF｜42.3 %',
      '▲ LAVI · 輕度異常｜34.3 mL/m² (16–34) [62.0 mL]',
      'TR Vmax｜2.74 m/s (≤2.8)',
      'BSA（Du Bois）｜1.81 m²',
    ])
    expect(result.notes!.zh).toBe('僅供參考，以臨床判讀為準。')
  })

  test('02: female 158 cm / 52 kg — all within reference', () => {
    const result = calc.compute(fromReport(fixture02, { sex: 'female', height: '158', weight: '52' }))!
    expect(result.value).toBe('0 / 7')
    expect(result.interpretation!.zh).toBe('皆在參考範圍內')
    expect(result.severity).toBe('normal')
    // Nothing is flagged and a normal geometry adds no row.
    expect(result.extra!.some(r => /▲|幾何|正常/.test(r.label.zh))).toBe(false)
  })

  test('03: male without height or weight — raw values graded, indices explained', () => {
    const values = fromReport(fixture03, { sex: 'male' })
    const result = calc.compute(values)!
    expect(rows(values)).toEqual([
      '▲ LVIDd · 異常｜62.0 mm (42.0–58.4)',
      'IVSd｜9.0 mm (6–10)',
      'LVPWd｜9.0 mm (6–10)',
      '▲ LV mass · 異常｜228.3 g (88–224)',
      'RWT｜0.290 (≤0.42)',
      'LVEF｜28.6 %',
      'LA volume｜90.0 mL',
      '▲ TR Vmax · 異常｜3.35 m/s (≤2.8)',
    ])
    expect(result.value).toBe('▲ 3 / 6')
    // What could not be indexed is said in the summary line, where it is read first.
    expect(result.interpretation!.zh).toBe('超出範圍：LVIDd、LV mass、TR Vmax（缺 BSA，未算 LVMI、LAVI）')
    expect(result.interpretation!.en).toMatch(/no BSA: LVMI, LAVI not calculated/)
  })

  test('LVEF is shown but never graded or counted', () => {
    const result = calc.compute({ sex: 'male', lvef: '20', trv: '2.0' })!
    expect(result.value).toBe('0 / 1')
    expect(result.extra![0]).toEqual({ label: { en: 'LVEF', zh: 'LVEF' }, value: '20.0 %' })
    expect(calc.compute({ lvef: '35' })).toMatchObject({ value: '—', interpretation: { zh: '無可分級的量測' } })
  })

  test('sex blank: rows whose male and female grades differ ask for sex', () => {
    const result = calc.compute({ lvidd: '55', lavi: '30', rwt: '0.5', lvmi: '100' })!
    expect(rows({ lvidd: '55', lavi: '30', rwt: '0.5', lvmi: '100' })).toEqual([
      'LVIDd · 需性別｜55.0 mm (M 42.0–58.4 / F 37.8–52.2)',
      'LVMI · 需性別｜100.0 g/m² (M 49–115 / F 43–95)',
      '▲ RWT · 異常｜0.500 (≤0.42)',
      'LAVI｜30.0 mL/m² (16–34)',
    ])
    expect(result.interpretation!.zh).toBe('超出範圍：RWT；2 項需性別')
    // Rows waiting for sex are not in the denominator: only RWT and LAVI are graded here.
    expect(result.value).toBe('▲ 1 / 2')
    expect(calc.compute({ lvidd: '55' })).toMatchObject({ value: '—', interpretation: { zh: '1 項需性別' }, severity: undefined })
    expect(calc.compute({ lvidd: '55', lavi: '30' })).toMatchObject({ value: '0 / 1', interpretation: { zh: '未超出範圍；1 項需性別' }, severity: undefined })
    // Agreeing references grade without sex and show both ranges.
    expect(rows({ ivsd: '12' })).toEqual(['▲ IVSd · 異常｜12.0 mm (M 6–10 / F 6–9)'])
  })

  test('an index stated in the report wins over raw ÷ BSA', () => {
    const values = { sex: 'male', height: '170', weight: '70', lvMass: '219.1', laVolume: '62', lvmi: '100', lavi: '30' }
    expect(rows(values)).toEqual([
      'LVMI｜100.0 g/m² (49–115) [219.1 g]',
      'LAVI｜30.0 mL/m² (16–34) [62.0 mL]',
      'BSA（Du Bois）｜1.81 m²',
    ])
    expect(calc.compute({ sex: 'male', lvMass: '200', lvmi: '100' })!.interpretation!.zh).toBe('皆在參考範圍內')
  })

  test('editing a dimension recalculates mass, RWT, LVMI and geometry', () => {
    const filled = fromReport(fixture01, { sex: 'male', height: '170', weight: '70' })
    // The report states neither, so the fields stay blank and both follow the dimensions.
    expect(filled.lvMass).toBeUndefined()
    expect(filled.rwt).toBeUndefined()
    // LVPWd 11 → 8 mm: RWT 2×8/48 = 0.333; mass 0.832 × (6.9³ − 4.8³) + 0.6 = 181.9 g; LVMI 181.9 / 1.8097 = 100.5.
    const edited = { ...filled, lvpwd: '8' }
    expect(rows(edited)).toEqual(expect.arrayContaining([
      'LVPWd｜8.0 mm (6–10)',
      'LVMI｜100.5 g/m² (49–115) [181.9 g]',
      'RWT｜0.333 (≤0.42)',
    ]))
    expect(calc.compute(edited)!.interpretation!.zh).toBe('超出範圍：IVSd、LAVI')
    // A mass or RWT the report states is an independent measurement and is kept.
    const stated = fromReport(`${fixture01} LV mass 180 g RWT 0.40`, { sex: 'male', height: '170', weight: '70', lvpwd: '8' })
    expect(stated).toMatchObject({ lvMass: '180', rwt: '0.4' })
    expect(rows(stated)).toEqual(expect.arrayContaining(['LVMI｜99.5 g/m² (49–115) [180.0 g]', 'RWT｜0.400 (≤0.42)']))
  })

  test('no measurement → no result', () => {
    expect(calc.compute({})).toBeNull()
    expect(calc.compute({ sex: 'male', height: '170', weight: '70' })).toBeNull()
    expect(calc.compute({ lvidd: '0', ivsd: '-3' })).toBeNull()
  })
})

describe('LVIDd, IVSd and LVPWd from the report', () => {
  test('mm and cm, with captions', () => {
    expect(parseCalculatorEcho(fixture01)).toMatchObject({ lvidd: 48, ivsd: 13, lvpwd: 11 })
    expect(parseCalculatorEcho('LVIDd:5.0cm IVSd:1.2cm LVPWd:1.1cm')).toMatchObject({ lvidd: 50, ivsd: 12, lvpwd: 11 })
    const af = buildEchoAutofill([report(fixture01)])
    expect(af.lvidd).toMatchObject({ value: 48, unit: 'mm', testName: 'Echocardiography · LVIDd' })
    expect(af.ivsd).toMatchObject({ value: 13, unit: 'mm', testName: 'Echocardiography · IVSd' })
    expect(af.lvpwd).toMatchObject({ value: 11, unit: 'mm', testName: 'Echocardiography · LVPWd' })
  })
  test('blank fields and implausible scales stay empty', () => {
    const blank = parseCalculatorEcho('LVIDd mm IVSd LVPWd   LVEF 60 %')
    expect(blank.lvidd).toBeUndefined()
    expect(blank.ivsd).toBeUndefined()
    expect(blank.lvpwd).toBeUndefined()
    expect(parseCalculatorEcho('LVIDd 480 mm IVSd 13 mm').lvidd).toBeUndefined()
    expect(parseCalculatorEcho('LVIDd 480 mm IVSd 13 mm').ivsd).toBe(13)
  })
})
