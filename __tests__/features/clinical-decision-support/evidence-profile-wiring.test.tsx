/**
 * What the feature hands the pack.
 *
 * Two wiring facts no rules test in the package can see. A chest film's
 * conclusion and a discharge summary's physical examination are evidence the
 * structured record does not otherwise carry, and the adapter reads them only
 * if the feature passes them. And a physician's switch reaches the pack only by
 * being part of the profile — the pack is a pure function of it, so a toggle
 * that did not travel this way would have to patch the rendered card instead.
 */
import { act, render, waitFor } from '@testing-library/react'
import LiveClinicalDecisionSupportFeature from '@/features/clinical-decision-support/LiveFeature'
import {
  evidenceOverridesStorageKey,
  useEvidenceOverridesStore,
} from '@/features/clinical-decision-support/stores/evidence-overrides.store'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'
import type { HospitalAwareCdssProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { sealAnswers, useRealWebCrypto } from './encrypted-answers.helper'

const mockUsePatient = jest.fn()
const mockUseClinicalData = jest.fn()
const createProfileSpy = jest.fn()
const packBuildSpy = jest.fn()

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => mockUsePatient(),
}))

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockUseClinicalData(),
}))

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))

// This unit renders the feature below its production provider boundary. The
// AI hook is covered separately; keep this suite focused on profile wiring.
jest.mock('@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook', () => ({
  useNhiLipidAiAssist: () => ({
    suggestions: {},
    decisions: {},
    isRunning: false,
    isDataReady: false,
    error: null,
    modelId: 'test',
    modelName: 'Test',
    run: jest.fn(async () => undefined),
    decide: jest.fn(),
  }),
}))

// The real adapter still runs; the spy only records what it was handed.
jest.mock('@voho0000/personalized-care-fhir', () => {
  const actual = jest.requireActual('@voho0000/personalized-care-fhir')
  return {
    ...actual,
    createFhirCdssPatientProfile: (input: unknown) => {
      createProfileSpy(input)
      return actual.createFhirCdssPatientProfile(input)
    },
  }
})

// A stub pack, so the assertion is about the profile the feature builds rather
// than about whichever disease pack happens to be enabled today.
jest.mock('@/features/clinical-decision-support/guideline-packs/registry', () => {
  const stubPack = {
    id: 'stub-pack',
    label: { zh: '測試指引', en: 'Stub pack' },
    enabled: true,
    applies: () => true,
    notApplicable: () => ({ title: '不適用', body: '不適用' }),
    build: ({ profile }: { profile: unknown }) => {
      packBuildSpy(profile)
      return {
        title: '測試指引',
        summary: '',
        packId: 'stub-pack',
        packVersion: '0.0.0',
        recommendations: [],
        knowledgePacks: [],
      }
    },
  }
  return {
    getEnabledClinicalGuidelinePacks: () => [stubPack],
    getApplicableClinicalGuidelinePacks: () => [stubPack],
    getDefaultClinicalGuidelinePack: () => stubPack,
    getClinicalGuidelinePack: () => stubPack,
  }
})

jest.mock('@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView', () => ({
  ClinicalDecisionSupportView: ({ patientId }: { patientId?: string }) => (
    <div data-testid="mock-cdss-result" data-patient-id={patientId} />
  ),
}))

const PATIENT_ID = 'evidence-wiring-patient'

const chestXray = {
  id: 'cxr-2026-07-19',
  status: 'final',
  effectiveDateTime: '2026-07-19',
  code: { text: 'Chest X-ray', coding: [{ code: '32001C', display: 'Chest PA' }] },
  conclusion: 'Cardiomegaly with bilateral pleural effusion and pulmonary congestion.',
}

const dischargeSummary = {
  id: 'discharge-2026-07-22',
  status: 'current',
  type: { text: '出院病歷摘要' },
  context: { period: { start: '2026-07-15' } },
  description: 'Physical examination: JVP elevated, bibasilar rales, pitting edema 2+.',
}

function clinicalData() {
  return {
    conditions: [],
    encounters: [],
    observations: [{
      id: 'nt-probnp-latest',
      resourceType: 'Observation',
      status: 'final',
      effectiveDateTime: '2026-07-20',
      code: {
        coding: [{ system: 'http://loinc.org', code: '33762-6', display: 'NT-proBNP' }],
      },
      valueQuantity: {
        value: 3200,
        unit: 'pg/mL',
        system: 'http://unitsofmeasure.org',
        code: 'pg/mL',
      },
    }],
    medications: [],
    allergies: [],
    carePlans: [],
    procedures: [],
    immunizations: [],
    diagnosticReports: [chestXray],
    documentReferences: [dischargeSummary],
    isLoading: false,
    isFetching: false,
    error: null,
    hasBlockingQueryIssues: false,
  }
}

function lastProfile(): CdssPatientProfile {
  return packBuildSpy.mock.calls.at(-1)?.[0] as CdssPatientProfile
}

