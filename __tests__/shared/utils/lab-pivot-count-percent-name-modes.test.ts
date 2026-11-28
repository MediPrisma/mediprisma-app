// Both name modes, one guarantee: a differential count and its percentage
// never share a cumulative column or a trend series. Original-name mode is an
// audit view that may split further by source label, but never merges what
// standardized mode keeps apart (count vs %, glucose subtype, …).
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'

const LOINC = 'http://loinc.org'
const UCUM = 'http://unitsofmeasure.org'
const NHI_ORDER = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const NHI_PAYMENT = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const MEDICLOUD_EXTENSION = {
  url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-system',
  valueCodeableConcept: { coding: [{ code: 'nhi-medicloud' }] },
}

let seq = 0
function obs(text: string, value: number | string, unit: string, opts: { loinc?: string; nhi?: string; ucum?: string; medicloud?: boolean; date?: string } = {}) {
  seq += 1
  return {
    resourceType: 'Observation', id: `cpnm-${seq}`, status: 'final',
    ...(opts.medicloud ? { extension: [MEDICLOUD_EXTENSION] } : {}),
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: {
      text,
      coding: [
        ...(opts.loinc ? [{ system: LOINC, code: opts.loinc }] : []),
        ...(opts.nhi ? [{ system: opts.nhi, code: '08013C', display: '白血球分類計數' }] : []),
      ],
    },
    ...(typeof value === 'number'
      ? { valueQuantity: { value, ...(unit ? { unit } : {}), ...(opts.ucum ? { code: opts.ucum, system: UCUM } : {}) } }
      : { valueString: value }),
    effectiveDateTime: `${opts.date ?? '2026-01-01'}T08:00:00+08:00`,
  }
}

const DATES = ['2026-01-01', '2026-02-01', '2026-03-01']
const SYNTHETIC = DATES.flatMap((date, i) => [
  // LOINC-coded count / % under one label
  obs('嗜中性白血球 / Neutrophil', 3 + i, '10^3/uL', { loinc: '751-8', nhi: NHI_ORDER, date }),
  obs('嗜中性白血球 / Neutrophil', 55 + i, '%', { loinc: '770-8', nhi: NHI_ORDER, date }),
  obs('淋巴球 / Lymphocyte', 1.5 + i, 'x10^9/L', { loinc: '731-0', date }),
  obs('淋巴球 / Lymphocyte', 30 + i, '%', { loinc: '736-9', date }),
  // LOINC-less NHI / MediCloud rows, Quantity and text, units and UCUM codes
  obs('嗜中性白血球', 2900 + i, '/uL', { nhi: NHI_PAYMENT, medicloud: true, date }),
  obs('嗜中性白血球', 61 + i, '%', { nhi: NHI_PAYMENT, medicloud: true, date }),
  obs('嗜中性白血球', 60 + i, 'pct', { nhi: NHI_PAYMENT, ucum: '%', date }),
  obs('嗜中性白血球', `${3100 + i} /uL`, '', { nhi: NHI_ORDER, date }),
  obs('嗜中性白血球', `${62 + i}%`, '', { nhi: NHI_ORDER, date }),
  obs('ANC', 3000 + i, '/uL', { nhi: NHI_PAYMENT, medicloud: true, date }),
  obs('ANC', 58 + i, '%', { date }),
  obs('Eosinophil', 150 + i, 'cells', { ucum: '/uL', date }),
  obs('Eosinophil', 2 + i, '%', { date }),
  obs('Band', 300 + i, '/uL', { date }),
  obs('Band', 3 + i, '%', { date }),
  // glucose subtypes under one label (a standardized split other than count / %)
  obs('Glucose', 100 + i, 'mg/dL', { loinc: '1558-6', date }),
  obs('Glucose', 140 + i, 'mg/dL', { loinc: '2345-7', date }),
])

function bundleObservations(): any[] {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((file) => file.endsWith('.json'))
  const out: any[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('"Observation"')) continue
    let json: any
    try { json = JSON.parse(text) } catch { continue }
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.resourceType === 'Observation') out.push(node)
      for (const value of Object.values(node)) walk(value)
    }
    walk(json)
  }
  return out
}

function unitKind(unit: string | undefined, value?: string): 'count' | 'percent' | null {
  const text = `${value ?? ''} ${unit ?? ''}`.normalize('NFKC').toLowerCase()
  if (/%|pct|percent/.test(text)) return 'percent'
  if (/\/(?:u|µ|μ)l|10\^9\/l|\/mm3|\/cumm/.test(text)) return 'count'
  return null
}

const CORPORA: Array<[string, () => any[]]> = [
  ['synthetic same-label rows', () => SYNTHETIC],
  ['demo / e2e bundles', bundleObservations],
]

describe.each(CORPORA)('%s', (_name, load) => {
  const observations = load()

  it('original mode never merges what standardized mode keeps apart', () => {
    const byOriginal = new Map<string, Set<string>>()
    for (const o of observations) {
      const category = categorizeObservation(o)?.id
      if (!category) continue
      const original = getLabPivotTestIdentity(o, category, 'original').mapKey
      const standardized = getLabPivotTestIdentity(o, category, 'standardized').mapKey
      const id = `${category}|${original}`
      byOriginal.set(id, (byOriginal.get(id) ?? new Set()).add(standardized))
    }
    expect([...byOriginal].filter(([, keys]) => keys.size > 1).map(([id, keys]) => `${id}: ${[...keys].join(' + ')}`)).toEqual([])
  })

  it.each(['standardized', 'original'] as const)('%s mode: no column mixes a count with a percentage', (nameMode) => {
    const failures: string[] = []
    for (const [categoryId, pivot] of Object.entries(buildLabPivots(observations, { nameMode }))) {
      for (const row of pivot.rows) {
        const kinds = new Set<string>()
        for (const cell of row.values.values()) {
          for (const record of cell.sourceRecords ?? [{ value: cell.value, unit: cell.unit }]) {
            const kind = unitKind(record.unit ?? row.unit, record.value)
            if (kind) kinds.add(kind)
          }
        }
        if (kinds.size > 1) failures.push(`${categoryId}/${row.mapKey}`)
      }
    }
    expect(failures).toEqual([])
  })

  it.each(['standardized', 'original'] as const)('%s mode: every trend series holds one standardized analyte', (nameMode) => {
    const failures: string[] = []
    const byId = new Map(observations.map((o: any) => [o.id, o]))
    for (const [categoryId, pivot] of Object.entries(buildLabPivots(observations, { nameMode }))) {
      for (const row of pivot.rows) {
        const series = buildLabTrendSeries(observations, {
          categoryId, mapKey: row.mapKey, testKey: row.testKey, displayName: row.displayName, nameMode,
        })
        const keys = new Set(series.points.map((point: any) => {
          const o: any = byId.get(point.id)
          return getLabPivotTestIdentity(o, categorizeObservation(o)?.id, 'standardized').mapKey
        }))
        if (keys.size > 1) failures.push(`${categoryId}/${row.mapKey}: ${[...keys].join(' + ')}`)
      }
    }
    expect(failures).toEqual([])
  })
})
