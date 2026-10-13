import { render } from '@testing-library/react'
import { MedicationItem } from '@/features/clinical-summary/medications/components/MedicationItem'
import { MedicationHistoryDetails } from '@/features/clinical-summary/medications/components/MedicationHistoryList'
import { doseUnlessRepeated } from '@/features/clinical-summary/medications/utils/dose-helpers'
import {
  BUILTIN_MED_COPY_FORMATS,
  buildMedicationCopyText,
  createMedCopyFormat,
  selectMedicationsForCopy,
  type MedCopySourceItem,
} from '@/features/clinical-summary/medications/utils/medication-copy-text'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }),
}))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: () => null,
}))

// A free-text SIG such as "1 tab QD" yields the dose "1 tab" and is also
// shown whole as the instruction (kept verbatim since #210), so every place
// that joined the two read "1 tab 1 tab QD".
describe('doseUnlessRepeated', () => {
  it.each([
    ['1 tab', '1 tab QD'],
    ['1 tab', '1 tablet QDPC'],
    ['1 tab', '1tab QD'],
    ['0.5 tab', '0.5 tab BID'],
    ['1 tab', '1 錠 QD'],
    ['5 mg', '5mg QD'],
    ['1 tab', '1 tab'],
    ['1 tab', '1 tab, QD'],
  ])('drops %s when the instruction starts with it: %s', (dose, instruction) => {
    expect(doseUnlessRepeated(dose, instruction)).toBeUndefined()
  })

  it.each([
    // A different leading dose is a discrepancy, not a repeat: show both.
    ['1 tab', '2 tab QD'],
    ['1 mg', '10 mg QD'],
    ['1 tab', 'QD'],
    ['1 tab', undefined],
    // A compound unit is a per-weight dose or a concentration, not the same
    // absolute dose (Astra r1 on #285).
    ['5 mg', '5 mg/kg QD'],
    ['5 mg', '5 mg/mL solution, take 2 mL QD'],
    ['5 mg', '5mg/kg QD'],
  ])('keeps %s otherwise: %s', (dose, instruction) => {
    expect(doseUnlessRepeated(dose, instruction)).toBe(dose)
  })

  it('has nothing to keep without a dose', () => {
    expect(doseUnlessRepeated(undefined, '1 tab QD')).toBeUndefined()
  })
})

describe('the medication row', () => {
  it('shows the source instruction once, without the repeated dose', () => {
    const row = {
      id: 'm1', title: 'Amlodipine 5mg', status: 'active', isInactive: false, isChronic: false,
      searchHaystack: '', refillCount: 1, dose: '1 tab', frequency: '1 tab QD',
    } as unknown as MedicationRow
    const { container } = render(<MedicationItem medication={row} />)
    const schedule = container.querySelector('[data-medication-schedule]')!.textContent ?? ''
    expect(schedule).toContain('1 tab QD')
    expect(schedule).not.toMatch(/1 tab\s*1 tab/)
  })
})

describe('an undated row with a supply duration', () => {
  // Only "（28 天）" ends in a full-width bracket that spaces itself; a bare
  // "28 天" needs a space before the instruction. The dropped dose used to
  // hide this ("28 天1 tab QD").
  const undated = {
    id: 'u1', title: 'Famotidine 20mg', status: 'completed', isInactive: true, isChronic: false,
    searchHaystack: '', refillCount: 1, durationDays: 28, dose: '1 tab', frequency: '1 tab QD',
  } as unknown as MedicationRow

  it('keeps a space after the bare duration in the row', () => {
    const { container } = render(<MedicationItem medication={undated} />)
    expect(container.querySelector('[data-medication-schedule]')!.textContent).toContain('28 天 1 tab QD')
  })

  it('keeps a space after the bare duration in the history detail', () => {
    const { container } = render(<MedicationHistoryDetails medications={[undated]} />)
    expect(container.textContent).toContain('28 天 1 tab QD')
  })
})

describe('copy text', () => {
  it('does not repeat the dose ahead of the instruction', () => {
    const item: MedCopySourceItem = {
      id: 'm1', title: 'Amlodipine 5mg', dose: '1 tab', frequency: '1 tab QD',
      day: '2026-10-02', durationDays: 28, isChronic: false, isInactive: false, isCurrent: true,
    } as MedCopySourceItem
    const { text } = buildMedicationCopyText(
      selectMedicationsForCopy([item]),
      BUILTIN_MED_COPY_FORMATS['builtin:compact'],
      { today: '2026-10-03', labels: zhTW.medCopy.text },
    )
    expect(text).toContain('1 tab QD')
    expect(text).not.toMatch(/1 ?tab\s*1 tab/)
  })

  const copy = (format: ReturnType<typeof createMedCopyFormat>) => {
    const item = {
      id: 'm1', title: 'Drug A', dose: '1 tab', frequency: '1 tab QD',
      day: '2026-10-02', durationDays: 28, isChronic: false, isInactive: false, isCurrent: true,
    } as MedCopySourceItem
    return buildMedicationCopyText(
      selectMedicationsForCopy([item]), format, { today: '2026-10-03', labels: zhTW.medCopy.text },
    ).text
  }

  it('keeps the dose when the format leaves the instruction out (Astra r1 on #285)', () => {
    const format = createMedCopyFormat(BUILTIN_MED_COPY_FORMATS['builtin:compact'], 'mine', 'mine')
    format.fields = format.fields.map((field) => field.id === 'frequency' ? { ...field, on: false } : field)
    expect(copy(format)).toContain('1 tab')
  })

  it('keeps the dose when the instruction is rewritten without it', () => {
    // Any frequency style that no longer starts with the dose must not take
    // the dose with it.
    for (const style of ['zh', 'split'] as const) {
      const format = createMedCopyFormat(BUILTIN_MED_COPY_FORMATS['builtin:compact'], 'mine', 'mine')
      format.fields = format.fields.map((field) => field.id === 'frequency' ? { ...field, style } : field)
      const text = copy(format)
      expect(text).toMatch(/1 ?tab/)
      expect(text).not.toMatch(/1 ?tab\s*1 tab/)
    }
  })
})

