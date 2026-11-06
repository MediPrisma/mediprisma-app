import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ICD_CROSSWALK_VERSION,
  buildIcdCodeReference,
  extractBilledIcd10Codes,
  interpretGemRows,
  templateRequestsIcd9,
  type IcdCrosswalk,
} from '@/src/core/utils/icd-code-reference.utils'

// The committed crosswalk, so the real CMS 2018 GEM rows are what is tested.
const committed = JSON.parse(
  readFileSync(join(__dirname, '../../../public/terminology/icd10cm-to-icd9cm-gem-2018.json'), 'utf8'),
) as IcdCrosswalk & { version: number }

const label = '-     ICD codes on visit record (billing, not confirmed diagnoses): '
const context = [
  'Visits & Treatment History:',
  '- ▶ 2026-01-01 · Clinic A',
  `${label}I10 - Essential hypertension; E11.9 - Type 2 diabetes`,
  '- ▶ 2026-02-01 · Clinic B',
  `${label}I10 - Essential hypertension; E10.3411 - Type 1 diabetes with severe NPDR with macular edema, right eye`,
  '- ▶ 2026-03-01 · Clinic A',
  `${label}R05.3 - Chronic cough`,
  'Lab Reports:',
  'HbA1c 7.1 (mentions I25.10 outside billing)',
].join('\n')

const HEADER =
  'ICD code reference: 4 distinct billed code(s) in this record. ICD-9-CM codes were translated by software ' +
  'with the CMS 2018 General Equivalence Mapping (GEM); this is a code translation, not a record entry, and billing codes are not confirmed diagnoses. ' +
  'No other ICD code exists in this record.\n' +
  'Row types: SINGLE = one ICD-9-CM code; copy it. ' +
  'ALTERNATIVES = mutually exclusive candidates; use one only if the record states which applies, never several. ' +
  'COMBINATION = the parts joined by + only together translate the one ICD-10-CM code; write every part, and from a {a | b} group the one code the record supports. ' +
  'NONE = no ICD-9-CM code. ' +
  'If the record cannot decide an ALTERNATIVES row or a { } group, keep the ICD-10-CM code and leave the ICD-9-CM code blank, marked "ICD-9 待確認".\n'

