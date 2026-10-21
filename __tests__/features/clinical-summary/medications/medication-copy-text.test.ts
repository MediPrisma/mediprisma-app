import {
  BUILTIN_MED_COPY_FORMATS,
  buildMedicationCopyText,
  createMedCopyFormat,
  frequencyToZh,
  splitFrequencyCodes,
  resolveMedCopyFormat,
  selectMedicationsForCopy,
  type MedCopySourceItem,
  type MedCopyTextLabels,
} from '@/features/clinical-summary/medications/utils/medication-copy-text'
import type { MedCopyFieldId, MedCopyFormat } from '@/src/application/stores/outpatient-prefs.store'

const LABELS: MedCopyTextLabels = {
  title: 'Current medication',
  titleShort: 'Med',
  titleMeta: '{date}, {count} 項',
  paren: '（{text}）',
  days: '{n} 天',
  daysShort: '{n}d',
  remainingLeft: '餘 {n} 天',
  remainingUntil: '至 {date}',
  endedDays: '已用完 {n} 天',
  endedOn: '{date} 已用完',
  ended: '已結束',
  stopped: '已停用',
  previousDose: '原 {dose}',
  endedListTitle: '近期已用完（短期藥，不算在上面 {count} 項）',
  unknownInstitution: '院所不明',
  uncategorised: '未分類',
  undated: '日期不明',
  none: '載入的處方中沒有使用中用藥',
}

const CTX = { today: '2026-10-03', labels: LABELS }

function med(overrides: Partial<MedCopySourceItem> & { id: string; title: string }): MedCopySourceItem {
  return {
    isChronic: false,
    isInactive: false,
    isCurrent: true,
    status: 'active',
    ...overrides,
  }
}

const METFORMIN = med({
  id: 'm1', title: 'Metformin', secondaryTitle: 'Glucophage', dose: '850 mg', frequency: 'BID', route: 'PO',
  institution: '臺北榮總', day: '2026-09-19', durationDays: 28, daysRemaining: 14,
  isChronic: true, previousDose: '500 mg · BID', category: 'Biguanides',
})
const AMLODIPINE = med({
  id: 'm2', title: 'Amlodipine', dose: '5 mg', frequency: 'QD', route: 'PO', institution: '臺北榮總',
  day: '2026-09-19', durationDays: 28, daysRemaining: 14, isChronic: true,
})
const ATORVASTATIN_RAN_OUT = med({
  id: 'm3', title: 'Atorvastatin', dose: '20 mg', frequency: 'HS', route: 'PO', institution: '臺北榮總',
  day: '2026-09-03', durationDays: 28, daysRemaining: -2, isChronic: true,
  isInactive: true, status: 'completed',
})
const ASPIRIN = med({
  id: 'm4', title: 'Aspirin', dose: '100 mg', frequency: 'QD', route: 'PO', institution: '振興醫院',
  day: '2026-09-08', durationDays: 30, daysRemaining: 5,
})
const ANTIBIOTIC_RAN_OUT = med({
  id: 'm5', title: 'Amoxicillin/Clavulanate', dose: '875/125 mg', frequency: 'BID', route: 'PO',
  institution: '○○診所', day: '2026-09-20', durationDays: 7, daysRemaining: -6,
  isInactive: true, status: 'completed',
})
const STOPPED_CHRONIC = med({
  id: 'm6', title: 'Bisoprolol', dose: '2.5 mg', frequency: 'QD', institution: '臺北榮總',
  day: '2026-09-01', durationDays: 28, daysRemaining: -4, isChronic: true, isInactive: true, status: 'stopped',
})
// 雲端病歷 never marks 慢箋: a monthly script that ran out still counts.
const CLOUD_MONTHLY_RAN_OUT = med({
  id: 'm8', title: 'Brimonidine', dose: '1 gtt', frequency: 'BID', institution: '○○眼科',
  day: '2026-08-27', durationDays: 28, daysRemaining: -9, isInactive: true, status: 'completed',
})
const LONG_GONE = med({ id: 'm7', title: 'Prednisolone', isCurrent: false, isInactive: true, status: 'completed' })

function withFields(base: MedCopyFormat, on: Partial<Record<MedCopyFieldId, string | boolean>>): MedCopyFormat {
  return {
    ...base,
    fields: base.fields.map((field) => {
      const value = on[field.id]
      if (value === undefined) return field
      if (value === false) return { ...field, on: field.id === 'name' }
      return { ...field, on: true, style: typeof value === 'string' ? value : field.style }
    }),
  }
}

