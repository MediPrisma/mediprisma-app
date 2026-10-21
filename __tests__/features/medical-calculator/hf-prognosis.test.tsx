/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useLabAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { HF_PROGNOSIS_MODELS, evidenceForModel, matchesPrognosisRequest, type PrognosisRequest, type PrognosisResponse } from '@/features/medical-calculator/prognosis/models'
import { HfPrognosisModels } from '@/features/medical-calculator/prognosis/HfPrognosisModels'
import { hfPrognosisEvidence } from '@/features/clinical-decision-support/utils/hf-prognosis-evidence'
import { prognosisAutofillEvidence } from '@/features/medical-calculator/prognosis/autofill-evidence'

jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => ({
  useLabAutofill: jest.fn(),
}))
const mockUseLabAutofill = jest.mocked(useLabAutofill)
const emptyAutofill = { resolve: () => undefined, sex: undefined }

const request: PrognosisRequest = {
  requestId: 'request-1', patientId: 'synthetic-A', modelId: 'maggic', modelVersion: 'test-1',
  inputRevision: 'revision-1', endpoint: 'all-cause-mortality', horizons: ['1-year', '3-year'],
  setting: 'chronic-hf', inputs: {},
}
const response: PrognosisResponse = {
  requestId: 'request-1', patientId: 'synthetic-A', modelId: 'maggic', modelVersion: 'test-1',
  inputRevision: 'revision-1', endpoint: 'all-cause-mortality', calculatedAt: '2026-09-17T01:00:00Z',
  estimates: [{ horizon: '1-year', probability: 0.1 }, { horizon: '3-year', probability: 0.2 }],
}

describe('HF prognosis calculator boundary', () => {
  it('does not use current outpatient values as admission values', () => {
    const input = { bloodPressure: { value: '120/80', date: '2026-09-17' } }
    expect(evidenceForModel(HF_PROGNOSIS_MODELS[0], input)).toBe(input)
    expect(evidenceForModel(HF_PROGNOSIS_MODELS[2], input)).toEqual({})
  })
  it('preserves source text and date without treating missing diagnoses or medication as negative', () => {
    const fields = hfPrognosisEvidence({ serumCreatinine: { en: '90 µmol/L', zh: '90 µmol/L', date: '2026-08-01', sources: [{ resourceType: 'Observation', resourceId: 'cr-1' }] } }, false)
    expect(fields.serumCreatinine).toEqual({ value: '90 µmol/L', date: '2026-08-01', source: 'Observation/cr-1' })
    expect(fields.diabetes).toBeUndefined()
    expect(fields.aceArb).toBeUndefined()
  })
  it('accepts only results for the requested patient, model, version, inputs and endpoint', () => {
    expect(matchesPrognosisRequest(request, response)).toBe(true)
    for (const key of ['requestId', 'patientId', 'modelId', 'modelVersion', 'inputRevision', 'endpoint']) {
      expect(matchesPrognosisRequest(request, { ...response, [key]: 'wrong' })).toBe(false)
    }
  })
  it('rejects wrong horizons, non-probabilities, invalid dates and admission requests without an encounter', () => {
    for (const probability of [-0.1, 1.1, NaN, Infinity]) {
      expect(matchesPrognosisRequest(request, { ...response, estimates: [{ horizon: '1-year', probability }, response.estimates[1]] })).toBe(false)
    }
    expect(matchesPrognosisRequest(request, { ...response, estimates: [response.estimates[0], response.estimates[0]] })).toBe(false)
    expect(matchesPrognosisRequest(request, { ...response, estimates: [{ horizon: '5-year', probability: 0.1 }, response.estimates[1]] })).toBe(false)
    expect(matchesPrognosisRequest(request, { ...response, calculatedAt: 'invalid' })).toBe(false)
    expect(matchesPrognosisRequest({ ...request, setting: 'hf-admission' }, response)).toBe(false)
  })
  it('uses serum-specific autofill and preserves source units for review', () => {
    const resolve = jest.fn(source => source?.kind === 'labSpecimen' && source.specimen === 'blood' && source.keys[0] === 'CREA' ? { value: 90, unit: 'µmol/L', date: '2026-08-01' } : undefined)
    expect(prognosisAutofillEvidence({ resolve }).serumCreatinine?.value).toBe('90 µmol/L')
  })
  it('keeps a model with no calculator as a checklist that never presents an uncomputed risk', () => {
    render(<HfPrognosisModels locale="zh-TW" evidence={{ LVEF: { value: '30%', date: '2026-09-01' } }} />)
    fireEvent.click(screen.getByTestId('open-prognosis-calculator-shfm'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('status')).toHaveTextContent('尚未計算風險')
    expect(within(dialog).getByText('30%')).toBeVisible()
  })
  // Clinician feedback 2026-09-28: 「能幫我改一行式畫面，而且 UI 要符合決策地圖」.
  it('draws each model as one row that is itself the button: name, outcome, status, and what it opens', () => {
    render(<HfPrognosisModels locale="zh-TW" evidence={{ LVEF: { value: '60%', date: '2026-09-01' } }} autofill={emptyAutofill as never} />)
    const maggic = screen.getByTestId('open-prognosis-calculator-maggic')
    expect(maggic.tagName).toBe('BUTTON')
    expect(maggic).toHaveTextContent('MAGGIC')
    expect(maggic).toHaveTextContent('1、3 年全因死亡風險')
    expect(maggic).toHaveTextContent(/待填 \d+ 項/)
    expect(maggic).toHaveTextContent('計算機')
    const shfm = screen.getByTestId('open-prognosis-calculator-shfm')
    // The row carries the acronym; the full name stays in its title and dialog.
    expect(shfm).toHaveTextContent(/^SHFM/)
    expect(shfm).toHaveTextContent('公式待串接')
    expect(shfm).toHaveTextContent('資料與引用')
    expect(shfm).toHaveAttribute('title', expect.stringContaining('Seattle Heart Failure Model'))
    // Nothing folds: no <details> left inside the list.
    expect(screen.getByTestId('hf-prognosis-models').querySelector('details')).toBeNull()
  })
  // Clinician feedback 2026-09-28: 「醫療計算機明明有，直接複用就好」.
  it('opens the medical calculator itself for a model it implements (MAGGIC), inputs and all', () => {
    mockUseLabAutofill.mockReturnValue({ autofill: emptyAutofill, isLoading: false, error: null, retry: jest.fn(async () => {}) } as unknown as ReturnType<typeof useLabAutofill>)
    render(<LanguageProvider><HfPrognosisModels locale="zh-TW" evidence={{ LVEF: { value: '30%', date: '2026-09-01' } }} /></LanguageProvider>)
    const card = screen.getByTestId('hf-prognosis-model-maggic')
    expect(card).not.toHaveTextContent('公式待串接')
    fireEvent.click(screen.getByTestId('open-prognosis-calculator-maggic'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('NYHA 功能分級')).toBeInTheDocument()
    expect(within(dialog).getAllByText('糖尿病').length).toBeGreaterThan(0)
    // LIFE-Preserved is an HFpEF model: not offered beside an LVEF of 30%.
    expect(screen.queryByTestId('hf-prognosis-model-life-preserved')).toBeNull()
  })
})
