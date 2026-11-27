import { classifyLvGeometry, gradeEchoMetric, type EchoChamberMetric, type EchoSex } from '@/features/medical-calculator/echo-chamber-grading'
import { parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'
import { duBoisBsa, indexToBsa } from '@/features/medical-calculator/echo-derived'

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
LV IVRT
AVA(I,D)              TR Max PG 30.0 mmHg    CO(LVOT)
Ao max PG             RVSP 33.0 mmHg         CO(PV)`
const fixture02 = `MMode/2D Measurements
Aortic root 30 mm    LVIDd 44 mm    IVSd 8 mm     EDV(MOD-bp) 80.0 ml
LAD 33 mm            LVIDs 28 mm    LVPWd 8 mm    ESV(MOD-bp) 30.0 ml
LA Volume 45.0 ml                                 LVEF(MOD-bp) 62.5 %
Doppler and color Doppler Measurements
MV E 70 cm/sec        E'_Med 9.0 cm/sec
MV A 60 cm/sec        E/E'_Med 7.8
MV dec time 190 msec  E'_Lat 12.0 cm/sec
MV E/A 1.17           E/E'_Lat 5.8
TR Max PG 20.0 mmHg`
const fixture03 = `MMode/2D Measurements
Aortic root 35 mm    LVIDd 62 mm    IVSd 9 mm     EDV(MOD-sp4) 210.0 ml
LAD 46 mm            LVIDs 52 mm    LVPWd 9 mm    ESV(MOD-sp4) 150.0 ml
LA Volume 90.0 ml                                 LVEF(MOD-sp4) 28.6 %
Doppler and color Doppler Measurements
MV E 110 cm/sec       E'_Med 4.0 cm/sec
MV A 45 cm/sec        E/E'_Med 27.5
MV dec time 140 msec  E'_Lat 6.0 cm/sec
MV E/A 2.44           E/E'_Lat 18.3
TR Max PG 45.0 mmHg`
// cm units with labels glued to the previous value.
const glued = "LVIDd:5.0cm IVSd:1.2cm EDV(MOD-sp4):90.5ml LAD:4.8cm LVIDs:3.3cm LVPWd:1.1cm ESV(MOD-sp4):35.2ml LA volume:88.4mlLVEF(Bp):61.1% TR max PG:30.0mmHg RVSP:40.0mmHg"

function chamber(text: string, sex: EchoSex | undefined, height?: number, weight?: number) {
  const echo = parseCalculatorEcho(text)
  const bsa = duBoisBsa(height, weight)
  const lvmi = indexToBsa(echo.lvMass, bsa), lavi = indexToBsa(echo.laVolume, bsa)
  return {
    echo, bsa, lvmi, lavi,
    grade: {
      lvmi: gradeEchoMetric('lvmi', lvmi, sex)?.grade, lavi: gradeEchoMetric('lavi', lavi, sex)?.grade,
      rwt: gradeEchoMetric('rwt', echo.rwt, sex)?.grade, lvef: gradeEchoMetric('lvef', echo.lvef, sex)?.grade,
      trv: gradeEchoMetric('trv', echo.trv, sex)?.grade, lvMass: gradeEchoMetric('lvMass', echo.lvMass, sex)?.grade,
    },
    geometry: classifyLvGeometry(lvmi, echo.rwt, sex)?.geometry,
  }
}

describe('skill fixtures through the app extractor', () => {
  test('01: male 170 cm / 70 kg', () => {
    const r = chamber(fixture01, 'male', 170, 70)
    expect(r.bsa).toBeCloseTo(1.8097, 4)
    // ASE cube: 0.832 × (7.2³ − 4.8³) + 0.6 = 219.13 → extractor rounds to 219.1
    expect(r.echo.lvMass).toBe(219.1)
    expect(r.lvmi).toBeCloseTo(121.07, 2) // hand value from unrounded mass 121.09
    expect(r.echo.rwt).toBe(0.458) // 2 × 11 / 48
    expect(r.lavi).toBeCloseTo(34.26, 2) // 62 / 1.8097, in the 34–35 gap
    expect(r.echo.lvef).toBe(42.3)
    expect(r.echo.trv).toBe(2.74) // √(30 / 4)
    expect(r.grade).toEqual({ lvmi: 'abnormal', lavi: 'mild', rwt: 'abnormal', lvef: 'mild', trv: 'normal', lvMass: 'normal' })
    expect(r.geometry).toBe('concentricHypertrophy')
  })

  test('02: female 158 cm / 52 kg (Du Bois; the skill used Mosteller)', () => {
    const r = chamber(fixture02, 'female', 158, 52)
    expect(r.bsa).toBeCloseTo(1.5125, 4)
    expect(r.echo.lvMass).toBe(109.4) // 0.832 × (6.0³ − 4.4³) + 0.6 = 109.44
    expect(r.lvmi).toBeCloseTo(72.33, 2)
    expect(r.lavi).toBeCloseTo(29.75, 2)
    expect(r.echo.rwt).toBe(0.364) // 2 × 8 / 44
    expect(r.echo.trv).toBe(2.24) // √(20 / 4)
    expect(r.grade).toEqual({ lvmi: 'normal', lavi: 'normal', rwt: 'normal', lvef: 'normal', trv: 'normal', lvMass: 'normal' })
    expect(r.geometry).toBe('normal')
  })

  test('03: male, no height or weight', () => {
    const r = chamber(fixture03, 'male')
    expect(r.bsa).toBeUndefined()
    expect(r.lvmi).toBeUndefined()
    expect(r.lavi).toBeUndefined()
    expect(r.echo.lvMass).toBe(228.3) // 0.832 × (8.0³ − 6.2³) + 0.6 = 228.30
    expect(r.echo.trv).toBe(3.35) // √(45 / 4)
    expect(r.grade).toEqual({ lvmi: undefined, lavi: undefined, rwt: 'normal', lvef: 'severe', trv: 'abnormal', lvMass: 'above' })
    expect(r.geometry).toBeUndefined()
    // The extractor does not expose LVIDd; the fixture's 62 mm graded directly.
    expect(gradeEchoMetric('lvidd', 62, 'male')?.grade).toBe('above')
  })

  test('glued cm layout', () => {
    const r = chamber(glued, 'male', 170, 70)
    expect(r.echo.lvMass).toBe(220.3)
    expect(r.echo.rwt).toBe(0.44) // 2 × 11 / 50
    expect(r.lvmi).toBeCloseTo(121.73, 2)
    expect(r.lavi).toBeCloseTo(48.85, 2)
    expect(r.grade).toMatchObject({ lvmi: 'abnormal', lavi: 'severe', rwt: 'abnormal', lvef: 'normal', trv: 'normal' })
    expect(r.geometry).toBe('concentricHypertrophy')
  })
})

describe('grading boundaries', () => {
  const g = (metric: EchoChamberMetric, value: number, sex?: EchoSex) => gradeEchoMetric(metric, value, sex)?.grade
  test.each<[EchoChamberMetric, EchoSex, number, string]>([
    ['lvidd', 'male', 41.9, 'below'], ['lvidd', 'male', 42, 'normal'], ['lvidd', 'male', 58.4, 'normal'], ['lvidd', 'male', 58.5, 'above'],
    ['lvidd', 'female', 37.7, 'below'], ['lvidd', 'female', 52.2, 'normal'], ['lvidd', 'female', 52.3, 'above'],
    ['ivsd', 'male', 5.9, 'below'], ['ivsd', 'male', 10, 'normal'], ['ivsd', 'male', 10.1, 'above'], ['ivsd', 'female', 9, 'normal'], ['ivsd', 'female', 9.1, 'above'],
    ['lvpwd', 'male', 6, 'normal'], ['lvpwd', 'male', 10.1, 'above'], ['lvpwd', 'female', 9.1, 'above'],
    ['lvMass', 'male', 224, 'normal'], ['lvMass', 'male', 224.1, 'above'], ['lvMass', 'female', 162, 'normal'], ['lvMass', 'female', 162.1, 'above'],
    ['lvmi', 'male', 115, 'normal'], ['lvmi', 'male', 115.01, 'abnormal'], ['lvmi', 'male', 200, 'abnormal'], ['lvmi', 'male', 48, 'below'],
    ['lvmi', 'female', 95, 'normal'], ['lvmi', 'female', 95.01, 'abnormal'], ['lvmi', 'female', 42, 'below'],
    ['rwt', 'male', 0.42, 'normal'], ['rwt', 'male', 0.42004, 'abnormal'], ['rwt', 'female', 0.1, 'normal'],
    ['lvef', 'male', 72, 'normal'], ['lvef', 'male', 72.1, 'above'], ['lvef', 'male', 52, 'normal'], ['lvef', 'male', 51.9, 'mild'],
    ['lvef', 'male', 41, 'mild'], ['lvef', 'male', 40.5, 'moderate'], ['lvef', 'male', 30, 'moderate'], ['lvef', 'male', 29.9, 'severe'],
    ['lvef', 'female', 54, 'normal'], ['lvef', 'female', 53.5, 'mild'], ['lvef', 'female', 41, 'mild'], ['lvef', 'female', 40.9, 'moderate'], ['lvef', 'female', 74.1, 'above'],
    ['lavi', 'male', 15.9, 'below'], ['lavi', 'male', 16, 'normal'], ['lavi', 'male', 34, 'normal'], ['lavi', 'male', 34.5, 'mild'],
    ['lavi', 'male', 41, 'mild'], ['lavi', 'male', 41.5, 'moderate'], ['lavi', 'male', 48, 'moderate'], ['lavi', 'male', 48.1, 'severe'],
    ['trv', 'male', 2.8, 'normal'], ['trv', 'male', 2.81, 'abnormal'],
  ])('%s %s %p → %s', (metric, sex, value, grade) => {
    expect(g(metric, value, sex)).toBe(grade)
  })

  test('without sex: graded only when both references agree', () => {
    expect(g('lvef', 53)).toBe('needsSex') // male normal, female mild
    expect(gradeEchoMetric('lvef', 53)).toMatchObject({ male: 'normal', female: 'mild' })
    expect(g('lvef', 42.3)).toBe('mild')
    expect(g('lvef', 60)).toBe('normal')
    expect(g('lvmi', 100)).toBe('needsSex')
    expect(g('lvmi', 121)).toBe('abnormal')
    expect(g('lavi', 34.3)).toBe('mild')
    expect(g('trv', 3)).toBe('abnormal')
  })

  test('every result names its source table', () => {
    expect(gradeEchoMetric('lvef', 60, 'male')?.source).toBe('ASE/EACVI 2015 Table 4（2DE biplane）')
    expect(gradeEchoMetric('lvmi', 100, 'male')?.source).toMatch(/Table 6/)
    expect(gradeEchoMetric('lavi', 30)?.source).toMatch(/Table 4/)
    expect(gradeEchoMetric('trv', 2)?.source).toMatch(/2016 Figure 8A/)
    expect(gradeEchoMetric('lvidd', 50, 'male')?.source).toMatch(/Table 2/)
  })

  test('no value, no grade', () => {
    expect(gradeEchoMetric('lvef', undefined, 'male')).toBeUndefined()
    expect(gradeEchoMetric('lvef', NaN, 'male')).toBeUndefined()
  })
})

describe('LV geometry', () => {
  test.each<[number, number, EchoSex, string]>([
    [100, 0.40, 'male', 'normal'],
    [100, 0.43, 'male', 'concentricRemodeling'],
    [120, 0.43, 'male', 'concentricHypertrophy'],
    [120, 0.42, 'male', 'eccentricHypertrophy'],
    [100, 0.40, 'female', 'eccentricHypertrophy'],
    [95, 0.43, 'female', 'concentricRemodeling'],
  ])('LVMI %p, RWT %p, %s → %s', (lvmi, rwt, sex, geometry) => {
    expect(classifyLvGeometry(lvmi, rwt, sex)?.geometry).toBe(geometry)
  })

  test('without sex', () => {
    expect(classifyLvGeometry(100, 0.40)).toMatchObject({ geometry: 'needsSex', male: 'normal', female: 'eccentricHypertrophy' })
    expect(classifyLvGeometry(130, 0.5)?.geometry).toBe('concentricHypertrophy')
    expect(classifyLvGeometry(80, 0.3)?.geometry).toBe('normal')
  })

  test('needs both LVMI and RWT', () => {
    expect(classifyLvGeometry(undefined, 0.5, 'male')).toBeUndefined()
    expect(classifyLvGeometry(120, undefined, 'male')).toBeUndefined()
  })
})
