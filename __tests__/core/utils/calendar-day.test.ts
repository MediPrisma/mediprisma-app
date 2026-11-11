import { taipeiDay, utcDay } from '@/src/core/utils/calendar-day'

describe('calendar days from instants', () => {
  it('reads a date-only string back as the day it names', () => {
    expect(utcDay(Date.parse('2026-10-23'))).toBe('2026-10-23')
    expect(utcDay(new Date(Date.UTC(2026, 0, 31 + 1)))).toBe('2026-02-01')
  })

  it('dates an early-morning Taiwan timestamp on its Taiwan day', () => {
    const instant = Date.parse('2026-10-23T00:30:00+08:00')
    expect(taipeiDay(instant)).toBe('2026-10-23')
    expect(utcDay(instant)).toBe('2026-10-22')
  })

  it('rolls into the next Taiwan day at 16:00 UTC', () => {
    expect(taipeiDay(Date.parse('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    expect(taipeiDay(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
  })

  it('throws on an invalid instant, as toISOString does', () => {
    expect(() => utcDay(Number.NaN)).toThrow(RangeError)
    expect(() => taipeiDay(new Date('nope'))).toThrow(RangeError)
  })
})
