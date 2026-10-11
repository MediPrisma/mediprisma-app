// A white-cell differential is reported two ways: as an absolute count
// (#/volume — LOINC property NCnc, units /µL, 10^3/µL, x10^9/L) and as a share
// of all leukocytes (LOINC property NFr, unit %). Both arrive with the same
// source label, e.g. 「嗜中性白血球 / Neutrophil」, so the name alone put
// 3.2 (10^3/µL) beside 55 (%) in one NEU column and drew a trend through them.
// The count goes to the absolute-count column (ANC, ALC, …); the percentage
// stays in NEU, LYM, …. LOINC property decides first, then the unit family.
import {
  buildLabPivots,
  countFractionAwareKey,
  getLabPivotTestIdentity,
} from '@/src/shared/utils/lab-pivot.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'

const LOINC = 'http://loinc.org'
const UCUM = 'http://unitsofmeasure.org'
const NHI_ORDER = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const NHI_PAYMENT = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const MEDICLOUD_EXTENSION = {
  url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-system',
  valueCodeableConcept: { coding: [{ code: 'nhi-medicloud' }] },
}

interface ObsInput {
  text: string
  value: number
  unit?: string
  ucum?: string
  loinc?: string
  nhi?: { system: string; code: string; display?: string }
  medicloud?: boolean
  date?: string
  id?: string
}

function obs(input: ObsInput): any {
  return {
    resourceType: 'Observation',
    id: input.id,
    status: 'final',
    ...(input.medicloud ? { extension: [MEDICLOUD_EXTENSION] } : {}),
    code: {
      text: input.text,
      coding: [
        ...(input.loinc ? [{ system: LOINC, code: input.loinc }] : []),
        ...(input.nhi ? [input.nhi] : []),
      ],
    },
    valueQuantity: {
      value: input.value,
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.ucum ? { code: input.ucum, system: UCUM } : {}),
    },
    effectiveDateTime: input.date ?? '2026-09-01',
  }
}

function keyOf(observation: any): string {
  return getLabPivotTestIdentity(observation, categorizeObservation(observation)?.id).testKey
}

const DIFF_08013C = { system: NHI_ORDER, code: '08013C', display: '白血球分類計數' }
const DIFF_08013C_PAYMENT = { system: NHI_PAYMENT, code: '08013C', display: '白血球分類計數' }

describe('differential identity — LOINC property decides first', () => {
  it.each([
    // [LOINC, expected key] — property verified at tx.fhir.org (LOINC 2.82)
    ['751-8', 'ANC'], ['753-4', 'ANC'], ['26499-4', 'ANC'], ['768-2', 'ANC'], ['30451-9', 'ANC'],
    ['770-8', 'NEU'], ['23761-0', 'NEU'], ['26511-6', 'NEU'], ['769-0', 'NEU'],
    ['731-0', 'ALC'], ['732-8', 'ALC'], ['26474-7', 'ALC'],
    ['736-9', 'LYM'], ['737-7', 'LYM'], ['26478-8', 'LYM'],
    ['742-7', 'AMC'], ['743-5', 'AMC'], ['26484-6', 'AMC'],
    ['5905-5', 'MONO'], ['744-3', 'MONO'], ['26485-3', 'MONO'],
    ['711-2', 'AEC'], ['712-0', 'AEC'], ['26449-9', 'AEC'],
    ['713-8', 'EOS'], ['714-6', 'EOS'], ['26450-7', 'EOS'],
    ['704-7', 'ABC'], ['705-4', 'ABC'], ['26444-0', 'ABC'],
    ['706-2', 'BASO'], ['707-0', 'BASO'], ['30180-4', 'BASO'],
    ['763-3', 'BAND-ABS'], ['26507-4', 'BAND-ABS'],
    ['764-1', 'BAND'], ['26508-2', 'BAND'], ['35332-6', 'BAND'],
    ['30376-8', 'BLAST-ABS'], ['709-6', 'BLAST'],
    ['771-6', 'NORMOBLAST-ABS'],
    ['14196-0', 'ARC'], ['60474-4', 'ARC'],
    ['17849-1', 'RETIC'], ['4679-7', 'RETIC'],
  ])('LOINC %s → %s whatever the shared source label says', (loinc, expected) => {
    // A generic bilingual label that names only the cell line. The unit is
    // deliberately left out so only the LOINC can decide.
    const observation = obs({ text: '嗜中性白血球 / Neutrophil', value: 1, loinc })
    expect(getLabPivotTestIdentity(observation, 'cbc').testKey).toBe(expected)
  })

  it('splits the reported 751-8 / 770-8 pair that shares 「嗜中性白血球 / Neutrophil」', () => {
    const count = obs({ text: '嗜中性白血球 / Neutrophil', value: 3.2, unit: '10^3/uL', loinc: '751-8', nhi: DIFF_08013C })
    const percent = obs({ text: '嗜中性白血球 / Neutrophil', value: 55, unit: '%', loinc: '770-8', nhi: DIFF_08013C })
    expect(keyOf(count)).toBe('ANC')
    expect(keyOf(percent)).toBe('NEU')
    expect(getLabPivotTestIdentity(count, 'cbc').displayName).toBe('ANC')
  })

  it('a LOINC property outranks a contradicting unit (the source label is not re-guessed)', () => {
    // NFr LOINC with a count unit: LOINC wins, the bad unit stays visible in the cell.
    expect(keyOf(obs({ text: 'Neutrophil', value: 3200, unit: '/uL', loinc: '770-8' }))).toBe('NEU')
    expect(keyOf(obs({ text: 'Neutrophil', value: 55, unit: '%', loinc: '751-8' }))).toBe('ANC')
  })
})

