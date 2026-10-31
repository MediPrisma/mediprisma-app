import { markSourceKeysOutsideCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'

const entry = (key: string): SummarySourceCatalogEntry => ({
  key, resourceType: 'MedicationRequest', resourceId: key.toLowerCase(), display: key,
})

describe('markSourceKeysOutsideCatalog', () => {
  const lane = [entry('M3'), entry('M7')]

  it('marks sources and refs the lane did not send, at any depth', () => {
    const marked = markSourceKeysOutsideCatalog({
      headline: 'x',
      problems: [{ label: 'DM', sources: ['M3', '[m4]', ' M7 '], metric: { ref: 'L2' } }],
      other: { ref: 'M7' },
    }, lane)
    expect(marked.problems[0].sources).toEqual(['M3', 'M4?', ' M7 '])
    expect(marked.problems[0].metric.ref).toBe('L2?')
    expect(marked.other.ref).toBe('M7')
    expect(marked.headline).toBe('x')
  })

  it('leaves non-string and non-source fields alone and does not mutate its input', () => {
    const input = { sources: ['M9', 3], label: 'M9', items: ['M9'] }
    const marked = markSourceKeysOutsideCatalog(input, lane)
    expect(marked).toEqual({ sources: ['M9?', 3], label: 'M9', items: ['M9'] })
    expect(input.sources[0]).toBe('M9')
  })
})
