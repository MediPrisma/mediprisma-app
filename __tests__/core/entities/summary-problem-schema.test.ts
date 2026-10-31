import { SummaryProblemSchema } from '@/src/core/entities/medical-summary.entity'

describe('SummaryProblemSchema one-line fields', () => {
  it('reads an empty list or null as no value instead of rejecting the problem list', () => {
    const parsed = SummaryProblemSchema.parse({
      label: 'Bilateral vitreous opacities', kind: 'diagnosis', basisSources: ['E2'],
      metric: [], metricMeta: null, managedBy: null,
    })
    expect(parsed.metric).toBeUndefined()
    expect(parsed.metricMeta).toBeUndefined()
    expect(parsed.managedBy).toBeUndefined()
  })

  it('joins a list written for a one-line field', () => {
    const parsed = SummaryProblemSchema.parse({
      label: 'CKD', kind: 'diagnosis', basisSources: ['E1'], metric: ['eGFR 35 → 32', 'Cr 1.93 mg/dL'],
    })
    expect(parsed.metric).toBe('eGFR 35 → 32; Cr 1.93 mg/dL')
  })

  it('still rejects a problem that cites nothing', () => {
    expect(SummaryProblemSchema.safeParse({ label: 'X', metric: [] }).success).toBe(false)
  })
})
