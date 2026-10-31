/**
 * @jest-environment node
 *
 * AI lab grouping (queryLabResultsByCategory, getHealthSummarySnapshot) must
 * (a) never split rows that carry the same LOINC — whatever their source
 *     label ("Lithium" / "Li") or value representation — and
 * (b) never put an absolute count and a percentage in one group — even when
 *     both carry the same label (「嗜中性白血球 / Neutrophil」 for 751-8 / 770-8)
 *     or no LOINC at all.
 * The differential test checks both properties for every category over the
 * committed demo / e2e bundles and a synthetic corpus.
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import {
  createFhirTools,
  declaredLoincAnalyteKey,
  declaredLoincScale,
  labCategoryAnalyteKey,
  labValueFamily,
} from '@/src/infrastructure/ai/tools/fhir-tools'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { expandObservationValues } from '@/src/core/utils/observation-value.utils'
import { samplePatient, sampleCollection } from './fixtures'

const LOINC = 'http://loinc.org'
const NHI_ORDER = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const NHI_PAYMENT = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const MEDICLOUD_EXTENSION = {
  url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-system',
  valueCodeableConcept: { coding: [{ code: 'nhi-medicloud' }] },
}

const toolsFor = (observations: any[]) => createFhirTools(() => ({
  patient: samplePatient,
  collection: { ...sampleCollection, observations, vitalSigns: [] },
}))

let seq = 0
function lab(
  text: string,
  loinc: string | undefined,
  value: number,
  unit: string,
  options: { date?: string; nhi?: string; medicloud?: boolean; high?: boolean } = {},
) {
  seq += 1
  return {
    resourceType: 'Observation',
    id: `diffgrp-${seq}`,
    status: 'final',
    ...(options.medicloud ? { extension: [MEDICLOUD_EXTENSION] } : {}),
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: {
      text,
      coding: [
        ...(loinc ? [{ system: LOINC, code: loinc }] : []),
        ...(options.nhi ? [{ system: options.nhi, code: '08013C', display: '白血球分類計數' }] : []),
      ],
    },
    valueQuantity: { value, unit },
    ...(options.high ? { interpretation: [{ coding: [{ code: 'H' }] }] } : {}),
    effectiveDateTime: `${options.date ?? '2026-10-01'}T08:00:00+08:00`,
  }
}

const loincOf = (observation: any): string | undefined =>
  (observation?.code?.coding ?? []).find((coding: any) => /loinc/i.test(coding?.system ?? ''))?.code

function unitKind(observation: any): 'count' | 'percent' | null {
  const unit = String(observation?.valueQuantity?.unit ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  if (unit === '%') return 'percent'
  if (/\/(?:u|µ|μ)l$|\/mm3$|\/cumm$|10\^9\/l$/.test(unit)) return 'count'
  return null
}

describe('same LOINC, different source labels', () => {
  it('keeps one history for an unrecognised analyte labelled "Lithium" and "Li" (LOINC 14334-7)', async () => {
    const lithium = [
      lab('Lithium', '14334-7', 0.6, 'mmol/L', { date: '2026-09-01' }),
      lab('Li', '14334-7', 0.8, 'mmol/L', { date: '2026-10-01' }),
    ]
    const category = categorizeObservation(lithium[0])?.id
    expect(category).toBeDefined()
    expect(labCategoryAnalyteKey(lithium[0], category!)).toBe(labCategoryAnalyteKey(lithium[1], category!))
    const result = await (toolsFor(lithium).queryLabResultsByCategory as any).execute({ category, withTrend: true })
    expect(result.analyteCount).toBe(1)
    expect(result.data[0].results.map((item: any) => item.value)).toEqual([0.8, 0.6])
  })

  it('the health summary keeps one latest abnormal row for that analyte', async () => {
    const result = await (toolsFor([
      lab('Lithium', '14334-7', 1.6, 'mmol/L', { date: '2026-09-01', high: true }),
      lab('Li', '14334-7', 1.8, 'mmol/L', { date: '2026-10-01', high: true }),
    ]).getHealthSummarySnapshot as any).execute({})
    const lithiumRows = JSON.stringify(result).match(/"value":1\.[68]/g) ?? []
    expect(lithiumRows).toHaveLength(1)
  })
})

describe('health summary: one LOINC is one analyte whatever the value representation', () => {
  it('a Quantity and a numeric string on 14334-7 keep only the latest abnormal row', async () => {
    const older = lab('Lithium', '14334-7', 1.6, 'mmol/L', { date: '2026-09-01', high: true })
    const newer = { ...lab('Li', '14334-7', 0, '', { date: '2026-10-01', high: true }), valueQuantity: undefined, valueString: '1.9' }
    const result = await (toolsFor([older, newer]).getHealthSummarySnapshot as any).execute({})
    expect(result.counts.abnormalLabs).toBe(1)
  })
})

describe('count and percentage under one label', () => {
  it('the health summary reports an abnormal ANC and an abnormal NEU% as two analytes', async () => {
    const result = await (toolsFor([
      lab('嗜中性白血球', undefined, 9100, '/uL', { nhi: NHI_PAYMENT, medicloud: true, high: true }),
      lab('嗜中性白血球', undefined, 82, '%', { nhi: NHI_PAYMENT, medicloud: true, high: true }),
    ]).getHealthSummarySnapshot as any).execute({})
    const text = JSON.stringify(result)
    expect(text).toContain('9100')
    expect(text).toContain('82')
  })
})

describe('numbers written as text keep their percent / count family', () => {
  const asText = (text: string, value: string, nhi?: string) =>
    ({ ...lab(text, undefined, 0, '', nhi ? { nhi } : {}), valueQuantity: undefined, valueString: value })

  it.each([['62%'], ['62 %'], ['62％'], ['62 percent'], ['< 1 %'], ['60-65%']])('valueString %s is a percentage', (value) => {
    expect(labValueFamily(asText('Neutrophil', value))).toBe('percent')
  })

  it.each([['3100 /uL'], ['3.1 x10^9/L'], ['62'], ['2 /HPF']])('valueString %s is a quantity', (value) => {
    expect(labValueFamily(asText('Neutrophil', value))).toBe('quantity')
  })

  it('a Quantity unit or UCUM code of % (any width) is a percentage', () => {
    expect(labValueFamily(lab('Neutrophil', undefined, 62, '％'))).toBe('percent')
    expect(labValueFamily({ ...lab('Neutrophil', undefined, 62, 'percent'), valueQuantity: { value: 62, unit: 'percent', code: '%' } })).toBe('percent')
  })

  it('NEU% as "62%" text and as 62 % Quantity are one percent group; a count stays apart', () => {
    const percentText = asText('嗜中性白血球', '62%', NHI_ORDER)
    const percentQuantity = lab('嗜中性白血球', undefined, 61, '%', { nhi: NHI_ORDER })
    const countText = asText('嗜中性白血球', '3100 /uL', NHI_ORDER)
    const countQuantity = lab('嗜中性白血球', undefined, 2900, '/uL', { nhi: NHI_ORDER })
    const key = (observation: any) => labCategoryAnalyteKey(observation, 'cbc')
    expect(key(percentText)).toBe(key(percentQuantity))
    expect(key(countText)).not.toBe(key(percentText))
    expect(key(countText)).toBe(key(countQuantity))
    expect(key(countQuantity)).not.toBe(key(percentQuantity))
  })

  it('the category tool returns the text and Quantity percentages as one series', async () => {
    const result = await (toolsFor([
      { ...asText('嗜中性白血球', '62%', NHI_ORDER), effectiveDateTime: '2026-10-02T08:00:00+08:00' },
      lab('嗜中性白血球', undefined, 61, '%', { nhi: NHI_ORDER, date: '2026-10-01' }),
      lab('嗜中性白血球', undefined, 2900, '/uL', { nhi: NHI_ORDER, date: '2026-10-01' }),
      { ...asText('嗜中性白血球', '3100 /uL', NHI_ORDER), effectiveDateTime: '2026-10-02T08:00:00+08:00' },
    ]).queryLabResultsByCategory as any).execute({ category: 'cbc', withTrend: true })
    const sizes = result.data.map((group: any) => group.observationCount).sort()
    expect(sizes).toEqual([2, 2])
  })
})

// ── Differential corpus ────────────────────────────────────────────────────
const SYNTHETIC: any[] = [
  // Same LOINC, different labels.
  lab('Lithium', '14334-7', 0.6, 'mmol/L'), lab('Li', '14334-7', 0.8, 'mmol/L'),
  lab('嗜中性白血球 / Neutrophil', '770-8', 55, '%'), lab('Seg', '770-8', 60, '%'), lab('Neutrophils %', '770-8', 58, '%'),
  lab('嗜中性白血球 / Neutrophil', '751-8', 3.2, '10^3/uL'), lab('ANC', '751-8', 3100, '/uL'),
  lab('Eosinophil', '711-2', 150, '/uL'), lab('Eos count', '711-2', 0.2, '10^3/uL'),
  // Different LOINC, same label — count vs percentage.
  ...([
    ['嗜中性白血球 / Neutrophil', '751-8', '770-8'],
    ['淋巴球 / Lymphocyte', '731-0', '736-9'],
    ['單核球 / Monocyte', '742-7', '5905-5'],
    ['嗜伊紅性白血球 / Eosinophil', '711-2', '713-8'],
    ['嗜鹼性白血球 / Basophil', '704-7', '706-2'],
    ['Band form', '26507-4', '764-1'],
  ] as const).flatMap(([text, count, percent]) => [
    lab(text, count, 3, '10^3/uL', { nhi: NHI_ORDER }), lab(text, percent, 40, '%', { nhi: NHI_ORDER }),
  ]),
  // No LOINC: NHI 08013C rows, MediCloud rows and plain names, count vs %.
  ...['嗜中性白血球', '淋巴球', '單核球', '嗜伊紅性白血球', 'Neutrophil', 'Segment', 'Lymphocyte', 'Monocyte', 'Eosinophil', 'Basophil', 'Band', 'Blast', 'NRBC']
    .flatMap((text) => [
      lab(text, undefined, 2900, '/uL', { nhi: NHI_ORDER }), lab(text, undefined, 61, '%', { nhi: NHI_ORDER }),
      lab(text, undefined, 2.9, 'x10^9/L', { nhi: NHI_PAYMENT, medicloud: true }), lab(text, undefined, 62, '%', { nhi: NHI_PAYMENT, medicloud: true }),
    ]),
  lab('ANC', undefined, 3100, '/uL', { nhi: NHI_PAYMENT, medicloud: true }), lab('ANC', undefined, 60, '%'),
  // Reticulocytes, count vs %.
  lab('Reticulocyte', '14196-0', 60, '10^3/uL'), lab('Reticulocyte', '17849-1', 1.2, '%'),
  lab('Retic', undefined, 55, '10^3/uL'), lab('Retic', undefined, 1.1, '%'),
]

function bundleObservations(): Array<{ source: string; observation: any }> {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((file) => file.endsWith('.json'))
  const out: Array<{ source: string; observation: any }> = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('"Observation"')) continue
    let json: any
    try { json = JSON.parse(text) } catch { continue }
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.resourceType === 'Observation') out.push({ source: file, observation: node })
      for (const value of Object.values(node)) walk(value)
    }
    walk(json)
  }
  return out
}

// One LOINC, many representations: a Quantity with or without a unit, an
// Integer, a Range, a number written as text. The LOINC already fixes what
// was measured, so each LOINC is one group — and 751-8 (count) never joins
// 770-8 (percentage).
function representations(text: string, loinc: string, quantity: { value: number; unit?: string }) {
  const base = lab(text, loinc, quantity.value, quantity.unit ?? '')
  const withoutUnit = { ...lab(text, loinc, quantity.value, ''), valueQuantity: { value: quantity.value } }
  const asInteger = { ...lab(text, loinc, 0, ''), valueQuantity: undefined, valueInteger: Math.round(quantity.value) }
  const asRange = { ...lab(text, loinc, 0, ''), valueQuantity: undefined, valueRange: { low: { value: quantity.value }, high: { value: quantity.value + 1 } } }
  const asText = { ...lab(text, loinc, 0, ''), valueQuantity: undefined, valueString: String(quantity.value) }
  const asComparatorText = { ...lab(text, loinc, 0, ''), valueQuantity: undefined, valueString: `< ${quantity.value}` }
  return [base, withoutUnit, asInteger, asRange, asText, asComparatorText]
}

const SAME_LOINC: any[] = [
  ...representations('嗜中性白血球 / Neutrophil', '751-8', { value: 3.2, unit: '10^3/uL' }),
  ...representations('ANC', '751-8', { value: 3100, unit: '/uL' }),
  ...representations('嗜中性白血球 / Neutrophil', '770-8', { value: 55, unit: '%' }),
  ...representations('Seg', '770-8', { value: 61, unit: '%' }),
  ...representations('淋巴球 / Lymphocyte', '731-0', { value: 1.9, unit: 'x10^9/L' }),
  ...representations('淋巴球 / Lymphocyte', '736-9', { value: 33, unit: '%' }),
  ...representations('Lithium', '14334-7', { value: 0.6, unit: 'mmol/L' }),
  ...representations('Li', '14334-7', { value: 0.8, unit: 'mmol/L' }),
]

describe('differential: demo / e2e bundles + synthetic corpora', () => {
  const corpora: Array<[string, Array<{ source: string; observation: any }>]> = [
    ['committed bundles', bundleObservations()],
    ['synthetic corpus', SYNTHETIC.map((observation) => ({ source: 'synthetic', observation }))],
    ['same-LOINC corpus', SAME_LOINC.map((observation) => ({ source: 'same-loinc', observation }))],
  ]

  it.each(corpora)('%s: one group per LOINC; LOINC-less groups hold one value family; multi-LOINC groups are declared + same scale; count and %% never merge', (_name, rows) => {
    expect(rows.length).toBeGreaterThan(0)
    const groups = new Map<string, any[]>()
    const keysByLoinc = new Map<string, Set<string>>()
    for (const { source, observation: raw } of rows) {
      for (const observation of expandObservationValues(raw)) {
        const category = categorizeObservation(observation)?.id
        if (!category) continue
        const key = `${source}|${category}|${labCategoryAnalyteKey(observation, category)}`
        groups.set(key, [...(groups.get(key) ?? []), observation])
        const loinc = loincOf(observation)
        if (loinc) {
          const scope = `${source}|${category}|${loinc}`
          keysByLoinc.set(scope, new Set([...(keysByLoinc.get(scope) ?? []), key]))
        }
      }
    }

    // One group per LOINC, whatever the label or value representation.
    expect([...keysByLoinc.entries()].filter(([, keys]) => keys.size > 1)).toEqual([])

    for (const [key, members] of groups) {
      const loincs = new Set(members.map(loincOf))
      if (loincs.has(undefined)) {
        // A LOINC-less group never mixes in a coded row and holds one value family.
        expect({ key, loincs: loincs.size }).toEqual({ key, loincs: 1 })
        expect({ key, families: [...new Set(members.map(labValueFamily))] })
          .toEqual({ key, families: [labValueFamily(members[0])] })
      } else if (loincs.size > 1) {
        // Several LOINCs share a group only on one declared key with one known scale.
        const declared = new Set([...loincs].map((loinc) => declaredLoincAnalyteKey(loinc!)))
        const scales = new Set([...loincs].map((loinc) => declaredLoincScale(loinc!)))
        expect({ key, declared: declared.size, scales: [...scales] }).toEqual({ key, declared: 1, scales: [expect.any(String)] })
        expect([...declared][0]).not.toBeNull()
      }
    }

    // No group holds both a count unit and a percentage.
    const mixed = [...groups.entries()]
      .filter(([, members]) => new Set(members.map(unitKind).filter(Boolean)).size > 1)
      .map(([key, members]) => `${key}: ${members.map((m) => `${m.code.text} ${m.valueQuantity?.unit}`).join(', ')}`)
    expect(mixed).toEqual([])
  })

  it('the count and percentage LOINCs of one cell line stay in different groups', () => {
    for (const [count, percent] of [['751-8', '770-8'], ['731-0', '736-9'], ['742-7', '5905-5'], ['711-2', '713-8'], ['704-7', '706-2'], ['26507-4', '764-1'], ['14196-0', '17849-1']]) {
      const countRow = lab('Same label', count, 3, '10^3/uL')
      const percentRow = lab('Same label', percent, 30, '%')
      expect(labCategoryAnalyteKey(countRow, 'cbc')).not.toBe(labCategoryAnalyteKey(percentRow, 'cbc'))
    }
  })

  it('count LOINCs of one cell line (automated / manual / unspecified) share one group', () => {
    const keys = ['751-8', '753-4', '26499-4'].map((loinc) => labCategoryAnalyteKey(lab('Neutrophil', loinc, 3, '10^3/uL'), 'cbc'))
    expect(new Set(keys).size).toBe(1)
  })
})
