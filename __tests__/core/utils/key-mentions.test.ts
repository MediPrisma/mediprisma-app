import { keyMentionsText, resolveKeyMentions, type KeyMentionSource } from '@/src/core/utils/key-mentions.utils'

// Synthetic records only.
const SOURCES: Record<string, KeyMentionSource> = {
  M5: { key: 'M5', resourceType: 'MedicationRequest', display: 'SYN-DONE TABLETS 5MG', medicationClass: 'donepezil · N06D ANTI-DEMENTIA DRUGS' },
  M21: { key: 'M21', resourceType: 'MedicationRequest', display: 'SYN-OXY TABLETS 5MG', medicationClass: 'oxybutynin · G04B UROLOGICALS' },
  M8: { key: 'M8', resourceType: 'MedicationRequest', display: 'SYN-NAPRO TABLETS 250MG', medicationClass: 'naproxen · M01A ANTIINFLAMMATORY' },
  M11: { key: 'M11', resourceType: 'MedicationRequest', display: 'SYN-IBU TABLETS 400MG', medicationClass: 'ibuprofen · M01A ANTIINFLAMMATORY' },
  E1: { key: 'E1', resourceType: 'Encounter', date: '2026-03-04' },
  E8: { key: 'E8', resourceType: 'Encounter', date: '2026-02-11' },
  E10: { key: 'E10', resourceType: 'Encounter', date: '2025-09-14' },
  E15: { key: 'E15', resourceType: 'Encounter', date: '2026-01-20' },
  D2: { key: 'D2', resourceType: 'DocumentReference', display: '出院病摘', date: '2025-06-30' },
  K1: { key: 'K1', resourceType: 'CarePlan', date: '2024-05-02' },
  K2: { key: 'K2', resourceType: 'CarePlan', date: '2024-11-19' },
}
const lookup = (key: string) => SOURCES[key]
const cited = Object.keys(SOURCES)

describe('resolveKeyMentions', () => {
  it('drops a key after the medicine it names and lets the name open the record', () => {
    const segments = resolveKeyMentions('Concurrent Donepezil (M5) and Oxybutynin (M21).', cited, lookup, 'en')
    expect(keyMentionsText(segments)).toBe('Concurrent Donepezil and Oxybutynin.')
    expect(segments.filter((segment) => segment.keys)).toEqual([
      { text: 'Donepezil', keys: ['M5'] },
      { text: 'Oxybutynin', keys: ['M21'] },
    ])
  })

  it('writes three or more visits as a count and the latest date', () => {
    const segments = resolveKeyMentions('Recurrent falls (visits E1, E8, E15) on sedatives.', cited, lookup, 'en')
    expect(keyMentionsText(segments)).toBe('Recurrent falls (3 visits, latest 2026-03-04) on sedatives.')
    expect(segments.find((segment) => segment.keys)?.keys).toEqual(['E1', 'E8', 'E15'])
  })

  it('names a document by its date and kind, without repeating the lead words', () => {
    expect(keyMentionsText(resolveKeyMentions('Monitor; discharge summary D2 noted anaemia.', cited, lookup, 'en')))
      .toBe('Monitor; 2025-06-30 discharge summary noted anaemia.')
  })

  it('writes bare keys as medicine names and visit dates', () => {
    expect(keyMentionsText(resolveKeyMentions('Recent NSAID use (M8, M11) with ulcer history (E10).', cited, lookup, 'en')))
      .toBe('Recent NSAID use (Naproxen, Ibuprofen) with ulcer history (visit 2025-09-14).')
    expect(keyMentionsText(resolveKeyMentions('2 care plans (K1, K2)', cited, lookup, 'en')))
      .toBe('2 care plans (care plan 2024-05-02, care plan 2024-11-19)')
  })

  it('adds only the date when the sentence already names the record', () => {
    const lab: KeyMentionSource = { key: 'L4', resourceType: 'Observation', display: 'eGFR', date: '2026-03-02' }
    expect(keyMentionsText(resolveKeyMentions('reduced eGFR L4', ['L4'], () => lab, 'en')))
      .toBe('reduced eGFR 2026-03-02')
    expect(keyMentionsText(resolveKeyMentions('renal function (L4)', ['L4'], () => lab, 'en')))
      .toBe('renal function (eGFR 2026-03-02)')
  })

  it('leaves ICD codes, lab names and keys the item does not cite as written', () => {
    expect(keyMentionsText(resolveKeyMentions('2 visits, C61; E11.9 on file; K31.7', cited, lookup, 'en')))
      .toBe('2 visits, C61; E11.9 on file; K31.7')
    expect(keyMentionsText(resolveKeyMentions('See visit E10. Then E10.5 stays.', cited, lookup, 'en')))
      .toBe('See visit 2025-09-14. Then E10.5 stays.')
    // E2 the hormone, in an alert that does not cite the visit E2.
    expect(keyMentionsText(resolveKeyMentions('ulcer history (E10); FSH and E2 low', ['M5'], lookup, 'en')))
      .toBe('ulcer history (E10); FSH and E2 low')
  })

  it('writes Chinese labels for a Chinese sentence', () => {
    expect(keyMentionsText(resolveKeyMentions('曾因跌倒就診 E1、E8、E15。', cited, lookup, 'zh-TW')))
      .toBe('曾因跌倒3 次就診，最近 2026-03-04。')
  })
})
