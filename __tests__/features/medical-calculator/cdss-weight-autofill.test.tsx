/**
 * A weight added in the CDSS reaches the DOAC calculator through the real
 * autofill hook and the patient's clinic-vitals store — one way: what is typed
 * into the calculator never becomes a measurement. Fictional patients only.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { CDSS_WEIGHT_SOURCE } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import {
  createMemoryPatientAnswerBacking,
  patientAnswerBacking,
  setPatientAnswerBacking,
} from '@/features/clinical-decision-support/stores/patient-answer-backing'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'

const obs = (id: string, code: string, value: number, unit: string, date: string) => ({
  id, status: 'final', effectiveDateTime: date,
  code: { coding: [{ system: 'http://loinc.org', code }] }, valueQuantity: { value, unit },
})
let observations: ReturnType<typeof obs>[] = []
// Stable references, as the query cache hands them out.
const none: never[] = []
const refetch = jest.fn()
let chart = { observations, diagnosticReports: none, medications: none, conditions: none, encounters: none, isLoading: false, isFetching: false, error: null, refetch }
const setObservations = (next: ReturnType<typeof obs>[]) => { observations = next; chart = { ...chart, observations } }

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => chart,
}))
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: jest.fn() }))
const mockUsePatient = jest.mocked(usePatient)
const asPatient = (id: string) => mockUsePatient.mockReturnValue({
  patient: { id, resourceType: 'Patient', age: 94, gender: 'male' }, loading: false, error: null,
} as unknown as ReturnType<typeof usePatient>)

const doac = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
const detail = () => (
  <LanguageProvider>
    <CalculatorDetail calc={doac} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} />
  </LanguageProvider>
)
const weightField = () => document.getElementById('calc-weight') as HTMLInputElement
const addClinicWeight = (patientId: string, value: number, measuredOn: string) => act(() => {
  void useClinicVitalsStore.getState().setVitals(patientId, { entries: { bodyWeight: { value, measuredOn } } })
})

describe('DOAC calculator reads the weight added in the CDSS', () => {
  const working = patientAnswerBacking()
  beforeAll(() => setPatientAnswerBacking(createMemoryPatientAnswerBacking()))
  afterAll(() => setPatientAnswerBacking(working))
  beforeEach(() => {
    useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    setObservations([obs('cr', '2160-0', 1.93, 'mg/dL', '2026-06-02')])
    localStorage.setItem('medical-note-locale', 'zh-TW')
    asPatient('weight-calc-a')
  })

  it('fills an untouched weight field with its source and date, and computes CrCl', () => {
    render(detail())
    expect(weightField()).toHaveValue(null)
    expect(screen.getByText('CrCl 未算')).toBeInTheDocument()

    addClinicWeight('weight-calc-a', 60, '2026-10-27')
    expect(weightField()).toHaveValue(60)
    expect(screen.getByText(CDSS_WEIGHT_SOURCE)).toBeInTheDocument()
    expect(screen.getByText(/2026-10-27/)).toBeInTheDocument()
    // (140 − 94) × 60 / (72 × 1.93) = 19.86
    expect(screen.getByText('CrCl 19.9 mL/min · Cockcroft–Gault')).toBeInTheDocument()
  })

  it('takes the chart weight’s place, as the CDSS does', () => {
    setObservations([...observations, obs('w-2018', '29463-7', 78, 'kg', '2018-02-12')])
    render(detail())
    expect(weightField()).toHaveValue(78)
    addClinicWeight('weight-calc-a', 60, '2026-10-27')
    expect(weightField()).toHaveValue(60)
  })

  it('updates the fields not typed in, keeps a what-if weight, and never stores it', () => {
    render(detail())
    fireEvent.change(document.getElementById('calc-age')!, { target: { value: '94' } })
    addClinicWeight('weight-calc-a', 60, '2026-10-27')
    // Another field was edited; the weight was not, so it still refreshes.
    expect(weightField()).toHaveValue(60)

    fireEvent.change(weightField(), { target: { value: '70' } })
    addClinicWeight('weight-calc-a', 62, '2026-10-27')
    expect(weightField()).toHaveValue(70)
    expect(useClinicVitalsStore.getState().byPatientId['weight-calc-a'].entries.bodyWeight?.value).toBe(62)

    fireEvent.click(screen.getByRole('button', { name: /重新帶入/ }))
    expect(weightField()).toHaveValue(62)
  })

  it('does not carry one patient’s weight to another', () => {
    addClinicWeight('weight-calc-a', 60, '2026-10-27')
    asPatient('weight-calc-b')
    render(detail())
    expect(weightField()).toHaveValue(null)
    expect(screen.getByText('CrCl 未算')).toBeInTheDocument()
  })

  it('starts over when an open calculator moves to another patient, dropping what was typed for the first', () => {
    const { rerender } = render(detail())
    fireEvent.change(weightField(), { target: { value: '70' } })
    fireEvent.change(document.getElementById('calc-age')!, { target: { value: '50' } })
    // (140 − 50) × 70 / (72 × 1.93) = 45.3, from the first patient's chart and what was typed.
    expect(screen.getByText('CrCl 45.3 mL/min · Cockcroft–Gault')).toBeInTheDocument()

    // Another chart imported into the same tab, the calculator still open.
    asPatient('weight-calc-b')
    setObservations([obs('cr-b', '2160-0', 1.1, 'mg/dL', '2026-10-01')])
    rerender(detail())
    expect(weightField()).toHaveValue(null)
    expect(document.getElementById('calc-age')).toHaveValue(94)
    expect(document.getElementById('calc-scr')).toHaveValue(1.1)
    expect(screen.getByText('CrCl 未算')).toBeInTheDocument()

    // The second patient's own weight from the CDSS still fills it.
    addClinicWeight('weight-calc-b', 64, '2026-10-27')
    expect(weightField()).toHaveValue(64)
  })
})
