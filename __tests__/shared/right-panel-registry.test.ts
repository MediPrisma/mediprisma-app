jest.mock('@/src/shared/config/optional-capabilities', () => ({ CDSS_AVAILABLE: true, SDK_IMPORT_AVAILABLE: true }))

import { tabPanelClasses } from '@/src/shared/config/right-panel-scroll'
import { getEnabledRightPanelFeatures } from '@/src/shared/config/right-panel-registry'
import { groupRightPanelFeatures } from '@/src/application/stores/right-panel-tabs.store'

describe('right-panel registry', () => {
  it('keeps contextual data scope out of the primary feature tabs', () => {
    const featureIds = getEnabledRightPanelFeatures().map((feature) => feature.id)

    expect(featureIds).toEqual([
      'medical-summary',
      'medical-chat',
      'medical-calculator',
      'ips-export',
      'settings',
    ])
    expect(featureIds).not.toContain('data-selection')
    expect(featureIds).not.toContain('personalized-education')
    expect(featureIds).not.toContain('clinical-decision-support')
    expect(getEnabledRightPanelFeatures().find((feature) => feature.id === 'settings')?.iconOnly)
      .not.toBe(true)
  })

  it('keeps education and CDSS as separate pinned modules', () => {
    const features = getEnabledRightPanelFeatures(undefined, {
      betaFeaturesEnabled: true,
    })
    const defaults = groupRightPanelFeatures(features, {})

    expect(defaults.overflowFeatures.map((feature) => feature.id)).toEqual([])
    expect(defaults.pinnedFeatures.map((feature) => feature.id)).toEqual([
      'medical-summary',
      'medical-chat',
      'medical-calculator',
      'personalized-education',
      'clinical-decision-support',
      'ips-export',
    ])

    const customized = groupRightPanelFeatures(features, { 'medical-calculator': false })
    expect(customized.overflowFeatures.map((feature) => feature.id)).toEqual([
      'medical-calculator',
    ])

    const pluggedIn = groupRightPanelFeatures([
      ...features,
      {
        id: 'future-feature',
        name: 'Future Feature',
        tabLabel: 'futureFeature',
        order: 99,
        enabled: true,
        pinned: false,
      },
    ], {})
    expect(pluggedIn.overflowFeatures.map((feature) => feature.id)).toEqual([
      'future-feature',
    ])
  })

  it('opens the Beta tabs to a signed-out visitor who turned the switch on', () => {
    // The owner's rule: no account, no sign-in prompt — flipping the switch in
    // 設定 → 顯示與關於 is the entire gate. `getEnabledRightPanelFeatures` never
    // hears about authentication, so there is nothing left that could ask.
    const medicalIds = getEnabledRightPanelFeatures('medical', {
      betaFeaturesEnabled: true,
    }).map((feature) => feature.id)
    expect(medicalIds).toContain('clinical-decision-support')

    expect(getEnabledRightPanelFeatures('medical', {
      betaFeaturesEnabled: false,
    }).map((feature) => feature.id)).not.toContain('clinical-decision-support')
    expect(getEnabledRightPanelFeatures('medical').map((feature) => feature.id))
      .not.toContain('clinical-decision-support')
  })

  it('shows each audience its Beta tab only after the user opts in', () => {
    expect(getEnabledRightPanelFeatures('patient').map((feature) => feature.id))
      .not.toContain('personalized-education')
    expect(getEnabledRightPanelFeatures('medical').map((feature) => feature.id))
      .not.toContain('clinical-decision-support')
    expect(getEnabledRightPanelFeatures('patient', {
      betaFeaturesEnabled: false,
    }).map((feature) => feature.id)).not.toContain('personalized-education')

    const patientIds = getEnabledRightPanelFeatures('patient', {
      betaFeaturesEnabled: true,
    }).map(
      (feature) => feature.id,
    )
    const medicalIds = getEnabledRightPanelFeatures('medical', {
      betaFeaturesEnabled: true,
    }).map(
      (feature) => feature.id,
    )

    expect(patientIds).toContain('personalized-education')
    expect(patientIds).not.toContain('clinical-decision-support')
    expect(medicalIds).not.toContain('personalized-education')
    expect(medicalIds).toContain('clinical-decision-support')

    expect(patientIds.indexOf('personalized-education')).toBe(
      patientIds.indexOf('medical-calculator') + 1,
    )
    expect(medicalIds.indexOf('clinical-decision-support')).toBe(
      medicalIds.indexOf('medical-calculator') + 1,
    )

    expect(
      getEnabledRightPanelFeatures('patient', {
        betaFeaturesEnabled: true,
      }).find(
        (feature) => feature.id === 'personalized-education',
      )?.badge,
    ).toBe('Beta')
    expect(
      getEnabledRightPanelFeatures('medical', {
        betaFeaturesEnabled: true,
      }).find(
        (feature) => feature.id === 'clinical-decision-support',
      )?.badge,
    ).toBe('Beta')
  })

  it('keeps the personalized-education result mounted across tab switches', () => {
    const education = getEnabledRightPanelFeatures(undefined, {
      betaFeaturesEnabled: true,
    }).find(
      (feature) => feature.id === 'personalized-education',
    )

    expect(education?.forceMount).toBe(true)
  })

  it('lets medical summary scroll with the panel so only its card chips stay sticky', () => {
    const medicalSummary = getEnabledRightPanelFeatures().find(
      (feature) => feature.id === 'medical-summary',
    )

    expect(medicalSummary?.scrollMode).toBe('panel')
  })

  it('never pins a panel-scrolled tab to the viewport', () => {
    // `min-h-0` here would stop the panel growing past the viewport, trapping
    // the content the right column is supposed to scroll.
    expect(tabPanelClasses('panel').split(' ')).not.toContain('min-h-0')
  })

  it('lets every other tab shrink so the scrollport inside it can scroll', () => {
    // The regression this guards: without `min-h-0` the panel grows to its
    // content, the ScrollArea inside grows with it, and the tab goes dead —
    // silently, and only once that feature's content outgrows the viewport.
    for (const mode of [undefined, 'feature', 'self'] as const) {
      expect(tabPanelClasses(mode).split(' ')).toContain('min-h-0')
    }
  })

  it('leaves panel sizing to the layout, not to each registry entry', () => {
    const structural = ['flex-1', 'min-h-0', 'h-full']
    for (const feature of getEnabledRightPanelFeatures(undefined, {
      betaFeaturesEnabled: true,
    })) {
      const classes = feature.contentClassName?.split(' ') ?? []
      for (const token of structural) {
        expect([feature.id, classes.includes(token)]).toEqual([feature.id, false])
      }
    }
  })
})