describe('differential identity — unit family when no LOINC decides', () => {
  it.each([
    ['/uL'], ['/µL'], ['/μL'], ['10^3/uL'], ['x10^3/uL'], ['10*3/uL'], ['K/uL'], ['1000/uL'],
    ['x10^9/L'], ['10^9/L'], ['10*9/L'], ['/mm3'], ['/cumm'], ['cells/uL'], ['10³/µL'],
  ])('「嗜中性白血球 / Neutrophil」 in %s → ANC', (unit) => {
    expect(getLabPivotTestIdentity(obs({ text: '嗜中性白血球 / Neutrophil', value: 3, unit }), 'cbc').testKey).toBe('ANC')
  })

  it.each([['%'], ['％']])('「嗜中性白血球 / Neutrophil」 in %s stays NEU', (unit) => {
    expect(getLabPivotTestIdentity(obs({ text: '嗜中性白血球 / Neutrophil', value: 55, unit }), 'cbc').testKey).toBe('NEU')
  })

  it.each([
    ['Neutrophil', 'ANC', 'NEU'],
    ['Segment', 'ANC', 'NEU'],
    ['Seg.', 'ANC', 'NEU'],
    ['淋巴球 / Lymphocyte', 'ALC', 'LYM'],
    ['Lymphocyte', 'ALC', 'LYM'],
    ['單核球', 'AMC', 'MONO'],
    ['Monocyte', 'AMC', 'MONO'],
    ['嗜伊紅性白血球', 'AEC', 'EOS'],
    ['Eosinophil', 'AEC', 'EOS'],
    ['嗜鹼性白血球 / Basophil', 'ABC', 'BASO'],
    ['Basophil', 'ABC', 'BASO'],
    ['Band form', 'BAND-ABS', 'BAND'],
    ['Blast', 'BLAST-ABS', 'BLAST'],
    ['NRBC', 'NORMOBLAST-ABS', 'NORMOBLAST'],
    ['Retic', 'ARC', 'RETIC'],
  ])('%s: count → %s, percent → %s', (text, countKey, percentKey) => {
    expect(getLabPivotTestIdentity(obs({ text, value: 3, unit: '10^3/uL' }), 'cbc').testKey).toBe(countKey)
    expect(getLabPivotTestIdentity(obs({ text, value: 30, unit: '%' }), 'cbc').testKey).toBe(percentKey)
  })

  it('reads the UCUM code when the display unit is a local spelling', () => {
    expect(keyOf(obs({ text: 'Neutrophil', value: 3.1, unit: 'K/cumm', ucum: '10*3/uL' }))).toBe('ANC')
    expect(keyOf(obs({ text: 'Neutrophil', value: 61, unit: 'percent', ucum: '%' }))).toBe('NEU')
  })

  it('a number written as text keeps its unit family ("3100 /uL" → ANC, "62%" → NEU)', () => {
    const text = (value: string) => ({ ...obs({ text: 'Neutrophil', value: 0 }), valueQuantity: undefined, valueString: value })
    expect(keyOf(text('3100 /uL'))).toBe('ANC')
    expect(keyOf(text('3.1 x10^9/L'))).toBe('ANC')
    expect(keyOf(text('62%'))).toBe('NEU')
    expect(keyOf(text('62 ％'))).toBe('NEU')
    expect(keyOf(text('62'))).toBe('NEU')
    expect(keyOf(text('see smear'))).toBe('NEU')
  })

  it('an ANC row reported in % is a percentage, never in the count column', () => {
    expect(keyOf(obs({ text: 'ANC', value: 61, unit: '%' }))).toBe('NEU')
    expect(keyOf(obs({ text: 'ANC', value: 3141, unit: '/uL' }))).toBe('ANC')
  })

  it('the UCUM code decides when present, as the AI value family reads it', () => {
    // unit text that is not '%' but code '%' → percentage
    for (const unit of ['pct', 'percent', 'per cent', '百分比', 'PCT', 'whatever']) {
      expect(keyOf(obs({ text: 'Neutrophil', value: 61, unit, ucum: '%' }))).toBe('NEU')
    }
    // a count code wins over a % unit text
    expect(keyOf(obs({ text: 'Neutrophil', value: 3.1, unit: '%', ucum: '10*3/uL' }))).toBe('ANC')
    expect(keyOf(obs({ text: 'Neutrophil', value: 3.1, unit: 'pct', ucum: '10*3/uL' }))).toBe('ANC')
    expect(keyOf(obs({ text: 'Lymphocyte', value: 1900, unit: 'cells', ucum: '/uL' }))).toBe('ALC')
    // without a code the unit text decides, in the AI's spellings
    for (const unit of ['pct', 'per cent', '百分比', 'Percent']) {
      expect(keyOf(obs({ text: 'Neutrophil', value: 61, unit }))).toBe('NEU')
      expect(keyOf(obs({ text: 'ANC', value: 61, unit }))).toBe('NEU')
    }
    // a non-UCUM code system does not decide
    const local = obs({ text: 'Neutrophil', value: 3.1, unit: '10^3/uL' })
    local.valueQuantity = { value: 3.1, unit: '10^3/uL', code: '%', system: 'http://example.org/local-units' }
    expect(keyOf(local)).toBe('ANC')
    // text values take the same spellings after the number
    const text = (value: string) => ({ ...obs({ text: 'ANC', value: 0 }), valueQuantity: undefined, valueString: value })
    expect(keyOf(text('61 pct'))).toBe('NEU')
    expect(keyOf(text('61 per cent'))).toBe('NEU')
  })

  it('leaves the key alone when the unit says neither (missing, /100 WBC, /HPF)', () => {
    expect(keyOf(obs({ text: 'Neutrophil', value: 55 }))).toBe('NEU')
    expect(keyOf(obs({ text: 'NRBC', value: 2, unit: '/100 WBC' }))).toBe('NORMOBLAST')
    expect(keyOf(obs({ text: 'WBC', value: 5600, unit: '/uL' }))).toBe('WBC')
  })

  it('NHI 08013C rows (order-code and payment-code systems) split the same way', () => {
    for (const nhi of [DIFF_08013C, DIFF_08013C_PAYMENT]) {
      expect(keyOf(obs({ text: '嗜中性白血球', value: 3100, unit: '/uL', nhi }))).toBe('ANC')
      expect(keyOf(obs({ text: '嗜中性白血球', value: 55, unit: '%', nhi }))).toBe('NEU')
      expect(keyOf(obs({ text: '淋巴球', value: 1.8, unit: '10^3/uL', nhi }))).toBe('ALC')
      expect(keyOf(obs({ text: '淋巴球', value: 30, unit: '%', nhi }))).toBe('LYM')
    }
  })

  it('MediCloud rows split the same way', () => {
    const count = obs({ text: '嗜中性白血球', value: 3100, unit: '/uL', nhi: DIFF_08013C_PAYMENT, medicloud: true })
    const percent = obs({ text: '嗜中性白血球', value: 55, unit: '%', nhi: DIFF_08013C_PAYMENT, medicloud: true })
    const anc = obs({ text: 'ANC', value: 2900, unit: '/uL', nhi: DIFF_08013C_PAYMENT, medicloud: true })
    expect([keyOf(count), keyOf(percent), keyOf(anc)]).toEqual(['ANC', 'NEU', 'ANC'])
  })

  it('the shared helper gives callers that start from another key the same answer', () => {
    expect(countFractionAwareKey(obs({ text: 'Eosinophil', value: 300, unit: '/uL', loinc: '711-2' }), 'EOS')).toBe('AEC')
    expect(countFractionAwareKey(obs({ text: 'Reticulocyte', value: 60, unit: '10^3/uL', loinc: '14196-0' }), 'RETIC')).toBe('ARC')
    expect(countFractionAwareKey(obs({ text: 'Retic', value: 1.2, unit: '%' }), 'RETIC')).toBe('RETIC')
    expect(countFractionAwareKey(obs({ text: 'Creatinine', value: 1, unit: 'mg/dL' }), 'CREA')).toBe('CREA')
  })
})

