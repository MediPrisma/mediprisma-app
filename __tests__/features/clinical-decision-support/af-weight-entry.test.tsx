import { fireEvent, render, screen, within } from '@testing-library/react'
import { ATRIAL_FIBRILLATION_GUIDELINE_PACK, buildVisitDecisionModel } from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile } from '@voho0000/personalized-care-fhir'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { AfWeightEntry } from '@/features/clinical-decision-support/renderers/AfWeightEntry'
import { VisitBookChromeContext } from '@/features/clinical-decision-support/renderers/visit/visit-book-chrome'
import { useClinicVitals, useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import { applyClinicVitals } from '@/features/clinical-decision-support/utils/apply-clinic-vitals'
import { useRealWebCrypto } from './encrypted-answers.helper'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

const NOW = new Date('2026-10-20T10:00:00+08:00')
const lab = (id: string, code: string, value: number, unit: string) => ({
  id, status: 'final', effectiveDateTime: '2026-10-19',
  code: { coding: [{ system: 'http://loinc.org', code }] }, valueQuantity: { value, unit },
})

function Reading({ patientId = 'weight-a', hasCr = true, weight, layout = 'map', locale = 'zh-TW' }: {
  patientId?: string; hasCr?: boolean; weight?: number; layout?: 'map' | 'flow'; locale?: 'zh-TW' | 'en'
}) {
  const vitals = useClinicVitals(patientId)
  const profile = applyAfCalculatorResults(applyClinicVitals({
    ...createFhirCdssPatientProfile({
      patient: { id: patientId, age: 78, gender: 'female' },
      conditions: ['I48.0', 'I10'].map(code => ({ id: code, clinicalStatus: 'active', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] } })),
      observations: [
        ...(hasCr ? [lab('cr', '2160-0', 1.2, 'mg/dL')] : []),
        ...(weight === undefined ? [] : [lab('weight', '29463-7', weight, 'kg')]),
        lab('egfr', '77147-7', 46, 'mL/min/1.73m2'),
      ],
      medications: [{ id: 'apixaban', status: 'active', authoredOn: '2026-10-19', medicationCodeableConcept: { text: 'apixaban' }, dispenseRequest: { expectedSupplyDuration: { value: 30, unit: 'days' } }, dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 5, unit: 'mg' } }], timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } } }] }],
      encounters: [], allergies: [], procedures: [], immunizations: [], carePlans: [], now: NOW,
    }), afClinicalAnswers: { mechanicalValve: false, significantMitralStenosis: false, activeBleeding: false },
  }, vitals))
  const result = ATRIAL_FIBRILLATION_GUIDELINE_PACK.build({ profile, locale })
  const model = buildVisitDecisionModel({ packId: result.packId, profile, result, locale })
  return <VisitBookChromeContext.Provider value={{ inline: true }}>
    <ClinicalDecisionSupportView patientId={patientId} result={result} visitModel={model}
      locale={locale} layout={layout} profileFacts={profile.facts} clinicVitals={vitals}
      onSaveClinicVitals={patch => useClinicVitalsStore.getState().setVitals(patientId, patch, NOW)} />
  </VisitBookChromeContext.Provider>
}

describe('AF missing-weight recovery', () => {
  useRealWebCrypto()
  beforeEach(() => {
    useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('applies a dated measurement through the real profile/calculator and replaces missing doses', () => {
    render(<Reading />)
    const table = screen.getByTestId('cdss-book-dose-table')
    expect(table).toHaveTextContent('缺 CrCl')
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    const input = screen.getByLabelText('體重（kg）')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '68' } })
    fireEvent.change(screen.getByLabelText('量測日期'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: '套用體重' }))
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight).toMatchObject({ value: 68, measuredOn: '2026-10-01' })
    expect(screen.queryByTestId('cdss-af-weight-entry')).not.toBeInTheDocument()
    expect(screen.getByText('已套用體重，請查看下方更新的劑量評估。')).toHaveFocus()
    expect(table).toHaveAttribute('aria-label', expect.stringContaining('CrCl 41'))
    expect(table).not.toHaveTextContent('缺 CrCl')
    expect(within(table).getByText('15 mg qd')).toBeInTheDocument()
  })

  it('does not fabricate CrCl or a dose when creatinine is also missing', () => {
    render(<Reading hasCr={false} />)
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    fireEvent.click(screen.getByRole('button', { name: '套用體重' }))
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 CrCl')
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 Cr（mg/dL）')
    expect(screen.getByText('已套用體重，請查看下方更新的劑量評估。')).toHaveFocus()
  })

  it('keeps saved weights and unsaved drafts with their patient', () => {
    const { rerender } = render(<Reading />)
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    rerender(<Reading patientId="weight-b" />)
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    expect(screen.getByLabelText('體重（kg）')).toHaveValue(null)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: '套用體重' }))
    rerender(<Reading />)
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 CrCl')
    expect(useClinicVitalsStore.getState().byPatientId['weight-a']?.entries.bodyWeight).toBeUndefined()
    expect(useClinicVitalsStore.getState().byPatientId['weight-b'].entries.bodyWeight?.value).toBe(55)
  })

  it('does not ask again when the record already supplies weight', () => {
    render(<Reading weight={68} />)
    expect(screen.queryByTestId('cdss-af-weight-entry')).not.toBeInTheDocument()
    expect(screen.getByTestId('cdss-book-dose-table')).not.toHaveTextContent('缺 CrCl')
  })

  it('also offers recovery in the three-section AF view', () => {
    render(<Reading layout="flow" />)
    fireEvent.click(within(screen.getByTestId('cdss-af-diagnosis')).getByRole('button'))
    expect(screen.getByRole('button', { name: '補登體重' })).toBeInTheDocument()
  })

  it('supports the English dose table', () => {
    render(<Reading locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter weight' }))
    expect(screen.getByLabelText('Measurement date')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Weight (kg)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter weight' })).toHaveFocus()
  })

  it.each(['', '0', '-1'])('rejects invalid weight %s without saving', value => {
    const save = jest.fn()
    render(<AfWeightEntry isEnglish={false} now={NOW} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '套用體重' }))
    expect(screen.getByRole('alert')).toHaveTextContent('大於 0')
    expect(save).not.toHaveBeenCalled()
  })

  it.each(['', '2026-10-21'])('rejects invalid or future measurement date %s', value => {
    const save = jest.fn()
    render(<AfWeightEntry isEnglish={false} now={NOW} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '補登體重' }))
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    fireEvent.change(screen.getByLabelText('量測日期'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '套用體重' }))
    expect(screen.getByRole('alert')).toHaveTextContent('量測日期')
    expect(save).not.toHaveBeenCalled()
  })
})