describe('LiveFeature profile wiring', () => {
  useRealWebCrypto()

  beforeEach(() => {
    createProfileSpy.mockClear()
    packBuildSpy.mockClear()
    useEvidenceOverridesStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    window.localStorage.clear()
    mockUsePatient.mockReturnValue({
      patient: { id: PATIENT_ID, resourceType: 'Patient', age: 78 },
      loading: false,
      error: null,
    })
    mockUseClinicalData.mockReturnValue(clinicalData())
  })

  it('passes the diagnostic reports and clinical documents into the adapter', () => {
    render(<LiveClinicalDecisionSupportFeature />)

    expect(createProfileSpy).toHaveBeenCalled()
    const input = createProfileSpy.mock.calls.at(-1)?.[0]
    expect(input.diagnosticReports).toEqual([chestXray])
    expect(input.documentReferences).toEqual([dischargeSummary])
  })

  it('passes hospital ingredient evidence and unconfirmed use through the real feature to the pack', () => {
    mockUseClinicalData.mockReturnValue({ ...clinicalData(), medications: [{
      id: 'fictional-hospital-order', status: 'active', authoredOn: '2024-06-14',
      medicationCodeableConcept: { coding: [{ system: 'urn:oid:vgh.medication.product', display: 'Meitifen SR FC * tab 75 mg' }] },
      dispenseRequest: { validityPeriod: { start: '2024-06-14', end: '2024-07-14' } },
    }] })
    render(<LiveClinicalDecisionSupportFeature />)
    const input = createProfileSpy.mock.calls.at(-1)?.[0]
    expect(input.medications[0].drugTerminology).toEqual({ ingredientText: 'Diclofenac sodium' })
    expect(lastProfile().medicationClassContexts?.['nsaid-or-cox2-inhibitor']?.state)
      .toBe('confirmed-current') // The pack evaluates possible exposure for safety.
    expect((lastProfile() as HospitalAwareCdssProfile).hospitalMedicationEvidence?.[0].useState).toBe('historical-record-current-status-unknown')
    expect(lastProfile().facts.hfHarmfulNsaid.zh).toContain('院內使用待確認')
    expect(lastProfile().facts['hospitalMedication:MedicationRequest:fictional-hospital-order'].sources?.[0].status).toBe('active')
  })

  it('turns a report sentence into a fact the pack receives', () => {
    render(<LiveClinicalDecisionSupportFeature />)

    const matchedTerms = Object.values(lastProfile().facts)
      .flatMap((fact) => fact.textEvidence?.matchedTerms ?? [])
    expect(matchedTerms).toContain('cardiomegaly')
  })

  it('carries the patient id to the view so the switches stay per patient', () => {
    const { getByTestId } = render(<LiveClinicalDecisionSupportFeature />)
    expect(getByTestId('mock-cdss-result')).toHaveAttribute('data-patient-id', PATIENT_ID)
  })

  it('re-runs the pack with the physician switches in the profile', async () => {
    render(<LiveClinicalDecisionSupportFeature />)

    await waitFor(() => expect(lastProfile().evidenceOverrides).toEqual({}))
    const buildsBeforeToggle = packBuildSpy.mock.calls.length

    act(() => {
      useEvidenceOverridesStore.getState().setOverride(PATIENT_ID, 'congestion:cxr', false)
    })

    await waitFor(() => {
      expect(packBuildSpy.mock.calls.length).toBeGreaterThan(buildsBeforeToggle)
      expect(lastProfile().evidenceOverrides).toEqual({ 'congestion:cxr': false })
    })
  })

  it('reads a sealed switch back before the cards are shown', async () => {
    await sealAnswers(evidenceOverridesStorageKey(PATIENT_ID), { 'congestion:cxr': false })

    const { queryByTestId } = render(<LiveClinicalDecisionSupportFeature />)
    // Decrypting takes a moment; the cards wait rather than showing the
    // record's default and flipping when the physician's switch lands.
    expect(queryByTestId('mock-cdss-result')).toBeNull()

    await waitFor(() => expect(queryByTestId('mock-cdss-result')).not.toBeNull())
    expect(lastProfile().evidenceOverrides).toEqual({ 'congestion:cxr': false })
  })

  it('runs the pack only once the stored answers are back, never on the defaults first', async () => {
    await sealAnswers(evidenceOverridesStorageKey(PATIENT_ID), { 'congestion:cxr': false })

    const { queryByTestId } = render(<LiveClinicalDecisionSupportFeature />)
    // The record half needs no answer and does not wait; the pack does.
    expect(createProfileSpy).toHaveBeenCalledTimes(1)
    expect(packBuildSpy).not.toHaveBeenCalled()

    await waitFor(() => expect(queryByTestId('mock-cdss-result')).not.toBeNull())
    const overridesSeen = packBuildSpy.mock.calls.map(([profile]) => (profile as CdssPatientProfile).evidenceOverrides)
    expect(overridesSeen.length).toBeGreaterThan(0)
    expect(overridesSeen).toEqual(overridesSeen.map(() => ({ 'congestion:cxr': false })))
    expect(createProfileSpy).toHaveBeenCalledTimes(1)
  })

  it('neither reads nor keeps a plaintext switch an earlier build left', async () => {
    window.localStorage.setItem(
      `cdss-evidence-overrides:${PATIENT_ID}`,
      JSON.stringify({ 'congestion:cxr': false }),
    )
    window.localStorage.setItem(
      'cdss-evidence-overrides:another-patient',
      JSON.stringify({ 'congestion:jvp': true }),
    )

    const { getByTestId } = render(<LiveClinicalDecisionSupportFeature />)

    expect(getByTestId('mock-cdss-result')).toBeInTheDocument()
    expect(lastProfile().evidenceOverrides).toEqual({})
    expect(window.localStorage.getItem(`cdss-evidence-overrides:${PATIENT_ID}`)).toBeNull()
    expect(window.localStorage.getItem('cdss-evidence-overrides:another-patient')).toBeNull()
  })
})