describe('selectMedicationsForCopy', () => {
  it('keeps running drugs and ran-out long-term scripts; leaves out ran-out short courses and stopped drugs', () => {
    const selection = selectMedicationsForCopy([
      METFORMIN, ATORVASTATIN_RAN_OUT, ASPIRIN, ANTIBIOTIC_RAN_OUT, STOPPED_CHRONIC, CLOUD_MONTHLY_RAN_OUT, LONG_GONE,
    ])
    expect(selection.current.map((entry) => entry.item.id)).toEqual(['m1', 'm3', 'm4', 'm8'])
    expect(selection.endedLongTerm.map((entry) => [entry.item.id, entry.endedDays])).toEqual([['m3', 2], ['m8', 9]])
    expect(selection.excluded.map((entry) => [entry.item.id, entry.reason])).toEqual([
      ['m5', 'ended'],
      ['m6', 'stopped'],
    ])
  })

  it('a 28-day supply is long-term without a 慢箋 mark; 27 days is not', () => {
    const short = med({ ...CLOUD_MONTHLY_RAN_OUT, id: 'm11', durationDays: 27 })
    const selection = selectMedicationsForCopy([CLOUD_MONTHLY_RAN_OUT, short])
    expect(selection.current.map((entry) => entry.item.id)).toEqual(['m8'])
    expect(selection.excluded.map((entry) => entry.item.id)).toEqual(['m11'])
  })

  it('ignores anything outside the 使用中 list', () => {
    expect(selectMedicationsForCopy([LONG_GONE]).current).toEqual([])
  })
})

