import { buildLabPivots } from '@/features/clinical-summary/reports/hooks/useLabPivot'

const LOINC = 'http://loinc.org'
const NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://example.org/CodeSystem/his-local-lab'

function microbiologyObservation({
  id,
  text,
  date,
  value,
  loinc,
  nhi,
  sourceDisplay,
  specimen,
}: {
  id: string
  text: string
  date: string
  value: string
  loinc?: string
  nhi?: string
  sourceDisplay?: string
  specimen?: string
}) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'laboratory',
      }],
    }],
    code: {
      text,
      coding: [
        ...(loinc ? [{ system: LOINC, code: loinc }] : []),
        ...(nhi ? [{ system: NHI, code: nhi, display: text }] : []),
        ...(sourceDisplay ? [{ system: LOCAL, code: sourceDisplay, display: sourceDisplay }] : []),
      ],
    },
    effectiveDateTime: `${date}T08:00:00+08:00`,
    valueString: value,
    ...(specimen ? { specimen: { display: specimen } } : {}),
  }
}

describe('buildLabPivots — microbiology name normalization', () => {
  it('canonicalizes Gram-stain and MIC report variants observed in NHI bundles', () => {
    const observations = [
      microbiologyObservation({
        id: 'gram-local',
        date: '2026-06-13',
        text: '革蘭氏染色',
        nhi: '13006C',
        value: 'No bacteria seen',
      }),
      microbiologyObservation({
        id: 'mic',
        date: '2026-06-10',
        text: '細菌最低抑制濃度快速試驗',
        nhi: '13023C',
        value: 'Ampicillin:S',
      }),
    ]

    const rows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )
    expect(rows.map((row) => row.displayName)).toEqual(expect.arrayContaining([
      'Gram Stain',
      '抗生素藥敏試驗',
    ]))
  })

  it('normalizes flattened 13006C microscopy components without turning them into CBC analytes', () => {
    const observations = [
      microbiologyObservation({
        id: 'gram-positive-bacilli-en',
        date: '2026-06-16',
        text: 'G(+)bacilli',
        nhi: '13006C',
        value: '1+',
      }),
      microbiologyObservation({
        id: 'gram-positive-bacilli-zh',
        date: '2026-06-15',
        text: '格蘭氏陽性桿菌',
        nhi: '13006C',
        value: '2+',
      }),
      microbiologyObservation({
        id: 'microscopy-neutrophil',
        date: '2026-06-16',
        text: 'Neutrophil',
        nhi: '13006C',
        value: '1+',
      }),
    ]

    const rows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )
    expect(rows.map((row) => row.displayName)).toEqual(expect.arrayContaining([
      'Gram-positive bacilli',
      'Neutrophils (microscopy)',
    ]))
    expect(rows.filter((row) => row.displayName === 'Gram-positive bacilli')).toHaveLength(1)
    expect(buildLabPivots(observations).cbc.rows.filter((row) => row.values.size > 0)).toEqual([])
  })

  it('normalizes local culture workflow labels carried under 13007C and 13008C', () => {
    const observations = [
      microbiologyObservation({
        id: 'anaerobic-short',
        date: '2026-06-15',
        text: 'Anaerobic #2',
        nhi: '13007C',
        value: 'No anaerobic pathogen',
      }),
      microbiologyObservation({
        id: 'anaerobic-truncated',
        date: '2026-06-14',
        text: 'Anaerobic Cultu',
        nhi: '13008C',
        value: 'No growth to date',
      }),
      microbiologyObservation({
        id: 'fungus',
        date: '2026-06-15',
        text: 'Fungus #1',
        nhi: '13007C',
        value: 'No Fungus',
      }),
      microbiologyObservation({
        id: 'id-ds',
        date: '2026-06-15',
        text: 'ID+DS Common #1',
        nhi: '13008C',
        value: 'No aerobic pathogen',
      }),
    ]

    const names = buildLabPivots(observations).microbio.rows
      .filter((row) => row.values.size > 0)
      .map((row) => row.displayName)
    expect(names).toEqual(expect.arrayContaining([
      'Anaerobic Culture',
      'Fungal Culture',
      'Culture identification / susceptibility',
    ]))
    expect(names.filter((name) => name === 'Anaerobic Culture')).toHaveLength(1)
  })

  it('merges LOINC and corroborated NHI mycobacterial cultures under the preferred display name', () => {
    const observations = [
      microbiologyObservation({
        id: 'loinc-culture',
        text: 'Mycobacterial Culture',
        sourceDisplay: 'TB Culture',
        loinc: '50941-4',
        date: '2026-07-01',
        value: 'No growth after 8 weeks',
      }),
      microbiologyObservation({
        id: 'nhi-culture',
        text: '抗酸菌培養',
        sourceDisplay: 'AFS+Culture',
        nhi: '13026C',
        date: '2026-08-01',
        value: 'No growth',
      }),
    ]

    const populatedRows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )

    expect(populatedRows).toHaveLength(1)
    expect(populatedRows[0]).toMatchObject({
      mapKey: 'MYCOBACTERIAL-CULTURE',
      testKey: 'MYCOBACTERIAL-CULTURE',
      displayName: 'Mycobacterial Culture',
    })
    expect([...populatedRows[0].values.keys()]).toEqual([
      '2026-07-01',
      '2026-08-01',
    ])
  })

  it('keeps source labels split in original-name mode for audit', () => {
    const observations = [
      microbiologyObservation({
        id: 'source-a',
        text: 'Mycobacterial Culture',
        sourceDisplay: 'TB Culture',
        loinc: '50941-4',
        date: '2026-07-01',
        value: 'Negative',
      }),
      microbiologyObservation({
        id: 'source-b',
        text: '抗酸菌培養',
        sourceDisplay: 'AFS+Culture',
        nhi: '13026C',
        date: '2026-08-01',
        value: 'Negative',
      }),
    ]

    const populatedRows = buildLabPivots(observations, { nameMode: 'original' })
      .microbio.rows.filter((row) => row.values.size > 0)

    expect(populatedRows.map((row) => row.displayName).sort()).toEqual([
      'AFS+Culture',
      'TB Culture',
    ])
  })

  it('does not infer Mycobacterium from unsupported acid-fast culture text alone', () => {
    const observations = [
      microbiologyObservation({
        id: 'free-text-zh',
        text: '抗酸菌培養',
        date: '2026-07-01',
        value: 'Negative',
      }),
      microbiologyObservation({
        id: 'free-text-en',
        text: 'AFB Culture',
        date: '2026-08-01',
        value: 'Negative',
      }),
    ]

    const populatedRows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )

    expect(populatedRows).toHaveLength(2)
    expect(populatedRows.map((row) => row.testKey)).toEqual(
      expect.arrayContaining(['抗酸菌培養', 'AFB CULTURE']),
    )
  })

  it('keeps acid-fast stain separate from culture and routes both before specimen', () => {
    const observations = [
      microbiologyObservation({
        id: 'stain',
        text: 'AFB Stain',
        loinc: '11545-1',
        specimen: 'Urine',
        date: '2026-07-01',
        value: 'Not found',
      }),
      microbiologyObservation({
        id: 'culture',
        text: 'Mycobacterial Culture',
        loinc: '50941-4',
        specimen: 'Urine',
        date: '2026-07-01',
        value: 'No growth',
      }),
    ]

    const populatedRows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )

    expect(populatedRows).toHaveLength(2)
    expect(populatedRows.map((row) => [row.testKey, row.displayName])).toEqual(
      expect.arrayContaining([
        ['MYCOBACTERIAL-CULTURE', 'Mycobacterial Culture'],
        ['ACID-FAST-STAIN', 'AFB smear'],
      ]),
    )
    expect(buildLabPivots(observations).urine.rows.every((row) => row.values.size === 0)).toBe(true)
  })

  it('orders columns by clinical family and workflow instead of alphabetically', () => {
    const observations = [
      microbiologyObservation({
        id: 'tb-ambiguous',
        text: 'TB Culture',
        nhi: '13013C',
        date: '2026-07-01',
        value: 'acid fast bacilli not found',
      }),
      microbiologyObservation({
        id: 'aerobic',
        text: 'Aerobic Culture',
        loinc: '634-6',
        date: '2026-07-01',
        value: 'Mixed flora',
      }),
      microbiologyObservation({
        id: 'blood-en',
        text: 'Blood Culture',
        loinc: '600-7',
        date: '2026-07-01',
        value: 'No growth',
      }),
      microbiologyObservation({
        id: 'blood-zh',
        text: '細菌血液培養',
        loinc: '600-7',
        date: '2026-08-01',
        value: 'No growth',
      }),
      microbiologyObservation({
        id: 'mycobacterial',
        text: 'Mycobacterial Culture',
        loinc: '50941-4',
        date: '2026-07-01',
        value: 'No growth',
      }),
      microbiologyObservation({
        id: 'afb-stain',
        text: 'Acid-fast Stain',
        loinc: '11545-1',
        date: '2026-07-01',
        value: 'Not found',
      }),
    ]

    const rows = buildLabPivots(observations).microbio.rows.filter(
      (row) => row.values.size > 0,
    )

    expect(rows.map((row) => row.testKey)).toEqual([
      'BLOOD-CULTURE',
      'AEROBIC-CULTURE',
      'ACID-FAST-STAIN',
      'MYCOBACTERIAL-CULTURE',
      'TB CULTURE',
    ])
    expect(rows.map((row) => row.subgroupId)).toEqual([
      'bacteriology',
      'bacteriology',
      'mycobacteriology',
      'mycobacteriology',
      'mycobacteriology',
    ])
    expect(rows[0].displayName).toBe('Blood Culture')
    expect(rows[0].values.size).toBe(2)
  })

  it('keeps mold allergens out of microbiology even when their names contain 黴菌', () => {
    const observations = [
      microbiologyObservation({
        id: 'alternaria-ige',
        text: 'Alternaria tenuis 交錯黴菌',
        nhi: '30022C',
        date: '2023-11-23',
        value: '0',
      }),
      microbiologyObservation({
        id: 'penicillium-ige',
        text: 'Penicillium 青黴菌',
        nhi: '30022C',
        date: '2023-11-23',
        value: '0',
      }),
    ]

    const pivots = buildLabPivots(observations)

    expect(pivots.microbio.rows.filter((row) => row.values.size > 0)).toEqual([])
    // Specific-allergen IgE (30022C) is kept out of the cumulative report
    // altogether (owner decision 2026-10-08): no panel holds it.
    const shown = Object.values(pivots).flatMap((pivot) => pivot.rows.filter((row) => row.values.size > 0))
    expect(shown).toEqual([])
  })
})
