/**
 * @jest-environment node
 *
 * One ordinal vocabulary: every spelling of a qualitative result — case,
 * full-width, spacing, punctuation, trailing detail — is the same kind of
 * value, so an assay reported "Negative" one day and "NEG" the next stays
 * one AI analyte with one history.
 */
import { ORDINAL_VALUE_SPELLINGS, ordinalValue } from '@/src/shared/utils/qualitative-value'
import { createFhirTools, labValueFamily } from '@/src/infrastructure/ai/tools/fhir-tools'
import { samplePatient, sampleCollection } from '../../infrastructure/ai/tools/fixtures'

const fullWidth = (s: string) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

/** Printed forms of one spelling. */
function printed(spelling: string): string[] {
  const forms = [spelling, spelling.toLowerCase(), titleCase(spelling), fullWidth(spelling), ` ${spelling} `]
  if (/^[A-Z]{3,}$/.test(spelling)) forms.push(`${spelling}.`, `${spelling} (<1:40)`, `${spelling} 0.21 S/CO`)
  if (/^[A-Z]+$/.test(spelling) && spelling.length > 6) {
    // Re-insert the space hospitals print: "Weakly positive", "Not detected".
    forms.push(spelling.replace(/^(WEAKLY|WEAK|STRONGLY|STRONG|NOT|NON|GRAY|GREY)/, '$1 '))
  }
  if (/[\p{Script=Han}]/u.test(spelling)) forms.push(`${spelling}(-)`, `${spelling} (參考值 <1)`)
  return [...new Set(forms)]
}

describe('ordinal value vocabulary', () => {
  const cases = Object.entries(ORDINAL_VALUE_SPELLINGS)
    .flatMap(([canonical, spellings]) => spellings.flatMap((s) => printed(s).map((form) => [form, canonical] as const)))
  it(`recognises all ${cases.length} printed spellings as their canonical value`, () => {
    const failures = cases
      .filter(([form, canonical]) => ordinalValue(form) !== canonical)
      .map(([form, canonical]) => `${JSON.stringify(form)}: ${ordinalValue(form)} ≠ ${canonical}`)
    expect(failures).toEqual([])
  })

  it(`classifies every one as the ordinal family`, () => {
    const failures = cases
      .filter(([form]) => labValueFamily({ valueString: form }) !== 'ordinal')
      .map(([form]) => `${JSON.stringify(form)}: ${labValueFamily({ valueString: form })}`)
    expect(failures).toEqual([])
  })

  it.each([
    '-5', '+0.3', '+1.25', 'RBC 3-5/HPF', 'Possible', 'Possibly',
    'Normal flora', 'Trachea', 'Rare', 'NEGLIGIBLE', 'Border cells', 'See report', 'BLOOD', 'Reactive lymphocytes seen'.replace('Reactive', 'Reactivated'),
  ])('%s is not an ordinal value', (value) => {
    expect(ordinalValue(value)).toBeNull()
  })

  it.each([['1:160', 'titer'], ['< 1:40', 'titer']])('%s stays a %s', (value, family) => {
    expect(labValueFamily({ valueString: value })).toBe(family)
  })
})

describe('one HBsAg history whatever the spelling', () => {
  it('groups 5195-3 "Negative", "NEG", "neg.", 「陰性」, "(-)" and "Non-reactive" as one analyte', async () => {
    const values = ['Negative', 'NEG', 'neg.', '陰性', '(-)', 'Non-reactive', 'ＮＥＧ', 'Reactive', 'W+']
    const observations = values.map((value, i) => ({
      resourceType: 'Observation', id: `hbsag-${i}`, status: 'final',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'HBsAg', coding: [{ system: 'http://loinc.org', code: '5195-3' }] },
      valueString: value,
      effectiveDateTime: `2026-0${(i % 9) + 1}-01T08:00:00+08:00`,
    }))
    const tools = createFhirTools(() => ({ patient: samplePatient, collection: { ...sampleCollection, observations, vitalSigns: [] } }))
    const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'hep', withTrend: true })
    expect(result.analyteCount).toBe(1)
    expect(result.data[0].observationCount).toBe(values.length)
  })
})

describe('ordinal phrases with trailing words', () => {
  it.each([
    ['Negative for HBsAg', 'NEGATIVE'], ['Not detected by PCR', 'NOT_DETECTED'], ['Positive (1:80)', 'POSITIVE'],
    ['Weakly positive for IgM', 'WEAKLY_POSITIVE'], ['Non reactive', 'NONREACTIVE'], ['Non-reactive (0.12)', 'NONREACTIVE'],
    ['NEG for MRSA', 'NEGATIVE'], ['Reactive, confirm', 'REACTIVE'], ['Trace amount', 'TRACE'], ['Not  detected', 'NOT_DETECTED'],
  ])('%s → %s', (value, canonical) => {
    expect(ordinalValue(value)).toBe(canonical)
  })
})
