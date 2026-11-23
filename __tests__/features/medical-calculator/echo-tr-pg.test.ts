import { buildEchoAutofill, parseCalculatorEcho } from '@/features/medical-calculator/echo-autofill'
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'

// Synthetic values only.
const report = (conclusion: string): DiagnosticReportEntity => ({
  id: 'echo-1', status: 'final', effectiveDateTime: '2026-09-20', code: { text: 'Echocardiography' }, conclusion,
})

describe('TR peak velocity from TR max PG (PG = 4V²)', () => {
  test.each([
    ['TR Max PG 22.0 mmHg CO(LVOT) RVSP 27.0 mmHg', 2.35],
    ['Ao mean PG:3.0mmHg TR max PG:30.0mmHg RVSP:40.0mmHg', 2.74],
    ['TR peak PG 36 mmHg', 3],
    ['TR PG = 16 mmHg', 2],
    ['TRPG: 40.0 mmHg', 3.16],
    ['tr max pg 25 MMHG', 2.5],
  ])('%s → %p m/s', (text, trv) => {
    expect(parseCalculatorEcho(text).trv).toBe(trv)
  })

  test.each([
    'TR Max PG CO(LVOT) Ao max PG 7.8 mmHg',
    'TR max PG: RVSP:40.0mmHg',
    'TR max PG 30-35 mmHg',
    'TR max PG 30–35 mmHg',
    'TR max PG >30 mmHg',
    'TR max PG 30',
    'TR max PG 30 cm/s',
    'RVSP 40 mmHg',
    'TR mean PG 20 mmHg',
  ])('gives no velocity from %s', text => {
    expect(parseCalculatorEcho(text).trv).toBeUndefined()
  })

  test('a stated velocity wins over the gradient', () => {
    expect(parseCalculatorEcho('TR Vmax 3.1 m/s TR max PG 22.0 mmHg').trv).toBe(3.1)
    expect(parseCalculatorEcho('TR max PG 22.0 mmHg TRV 310 cm/s').trv).toBe(3.1)
  })

  test('the caption says a converted velocity was converted, a stated one does not', () => {
    expect(buildEchoAutofill([report('TR max PG:30.0mmHg RVSP:40.0mmHg')]).trv)
      .toMatchObject({ value: 2.74, unit: 'm/s', testName: 'Echocardiography · TR Vmax（由 TR max PG 換算）' })
    expect(buildEchoAutofill([report('TR Vmax 3.1 m/s TR max PG 22.0 mmHg')]).trv?.testName).toBe('Echocardiography · TR Vmax')
  })
})
