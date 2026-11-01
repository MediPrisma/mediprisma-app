/**
 * A local development server may list the packs of the rules branch it was
 * started on, ahead of the host's own. The list is read once, at module load,
 * from `NEXT_PUBLIC_HMC_DEV_EXTRA_PACKS`, and only when NODE_ENV is
 * development — a deployed build lists exactly the host's own packs whatever
 * the variable says. An extra pack is still subject to the visibility rule:
 * unreleased guidance needs Beta, and the unattended Medcloud hand-off shows
 * released guidance only.
 *
 * The extra pack is stubbed rather than named. What the escape hatch is for is
 * a pack that exists on a rules branch and nowhere else, so naming a real id
 * would tie these cases to whichever care-pack build the machine happens to
 * carry: green where `node_modules` holds that branch's build, red everywhere
 * else. The HMC preview now installs the complete pilot registry.
 */
let mockMedcloudLaunchRoute = false

jest.mock('@/src/application/launch/medcloud-launch-route', () => ({
  isMedcloudLaunchRoute: () => mockMedcloudLaunchRoute,
}))

jest.mock('@/src/application/launch/medcloud-launch-context', () => ({
  ...jest.requireActual('@/src/application/launch/medcloud-launch-context'),
  isVghtpeUnattendedLaunch: () => false,
}))

jest.mock('@voho0000/personalized-care', () => {
  const actual = jest.requireActual('@voho0000/personalized-care')
  const [released] = actual.CARE_PACKS
  return {
    ...actual,
    // Modelled on a released pack so it satisfies the contract
    // `registerCarePacks` validates every pack against, then given the two
    // properties this suite is about: an id the host does not list, and
    // `enabled: false` for guidance the package has not released.
    CARE_PACKS: [
      ...actual.CARE_PACKS,
      {
        ...released,
        id: 'stub-extra-cdss',
        enabled: false,
        label: { zh: '測試用分支指引', en: 'Stub branch pack' },
      },
    ],
  }
})

type Registry = typeof import('@/features/clinical-decision-support/guideline-packs/registry')
type BetaStore = typeof import('@/src/application/stores/beta-features.store')

const HOST_PACK_IDS = ['heart-failure-cdss', 'hypertension-cdss', 'hyperlipidemia-cdss', 'atrial-fibrillation-cdss', 'chronic-coronary-disease-cdss']
const EXTRA = 'stub-extra-cdss'

/** A fresh module graph loaded under the given environment. */
function load(nodeEnv: string, extraPacks?: string): { registry: Registry; beta: BetaStore } {
  const original = process.env
  const env: Record<string, string | undefined> = { ...original, NODE_ENV: nodeEnv }
  if (extraPacks === undefined) delete env.NEXT_PUBLIC_HMC_DEV_EXTRA_PACKS
  else env.NEXT_PUBLIC_HMC_DEV_EXTRA_PACKS = extraPacks
  process.env = env as NodeJS.ProcessEnv
  try {
    let loaded: { registry: Registry; beta: BetaStore } | undefined
    // The list is read at module load, so each case needs its own module graph.
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      loaded = {
        registry: require('@/features/clinical-decision-support/guideline-packs/registry'),
        beta: require('@/src/application/stores/beta-features.store'),
      }
      /* eslint-enable @typescript-eslint/no-require-imports */
    })
    return loaded!
  } finally {
    process.env = original
  }
}

function hostIds(registry: Registry): string[] {
  return registry.HOST_CARE_PACKS.map((pack) => pack.id)
}

describe('development-only extra care packs', () => {
  beforeEach(() => {
    mockMedcloudLaunchRoute = false
    window.localStorage.clear()
  })

  it('lists the named pack ahead of the host list on a development server', () => {
    const { registry } = load('development', EXTRA)

    expect(hostIds(registry)).toEqual([EXTRA, ...HOST_PACK_IDS])
  })

  it('ignores the variable in a production build', () => {
    const { registry } = load('production', EXTRA)

    expect(hostIds(registry)).toEqual(HOST_PACK_IDS)
  })

  it('ignores the variable under test', () => {
    const { registry } = load('test', EXTRA)

    expect(hostIds(registry)).toEqual(HOST_PACK_IDS)
  })

  it('lists the host packs alone when the variable is unset', () => {
    const { registry } = load('development')

    expect(hostIds(registry)).toEqual(HOST_PACK_IDS)
  })

  it('skips an id the package does not ship instead of throwing', () => {
    const { registry } = load('development', `not-a-pack, ${EXTRA}`)

    expect(hostIds(registry)).toEqual([EXTRA, ...HOST_PACK_IDS])
  })

  it('never lists a pack twice', () => {
    const { registry } = load('development', `heart-failure-cdss,${EXTRA},${EXTRA}`)

    expect(hostIds(registry)).toEqual([EXTRA, ...HOST_PACK_IDS])
  })

  // Whether heart failure itself is released depends on the care-pack build the
  // app was installed with, so these two cases assert only on the extra pack.
  it('keeps an unreleased extra pack behind Beta, then opens on it', () => {
    const { registry, beta } = load('development', EXTRA)
    const visible = () => registry.getEnabledClinicalGuidelinePacks().map((pack) => pack.id)

    expect(registry.HOST_CARE_PACKS[0].enabled).toBe(false)
    expect(visible()).not.toContain(EXTRA)
    expect(registry.getClinicalGuidelinePack(EXTRA)).toBeUndefined()

    beta.useBetaFeaturesStore.getState().setBetaFeaturesEnabled('user-a', true)
    expect(visible()).toEqual(hostIds(registry))
    expect(registry.getDefaultClinicalGuidelinePack().id).toBe(EXTRA)
  })

  it('shows no extra pack on the Medcloud launch route even with Beta on', () => {
    const { registry, beta } = load('development', EXTRA)
    beta.useBetaFeaturesStore.getState().setBetaFeaturesEnabled('user-a', true)
    mockMedcloudLaunchRoute = true

    expect(registry.getEnabledClinicalGuidelinePacks().map((pack) => pack.id)).not.toContain(EXTRA)
    expect(registry.getClinicalGuidelinePack(EXTRA)).toBeUndefined()
  })
})
