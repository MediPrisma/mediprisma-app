import {
  adaptiveFiltersAction,
  autoSelectAllTokenLimit,
  estimateFullRecordTokens,
  AUTO_SELECT_ALL_TOKENS,
} from '@/features/data-selection/hooks/useAdaptiveDataDefaults'
import { DEFAULT_DATA_FILTERS, MEDCLOUD_YEAR_DATA_FILTERS } from '@/src/shared/constants/data-selection.constants'

const obs = (i: number) => ({
  id: `o${i}`,
  code: { text: 'Creatinine' },
  valueQuantity: { value: 1, unit: 'mg/dL' },
  effectiveDateTime: '2026-01-01',
})

describe('estimateFullRecordTokens', () => {
  it('lowers auto-select-all headroom for a configured 32k endpoint', () => {
    expect(autoSelectAllTokenLimit([])).toBe(AUTO_SELECT_ALL_TOKENS)
    expect(autoSelectAllTokenLimit([32_768])).toBe(20_768)
    expect(autoSelectAllTokenLimit([131_072, 32_768]))
      .toBe(autoSelectAllTokenLimit([32_768]))
  })

  it('a tiny structured-only record estimates well under the auto-select threshold', () => {
    const data = { observations: [obs(1), obs(2), obs(3)], diagnosticReports: [], medications: [] } as any
    const tokens = estimateFullRecordTokens(data)
    expect(tokens).toBeLessThan(AUTO_SELECT_ALL_TOKENS)
    expect(tokens).toBeGreaterThan(0)
  })

  it('a huge structured record short-circuits to Infinity (no document decode needed)', () => {
    const many = Array.from({ length: 700 }, (_, i) => obs(i))
    const data = { observations: many } as any
    expect(estimateFullRecordTokens(data)).toBe(Number.POSITIVE_INFINITY)
  })

  it('counts document text weight — a big discharge summary pushes a sparse patient over budget', () => {
    // One CJK-heavy discharge summary ~ 80k chars → ~53k tokens (÷1.5), over 40k.
    const bigNote = '病'.repeat(80_000)
    const data = {
      observations: [obs(1)],
      documentReferences: [
        {
          id: 'big-note',
          date: '2025-01-01',
          type: { coding: [{ code: '18842-5' }] },
          content: [{ attachment: { contentType: 'text/html', data: btoa(unescape(encodeURIComponent(bigNote))) } }],
        },
      ],
    } as any
    expect(estimateFullRecordTokens(data)).toBeGreaterThan(AUTO_SELECT_ALL_TOKENS)
  })

  it('a sparse patient with only small documents stays under budget', () => {
    const smallNote = '<p>Short discharge note.</p>'
    const data = {
      observations: [obs(1), obs(2)],
      documentReferences: [
        {
          id: 'small-note',
          date: '2025-01-01',
          type: { coding: [{ code: '18842-5' }] },
          content: [{ attachment: { contentType: 'text/html', data: btoa(smallNote) } }],
        },
      ],
    } as any
    expect(estimateFullRecordTokens(data)).toBeLessThan(AUTO_SELECT_ALL_TOKENS)
  })
})

describe('adaptiveFiltersAction', () => {
  const base = { filters: DEFAULT_DATA_FILTERS, activePreset: 'newPatient', dataSource: 'nhi-medcloud' as const, smallRecord: false, autoApplied: false }

  it('gives an untouched 雲端病歷 record its whole year of visits, medicines, labs and reports', () => {
    expect(adaptiveFiltersAction(base)).toEqual({ kind: 'set-filters', filters: MEDCLOUD_YEAR_DATA_FILTERS })
    expect(MEDCLOUD_YEAR_DATA_FILTERS).toMatchObject({ encounterTimeRange: '1y', medicationTimeRange: '1y', labReportTimeRange: '1y', imagingReportTimeRange: '1y' })
    expect(adaptiveFiltersAction({ ...base, filters: MEDCLOUD_YEAR_DATA_FILTERS, autoApplied: true })).toEqual({ kind: 'none' })
  })

  it('returns another source to the factory window it set for the cloud record', () => {
    expect(adaptiveFiltersAction({ ...base, dataSource: 'nhi-health-bank', filters: MEDCLOUD_YEAR_DATA_FILTERS, autoApplied: true }))
      .toEqual({ kind: 'set-filters', filters: DEFAULT_DATA_FILTERS })
    expect(adaptiveFiltersAction({ ...base, dataSource: 'other' })).toEqual({ kind: 'none' })
  })

  it('still takes everything for a small record', () => {
    expect(adaptiveFiltersAction({ ...base, smallRecord: true })).toEqual({ kind: 'select-all' })
  })

  it('keeps a one-year window the user chose by hand (d834b140 review)', () => {
    expect(adaptiveFiltersAction({ ...base, dataSource: 'nhi-health-bank', filters: MEDCLOUD_YEAR_DATA_FILTERS })).toEqual({ kind: 'none' })
    expect(adaptiveFiltersAction({ ...base, dataSource: 'nhi-health-bank', filters: MEDCLOUD_YEAR_DATA_FILTERS, smallRecord: true })).toEqual({ kind: 'none' })
  })

  it('never overrides the user\'s own window or another template', () => {
    expect(adaptiveFiltersAction({ ...base, filters: { ...DEFAULT_DATA_FILTERS, encounterTimeRange: '3m' } })).toEqual({ kind: 'none' })
    expect(adaptiveFiltersAction({ ...base, activePreset: 'followUp' })).toEqual({ kind: 'none' })
  })
})
