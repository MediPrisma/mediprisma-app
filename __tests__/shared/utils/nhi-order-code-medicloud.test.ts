// MediCloud (雲端病歷) bundles carry the NHI 醫令 code under TW Core's
// `…/medical-service-payment-tw`, not NHI-FHIR-Bridge's
// `…/nhi-medical-order-code`. Every reader of the NHI order code must accept
// both; these cases use MediCloud-shaped Observations to prove it.
import { buildLabPivots } from '@/features/clinical-summary/reports/hooks/useLabPivot'
import { buildMicrobiologyCumulativeModel } from '@/src/shared/utils/microbiology-cumulative.utils'
import { isNhiOrderCodeSystem, nhiOrderCode } from '@/src/shared/utils/nhi-order-code'

const MEDICLOUD_NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const MEDICLOUD_LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'
const HEALTHBANK_NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'

function medicloudObservation({
  id,
  date,
  nhiCode,
  nhiDisplay,
  name,
  value,
  specimen,
  text = name,
}: {
  id: string
  date: string
  nhiCode: string
  nhiDisplay: string
  name: string
  value: string
  specimen?: string
  text?: string
}) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }],
    }],
    code: {
      ...(text ? { text } : {}),
      coding: [
        { system: MEDICLOUD_NHI, code: nhiCode, display: nhiDisplay },
        { system: MEDICLOUD_LOCAL, code: name, display: name },
      ],
    },
    effectiveDateTime: `${date}T08:00:00+08:00`,
    valueString: value,
    ...(specimen ? { specimen: { display: specimen } } : {}),
    performer: [{ display: 'Test Hospital' }],
    meta: { tag: [{ code: 'MEDCLOUD' }] },
  }
}

describe('shared NHI order-code helper', () => {
  it('recognises every NHI order system, MediCloud included', () => {
    expect(isNhiOrderCodeSystem(MEDICLOUD_NHI)).toBe(true)
    expect(isNhiOrderCodeSystem(HEALTHBANK_NHI)).toBe(true)
    expect(isNhiOrderCodeSystem('https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/nhi-medical-order-code')).toBe(true)
    expect(isNhiOrderCodeSystem('urn:oid:nhi.lab.code')).toBe(true)
    expect(isNhiOrderCodeSystem('https://example.org/nhi-lab-code')).toBe(true)
    expect(isNhiOrderCodeSystem(MEDICLOUD_LOCAL)).toBe(false)
    expect(isNhiOrderCodeSystem('http://loinc.org')).toBe(false)
    expect(isNhiOrderCodeSystem(undefined)).toBe(false)
    expect(nhiOrderCode(medicloudObservation({
      id: 'x', date: '2026-01-01', nhiCode: '13006c', nhiDisplay: 'x', name: 'y', value: '1+',
    }))).toBe('13006C')
  })
})

describe('MediCloud NHI order code — cumulative lab pivot (lab-pivot.utils)', () => {
  it('splits flattened 13006C microscopy components into their own columns', () => {
    const observations = [
      medicloudObservation({ id: 'gpb', date: '2026-06-16', nhiCode: '13006C', nhiDisplay: '一般細菌顯微鏡檢查', name: 'G(+)bacilli', value: '1+' }),
      medicloudObservation({ id: 'neu', date: '2026-06-16', nhiCode: '13006C', nhiDisplay: '一般細菌顯微鏡檢查', name: 'Neutrophil', value: '2+' }),
    ]
    const pivots = buildLabPivots(observations)
    const names = pivots.microbio.rows.filter((row) => row.values.size > 0).map((row) => row.displayName)
    expect(names).toEqual(expect.arrayContaining(['Gram-positive bacilli', 'Neutrophils (microscopy)']))
    expect(pivots.cbc.rows.filter((row) => row.values.size > 0)).toEqual([])
  })

  it('names 13007C culture workflow rows by culture type', () => {
    const observations = [
      medicloudObservation({ id: 'ana', date: '2026-06-15', nhiCode: '13007C', nhiDisplay: '細菌培養鑑定檢查', name: 'Anaerobic #2', value: 'No anaerobic pathogen' }),
      medicloudObservation({ id: 'fun', date: '2026-06-15', nhiCode: '13007C', nhiDisplay: '細菌培養鑑定檢查', name: 'Fungus #1', value: 'No Fungus' }),
    ]
    const names = buildLabPivots(observations).microbio.rows
      .filter((row) => row.values.size > 0)
      .map((row) => row.displayName)
    expect(names).toEqual(expect.arrayContaining(['Anaerobic Culture', 'Fungal Culture']))
  })

  it('joins a corroborated 13026C culture to the mycobacterial culture column', () => {
    const observations = [
      medicloudObservation({ id: 'tb', date: '2026-08-01', nhiCode: '13026C', nhiDisplay: '抗酸菌培養', name: 'AFS+Culture', text: '抗酸菌培養', value: 'No growth' }),
    ]
    const rows = buildLabPivots(observations).microbio.rows.filter((row) => row.values.size > 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ testKey: 'MYCOBACTERIAL-CULTURE', displayName: 'Mycobacterial Culture' })
  })
})

describe('MediCloud NHI order code — microbiology cumulative view', () => {
  it('reports the source order code and keeps the NHI panel name out of stage detection', () => {
    const model = buildMicrobiologyCumulativeModel([
      // The NHI display「細菌培養鑑定檢查」says both 培養 and 鑑定; only the
      // row's own name ("Aerobic Culture") may decide the stage.
      medicloudObservation({ id: 'aer', date: '2026-04-01', nhiCode: '13007C', nhiDisplay: '細菌培養鑑定檢查', name: 'Aerobic Culture', specimen: 'Sputum', value: 'Normal flora' }),
    ])
    const result = model.tracks.flatMap((track) => track.results).find((r) => r.id === 'aer')
    expect(result).toMatchObject({ stage: 'culture', sourceOrderCode: '13007C' })
  })

  it('propagates a stated specimen across one 13006C report', () => {
    const model = buildMicrobiologyCumulativeModel([
      medicloudObservation({ id: 'ep', date: '2026-04-03', nhiCode: '13006C', nhiDisplay: '一般細菌顯微鏡檢查', name: 'Gram stain', specimen: 'Sputum', value: 'Few' }),
      medicloudObservation({ id: 'gpc', date: '2026-04-03', nhiCode: '13006C', nhiDisplay: '一般細菌顯微鏡檢查', name: 'G(+)cocci', value: '1+' }),
    ])
    const gpc = model.tracks.flatMap((track) => track.results).find((r) => r.id === 'gpc')
    expect(gpc).toMatchObject({ specimen: 'Sputum', specimenConfidence: 'inferred' })
  })
})
