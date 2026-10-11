/**
 * @jest-environment node
 *
 * Table-driven sweep of labValueFamily over the value shapes hospitals print,
 * and of the AI group label: a number is a quantity however it is signed,
 * grouped, written in full-width or followed by its unit; a percent unit
 * makes it a percentage; the family never depends on whether the same value
 * arrived as a string, a Quantity, a Range, an integer or a decimal; and a
 * group's label holds for every member.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  createFhirTools,
  labCategoryAnalyte,
  labGroupLabel,
  labValueFamily,
} from '@/src/infrastructure/ai/tools/fhir-tools'
import { LAB_CATEGORIES, categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { expandObservationValues } from '@/src/core/utils/observation-value.utils'
import { samplePatient, sampleCollection } from './fixtures'

const fullWidth = (s: string) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))

const SIGNS: Array<[string, number]> = [['', 1], ['+', 1], ['-', -1], ['＋', 1], ['−', -1], ['－', -1], ['‒', -1]]
const BODIES: Array<[string, number]> = [
  ['3.2', 3.2], ['3', 3], ['.5', 0.5], ['0.5', 0.5], ['1,234', 1234], ['1,234.5', 1234.5], ['12,345,678', 12345678],
  ['1.2e3', 1200], ['1.2E-3', 0.0012], ['３.２', 3.2],
]
const COMPARATORS = ['', '<', '>', '≤', '≥', '<=', '>=', '< ', '≦', '≧ ']
const UNITS = ['', ' mmol/L', 'mmol/L', ' /HPF', ' x10^3/uL', ' mg/dL (H)']
const PERCENTS = ['%', ' %', '％', ' percent', ' Percent']
const RANGE_SEPARATORS = ['-', ' - ', '~', ' ~ ', '–', '—', ' to ', ' TO ']

type Case = { value: string; family: string; equivalent?: Record<string, any> }

const CASES: Case[] = []
for (const [sign, s] of SIGNS) {
  for (const [body, n] of BODIES) {
    for (const comparator of COMPARATORS) {
      for (const unit of UNITS) {
        CASES.push({
          value: `${comparator}${sign}${body}${unit}`, family: 'quantity',
          equivalent: { valueQuantity: { value: s * n, unit: unit.replace(/\(H\)/, '').trim() } },
        })
      }
      for (const unit of PERCENTS) {
        CASES.push({
          value: `${comparator}${sign}${body}${unit}`, family: 'percent',
          equivalent: { valueQuantity: { value: s * n, unit: '%' } },
        })
      }
    }
  }
}
for (const separator of RANGE_SEPARATORS) {
  for (const [low, high] of [['0', '5'], ['0.25', '1.75'], ['1,000', '2,000'], ['-1', '+1'], ['.5', '2']]) {
    for (const unit of UNITS) {
      CASES.push({
        value: `${low}${separator}${high}${unit}`, family: 'quantity',
        equivalent: { valueRange: { low: { value: 0, unit: unit.trim() }, high: { value: 1, unit: unit.trim() } } },
      })
    }
    for (const unit of PERCENTS) {
      CASES.push({
        value: `${low}${separator}${high}${unit}`, family: 'percent',
        equivalent: { valueRange: { low: { value: 0, unit: '%' }, high: { value: 1, unit: '%' } } },
      })
    }
  }
}
for (const value of ['1:80', '1：80', '<1:40', '< 1:40', '≥1:320', '1:160 speckled', '1:1280 (homogeneous)', fullWidth('1:80')]) {
  CASES.push({ value, family: 'titer', equivalent: { valueRatio: { numerator: { value: 1 }, denominator: { value: 80 } } } })
}
for (const value of [
  'Negative', 'NEG', 'negative for HBsAg', 'Not detected by PCR', 'Positive (1:80)', 'Weakly positive', '陰性', '弱陽性',
  '(-)', '(+)', '±', '+', '-', '2+', '+++', 'Trace', 'Non-reactive', 'Reactive', 'Borderline', fullWidth('NEG'),
]) {
  CASES.push({ value, family: 'ordinal', equivalent: { valueCodeableConcept: { text: value } } })
}
for (const value of ['see report', 'Speckled pattern', 'Normal flora', 'Hemolyzed', 'pending', 'N/A', 'Rare', 'Few RBC seen', '—', 'Comment: repeat']) {
  CASES.push({ value, family: 'text' })
}
for (const value of [3, -3, 0]) CASES.push({ value: String(value), family: 'quantity', equivalent: { valueInteger: value } })
for (const value of [3.2, -0.5, 0.0012]) CASES.push({ value: String(value), family: 'quantity', equivalent: { valueDecimal: value } })

describe('labValueFamily sweep', () => {
  it(`classifies ${CASES.length} printed values by their intended family`, () => {
    const failures = CASES
      .filter(({ value, family }) => labValueFamily({ valueString: value }) !== family)
      .map(({ value, family }) => `${JSON.stringify(value)}: ${labValueFamily({ valueString: value })} ≠ ${family}`)
    expect(failures.slice(0, 40)).toEqual([])
    expect(failures.length).toBe(0)
  })

  it('gives a string and its structured equivalent the same family', () => {
    const failures = CASES
      .filter((c) => c.equivalent)
      .filter(({ value, equivalent }) => labValueFamily({ valueString: value }) !== labValueFamily(equivalent))
      .map(({ value, equivalent }) => `${JSON.stringify(value)}: ${labValueFamily({ valueString: value })} vs ${JSON.stringify(equivalent)}: ${labValueFamily(equivalent)}`)
    expect(failures.slice(0, 40)).toEqual([])
    expect(failures.length).toBe(0)
  })

  it('keeps a LOINC-less base excess history crossing zero in one group', async () => {
    const values = ['-3.2', '+1.1', '0.25', '−2.0', '－0.75', '-.5', '+3.2 mmol/L']
    const observations = values.map((value, i) => ({
      resourceType: 'Observation', id: `be-${i}`, status: 'final',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'BE' },
      valueString: value,
      effectiveDateTime: `2026-0${i + 1}-01T08:00:00+08:00`,
    }))
    const tools = createFhirTools(() => ({ patient: samplePatient, collection: { ...sampleCollection, observations, vitalSigns: [] } }))
    const category = categorizeObservation(observations[0])?.id ?? 'other'
    const result = await (tools.queryLabResultsByCategory as any).execute({ category, withTrend: true })
    expect(result.analyteCount).toBe(1)
    expect(result.data[0].observationCount).toBe(values.length)
  })
})

describe('group labels hold for every member', () => {
  const lab = (text: string, loinc: string, value: number, date: string) => ({
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: { text, coding: [{ system: 'http://loinc.org', code: loinc }] },
    valueQuantity: { value, unit: 'mg/dL' },
    effectiveDateTime: `${date}T08:00:00+08:00`,
  })

  it('labels older "AC Sugar" + newer generic "Glucose" (both 2345-7) generically', async () => {
    const observations = [lab('AC Sugar', '2345-7', 98, '2026-01-01'), lab('Glucose', '2345-7', 160, '2026-06-01')]
    const tools = createFhirTools(() => ({ patient: samplePatient, collection: { ...sampleCollection, observations, vitalSigns: [] } }))
    const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'glucose' })
    expect(result.analyteCount).toBe(1)
    expect(result.data[0].analyte).not.toMatch(/AC|fasting|飯前/i)
    expect(result.data[0].results[0].value).toBe(160)
  })

  const ROOT = process.cwd()
  const bundles = [
    'public/demo/demo-bundle.json',
    ...readdirSync(join(ROOT, 'public/demo/hfrEF')).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
      .map((f) => `public/demo/hfrEF/${f}`),
    'e2e/fixtures/hospital-cdss-bundle.json',
    'e2e/fixtures/medcloud-hepatitis-bundle.json',
    'e2e/fixtures/synthetic-bundle.json',
  ]
  it.each(bundles)('%s', (path) => {
    const bundle = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
    const observations = (bundle.entry ?? []).map((e: any) => e.resource).filter((r: any) => r?.resourceType === 'Observation')
    const failures: string[] = []
    for (const category of LAB_CATEGORIES.map((c) => c.id)) {
      const groups = new Map<string, any[]>()
      for (const o of observations.flatMap((x: any) => expandObservationValues(x))) {
        if (categorizeObservation(o)?.id !== category) continue
        const { key } = labCategoryAnalyte(o, category)
        groups.set(key, [...(groups.get(key) ?? []), o])
      }
      for (const members of groups.values()) {
        if (members.length < 2) continue
        const label = labGroupLabel(members, category)
        const own = members.map((o) => ({
          label: labCategoryAnalyte(o, category).label,
          testKey: getLabPivotTestIdentity(o, category).testKey,
        }))
        if (new Set(own.map((m) => m.label)).size === 1) {
          if (label !== own[0].label) failures.push(`${category}: ${label} ≠ shared ${own[0].label}`)
          continue
        }
        // Members disagree: the label may not be one that only some carry
        // because of their own subtype.
        const canonicalKey = labCategoryAnalyte(members[0], category).canonicalKey
        const subtypeLabels = new Set(own.filter((m) => m.testKey !== canonicalKey).map((m) => m.label))
        if (subtypeLabels.has(label)) failures.push(`${category}: ${label} is a member subtype (${[...new Set(own.map((m) => m.label))].join(' / ')})`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('percent vs count units, by unit text and UCUM code', () => {
  const UCUM = 'http://unitsofmeasure.org'
  const PERCENT_UNITS = ['%', '％', 'percent', 'Percent', 'per cent', 'pct', 'PCT', '百分比', ' % ']
  const COUNT_CODES = ['/uL', '10*3/uL', '10*9/L', '10*6/uL', '/[HPF]']
  const COUNT_UNITS = ['/uL', '10^3/uL', 'x10^9/L', 'K/uL', '/HPF', 'cells/uL', '']

  const percentForms: Array<[string, any]> = []
  for (const unit of PERCENT_UNITS) {
    for (const coded of [undefined, { system: UCUM, code: '%' }, { code: '%' }]) {
      const q = { value: 62, unit, ...(coded ?? {}) }
      percentForms.push([`Quantity unit ${JSON.stringify(unit)} ${coded ? `code % ${coded.system ? 'UCUM' : 'no system'}` : 'no code'}`, { valueQuantity: q }])
      percentForms.push([`Range unit ${JSON.stringify(unit)} ${coded ? 'code %' : 'no code'}`, { valueRange: { low: { ...q, value: 1 }, high: { ...q, value: 5 } } }])
    }
    percentForms.push([`text "62${unit}"`, { valueString: `62${unit}` }])
    percentForms.push([`text "62 ${unit}"`, { valueString: `62 ${unit}` }])
  }
  // A UCUM code '%' decides even when the unit text is something else.
  for (const unit of ['', 'pct.', 'percentage', 'ratio %']) {
    percentForms.push([`Quantity unit ${JSON.stringify(unit)} with UCUM code %`, { valueQuantity: { value: 62, unit, system: UCUM, code: '%' } }])
  }

  it(`reads all ${percentForms.length} percent forms as percent`, () => {
    const failures = percentForms.filter(([, o]) => labValueFamily(o) !== 'percent').map(([name, o]) => `${name}: ${labValueFamily(o)}`)
    expect(failures).toEqual([])
  })

  const countForms: Array<[string, any]> = []
  for (const code of COUNT_CODES) {
    for (const unit of COUNT_UNITS) {
      countForms.push([`Quantity unit ${JSON.stringify(unit)} code ${code}`, { valueQuantity: { value: 4.1, unit, system: UCUM, code } }])
      countForms.push([`Range unit ${JSON.stringify(unit)} code ${code}`, { valueRange: { low: { value: 1, unit, system: UCUM, code }, high: { value: 5, unit, system: UCUM, code } } }])
    }
  }
  for (const unit of COUNT_UNITS) countForms.push([`text "4.1 ${unit}"`, { valueString: `4.1 ${unit}` }])

  it(`reads all ${countForms.length} count forms as quantity`, () => {
    const failures = countForms.filter(([, o]) => labValueFamily(o) !== 'quantity').map(([name, o]) => `${name}: ${labValueFamily(o)}`)
    expect(failures).toEqual([])
  })

  it('keeps one LOINC-less NEU % history together across unit spellings and codes', async () => {
    const forms = [
      { valueQuantity: { value: 62, unit: '%' } },
      { valueQuantity: { value: 60, unit: 'pct', system: UCUM, code: '%' } },
      { valueQuantity: { value: 58, unit: 'percent' } },
      { valueQuantity: { value: 57, unit: '百分比', code: '%' } },
      { valueString: '55 per cent' },
      { valueRange: { low: { value: 50, unit: 'pct', code: '%' }, high: { value: 54, unit: 'pct', code: '%' } } },
      { valueQuantity: { value: 4.1, unit: '10^3/uL', system: UCUM, code: '10*3/uL' } },
    ]
    const observations = forms.map((value, i) => ({
      resourceType: 'Observation', id: `neu-${i}`, status: 'final',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Neutrophil' },
      effectiveDateTime: `2026-0${i + 1}-01T08:00:00+08:00`,
      ...value,
    }))
    const tools = createFhirTools(() => ({ patient: samplePatient, collection: { ...sampleCollection, observations, vitalSigns: [] } }))
    const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'cbc', withTrend: true })
    expect(result.analyteCount).toBe(2)
    expect(result.data.map((g: any) => g.observationCount).sort()).toEqual([1, 6])
  })
})