describe('buildMedicationCopyText', () => {
  const selection = selectMedicationsForCopy([METFORMIN, AMLODIPINE, ATORVASTATIN_RAN_OUT, ASPIRIN, ANTIBIOTIC_RAN_OUT])

  it('standard: one line each, ran-out long-term supply marked', () => {
    const { text, currentCount, listedExcludedCount } = buildMedicationCopyText(
      selection, BUILTIN_MED_COPY_FORMATS['builtin:standard'], CTX,
    )
    expect(text).toBe([
      'Current medication (2026/10/03, 4 項)',
      '1. Metformin 850 mg BID PO （原 500 mg · BID） 臺北榮總 09/19 28 天',
      '2. Amlodipine 5 mg QD PO 臺北榮總 09/19 28 天',
      '3. Atorvastatin 20 mg HS PO 臺北榮總 09/03 28 天 （已用完 2 天）',
      '4. Aspirin 100 mg QD PO 振興醫院 09/08 30 天',
    ].join('\n'))
    expect(currentCount).toBe(4)
    expect(listedExcludedCount).toBe(0)
  })

  it('compact: name, dose and frequency only', () => {
    const { text } = buildMedicationCopyText(selection, BUILTIN_MED_COPY_FORMATS['builtin:compact'], CTX)
    expect(text.split('\n')).toEqual([
      'Current medication (2026/10/03, 4 項)',
      '- Metformin 850 mg BID',
      '- Amlodipine 5 mg QD',
      '- Atorvastatin 20 mg HS （已用完 2 天）',
      '- Aspirin 100 mg QD',
    ])
  })

  it('full: grouped by institution, shared values hoisted, ran-out short courses listed last', () => {
    const { text, listedExcludedCount } = buildMedicationCopyText(selection, BUILTIN_MED_COPY_FORMATS['builtin:full'], CTX)
    expect(text.split('\n')).toEqual([
      'Current medication (2026/10/03, 4 項)',
      '【臺北榮總】28 天',
      '1. Metformin (Glucophage) 850 mg BID PO （原 500 mg · BID） 09/19 至 10/17',
      '2. Amlodipine 5 mg QD PO 09/19 至 10/17',
      '3. Atorvastatin 20 mg HS PO 09/03 10/01 已用完',
      '【振興醫院】09/08 30 天',
      '4. Aspirin 100 mg QD PO 至 10/08',
      '',
      '近期已用完（短期藥，不算在上面 4 項）',
      '- Amoxicillin/Clavulanate 875/125 mg BID PO ○○診所 09/20 7 天 （已用完 6 天）',
    ])
    expect(listedExcludedCount).toBe(1)
  })

  it('writes every field style the editor offers', () => {
    const format = withFields(BUILTIN_MED_COPY_FORMATS['builtin:standard'], {
      name: 'product', dose: 'compact', prevDose: 'arrow', frequency: 'zh', date: 'roc', days: 'd',
      remaining: 'left', category: 'paren',
    })
    const { text } = buildMedicationCopyText(selectMedicationsForCopy([METFORMIN]), format, CTX)
    expect(text.split('\n')).toEqual([
      'Current medication (115/10/03, 1 項)',
      '1. Glucophage 850mg 一天兩次 PO （500 mg · BID → 850 mg · BID） 臺北榮總 115/09/19 28d 餘 14 天 (Biguanides)',
    ])
  })

  it('separator, numbering and title choices', () => {
    const format: MedCopyFormat = {
      ...withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], {}),
      numbering: 'paren',
      separator: 'dot',
      title: 'short',
      titleMeta: false,
    }
    const { text } = buildMedicationCopyText(selectMedicationsForCopy([AMLODIPINE]), format, CTX)
    expect(text).toBe('Med:\n1) Amlodipine・5 mg・QD')
    const none = buildMedicationCopyText(selectMedicationsForCopy([AMLODIPINE]), { ...format, title: 'none', numbering: 'none' }, CTX)
    expect(none.text).toBe('Amlodipine・5 mg・QD')
  })

  it('the same ingredient from two institutions keeps both lines without a marker', () => {
    // 「（同成分，N 院）」 was removed (owner, 2026-10-13): it counted
    // institution strings, so a pharmacy dispensing another brand of the
    // same ingredient, or one hospital's 門診 and 急診, read as two
    // institutions — a false duplicate-therapy alarm in the chart.
    const elsewhere = med({ ...ASPIRIN, id: 'm9', institution: '臺北榮總' })
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([ASPIRIN, elsewhere]),
      BUILTIN_MED_COPY_FORMATS['builtin:compact'],
      CTX,
    )
    expect(text.split('\n').slice(1)).toEqual([
      '- Aspirin 100 mg QD',
      '- Aspirin 100 mg QD',
    ])
  })

  it('groups by prescribing day newest first, and by category', () => {
    const base = withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { date: true, category: true })
    const byDate = buildMedicationCopyText(
      selectMedicationsForCopy([ATORVASTATIN_RAN_OUT, ASPIRIN, METFORMIN]),
      { ...base, group: 'date', groupHeader: 'colon', hoistShared: false },
      CTX,
    )
    expect(byDate.text.split('\n').filter((l) => l.endsWith(':'))).toEqual(['09/19:', '09/08:', '09/03:'])

    const byCategory = buildMedicationCopyText(
      selectMedicationsForCopy([METFORMIN, ASPIRIN]),
      { ...base, group: 'category', groupHeader: 'hash' },
      CTX,
    )
    expect(byCategory.text.split('\n').filter((l) => l.startsWith('# '))).toEqual(['# Biguanides 09/19', '# 未分類 09/08'])

  })

  it('a stopped drug listed last says 已停用, not 已用完', () => {
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([AMLODIPINE, STOPPED_CHRONIC]),
      { ...BUILTIN_MED_COPY_FORMATS['builtin:compact'], endedAcute: 'list' },
      CTX,
    )
    expect(text.split('\n').at(-1)).toBe('- Bisoprolol 2.5 mg QD （已停用）')
  })

  it('with 剩餘／已用完 off, no line counts days — ran out or not; 已停用 is still said', () => {
    const format: MedCopyFormat = {
      ...withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { remaining: false }),
      endedAcute: 'list',
    }
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([AMLODIPINE, ATORVASTATIN_RAN_OUT, ANTIBIOTIC_RAN_OUT, STOPPED_CHRONIC]),
      format,
      CTX,
    )
    expect(text).not.toMatch(/已用完 \d+ 天|餘 \d+ 天/)
    expect(text.split('\n')).toEqual([
      'Current medication (2026/10/03, 2 項)',
      '- Amlodipine 5 mg QD',
      '- Atorvastatin 20 mg HS',
      '',
      '近期已用完（短期藥，不算在上面 2 項）',
      '- Amoxicillin/Clavulanate 875/125 mg BID',
      '- Bisoprolol 2.5 mg QD （已停用）',
    ])
  })

  it('the three 剩餘／已用完 styles differ for a ran-out drug too', () => {
    const write = (style: string) => buildMedicationCopyText(
      selectMedicationsForCopy([ATORVASTATIN_RAN_OUT]),
      withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { remaining: style }),
      CTX,
    ).text.split('\n')[1]
    expect(write('endedOnly')).toBe('- Atorvastatin 20 mg HS （已用完 2 天）')
    expect(write('left')).toBe('- Atorvastatin 20 mg HS 已用完 2 天')
    expect(write('until')).toBe('- Atorvastatin 20 mg HS 10/01 已用完')
  })

  it('「只標已用完」 says nothing for a running supply', () => {
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([AMLODIPINE]),
      withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { remaining: 'endedOnly' }),
      CTX,
    )
    expect(text.split('\n')[1]).toBe('- Amlodipine 5 mg QD')
  })

  it('nothing current prints the title and says so', () => {
    const { text, currentCount } = buildMedicationCopyText(
      selectMedicationsForCopy([ANTIBIOTIC_RAN_OUT]),
      BUILTIN_MED_COPY_FORMATS['builtin:standard'],
      CTX,
    )
    expect(text).toBe('Current medication (2026/10/03, 0 項)\n載入的處方中沒有使用中用藥')
    expect(currentCount).toBe(0)
  })

  it('a short date carries the year when it is not this year', () => {
    const old = med({ ...AMLODIPINE, id: 'm10', day: '2025-12-20' })
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([old]),
      withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { date: 'md' }),
      CTX,
    )
    expect(text).toContain('2025/12/20')
  })
})

