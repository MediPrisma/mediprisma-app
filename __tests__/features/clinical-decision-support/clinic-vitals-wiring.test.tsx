/**
 * A vital typed in the room reaches the pack only as a fact on the profile —
 * the pack is a pure function of it — so this checks the feature hands it
 * over, and stops handing it over once the patient changes.
 */
import { render, screen, waitFor } from '@testing-library/react'
import LiveClinicalDecisionSupportFeature from '@/features/clinical-decision-support/LiveFeature'
import {
  clinicVitalsStorageKey,
  useClinicVitalsStore,
} from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'
import { storedCiphertext, useRealWebCrypto } from './encrypted-answers.helper'

const mockUsePatient = jest.fn()
const mockUseClinicalData = jest.fn()
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
// AI hook is covered separately; keep this suite focused on vitals hydration.
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
  ClinicalDecisionSupportView: () => <div data-testid="mock-cdss-result" />,
}))

function clinicalData() {
  return {
    conditions: [],
    encounters: [],
    observations: [],
    medications: [],
    allergies: [],
    carePlans: [],
    procedures: [],
    immunizations: [],
    diagnosticReports: [],
    documentReferences: [],
    isLoading: false,
    isFetching: false,
    error: null,
    hasBlockingQueryIssues: false,
  }
}

function latestProfile(): CdssPatientProfile {
  return packBuildSpy.mock.calls.at(-1)?.[0] as CdssPatientProfile
}

describe('clinic vitals reach the pack through the profile', () => {
  useRealWebCrypto()

  beforeEach(() => {
    packBuildSpy.mockClear()
    useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    mockUseClinicalData.mockReturnValue(clinicalData())
    mockUsePatient.mockReturnValue({
      patient: { id: 'vitals-patient', resourceType: 'Patient', age: 70 },
      loading: false,
      error: null,
    })
  })

  it('is a fact on the profile for this patient only', async () => {
    useClinicVitalsStore.getState().setVitals('vitals-patient', {
      entries: {
        systolic: { value: 126, measuredOn: '2026-09-05' },
        diastolic: { value: 78, measuredOn: '2026-09-05' },
        heartRate: { value: 68, measuredOn: '2026-09-05' },
        bodyWeight: { value: 72, measuredOn: '2026-09-05' },
      },
    })
    const view = render(<LiveClinicalDecisionSupportFeature />)
    await waitFor(() => expect(packBuildSpy).toHaveBeenCalled())

    const profile = latestProfile()
    expect(profile.facts.bloodPressure?.zh).toBe('126/78 mmHg（2026-09-05 門診輸入）')
    expect(profile.facts.heartRate?.numericValue).toBe(68)
    expect(profile.facts.bodyWeight?.numericValue).toBe(72)
    expect(profile.freshnessContexts?.heartRate?.state).toBe('current')
    expect(profile.freshnessContexts?.heartRate?.date).toBe('2026-09-05')

    view.unmount()
    packBuildSpy.mockClear()
    mockUsePatient.mockReturnValue({
      patient: { id: 'another-patient', resourceType: 'Patient', age: 60 },
      loading: false,
      error: null,
    })
    render(<LiveClinicalDecisionSupportFeature />)
    await waitFor(() => expect(packBuildSpy).toHaveBeenCalled())
    expect(latestProfile().facts.bloodPressure).toBeUndefined()
    expect(latestProfile().facts.heartRate).toBeUndefined()
  })

  it('waits for the stored answers rather than building the pack without them', async () => {
    // A reload of this tab: the record is on disk, sealed, and nothing is in
    // memory. Reading it back is a decryption, so the guidance has to wait —
    // a pack built from the empty record would draw every question unanswered
    // and then jump when the answers landed.
    useClinicVitalsStore.getState().setVitals('vitals-patient', {
      entries: {
        systolic: { value: 126, measuredOn: '2026-09-05' },
        diastolic: { value: 78, measuredOn: '2026-09-05' },
      },
      nyhaClass: 'III',
    })
    await storedCiphertext(clinicVitalsStorageKey('vitals-patient'))
    useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    packBuildSpy.mockClear()

    render(<LiveClinicalDecisionSupportFeature />)

    // While the read is in flight the reader sees the loading state, never a
    // visit with every question unanswered.
    expect(screen.queryByTestId('mock-cdss-result')).not.toBeInTheDocument()
    expect(screen.getByLabelText('正在整理臨床決策支援')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByTestId('mock-cdss-result')).toBeInTheDocument())
    // The first guidance this reader is shown already carries the answer, so
    // there is no unanswered state to flash out of.
    expect(latestProfile().facts.physicianNyhaClass?.zh).toContain('NYHA III')
    expect(latestProfile().facts.bloodPressure?.zh).toContain('126/78 mmHg')
  })
})
