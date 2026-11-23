/**
 * A converted echo value's source caption wraps instead of being cut off, so
 * the clinician can read how it was derived. Lab captions keep their width cap.
 * Fictional patient and synthetic values only.
 */
import { render, screen } from '@testing-library/react'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'

const none: never[] = []
const chart = {
  observations: [{
    id: 'ntpro', status: 'final', effectiveDateTime: '2026-11-01',
    code: { text: 'NT-proBNP', coding: [{ system: 'http://loinc.org', code: '33762-6' }] }, valueQuantity: { value: 900, unit: 'pg/mL' },
  }],
  diagnosticReports: [{ id: 'echo-1', status: 'final', effectiveDateTime: '2026-11-01', code: { text: 'Echocardiography' }, conclusion: 'TR max PG:30.0mmHg RVSP:40.0mmHg' }],
  medications: none, conditions: none, encounters: none, isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
}
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => chart }))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: jest.fn() }))

it('wraps a converted echo caption and keeps the lab caption truncated', () => {
  jest.mocked(usePatient).mockReturnValue({ patient: { id: 'caption-a', resourceType: 'Patient', age: 70, gender: 'female' }, loading: false, error: null } as unknown as ReturnType<typeof usePatient>)
  const calc = CALCULATORS.find((c) => c.id === 'hfa-peff')!
  render(<LanguageProvider><CalculatorDetail calc={calc} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} /></LanguageProvider>)

  const echo = screen.getByText('Echocardiography · TR Vmax（由 TR max PG 換算）')
  expect(echo).toHaveClass('break-words')
  expect(echo).not.toHaveClass('truncate')

  const lab = screen.getByText((_, el) => el?.tagName === 'SPAN' && /NT-proBNP/.test(el.textContent ?? '') && el.closest('[class*="text-muted-foreground"]') !== null && !el.querySelector('span'))
  expect(lab).toHaveClass('truncate')
})
