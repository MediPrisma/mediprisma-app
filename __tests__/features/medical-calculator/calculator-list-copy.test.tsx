import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CalculatorCard } from '@/features/medical-calculator/Feature'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'

jest.mock('@/features/medical-calculator/prognosis/HfSamdCalculator', () => ({}))

const egfr = CALCULATORS.find((calc) => calc.id === 'egfr-ckd-epi-2021')!
const autofill: Autofill = {
  sex: 'female',
  resolve: (source) => source?.kind === 'age' ? { value: 70, unit: 'y', date: '' }
    : source?.kind === 'lab' ? { value: 1.6, unit: 'mg/dL', date: '2026-06-02' } : undefined,
}

it('copies the inline result with its data date without opening the calculator', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  const onOpen = jest.fn()
  render(<CalculatorCard calc={egfr} locale="zh-TW" autofill={autofill} isFavorite={false} patientFillable={false} onToggleFavorite={() => {}} onOpen={onOpen} />)
  fireEvent.click(screen.getByTestId('calc-list-copy-egfr-ckd-epi-2021'))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  expect(writeText.mock.calls[0][0]).toMatch(/^eGFR \(CKD-EPI 2021\): \d+ mL\/min\/1\.73m² — .*（資料日期 2026-06-02）$/)
  expect(onOpen).not.toHaveBeenCalled()
})

it('offers no copy button on a card without an inline result', () => {
  const hasBled = CALCULATORS.find((calc) => calc.id === 'has-bled')!
  render(<CalculatorCard calc={hasBled} locale="zh-TW" autofill={autofill} isFavorite={false} patientFillable={false} onToggleFavorite={() => {}} onOpen={() => {}} />)
  expect(screen.queryByTestId('calc-list-copy-has-bled')).toBeNull()
})
