/** HMC lists HF and lipid; existing route and Beta gates remain in force. */
let mockMedcloudLaunchRoute = false
let mockVghtpeUnattendedLaunch = false

jest.mock('@/src/application/launch/medcloud-launch-route', () => ({
  isMedcloudLaunchRoute: () => mockMedcloudLaunchRoute,
}))

jest.mock('@/src/application/launch/medcloud-launch-context', () => ({
  ...jest.requireActual('@/src/application/launch/medcloud-launch-context'),
  isVghtpeUnattendedLaunch: () => mockVghtpeUnattendedLaunch,
}))

import {
  HOST_CARE_PACKS,
  getClinicalGuidelinePack,
  getDefaultClinicalGuidelinePack,
  getEnabledClinicalGuidelinePacks,
} from '@/features/clinical-decision-support/guideline-packs/registry'
import { writePilotPackIds } from '@/features/clinical-decision-support/guideline-packs/pilot-gate'
import {
  GUEST_BETA_FEATURES_KEY,
  useBetaFeaturesStore,
} from '@/src/application/stores/beta-features.store'

/** What the host lists, in switcher order. */
const HOST_PACK_IDS = ['heart-failure-cdss', 'hyperlipidemia-cdss', 'atrial-fibrillation-cdss', 'chronic-coronary-disease-cdss']
const RELEASED_PACK_IDS = ['heart-failure-cdss']
/** Names the package has carried at one time or another, none of them listed here. */
const UNLISTED_PACK_IDS = [
  'ckd-cdss',
  'dm-ckd-cdss',
  'hypertension-cdss',
  'cirrhosis-cdss',
  'aki-alert-cdss',
  'renal-safety-cdss',
  'ckd-anemia-cdss',
]

function visibleIds(): string[] {
  return getEnabledClinicalGuidelinePacks().map((pack) => pack.id)
}

function enableBeta(): void {
  useBetaFeaturesStore.getState().setBetaFeaturesEnabled('user-a', true)
}

describe('care pack visibility', () => {
  beforeEach(() => {
    mockMedcloudLaunchRoute = false
    mockVghtpeUnattendedLaunch = false
    window.localStorage.clear()
    useBetaFeaturesStore.setState({ enabledByUser: {} })
  })

  it('lists heart failure, dyslipidemia, AF and coronary disease', () => {
    expect(HOST_CARE_PACKS.map((pack) => pack.id)).toEqual(HOST_PACK_IDS)
  })

  it('shows the listed pack to a browser with nothing turned on', () => {
    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)
    expect(getClinicalGuidelinePack('heart-failure-cdss')?.id).toBe('heart-failure-cdss')
  })

  it('reveals dyslipidemia, AF and coronary disease when Beta features go on', () => {
    enableBeta()

    expect(visibleIds()).toEqual(HOST_PACK_IDS)
  })

  it('reads a signed-out visitor\'s Beta switch the same way', () => {
    // A guest's Beta switch also reveals the pilot lipid pathway.
    useBetaFeaturesStore.getState().setBetaFeaturesEnabled(GUEST_BETA_FEATURES_KEY, true)

    expect(visibleIds()).toEqual(HOST_PACK_IDS)
  })

  it('leaves the listed pack marked released, which is what the 試辦 chip reads', () => {
    // Preserve the released HF status and the pilot lipid label.
    expect(getClinicalGuidelinePack('heart-failure-cdss')?.enabled).toBe(true)
    expect(HOST_CARE_PACKS.find(pack => pack.id === 'hyperlipidemia-cdss')?.enabled).toBe(false)
  })

  it('never shows a pack this host does not list', () => {
    enableBeta()
    writePilotPackIds(UNLISTED_PACK_IDS)

    expect(visibleIds()).toEqual(HOST_PACK_IDS)
    for (const id of UNLISTED_PACK_IDS) {
      expect(getClinicalGuidelinePack(id)).toBeUndefined()
    }
  })

  it('ignores an unknown pilot id', () => {
    writePilotPackIds(['not-a-pack'])

    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)
    expect(getClinicalGuidelinePack('not-a-pack')).toBeUndefined()
  })

  it('answers per call, so flipping the Beta switch never empties the list', () => {
    // Nothing may cache the pre-hydration answer: the module graph loads long
    // before the persisted Beta value is read back, and a user can flip the
    // switch mid-session.
    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)

    enableBeta()
    expect(visibleIds()).toEqual(HOST_PACK_IDS)

    useBetaFeaturesStore.getState().setBetaFeaturesEnabled('user-a', false)
    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)
  })

  it('shows the released pack on the Medcloud launch route, and nothing more', () => {
    // That route shows released guidance only, whatever a tester left switched
    // on in this browser earlier.
    enableBeta()
    writePilotPackIds([...UNLISTED_PACK_IDS, 'hyperlipidemia-cdss'])
    mockMedcloudLaunchRoute = true

    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)
    for (const id of UNLISTED_PACK_IDS) {
      expect(getClinicalGuidelinePack(id)).toBeUndefined()
    }
  })

  it('shows the released pack on the hospital\'s own unattended launch too', () => {
    mockMedcloudLaunchRoute = true
    mockVghtpeUnattendedLaunch = true

    expect(visibleIds()).toEqual(RELEASED_PACK_IDS)
    enableBeta()
    expect(visibleIds()).toEqual(HOST_PACK_IDS)
  })
})

describe('care pack default', () => {
  beforeEach(() => {
    mockMedcloudLaunchRoute = false
    mockVghtpeUnattendedLaunch = false
    window.localStorage.clear()
    useBetaFeaturesStore.setState({ enabledByUser: {} })
  })

  it('falls back to the first pack the host lists that is visible', () => {
    expect(getDefaultClinicalGuidelinePack().id).toBe('heart-failure-cdss')

    enableBeta()
    expect(getDefaultClinicalGuidelinePack().id).toBe('heart-failure-cdss')
  })
})

describe('a listed pack the package does not ship', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('@voho0000/personalized-care')
    jest.dontMock('@voho0000/personalized-care/registry')
  })

  it('is a wiring error rather than a silently shorter switcher', () => {
    jest.resetModules()
    jest.doMock('@voho0000/personalized-care', () => ({
      ...jest.requireActual('@voho0000/personalized-care'),
      // The release the host was not updated for: the pack it lists is gone.
      CARE_PACKS: [],
    }))
    jest.doMock('@voho0000/personalized-care/registry', () => ({
      registerCarePacks: () => undefined,
    }))

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/features/clinical-decision-support/guideline-packs/registry')
    }).toThrow(/Care pack "heart-failure-cdss" is listed by the host but not shipped/)
  })
})
