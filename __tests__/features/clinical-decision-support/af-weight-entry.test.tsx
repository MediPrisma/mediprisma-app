import { fireEvent, render, screen, within } from '@testing-library/react'
import { ATRIAL_FIBRILLATION_GUIDELINE_PACK, buildVisitDecisionModel } from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile } from '@voho0000/personalized-care-fhir'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { AfWeightEntry } from '@/features/clinical-decision-support/renderers/AfWeightEntry'
import { VisitBookChromeContext } from '@/features/clinical-decision-support/renderers/visit/visit-book-chrome'
import { clinicVitalsStorageKey, useClinicVitals, useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { createMemoryPatientAnswerBacking, patientAnswerBacking, setPatientAnswerBacking } from '@/features/clinical-decision-support/stores/patient-answer-backing'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import { applyClinicVitals } from '@/features/clinical-decision-support/utils/apply-clinic-vitals'
import { expectSealedEnvelope, storedCiphertext, until, useRealWebCrypto } from './encrypted-answers.helper'

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

  it('applies the weight as measured today, with no date to fill in, through the real profile/calculator', async () => {
    render(<Reading />)
    const table = screen.getByTestId('cdss-book-dose-table')
    expect(table).toHaveTextContent('缺 CrCl')
    const input = screen.getByLabelText('體重（kg）')
    expect(screen.queryByLabelText('量測日期')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '68' } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight).toMatchObject({ value: 68, measuredOn: '2026-10-20' })
    // Used for this visit; kept for the next one only by saving the CDSS record. The field stays, to correct it.
    expect(await screen.findByText('已帶入 68 kg（視為今天量測），可直接改數值。儲存 CDSS 紀錄後才會留到下次。')).toBeInTheDocument()
    expect(screen.queryByText(/已存入 CDSS/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('體重（kg）')).toHaveValue(68)
    expect(table).toHaveAttribute('aria-label', expect.stringContaining('CrCl 41'))
    expect(table).not.toHaveTextContent('缺 CrCl')
    expect(within(table).getByText('15 mg qd')).toBeInTheDocument()
  })

  it('a mistyped weight is corrected in the same field, and the dose follows', async () => {
    render(<Reading />)
    const field = () => screen.getByLabelText('體重（kg）')
    fireEvent.change(field(), { target: { value: '86' } })
    fireEvent.blur(field())
    await screen.findByText(/已帶入 86 kg/)
    fireEvent.change(field(), { target: { value: '68' } })
    fireEvent.blur(field())
    await screen.findByText(/已帶入 68 kg/)
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight?.value).toBe(68)
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveAttribute('aria-label', expect.stringContaining('CrCl 41'))
  })

  it('does not fabricate CrCl or a dose when creatinine is also missing', async () => {
    render(<Reading hasCr={false} />)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 CrCl')
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 Cr（mg/dL）')
    expect(await screen.findByText(/已帶入 68 kg/)).toBeInTheDocument()
  })

  it('keeps saved weights and unsaved drafts with their patient', () => {
    const { rerender } = render(<Reading />)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    rerender(<Reading patientId="weight-b" />)
    expect(screen.getByLabelText('體重（kg）')).toHaveValue(null)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '55' } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    rerender(<Reading />)
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 CrCl')
    expect(useClinicVitalsStore.getState().byPatientId['weight-a']?.entries.bodyWeight).toBeUndefined()
    expect(useClinicVitalsStore.getState().byPatientId['weight-b'].entries.bodyWeight?.value).toBe(55)
  })

  it('keeps the added weight in the patient’s stored CDSS record across a reload of this tab', async () => {
    const { unmount } = render(<Reading />)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    await screen.findByText(/已帶入 68 kg/)
    // Sealed: no plaintext field or date. (A bare '68' can occur in base64 by chance.)
    expectSealedEnvelope(await storedCiphertext(clinicVitalsStorageKey('weight-a')), ['"bodyWeight"', '"value":68', '2026-10-20'])
    unmount()

    // A reload: nothing in memory, the sealed record read back.
    useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    useClinicVitalsStore.getState().hydrate('weight-a')
    await until(() => Boolean(useClinicVitalsStore.getState().hydratedPatientIds['weight-a']), 'weight hydration')
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight).toMatchObject({ value: 68, measuredOn: '2026-10-20' })
    render(<Reading />)
    expect(screen.getByTestId('cdss-book-dose-table')).toHaveAttribute('aria-label', expect.stringContaining('CrCl 41'))
    expect(screen.queryByTestId('cdss-af-weight-entry')).not.toBeInTheDocument()
    // Another chart reads none of it.
    useClinicVitalsStore.getState().hydrate('weight-b')
    expect(useClinicVitalsStore.getState().byPatientId['weight-b']?.entries.bodyWeight).toBeUndefined()
  })

  it('does not report a weight as saved when the stored record cannot be written', async () => {
    const working = patientAnswerBacking()
    const save = jest.fn((): Promise<boolean> => Promise.resolve(false))
    setPatientAnswerBacking({ ...createMemoryPatientAnswerBacking(), save })
    try {
      render(<Reading />)
      fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
      fireEvent.blur(screen.getByLabelText('體重（kg）'))
      expect(await screen.findByText('體重未能帶入，劑量評估未使用這筆體重。請再輸入一次重試。')).toBeInTheDocument()
      expect(screen.queryByText(/已帶入/)).not.toBeInTheDocument()
      // Taken back out of the page: nothing is computed from an unsaved weight.
      expect(useClinicVitalsStore.getState().byPatientId['weight-a']?.entries.bodyWeight).toBeUndefined()
      expect(screen.getByTestId('cdss-book-dose-table')).toHaveTextContent('缺 CrCl')
      // What was typed is still there, ready for another try.
      expect(screen.getByLabelText('體重（kg）')).toHaveValue(68)

      save.mockImplementation(() => Promise.resolve(true))
      fireEvent.blur(screen.getByLabelText('體重（kg）'))
      expect(await screen.findByText(/已帶入 68 kg/)).toBeInTheDocument()
      expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight).toMatchObject({ value: 68, measuredOn: '2026-10-20' })
    } finally {
      setPatientAnswerBacking(working)
    }
  })

  describe('a weight on file that the dose rules do not take', () => {
    const fact = (date?: string) => ({ zh: '58 kg', en: '58 kg', numericValue: 58, unit: 'kg', ...(date ? { date } : {}) })
    const entry = (date?: string) => render(<AfWeightEntry weight={fact(date)} isEnglish={false} now={NOW} onSave={jest.fn()} />)

    it('is asked for again when it is over 90 days old, saying which reading was left out', () => {
      entry('2026-07-21T08:00:00+08:00')
      expect(screen.getByTestId('cdss-af-weight-entry')).toHaveTextContent('病歷體重 58 kg（2026-07-21）已超過 90 天，不採用，無法計算 CrCl。')
      expect(screen.getByLabelText('體重（kg）')).toBeInTheDocument()
    })

    it('is asked for again when it has no measurement date', () => {
      entry()
      expect(screen.getByTestId('cdss-af-weight-entry')).toHaveTextContent('病歷體重 58 kg 沒有量測日期，不採用')
    })

    it('is not asked for on its 90th day', () => {
      entry('2026-07-22')
      expect(screen.queryByTestId('cdss-af-weight-entry')).not.toBeInTheDocument()
    })
  })

  it('does not ask again when the record already supplies weight', () => {
    render(<Reading weight={68} />)
    expect(screen.queryByTestId('cdss-af-weight-entry')).not.toBeInTheDocument()
    expect(screen.getByTestId('cdss-book-dose-table')).not.toHaveTextContent('缺 CrCl')
  })

  it('also offers recovery in the three-section AF view', () => {
    render(<Reading layout="flow" />)
    fireEvent.click(within(screen.getByTestId('cdss-af-diagnosis')).getByRole('button'))
    expect(screen.getByLabelText('體重（kg）')).toBeInTheDocument()
  })

  it('keeps the AF weight when the clinic form later saves blood pressure', () => {
    render(<Reading layout="flow" />)
    fireEvent.click(within(screen.getByTestId('cdss-af-diagnosis')).getByRole('button'))
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value: '68' } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    fireEvent.click(screen.getByRole('button', { name: '門診量測' }))
    fireEvent.change(screen.getByTestId('cdss-hf-clinic-vitals-systolic'), { target: { value: '130' } })
    fireEvent.change(screen.getByTestId('cdss-hf-clinic-vitals-diastolic'), { target: { value: '80' } })
    fireEvent.click(screen.getByTestId('cdss-hf-clinic-vitals-save'))
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.bodyWeight).toMatchObject({ value: 68, measuredOn: '2026-10-20' })
    expect(useClinicVitalsStore.getState().byPatientId['weight-a'].entries.systolic?.value).toBe(130)
  })

  it('supports the English dose table', () => {
    render(<Reading locale="en" />)
    expect(screen.getByLabelText('Weight (kg)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Measurement date')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /weight/i })).not.toBeInTheDocument()
  })

  it.each(['0', '-1'])('rejects invalid weight %s without saving', value => {
    const save = jest.fn()
    render(<AfWeightEntry isEnglish={false} now={NOW} onSave={save} />)
    fireEvent.change(screen.getByLabelText('體重（kg）'), { target: { value } })
    fireEvent.blur(screen.getByLabelText('體重（kg）'))
    expect(screen.getByRole('alert')).toHaveTextContent('大於 0')
    expect(save).not.toHaveBeenCalled()
  })
})
