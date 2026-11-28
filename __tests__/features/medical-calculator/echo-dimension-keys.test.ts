import { buildEchoAutofill, parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'
import { aseLvMass, relativeWallThickness } from '@/features/medical-calculator/echo-derived'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

// Synthetic values only.
const text = 'MMode/2D Measurements LVIDd 48 mm IVSd 13 mm LVPWd 11 mm LA Volume 62.0 ml LVEF(MOD-sp4) 42.3 %'
const report = (conclusion: string): DiagnosticReportEntity => ({ id: 'echo-1', status: 'final', effectiveDateTime: '2026-09-20', code: { text: 'Echocardiography' }, conclusion })

describe('LVIDd, IVSd and LVPWd from the report', () => {
  test('mm and cm, with captions', () => {
    expect(parseCalculatorEcho(text)).toMatchObject({ lvidd: 48, ivsd: 13, lvpwd: 11 })
    expect(parseCalculatorEcho('LVIDd:5.0cm IVSd:1.2cm LVPWd:1.1cm')).toMatchObject({ lvidd: 50, ivsd: 12, lvpwd: 11 })
    const af = buildEchoAutofill([report(text)])
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

describe('LV mass and RWT: stated in the report vs estimated', () => {
  test('stated keys carry only what the report says', () => {
    // Estimated from the dimensions: lvMass and rwt are filled, the stated keys are not.
    const estimated = parseCalculatorEcho(text)
    expect(estimated.lvMass).toBe(219.1)
    expect(estimated.rwt).toBe(0.458)
    expect(estimated.lvMassStated).toBeUndefined()
    expect(estimated.rwtStated).toBeUndefined()
    // Stated in the report: both keys carry the report's value.
    expect(parseCalculatorEcho(`${text} LV mass 180 g RWT 0.40`)).toMatchObject({ lvMass: 180, lvMassStated: 180, rwt: 0.4, rwtStated: 0.4 })
  })
  test('ASE linear mass and RWT from dimensions in mm', () => {
    // 0.832 × (7.2³ − 4.8³) + 0.6 = 0.832 × 262.656 + 0.6 = 219.13
    expect(aseLvMass(48, 13, 11)).toBeCloseTo(219.13, 2)
    expect(relativeWallThickness(11, 48)).toBeCloseTo(0.4583, 4)
    for (const missing of [undefined, 0, -1]) {
      expect(aseLvMass(missing, 13, 11)).toBeUndefined()
      expect(relativeWallThickness(missing, 48)).toBeUndefined()
    }
  })
})
