/**
 * How LiveFeature feeds the decision map: the default layout per pack, the
 * companions a pack's map reads (atrial fibrillation's result on the
 * heart-failure page), both read from the pack's own registry, the every-visit
 * answers entering the profile, and the fall-back to three sections whenever
 * there is no model. The model builder is the pack's; here it is a stand-in
 * that records what it was given.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { CARE_PACKS } from '@voho0000/personalized-care'
import LiveClinicalDecisionSupportFeature from '@/features/clinical-decision-support/LiveFeature'
import {
  GUEST_BETA_FEATURES_KEY,
  useBetaFeaturesStore,
} from '@/src/application/stores/beta-features.store'
import { useCdssLayoutStore } from '@/features/clinical-decision-support/stores/layout-preference.store'
import { useVisitAnswersStore } from '@/features/clinical-decision-support/stores/visit-answers.store'
import type {
  BuildVisitDecisionModelInput,
  VisitAnswers,
  VisitDecisionModel,
  VisitMapDefinition,
} from '@/features/clinical-decision-support/types'
import type { CdssPatientProfile } from '@/features/clinical-decision-support/types'

const mockBuildVisitModel = jest.fn<VisitDecisionModel | undefined, [BuildVisitDecisionModelInput]>()
const mockApplyVisitAnswers = jest.fn((profile: CdssPatientProfile, answers: VisitAnswers) => {
  void answers
  return profile
})

// The pack's map registry, as the host reads it; a test can declare another.
const mockVisitMapOf = jest.fn<VisitMapDefinition | undefined, [string]>()

jest.mock('@/features/clinical-decision-support/renderers/visit/visit-model.source', () => ({
  ...jest.requireActual('@/features/clinical-decision-support/renderers/visit/visit-model.source'),
  isVisitModelSupported: () => true,
  visitMapOf: (packId: string) => mockVisitMapOf(packId),
  hasVisitMap: (packId: string) => mockVisitMapOf(packId) !== undefined,
  buildVisitModel: (input: BuildVisitDecisionModelInput) => mockBuildVisitModel(input),
  applyVisitAnswers: (profile: CdssPatientProfile, answers: VisitAnswers) => mockApplyVisitAnswers(profile, answers),
  applyFmtIntolerance: (profile: CdssPatientProfile) => profile,
  applyPreviousVisit: (profile: CdssPatientProfile) => profile,
}))

jest.mock('@/features/clinical-decision-support/hooks/use-nhi-lipid-ai-assist.hook', () => ({
  useNhiLipidAiAssist: () => ({
    suggestions: {}, decisions: {}, isRunning: false, isDataReady: false, error: null,
    modelId: 'test', modelName: 'Test', run: jest.fn(async () => undefined), decide: jest.fn(),
  }),
}))

const mockUsePatient = jest.fn()
const mockUseClinicalData = jest.fn()
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatient: () => mockUsePatient() }))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => mockUseClinicalData() }))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW' }) }))

jest.mock('@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView', () => ({
  ClinicalDecisionSupportView: ({
    result,
    layout,
    visitModel,
    companionResults,
    onVisitAnswer,
  }: {
    result: { packId: string }
    layout?: string
    visitModel?: { packId: string }
    companionResults?: readonly { packId: string }[]
    onVisitAnswer?: (id: string, value: string | null) => void
  }) => {
    // The handbook page reads its chrome from the context the host lends it.
    const { useContext } = jest.requireActual<typeof import('react')>('react')
    const { VisitBookChromeContext } = jest.requireActual<typeof import('@/features/clinical-decision-support/renderers/visit/visit-book-chrome')>('@/features/clinical-decision-support/renderers/visit/visit-book-chrome')
    const bookChrome = useContext(VisitBookChromeContext)
    return (
      <div
        data-testid="mock-cdss-result"
        data-pack={result.packId}
        data-layout={layout}
        data-book={bookChrome ? (bookChrome.inline ? 'inline' : 'window') : 'no'}
        data-model={visitModel?.packId ?? ''}
        data-companion={(companionResults ?? []).map((companion) => companion.packId).join(',')}
      >
        <button type="button" onClick={() => onVisitAnswer?.('dyspnoea-trend', 'worse')}>answer</button>
        {bookChrome?.onExpand ? <button type="button" onClick={bookChrome.onExpand}>expand book</button> : null}
        {bookChrome?.onCollapse ? <button type="button" onClick={bookChrome.onCollapse}>collapse book</button> : null}
      </div>
    )
  },
}))

const ICD10 = 'http://hl7.org/fhir/sid/icd-10-cm'
const PATIENT_ID = 'map-patient'

function model(packId: string): VisitDecisionModel {
  return {
    packId, stage: 'follow-up', triggers: [], headline: 'headline', keyValues: [], asks: [],
    queue: [], points: [], coverage: { total: 0, included: 0 },
  }
}

function clinicalData(codes: string[]) {
  return {
    conditions: [],
    encounters: [{
      id: 'enc-1',
      status: 'finished',
      period: { start: '2026-06-25T00:00:00+08:00' },
      reasonCode: codes.map((code) => ({ coding: [{ system: ICD10, code }] })),
    }],
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

function view() {
  return screen.getByTestId('mock-cdss-result')
}

describe('decision map wiring', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockBuildVisitModel.mockReset()
    mockApplyVisitAnswers.mockClear()
    mockBuildVisitModel.mockImplementation((input) => model(input.packId))
    const { visitMapOf } = jest.requireActual<typeof import('@/features/clinical-decision-support/renderers/visit/visit-model.source')>('@/features/clinical-decision-support/renderers/visit/visit-model.source')
    mockVisitMapOf.mockReset()
    mockVisitMapOf.mockImplementation(visitMapOf)
    useCdssLayoutStore.setState({ layout: null })
    useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    useBetaFeaturesStore.setState({ enabledByUser: {} })
    useBetaFeaturesStore.getState().setBetaFeaturesEnabled(GUEST_BETA_FEATURES_KEY, true)
    mockUsePatient.mockReturnValue({ patient: { id: PATIENT_ID, resourceType: 'Patient', age: 74 }, loading: false, error: null })
    mockUseClinicalData.mockReturnValue(clinicalData(['I50.22', 'I48.91', 'E78.5']))
  })

  it('opens heart failure on the decision map, with the AF result as its companion', () => {
    render(<LiveClinicalDecisionSupportFeature />)
    expect(view()).toHaveAttribute('data-pack', 'heart-failure-cdss')
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-model', 'heart-failure-cdss')
    expect(view()).toHaveAttribute('data-companion', 'atrial-fibrillation-cdss')
    const input = mockBuildVisitModel.mock.calls.at(-1)![0]
    expect(input.packId).toBe('heart-failure-cdss')
    expect(input.companions?.['atrial-fibrillation-cdss']?.packId).toBe('atrial-fibrillation-cdss')
    expect(input.locale).toBe('zh-TW')

    // The map is 決策地圖 v2, in this panel; the first decision map is gone
    // (owner, 2026-10-01: 「原本的決策地圖就可以整個拿掉了，留著v2跟三區塊」).
    expect(view()).toHaveAttribute('data-book', 'inline')
    expect(screen.getByTestId('cdss-layout-switch-map')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cdss-layout-switch-map')).toHaveTextContent('決策地圖 v2')
    expect(screen.getByTestId('cdss-layout-switch-sections')).toBeInTheDocument()
    expect(screen.getByTestId('cdss-layout-switch').querySelectorAll('button')).toHaveLength(2)
    for (const retired of ['flow', 'board', 'book']) {
      expect(screen.queryByTestId(`cdss-layout-switch-${retired}`)).not.toBeInTheDocument()
    }
    // Nothing in the header is hidden by the map: the module counts stay.
    // The header's 優先／需資料 counts are left out on the map: 今天要決定 says it, item by item.
    expect(screen.queryByText(/\d+ 優先$/)).toBeNull()
    expect(screen.getByTestId('cdss-hf-reset-page-defaults')).toBeInTheDocument()
  })

  it('keeps a browser that chose a layout on it', () => {
    useCdssLayoutStore.setState({ layout: 'sections' })
    render(<LiveClinicalDecisionSupportFeature />)
    expect(view()).toHaveAttribute('data-layout', 'sections')
    expect(view()).toHaveAttribute('data-model', '')
    // The map is not built for a page that is not showing it.
    expect(mockBuildVisitModel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cdss-layout-switch-map'))
    expect(view()).toHaveAttribute('data-layout', 'map')
  })

  it('switches between 決策地圖 v2, beside the patient\'s record, and the three sections', () => {
    render(<LiveClinicalDecisionSupportFeature />)
    fireEvent.click(screen.getByTestId('cdss-layout-switch-sections'))
    expect(useCdssLayoutStore.getState().layout).toBe('sections')
    expect(view()).toHaveAttribute('data-layout', 'sections')
    expect(view()).toHaveAttribute('data-book', 'no')

    fireEvent.click(screen.getByTestId('cdss-layout-switch-map'))
    expect(useCdssLayoutStore.getState().layout).toBe('map')
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-model', 'heart-failure-cdss')
    // Beside the patient's record, under this header's own switches.
    expect(view()).toHaveAttribute('data-book', 'inline')
    expect(screen.getByTestId('cdss-layout-switch-map')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens 決策地圖 v2 for a browser that chose it while it sat beside the first map', () => {
    window.localStorage.setItem('cdss-layout-preference', JSON.stringify({ state: { layout: 'book' }, version: 0 }))
    useCdssLayoutStore.persist.rehydrate()
    render(<LiveClinicalDecisionSupportFeature />)
    expect(useCdssLayoutStore.getState().layout).toBe('map')
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-book', 'inline')
  })

  it('opens 決策地圖 v2 over the whole window from the panel, and returns to the panel', () => {
    useCdssLayoutStore.setState({ layout: 'map' })
    render(<LiveClinicalDecisionSupportFeature />)
    expect(view()).toHaveAttribute('data-book', 'inline')
    fireEvent.click(screen.getByRole('button', { name: 'expand book' }))
    // The same page, over the window with its own disease tabs; the stored layout stays the map.
    expect(view()).toHaveAttribute('data-book', 'window')
    expect(useCdssLayoutStore.getState().layout).toBe('map')
    fireEvent.click(screen.getByRole('button', { name: 'collapse book' }))
    expect(view()).toHaveAttribute('data-book', 'inline')
  })

  it('falls back to three sections, and stops offering the map, when the model cannot be built', () => {
    mockBuildVisitModel.mockReturnValue(undefined)
    render(<LiveClinicalDecisionSupportFeature />)
    expect(view()).toHaveAttribute('data-layout', 'sections')
    expect(view()).toHaveAttribute('data-book', 'no')
    expect(screen.queryByTestId('cdss-layout-switch-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('cdss-layout-switch-sections')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves heart failure standing when the AF companion cannot be built', () => {
    const afPack = CARE_PACKS.find((pack) => pack.id === 'atrial-fibrillation-cdss')!
    const build = jest.spyOn(afPack, 'build').mockImplementation(() => { throw new Error('AF broke') })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<LiveClinicalDecisionSupportFeature />)
      expect(view()).toHaveAttribute('data-layout', 'map')
      expect(view()).toHaveAttribute('data-companion', '')
      expect(mockBuildVisitModel.mock.calls.at(-1)![0].companions).toEqual({})
    } finally {
      build.mockRestore()
      error.mockRestore()
    }
  })

  it('builds no companion when the AF pathway is not visible in this browser', () => {
    // Atrial fibrillation ships unreleased; without Beta it is not listed.
    useBetaFeaturesStore.setState({ enabledByUser: {} })
    render(<LiveClinicalDecisionSupportFeature />)
    expect(screen.queryByTestId('cdss-disease-switch-atrial-fibrillation-cdss')).not.toBeInTheDocument()
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-companion', '')
  })

  it('opens atrial fibrillation on its map, beside its own three-section flow', () => {
    render(<LiveClinicalDecisionSupportFeature />)
    fireEvent.click(screen.getByTestId('cdss-disease-switch-atrial-fibrillation-cdss'))
    expect(view()).toHaveAttribute('data-pack', 'atrial-fibrillation-cdss')
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-companion', '')
    expect(screen.getByTestId('cdss-layout-switch-map')).toBeInTheDocument()
    expect(screen.getByTestId('cdss-layout-switch-sections')).toBeInTheDocument()
    expect(screen.queryByTestId('cdss-layout-switch-flow')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cdss-layout-switch-sections'))
    expect(view()).toHaveAttribute('data-layout', 'sections')
  })

  it('leaves dyslipidemia on three sections', () => {
    render(<LiveClinicalDecisionSupportFeature />)
    fireEvent.click(screen.getByTestId('cdss-disease-switch-hyperlipidemia-cdss'))
    expect(view()).toHaveAttribute('data-layout', 'sections')
    expect(screen.queryByTestId('cdss-layout-switch-map')).not.toBeInTheDocument()
  })

  // Which pages have a map, and which results a map reads beside the page's
  // own, are the pack's to declare: the host lists no pack ids for either.
  it('follows the pack’s registry for which pages have a map and what each map reads', () => {
    const { visitMapOf } = jest.requireActual<typeof import('@/features/clinical-decision-support/renderers/visit/visit-model.source')>('@/features/clinical-decision-support/renderers/visit/visit-model.source')
    const hf = visitMapOf('heart-failure-cdss')!
    const af = visitMapOf('atrial-fibrillation-cdss')!
    // Say AF's map read heart failure's result, and heart failure's read none.
    mockVisitMapOf.mockImplementation((packId) => packId === hf.packId
      ? { ...hf, companions: [] }
      : packId === af.packId ? { ...af, companions: [hf.packId] } : undefined)
    render(<LiveClinicalDecisionSupportFeature />)
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-companion', '')
    expect(mockBuildVisitModel.mock.calls.at(-1)![0].companions).toEqual({})
    fireEvent.click(screen.getByTestId('cdss-disease-switch-atrial-fibrillation-cdss'))
    expect(view()).toHaveAttribute('data-layout', 'map')
    expect(view()).toHaveAttribute('data-companion', 'heart-failure-cdss')
    expect(mockBuildVisitModel.mock.calls.at(-1)![0].companions?.['heart-failure-cdss']?.packId).toBe('heart-failure-cdss')
  })

  it('opens a pack whose map the registry no longer declares on three sections, and offers no map', () => {
    const { visitMapOf } = jest.requireActual<typeof import('@/features/clinical-decision-support/renderers/visit/visit-model.source')>('@/features/clinical-decision-support/renderers/visit/visit-model.source')
    mockVisitMapOf.mockImplementation((packId) => (packId === 'atrial-fibrillation-cdss' ? undefined : visitMapOf(packId)))
    render(<LiveClinicalDecisionSupportFeature />)
    // Heart failure reads AF's result only through its map, which is still declared.
    expect(view()).toHaveAttribute('data-companion', 'atrial-fibrillation-cdss')
    fireEvent.click(screen.getByTestId('cdss-disease-switch-atrial-fibrillation-cdss'))
    expect(view()).toHaveAttribute('data-layout', 'sections')
    expect(view()).toHaveAttribute('data-model', '')
    expect(screen.queryByTestId('cdss-layout-switch-map')).not.toBeInTheDocument()
  })

  it('carries an every-visit answer into the profile through the pack, and resets it with the page', () => {
    render(<LiveClinicalDecisionSupportFeature />)
    fireEvent.click(screen.getByRole('button', { name: 'answer' }))
    expect(useVisitAnswersStore.getState().byPatientId[PATIENT_ID]?.['dyspnoea-trend']?.value).toBe('worse')
    expect(mockApplyVisitAnswers.mock.calls.at(-1)![1]).toEqual({ 'dyspnoea-trend': 'worse' })

    fireEvent.click(screen.getByTestId('cdss-hf-reset-page-defaults'))
    expect(useVisitAnswersStore.getState().byPatientId[PATIENT_ID]).toEqual({})
    expect(mockApplyVisitAnswers.mock.calls.at(-1)![1]).toEqual({})
  })
})