describe('ICD code reference', () => {
  it('detects templates that ask for ICD-9 codes', () => {
    expect(templateRequestsIcd9('A RULES: ICD-9 block then ICD-10 block')).toBe(true)
    expect(templateRequestsIcd9('list icd 9 codes')).toBe(true)
    expect(templateRequestsIcd9('Summarize ICD-10 billing reasons')).toBe(false)
  })

  it('lists each billed ICD-10 code once, in first-seen order, from billing lines only', () => {
    expect([...extractBilledIcd10Codes(context)]).toEqual([
      ['I10', 'Essential hypertension'],
      ['E11.9', 'Type 2 diabetes'],
      ['E10.3411', 'Type 1 diabetes with severe NPDR with macular edema, right eye'],
      ['R05.3', 'Chronic cough'],
    ])
  })

  it('keeps the CMS GEM rows and their flags in the committed crosswalk', () => {
    expect(committed.version).toBe(ICD_CROSSWALK_VERSION)
    expect(committed.map.I10).toEqual(['4010 10000', '4011 10000', '4019 10000'])
    expect(committed.map.E103411).toEqual(['25051 10111', '36206 10112', '36207 10113'])
    expect(committed.map.R29700).toEqual(['NoDx 11000'])
    // The CMS file spells this target in lower case; the builder normalises it.
    expect(committed.map.T8853XD).toEqual(['V5889 10000'])
    for (const rows of Object.values(committed.map)) {
      for (const row of rows) {
        expect(row).toMatch(/^(?:NoDx 11000|[0-9EV]\d{2,4} [01]0[01]\d\d)$/)
        const [code] = row.split(' ')
        if (code !== 'NoDx' && !committed.names[code]) throw new Error(`No ICD-9-CM name for ${code}`)
      }
    }
  })

  it('separates single, alternative, combination and missing translations', () => {
    expect(interpretGemRows(committed.map.E119)).toEqual({ kind: 'single', code: '25000', approximate: true })
    expect(interpretGemRows(committed.map.R05)).toEqual({ kind: 'single', code: '7862', approximate: false })
    expect(interpretGemRows(committed.map.I10)).toEqual({
      kind: 'alternatives',
      options: [
        { kind: 'single', code: '4010', approximate: true },
        { kind: 'single', code: '4011', approximate: true },
        { kind: 'single', code: '4019', approximate: true },
      ],
    })
    expect(interpretGemRows(committed.map.E103411)).toEqual({
      kind: 'combination',
      choiceLists: [['25051'], ['36206'], ['36207']],
    })
    // One choice list with two codes: 249.50 or 250.50, always with 362.02.
    expect(interpretGemRows(committed.map.E133599)).toEqual({
      kind: 'combination',
      choiceLists: [['24950', '25050'], ['36202']],
    })
    // A single row and a combination scenario are alternatives to each other.
    expect(interpretGemRows(committed.map.O659)).toEqual({
      kind: 'alternatives',
      options: [
        { kind: 'single', code: '66021', approximate: true },
        { kind: 'combination', choiceLists: [['66021'], ['65491']] },
      ],
    })
    expect(interpretGemRows(committed.map.R29700)).toEqual({ kind: 'none', reason: 'no-map' })
    expect(interpretGemRows(committed.map.R053)).toEqual({ kind: 'none', reason: 'not-in-gem' })
  })

  it('builds a counted, terminated reference that never presents candidates as one equivalent', () => {
    expect(buildIcdCodeReference(context, committed)).toBe(
      HEADER +
      '1. billed ICD-10-CM I10 Essential hypertension | ICD-9-CM ALTERNATIVES (at most one): ' +
      'option 1: 401.0 MALIGNANT ESSENTIAL HYPERTENSION; option 2: 401.1 BENIGN ESSENTIAL HYPERTENSION; option 3: 401.9 UNSPECIFIED ESSENTIAL HYPERTENSION\n' +
      '2. billed ICD-10-CM E11.9 Type 2 diabetes | ICD-9-CM SINGLE (approximate): ' +
      '250.00 DIABETES MELLITUS WITHOUT MENTION OF COMPLICATION, TYPE II OR UNSPECIFIED TYPE, NOT STATED AS UNCONTROLLED\n' +
      '3. billed ICD-10-CM E10.3411 Type 1 diabetes with severe NPDR with macular edema, right eye | ICD-9-CM COMBINATION (all parts together): ' +
      '250.51 DIABETES WITH OPHTHALMIC MANIFESTATIONS, TYPE I [JUVENILE TYPE], NOT STATED AS UNCONTROLLED + ' +
      '362.06 SEVERE NONPROLIFERATIVE DIABETIC RETINOPATHY + 362.07 DIABETIC MACULAR EDEMA\n' +
      '4. billed ICD-10-CM R05.3 Chronic cough | ICD-9-CM NONE (code not in the 2018 GEM)\n' +
      'End of ICD code reference (4 code(s)).\n\n',
    )
  })

  it('marks a choice within a combination and a GEM no-map entry', () => {
    const reference = buildIcdCodeReference(
      `${label}E13.3599 - Other specified diabetes with PDR without macular edema; R29.700 - NIHSS score 0`,
      committed,
    )
    expect(reference).toContain(
      '1. billed ICD-10-CM E13.3599 Other specified diabetes with PDR without macular edema | ICD-9-CM COMBINATION (all parts together): ' +
      '{249.50 SECONDARY DIABETES MELLITUS WITH OPHTHALMIC MANIFESTATIONS, NOT STATED AS UNCONTROLLED, OR UNSPECIFIED | ' +
      '250.50 DIABETES WITH OPHTHALMIC MANIFESTATIONS, TYPE II OR UNSPECIFIED TYPE, NOT STATED AS UNCONTROLLED} + ' +
      '362.02 PROLIFERATIVE DIABETIC RETINOPATHY\n',
    )
    expect(reference).toContain('2. billed ICD-10-CM R29.700 NIHSS score 0 | ICD-9-CM NONE (the GEM has no ICD-9-CM translation)\n')
  })

  it('formats E-codes with four digits before the decimal point', () => {
    const reference = buildIcdCodeReference(`${label}T36.0X1A - Penicillin poisoning`, committed)
    expect(reference).toContain(
      'ICD-9-CM COMBINATION (all parts together): 960.0 POISONING BY PENICILLINS + E856 ACCIDENTAL POISONING BY ANTIBIOTICS',
    )
    expect(buildIcdCodeReference(`${label}W01.0XXA - Fall`, committed))
      .toContain('ICD-9-CM SINGLE (approximate): E885.9 FALL FROM OTHER SLIPPING, TRIPPING, OR STUMBLING')
  })

  it('returns nothing when the record has no billed code', () => {
    expect(buildIcdCodeReference('Lab Reports:\nnone', committed)).toBe('')
  })
})
