import { formatDate } from '@/features/ips-export/utils/ips-helpers'

describe('IPS export formatDate', () => {
  it('keeps the calendar day of a +08:00 midnight stamp (健康存摺 rows)', () => {
    expect(formatDate('2026-10-23T00:00:00+08:00')).toBe('2026-10-23')
  })

  it('keeps the source day for any time before 08:00 local', () => {
    expect(formatDate('2026-10-23T07:59:00+08:00')).toBe('2026-10-23')
  })

  it('keeps the written day of a UTC stamp, as the screen does', () => {
    expect(formatDate('2026-10-23T23:30:00Z')).toBe('2026-10-23')
  })

  it('passes a plain date through and returns empty for no value', () => {
    expect(formatDate('2026-10-23')).toBe('2026-10-23')
    expect(formatDate(undefined)).toBe('')
  })

  it('leaves an unparseable value as written', () => {
    expect(formatDate('not a date')).toBe('not a date')
  })
})