describe('frequencyToZh', () => {
  it('translates known codes, glued meal suffixes and Q-n-H', () => {
    expect(frequencyToZh('QD')).toBe('一天一次')
    expect(frequencyToZh('QD AC')).toBe('一天一次 飯前')
    expect(frequencyToZh('TIDPC')).toBe('一天三次 飯後')
    expect(frequencyToZh('HS PRN')).toBe('睡前 需要時')
    expect(frequencyToZh('Q6H')).toBe('每 6 小時')
  })

  it('pulls apart cloud codes glued from three or more pieces', () => {
    expect(frequencyToZh('QDACPO')).toBe('一天一次 飯前 口服')
    expect(frequencyToZh('HSPRN')).toBe('睡前 需要時')
    expect(frequencyToZh('QDPRNPC')).toBe('一天一次 需要時 飯後')
    expect(frequencyToZh('QODPCPO')).toBe('隔天一次 飯後 口服')
    expect(frequencyToZh('Q12HPC')).toBe('每 12 小時 飯後')
    expect(frequencyToZh('Q6MON')).toBe('每 6 個月')
    expect(frequencyToZh('Q2W')).toBe('每 2 週')
    // A longer code wins over its prefix.
    expect(frequencyToZh('STAT')).toBe('立即')
    expect(frequencyToZh('QDAY')).toBe('一天一次')
  })

  it('returns null rather than half-translating', () => {
    expect(frequencyToZh('ASOR')).toBeNull()
    expect(frequencyToZh('QDXYZ')).toBeNull()
    expect(frequencyToZh('QD XYZ')).toBeNull()
    expect(frequencyToZh('每日一次')).toBeNull()
    expect(frequencyToZh('')).toBeNull()
  })
})

describe('splitFrequencyCodes', () => {
  it('splits glued codes and leaves what it cannot split as recorded', () => {
    expect(splitFrequencyCodes('QDACPO')).toBe('QD AC PO')
    expect(splitFrequencyCodes('HSPRN')).toBe('HS PRN')
    expect(splitFrequencyCodes('TIDPC')).toBe('TID PC')
    expect(splitFrequencyCodes('QD')).toBe('QD')
    expect(splitFrequencyCodes('ASOR')).toBe('ASOR')
    expect(splitFrequencyCodes('QD ASOR')).toBe('QD ASOR')
    expect(splitFrequencyCodes('每日一次')).toBe('每日一次')
    // A full SIG keeps its words and separators: half a tablet stays 1/2.
    expect(splitFrequencyCodes('Take 1/2 tablet BID')).toBe('Take 1/2 tablet BID')
    expect(splitFrequencyCodes('QDAC ASOR')).toBe('QDAC ASOR')
  })

  it('is what the built-in formats write', () => {
    const glued = med({ id: 'g1', title: 'Levothyroxine', dose: '0.1 mg', frequency: 'QDACPO' })
    const { text } = buildMedicationCopyText(selectMedicationsForCopy([glued]), BUILTIN_MED_COPY_FORMATS['builtin:compact'], CTX)
    expect(text.split('\n')[1]).toBe('- Levothyroxine 0.1 mg QD AC PO')
    const asRecorded = buildMedicationCopyText(
      selectMedicationsForCopy([glued]),
      withFields(BUILTIN_MED_COPY_FORMATS['builtin:compact'], { frequency: 'source' }),
      CTX,
    )
    expect(asRecorded.text.split('\n')[1]).toBe('- Levothyroxine 0.1 mg QDACPO')
  })
})

describe('resolveMedCopyFormat', () => {
  it('is the clinician\'s own format, else the 緊湊 built-in', () => {
    expect(resolveMedCopyFormat(null).id).toBe('builtin:compact')
    expect(resolveMedCopyFormat(undefined).id).toBe('builtin:compact')
    const mine = createMedCopyFormat(BUILTIN_MED_COPY_FORMATS['builtin:standard'], '', 'mine')
    expect(resolveMedCopyFormat(mine)).toBe(mine)
  })
})
