describe('optional CDSS visibility', () => {
  afterEach(() => { jest.resetModules(); jest.dontMock('@/src/shared/config/optional-capabilities') })
  test.each([true, false])('package installed: %s, across plain and hospital launches', (installed) => {
    jest.resetModules()
    jest.doMock('@/src/shared/config/optional-capabilities', () => ({ CDSS_AVAILABLE: installed, SDK_IMPORT_AVAILABLE: true }))
    const { getEnabledRightPanelFeatures } = jest.requireActual('@/src/shared/config/right-panel-registry')
    for (const route of ['/', '/?medcloud2=auto', '/app/?medcloud2=auto&site=vghtpe', '/app-hmc/?medcloud2=auto&site=vghtpe']) {
      window.history.replaceState({}, '', route)
      const ids = getEnabledRightPanelFeatures('medical', { betaFeaturesEnabled: true }).map((feature: { id: string }) => feature.id)
      expect(ids.includes('clinical-decision-support')).toBe(installed)
      expect(ids).toEqual(expect.arrayContaining(['medical-summary', 'medical-chat', 'medical-calculator', 'ips-export', 'settings']))
      // Patient education keeps its original Beta/audience rule.
      const patientIds = getEnabledRightPanelFeatures('patient', { betaFeaturesEnabled: true }).map((feature: { id: string }) => feature.id)
      expect(patientIds).toContain('personalized-education')
    }
  })
})
