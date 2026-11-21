import { parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'

// Synthetic values only.
const spaced = "MMode/2D Measurements Aortic root 31 mm LVIDd 46 mm IVSd 9 mm EDV(MOD-sp4) 80.2 ml LAD 35 mm LVIDs 30 mm LVPWd 9 mm ESV(MOD-sp4) 30.1 ml LA Volume 41.5 ml LVEF(MOD-sp4) 62.5 % Doppler and color Doppler Measurements MV E 72.4 cm/sec E'_Med 6.2 cm/sec MR ERO MV A 80.1 cm/sec E/E'_Med 11.7 MVA(P1/2t) MV dec time 0.2 sec E'_Lat 9.8 cm/sec MV max PG 2.0 mmHg MV E/A 0.9 E/E'_Lat 7.4 MV mean PG LV IVRT AVA(I,D) TR Max PG 22.0 mmHg CO(LVOT) Ao max PG RVSP 27.0 mmHg CO(PV) Ao mean PG Qp/Qs AI P1/2t Conclusion & Comments 1. Normal study."
const glued = "M-Mode/2D Measurements: Ao root:3.4cm LVIDd:5.0cm IVSd:1.2cm EDV(MOD-sp4):90.5ml LAD:4.8cm LVIDs:3.3cm LVPWd:1.1cm ESV(MOD-sp4):35.2ml LA volume:88.4mlLVEF(Bp):61.1% Doppler and color Doppler Measurements: MV E:120.5cm/sec E'_Med:5.5cm/sec MR ERO:0.3cm^2 MV A: E/E'_Med:21.9 MVA(P1/2t): MV dec time:0.2sec E'_Lat:8.5cm/sec MV max PG: MV E/A: E/E'_Lat:14.2 MV mean PG: AVA(I,D): Ao max PG:5.0mmHg Ao mean PG:3.0mmHg TR max PG:30.0mmHg RVSP:40.0mmHg Qp/Qs: AI P1/2t:"
const blankE = "LVEF(MOD-sp4) 58.0 % MV E E'_Med 4.7 cm/sec MR ERO MV A 110 cm/sec E/E'_Med MVA(P1/2t) MV dec time E'_Lat 5.3 cm/sec MV max PG MV E/A E/E'_Lat RVSP 30.0 mmHg"

describe('echo layout with LVEF(method) and E\'_Med / E\'_Lat labels', () => {
  test('spaced variant', () => {
    const v = parseCalculatorEcho(spaced)
    expect(v).toMatchObject({ lvef: 62.5, e: 72.4, septalE: 6.2, lateralE: 9.8, pasp: 27, wall: 9 })
    expect(v.averageEe).toBeCloseTo(2 * 72.4 / (6.2 + 9.8))
    expect(v.ee).toBeCloseTo(2 * 72.4 / (6.2 + 9.8))
    expect(v.rwt).toBeCloseTo(18 / 46)
    expect(v.trv).toBe(2.35) // from TR Max PG 22.0 mmHg
    expect(v.lavi).toBeUndefined()
  })

  test('glued variant with colons and LVEF label right after ml', () => {
    const v = parseCalculatorEcho(glued)
    expect(v).toMatchObject({ lvef: 61.1, e: 120.5, septalE: 5.5, lateralE: 8.5, pasp: 40, wall: 12 })
    expect(v.averageEe).toBeCloseTo(2 * 120.5 / (5.5 + 8.5))
    expect(v.ee).toBeCloseTo(2 * 120.5 / (5.5 + 8.5))
    expect(v.rwt).toBeCloseTo(22 / 50)
    expect(v.trv).toBe(2.74) // from TR max PG:30.0mmHg
  })

  test('blank E does not borrow a later number and yields no E/e′', () => {
    const v = parseCalculatorEcho(blankE)
    expect(v).toMatchObject({ lvef: 58, septalE: 4.7, lateralE: 5.3, pasp: 30 })
    expect(v.e).toBeUndefined()
    expect(v.averageEe).toBeUndefined()
    expect(v.ee).toBeUndefined()
  })

  test('E/E\'_Med and E/E\'_Lat ratios are not tissue velocities', () => {
    const v = parseCalculatorEcho("E/E'_Med 11.7 E/E'_Lat 7.4")
    expect(v.septalE).toBeUndefined()
    expect(v.lateralE).toBeUndefined()
    expect(parseCalculatorEcho("E/E'_Med:21.9 E'_Lat:8.5cm/sec").septalE).toBeUndefined()
  })

  test('accepts E\'_Sep as septal e′', () => {
    expect(parseCalculatorEcho("E'_Sep 7.1 cm/sec").septalE).toBe(7.1)
  })

  test.each(['LVEF 55-60%', 'LVEF(MOD-sp4) 55-60 %', 'LA volume:88.4mlLVEF(Bp):55–60%'])('does not read an LVEF range from %s', text => {
    expect(parseCalculatorEcho(text).lvef).toBeUndefined()
  })
})
