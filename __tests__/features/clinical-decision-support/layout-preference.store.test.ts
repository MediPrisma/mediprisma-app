import { layoutFor } from '@/features/clinical-decision-support/stores/layout-preference.store'

describe('layoutFor', () => {
  it('opens dyslipidemia on NHI Table 1 only', () => {
    expect(layoutFor('hyperlipidemia-cdss')).toBe('nhi')
  })

  it('opens every pack with a decision map on the map', () => {
    expect(layoutFor('heart-failure-cdss')).toBe('map')
    expect(layoutFor('atrial-fibrillation-cdss')).toBe('map')
  })

  it('falls back to sections only for a pack without a map', () => {
    expect(layoutFor('some-future-pack')).toBe('sections')
  })
})
