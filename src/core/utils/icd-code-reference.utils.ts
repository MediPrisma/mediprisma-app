/**
 * ICD code reference for custom-summary templates that demand ICD-9 codes.
 *
 * The HMC SOAP template requires an ICD-9 block, but MedCloud records carry
 * only ICD-10-CM billing codes. Without a code to copy, tvghbrain3.5 recalled
 * ICD-9 codes from memory and enumerated the code table until the 4096-token
 * limit. This module translates only the billing codes already present in the
 * context, with an explicit count and end marker, plus a matching system guard.
 *
 * The CMS GEM is not a list of equivalents. Its flags separate one complete
 * translation from mutually exclusive alternatives (I10 -> 401.0, 401.1 or
 * 401.9) and from combinations whose codes are only complete together
 * (E10.3411 -> 250.51 with 362.06 with 362.07). Each row of the reference
 * keeps that distinction, and the guard tells the model to leave the ICD-9
 * code pending when the record cannot choose.
 */

/** Bump with scripts/build-icd9-crosswalk.mjs whenever the JSON layout changes. */
export const ICD_CROSSWALK_VERSION = 2

export interface IcdCrosswalk {
  /**
   * ICD-10-CM code without decimal point -> its CMS GEM rows, each
   * "<ICD-9-CM target> <flags>" exactly as in 2018_I10gem.txt. The five flag
   * digits are approximate, no map, combination, scenario and choice list.
   */
  map: Record<string, string[]>
  /** ICD-9-CM code without decimal point -> CMS long description. */
  names: Record<string, string>
}

export interface Icd9SingleTranslation {
  kind: 'single'
  code: string
  approximate: boolean
}

export interface Icd9CombinationTranslation {
  kind: 'combination'
  /** One code from every list, all lists together, is one complete translation. */
  choiceLists: string[][]
}

export type Icd9Option = Icd9SingleTranslation | Icd9CombinationTranslation

export type Icd9Translation =
  | Icd9Option
  | { kind: 'alternatives'; options: Icd9Option[] }
  | { kind: 'none'; reason: 'no-map' | 'not-in-gem' }

const BILLING_LINE = /ICD codes on visit record \(billing, not confirmed diagnoses\): (.+)$/gm
const ICD10_CODE = /\b[A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/g
const GEM_ROW = /^(\S+) ([01])([01])([01])(\d)(\d)$/
const PENDING_MARK = '"ICD-9 待確認"'

export const ICD_CODE_GUARD =
  'DIAGNOSIS CODES: In any ICD code list, use only codes that appear in the supplied record or its ICD code reference. ' +
  'Never recall or enumerate codes from memory; for a supported diagnosis without a supplied code, write the name and leave the code blank. ' +
  'From the ICD code reference, copy a SINGLE code; write every part of a COMBINATION, one code from each { } group; ' +
  'use at most one of ALTERNATIVES, and only when the record states which applies. ' +
  `When the record cannot decide, keep the ICD-10-CM code and leave the ICD-9-CM code blank, marked ${PENDING_MARK}. ` +
  'Write each diagnosis at most once per block, then continue to the next section.'

/** True when a user template asks for ICD-9 codes (e.g. the HMC SOAP template). */
export function templateRequestsIcd9(prompt: string): boolean {
  return /\bICD[-\s]?9\b/i.test(prompt)
}

/** Distinct billed ICD-10 codes in first-seen order, with the record's own description. */
export function extractBilledIcd10Codes(context: string): Map<string, string> {
  const items = new Map<string, string>()
  for (const [, list] of context.matchAll(BILLING_LINE)) {
    const found = [...list.matchAll(ICD10_CODE)]
    found.forEach((match, index) => {
      const next = found[index + 1]?.index ?? list.length
      const description = list
        .slice((match.index ?? 0) + match[0].length, next)
        .replace(/^[\s\-:]+|[\s;,]+$/g, '')
      if (!items.has(match[0])) items.set(match[0], description)
    })
  }
  return items
}

/**
 * Interprets the GEM rows of one ICD-10-CM code (CMS GEM technical
 * documentation, flags 1-5): every combination-flag-0 row is a complete
 * alternative on its own; combination rows form one alternative per scenario,
 * completed by one code from each choice list.
 */
export function interpretGemRows(rows: readonly string[] | undefined): Icd9Translation {
  if (!rows?.length) return { kind: 'none', reason: 'not-in-gem' }
  const singles: Icd9SingleTranslation[] = []
  const scenarios = new Map<string, Map<string, string[]>>()
  let noMap = false
  for (const row of rows) {
    const match = GEM_ROW.exec(row)
    if (!match) throw new Error(`Malformed GEM row: ${row}`)
    const [, code, approximate, noMapFlag, combination, scenario, choiceList] = match
    if (noMapFlag === '1') {
      noMap = true
    } else if (combination === '0') {
      if (!singles.some((single) => single.code === code)) {
        singles.push({ kind: 'single', code, approximate: approximate === '1' })
      }
    } else {
      const lists = scenarios.get(scenario) ?? new Map<string, string[]>()
      scenarios.set(scenario, lists)
      const list = lists.get(choiceList) ?? []
      lists.set(choiceList, list)
      if (!list.includes(code)) list.push(code)
    }
  }
  const options: Icd9Option[] = [
    ...singles,
    ...[...scenarios.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, lists]): Icd9CombinationTranslation => ({
        kind: 'combination',
        choiceLists: [...lists.entries()]
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, codes]) => codes),
      })),
  ]
  if (options.length === 0) return { kind: 'none', reason: noMap ? 'no-map' : 'not-in-gem' }
  return options.length === 1 ? options[0] : { kind: 'alternatives', options }
}

