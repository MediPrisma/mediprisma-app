import { fireEvent, render, screen } from '@testing-library/react'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useLabAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'

jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => ({ useLabAutofill: jest.fn() }))

// PR #525 review: the 「未確認」 option has value ''. Open the real Select on
// the PCE form, see every option, and choose 「未確認」 and 「是」.
test('the PCE yes/no selects open and choose, 「未確認」 included', () => {
  Element.prototype.scrollIntoView = jest.fn()
  Element.prototype.hasPointerCapture = jest.fn(() => false)
  Element.prototype.releasePointerCapture = jest.fn()
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(useLabAutofill).mockReturnValue({
    autofill: { resolve: () => undefined, sex: 'male', clinicalSelects: {} },
    isLoading: false, error: null, retry: jest.fn(async () => {}),
  } as unknown as ReturnType<typeof useLabAutofill>)
  const pce = CALCULATORS.find((c) => c.id === 'pce-ascvd')!
  render(<LanguageProvider><CalculatorDetail calc={pce} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} /></LanguageProvider>)
  const trigger = document.querySelector<HTMLElement>('#calc-dm')!
  trigger.focus(); fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['未確認', '否', '是'])
  fireEvent.click(screen.getByRole('option', { name: '是' }))
  expect(trigger).toHaveTextContent('是')
  trigger.focus(); fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name: '未確認' }))
  expect(errors).not.toHaveBeenCalledWith(expect.stringMatching(/Select\.Item/))
  errors.mockRestore()
})