describe('cumulative pivot — counts and percentages never share a column', () => {
  const day1 = '2026-09-01'
  const day2 = '2026-09-08'
  const rows = [
    obs({ id: 'n-c-1', text: '嗜中性白血球 / Neutrophil', value: 3.2, unit: '10^3/uL', loinc: '751-8', nhi: DIFF_08013C, date: day1 }),
    obs({ id: 'n-p-1', text: '嗜中性白血球 / Neutrophil', value: 55, unit: '%', loinc: '770-8', nhi: DIFF_08013C, date: day1 }),
    obs({ id: 'n-c-2', text: '嗜中性白血球', value: 2900, unit: '/uL', nhi: DIFF_08013C_PAYMENT, medicloud: true, date: day2 }),
    obs({ id: 'n-p-2', text: '嗜中性白血球', value: 61, unit: '%', nhi: DIFF_08013C_PAYMENT, medicloud: true, date: day2 }),
    obs({ id: 'l-c-1', text: 'Lymphocyte', value: 1.9, unit: 'x10^9/L', date: day1 }),
    obs({ id: 'l-p-1', text: 'Lymphocyte', value: 33, unit: '%', date: day1 }),
    obs({ id: 'e-c-1', text: 'Eosinophil', value: 150, unit: '/uL', loinc: '711-2', date: day1 }),
    obs({ id: 'e-p-1', text: 'Eosinophil', value: 2, unit: '%', loinc: '713-8', date: day1 }),
  ]

  it('builds separate ANC / NEU, ALC / LYM, AEC / EOS rows with one value each per day', () => {
    const cbc = buildLabPivots(rows).cbc
    const byKey = new Map(cbc.rows.map((row) => [row.testKey, row]))
    expect(byKey.get('NEU')?.values.get(day1)?.value).toBe('55')
    expect(byKey.get('NEU')?.values.get(day2)?.value).toBe('61')
    expect(byKey.get('NEU')?.unit).toBe('%')
    expect(byKey.get('ANC')?.values.get(day1)?.value).toBe('3.2')
    expect(byKey.get('ANC')?.values.get(day2)?.value).toBe('2900')
    expect(byKey.get('LYM')?.values.get(day1)?.value).toBe('33')
    expect(byKey.get('ALC')?.values.get(day1)?.value).toBe('1.9')
    expect(byKey.get('EOS')?.values.get(day1)?.value).toBe('2')
    expect(byKey.get('AEC')?.values.get(day1)?.value).toBe('150')
    for (const row of cbc.rows) {
      for (const cell of row.values.values()) expect(cell.allValues).toBeUndefined()
    }
    // Absolute counts read after the percentage differential.
    const order = cbc.rows.map((row) => row.testKey)
    expect(order.indexOf('ANC')).toBeGreaterThan(order.indexOf('BASO'))
    expect(order.indexOf('ALC')).toBeGreaterThan(order.indexOf('ANC'))
  })

  it('original-name mode keeps the count apart from the percentage under the same source label', () => {
    const cbc = buildLabPivots(rows.slice(0, 2), { nameMode: 'original' }).cbc
    const neutrophilRows = cbc.rows.filter((row) => row.displayName === '嗜中性白血球 / Neutrophil')
    expect(neutrophilRows).toHaveLength(2)
    expect(neutrophilRows.map((row) => row.unit).sort()).toEqual(['%', '10^3/uL'])
  })

  it('the trend series for NEU contains only percentages', () => {
    const series = buildLabTrendSeries(rows, { categoryId: 'cbc', mapKey: 'NEU', testKey: 'NEU', displayName: 'NEU', nameMode: 'standardized' })
    expect(series.points.map((point: any) => point.value).sort((a: number, b: number) => a - b)).toEqual([55, 61])
  })
})
