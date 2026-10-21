import {
  groupReadingsByDay,
  readingAge,
  readingDay,
} from '@/features/clinical-summary/vitals/utils/reading-dates'

const today = new Date(2026, 8, 28) // 2026-09-28, local calendar

describe('readingDay', () => {
  it('keeps the calendar date the source wrote, whatever the offset', () => {
    expect(readingDay('2018-02-12T00:00:00+08:00')).toBe('2018-02-12')
    expect(readingDay('2026-08-25T23:30:00-05:00')).toBe('2026-08-25')
    expect(readingDay('2018-02')).toBe('2018-02')
    expect(readingDay(undefined)).toBe('')
  })
})

describe('groupReadingsByDay', () => {
  it('puts same-day readings together and newest day first', () => {
    const groups = groupReadingsByDay([
      { key: 'height', value: '168 cm', effective: '2018-02-12T00:00:00+08:00' },
      { key: 'weight', value: '78 kg', effective: '2018-02-12T00:00:00+08:00' },
      { key: 'bp', value: '150/80 mmHg', effective: '2026-08-25T09:10:00+08:00' },
      { key: 'hr', value: '72 bpm' },
    ])
    expect(groups.map((g) => [g.day, g.readings.map((r) => r.key)])).toEqual([
      ['2026-08-25', ['bp']],
      ['2018-02-12', ['height', 'weight']],
      ['', ['hr']],
    ])
  })

  it('keeps a same-day reading from another source on its own line', () => {
    const groups = groupReadingsByDay([
      { key: 'height', value: '155 cm', effective: '2026-01-13', sourceProgram: 'adult-preventive' },
      { key: 'bp', value: '147/79 mmHg', effective: '2026-01-13T10:00:00+08:00' },
      { key: 'weight', value: '61 kg', effective: '2026-01-13', sourceProgram: 'adult-preventive' },
    ])
    expect(groups.map((g) => [g.day, g.sourceProgram, g.readings.map((r) => r.key)])).toEqual([
      ['2026-01-13', 'adult-preventive', ['height', 'weight']],
      ['2026-01-13', undefined, ['bp']],
    ])
  })

  it('makes one group when a health check measured everything at once', () => {
    const groups = groupReadingsByDay([
      { key: 'height', value: '168 cm', effective: '2018-02-12' },
      { key: 'bp', value: '154/88 mmHg', effective: '2018-02-12T00:00:00+08:00' },
    ])
    expect(groups).toHaveLength(1)
  })
})

describe('readingAge', () => {
  it.each([
    ['2026-09-28', { unit: 'today' }],
    ['2026-09-27', { unit: 'days', n: 1 }],
    ['2026-08-29', { unit: 'days', n: 30 }],
    ['2026-08-28', { unit: 'months', n: 1 }],
    ['2025-09-29', { unit: 'months', n: 11 }],
    ['2025-09-28', { unit: 'years', n: 1 }],
    ['2018-02-12', { unit: 'years', n: 8 }],
  ])('%s is %o before 2026-09-28', (day, age) => {
    expect(readingAge(day, today)).toEqual(age)
  })

  it('does not guess an age for a partial date', () => {
    expect(readingAge('2018-02', today)).toBeNull()
    expect(readingAge('', today)).toBeNull()
  })
})