function dottedIcd9(code: string): string {
  const head = code.startsWith('E') ? 4 : 3
  return code.length > head ? `${code.slice(0, head)}.${code.slice(head)}` : code
}

function describeIcd9(code: string, names: IcdCrosswalk['names']): string {
  return `${dottedIcd9(code)} ${(names[code] ?? '').toUpperCase()}`.trim()
}

function describeCombination(
  combination: Icd9CombinationTranslation,
  names: IcdCrosswalk['names'],
): string {
  return combination.choiceLists
    .map((codes) => codes.length === 1
      ? describeIcd9(codes[0], names)
      : `{${codes.map((code) => describeIcd9(code, names)).join(' | ')}}`)
    .join(' + ')
}

function describeOption(option: Icd9Option, names: IcdCrosswalk['names']): string {
  return option.kind === 'single' ? describeIcd9(option.code, names) : describeCombination(option, names)
}

/** The ICD-9-CM half of one reference row. */
export function describeIcd9Translation(
  translation: Icd9Translation,
  names: IcdCrosswalk['names'],
): string {
  switch (translation.kind) {
    case 'single':
      return `ICD-9-CM SINGLE (${translation.approximate ? 'approximate' : 'exact'}): ${describeIcd9(translation.code, names)}`
    case 'combination':
      return `ICD-9-CM COMBINATION (all parts together): ${describeCombination(translation, names)}`
    case 'alternatives':
      return `ICD-9-CM ALTERNATIVES (at most one): ${translation.options
        .map((option, index) => `option ${index + 1}: ${describeOption(option, names)}`)
        .join('; ')}`
    case 'none':
      return translation.reason === 'no-map'
        ? 'ICD-9-CM NONE (the GEM has no ICD-9-CM translation)'
        : 'ICD-9-CM NONE (code not in the 2018 GEM)'
  }
}

/** Reference block prepended to the clinical context, or '' when no billed code exists. */
export function buildIcdCodeReference(context: string, crosswalk: IcdCrosswalk): string {
  const items = [...extractBilledIcd10Codes(context)]
  if (!items.length) return ''
  const rows = items.map(([code, description], index) => {
    const translation = interpretGemRows(crosswalk.map[code.replace('.', '')])
    return `${index + 1}. billed ICD-10-CM ${code}${description ? ` ${description}` : ''} | ${describeIcd9Translation(translation, crosswalk.names)}`
  })
  return (
    `ICD code reference: ${items.length} distinct billed code(s) in this record. ICD-9-CM codes were translated by software ` +
    'with the CMS 2018 General Equivalence Mapping (GEM); this is a code translation, not a record entry, and billing codes are not confirmed diagnoses. ' +
    'No other ICD code exists in this record.\n' +
    'Row types: SINGLE = one ICD-9-CM code; copy it. ' +
    'ALTERNATIVES = mutually exclusive candidates; use one only if the record states which applies, never several. ' +
    'COMBINATION = the parts joined by + only together translate the one ICD-10-CM code; write every part, and from a {a | b} group the one code the record supports. ' +
    'NONE = no ICD-9-CM code. ' +
    `If the record cannot decide an ALTERNATIVES row or a { } group, keep the ICD-10-CM code and leave the ICD-9-CM code blank, marked ${PENDING_MARK}.\n` +
    rows.join('\n') +
    `\nEnd of ICD code reference (${items.length} code(s)).\n\n`
  )
}
