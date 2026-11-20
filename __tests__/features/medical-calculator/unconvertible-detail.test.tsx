/**
 * A prefilled reading in a unit the formula cannot take is not computed on in
 * the detail view until the clinician corrects it. Fictional patient only.
 */
import { fireEvent, render } from '@testing-library/react'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { CalcResult } from '@/features/medical-calculator/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'

const obs = (id: string, code: string, value: number, unit: string) => ({
  id, status: 'final', effectiveDateTime: '2026-11-01',
  code: { coding: [{ system: 'http://loinc.org', code }] }, valueQuantity: { value, unit },
})
const none: never[] = []
const chart = {
  observations: [obs('qt', '8634-8', 0.52, 'furlong'), obs('hr', '8867-4', 60, '/min')],
  diagnosticReports: none, medications: none, conditions: none, encounters: none, isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
}
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => chart }))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: jest.fn() }))

it('does not compute QTc from a QT in an unreadable unit until it is corrected', () => {
  jest.mocked(usePatient).mockReturnValue({ patient: { id: 'unit-a', resourceType: 'Patient', age: 60, gender: 'male' }, loading: false, error: null } as unknown as ReturnType<typeof usePatient>)
  const results: (CalcResult | null)[] = []
  const qtc = CALCULATORS.find((c) => c.id === 'qtc')!
  render(<LanguageProvider><CalculatorDetail calc={qtc} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} onResult={(r) => results.push(r)} /></LanguageProvider>)
  expect(results.at(-1)).toBeNull()
  fireEvent.change(document.getElementById('calc-qt') as HTMLInputElement, { target: { value: '520' } })
  expect(results.at(-1)).not.toBeNull()
})
