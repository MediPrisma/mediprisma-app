import { staleEvidenceDate } from '@/src/core/utils/stale-evidence.utils'

const NOW = Date.parse('2026-10-03T10:00:00+08:00')

describe('staleEvidenceDate', () => {
  it('names the newest date when every cited record is over a year old', () => {
    expect(staleEvidenceDate(['2022-11-07', '2021-03-01'], NOW)).toBe('2022-11-07')
  })

  it('stays silent when any cited record is within the year', () => {
    expect(staleEvidenceDate(['2022-11-07', '2026-06-24'], NOW)).toBeUndefined()
    expect(staleEvidenceDate(['2025-10-03'], NOW)).toBeUndefined()
  })

  it('labels the day just past a year', () => {
    expect(staleEvidenceDate(['2025-10-02'], NOW)).toBe('2025-10-02')
  })

  it('cannot state an age without dates', () => {
    expect(staleEvidenceDate([], NOW)).toBeUndefined()
    expect(staleEvidenceDate(['2022-11-07', undefined], NOW)).toBeUndefined()
    expect(staleEvidenceDate(['2022-11-07'], Number.NaN)).toBeUndefined()
  })
})
