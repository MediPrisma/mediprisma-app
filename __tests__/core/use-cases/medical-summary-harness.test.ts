import {
  FRONTIER_HARNESS_MIN_CONTEXT_TOKENS,
  medicalSummaryHarnessProfile,
  usesCompactSummaryHarness,
} from '@/src/core/use-cases/medical-summary/medical-summary-harness'
import { ALL_MODELS } from '@/src/shared/constants/ai-models.constants'

describe('medical summary harness selection', () => {
  it('is decided by the context window, not by the provider', () => {
    // The three cloud models below 500K deliberately move onto the compact
    // rules; nothing here names an endpoint or a vendor.
    expect(medicalSummaryHarnessProfile(120_000)).toBe('local-small')
    expect(medicalSummaryHarnessProfile(180_000)).toBe('local-small')
    expect(medicalSummaryHarnessProfile(15_000)).toBe('local-small')
    expect(medicalSummaryHarnessProfile(900_000)).toBe('frontier')
    expect(medicalSummaryHarnessProfile(1_800_000)).toBe('frontier')
  })

  it('treats the threshold itself as frontier', () => {
    expect(usesCompactSummaryHarness(FRONTIER_HARNESS_MIN_CONTEXT_TOKENS)).toBe(false)
    expect(usesCompactSummaryHarness(FRONTIER_HARNESS_MIN_CONTEXT_TOKENS - 1)).toBe(true)
  })

  it('falls back to the compact harness for an unusable limit', () => {
    // A custom endpoint whose declared window is missing or nonsense must not
    // silently receive the long frontier prompt.
    expect(usesCompactSummaryHarness(undefined)).toBe(true)
    expect(usesCompactSummaryHarness(Number.NaN)).toBe(true)
    expect(usesCompactSummaryHarness(Number.POSITIVE_INFINITY)).toBe(true)
  })

  it('splits the shipped model lineup the way the threshold intends', () => {
    const compact = ALL_MODELS
      .filter((model) => usesCompactSummaryHarness(model.contextLimit))
      .map((model) => model.id)
    // Every shipped model either declares a 900K+ window or is one of the
    // small-window entries; an added model lands on one side deliberately.
    expect(compact.length).toBeGreaterThan(0)
    for (const model of ALL_MODELS) {
      expect(usesCompactSummaryHarness(model.contextLimit))
        .toBe(model.contextLimit < FRONTIER_HARNESS_MIN_CONTEXT_TOKENS)
    }
  })
})
