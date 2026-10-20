import { renderHook } from '@testing-library/react'
import { useMedicationTimeline } from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'

const zhAtcCategories = {
  C: '心血管系統',
  R: '呼吸系統',
}

function medication(overrides: Record<string, unknown> = {}) {
  return {
    resourceType: 'MedicationRequest',
    id: 'med-1',
    status: 'active',
    authoredOn: '2026-07-01',
    medicationCodeableConcept: {
      coding: [{ code: 'AC49322100', display: 'ACETYLCYSTEINE 600 MG' }],
      text: '愛克痰發泡錠600毫克',
    },
    dispenseRequest: {
      expectedSupplyDuration: { value: 14, unit: 'days' },
    },
    drugTerminology: {
      officialNameZh: '愛克痰發泡錠600毫克',
      officialNameEn: 'ACTEIN EFFERVESCENT TABLETS 600MG',
      ingredientText: 'ACETYLCYSTEINE 600 MG',
      atcCode: 'R05CB01',
      atcLevel2Code: 'R05',
      atcLevel2NameEn: 'COUGH AND COLD PREPARATIONS',
      atcLevel2NameZh: '咳嗽與感冒製劑',
    },
    ...overrides,
  }
}

describe('useMedicationTimeline category grouping', () => {
  it('keeps the clinical inclusive supply end separate from the exclusive chart boundary', () => {
    const { result } = renderHook(() => useMedicationTimeline([
      medication({ authoredOn: '2026-10-19', dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } }),
    ], 'medical', 'all', '其他', 'zh-TW', zhAtcCategories))
    const bar = result.current.categories[0].drugs[0].bars[0]
    expect(bar.supplyEndDay).toBe('2026-11-15')
    expect(bar.endMs).toBe(Date.parse('2026-11-16T00:00:00+08:00'))
  })
  it.each(['weeks', 'period'])('shows days consistent with the chart for source %s', format => {
    const med = medication({ authoredOn: '2026-10-19',
      dispenseRequest: format === 'weeks' ? { expectedSupplyDuration: { value: 2, code: 'wk' } } : undefined,
      dosageInstruction: format === 'period' ? [{ timing: { repeat: { boundsPeriod: { start: '2026-10-19', end: '2026-11-01' } } } }] : undefined,
    })
    const { result } = renderHook(() => useMedicationTimeline([med], 'medical', 'all', '其他', 'zh-TW', zhAtcCategories))
    const bar = result.current.categories[0].drugs[0].bars[0]
    expect(bar).toMatchObject({ supplyDays: 14, supplyEndDay: '2026-11-01', supplyDaysUnrecorded: false })
  })
  it.each([{ value: 6, code: 'h', days: 0.25, end: '2026-10-19' }, { value: 1.5, code: 'd', days: 1.5, end: '2026-10-20' }, { value: 1.25, code: 'd', days: 1.25, end: '2026-10-20' }])('preserves a positive subday duration $value $code', ({ value, code, days, end }) => {
    const { result } = renderHook(() => useMedicationTimeline([medication({ authoredOn: '2026-10-19T00:00:00+08:00', dispenseRequest: { expectedSupplyDuration: { value, code } } })], 'medical', 'all', '其他', 'zh-TW', zhAtcCategories))
    const bar = result.current.categories[0].drugs[0].bars[0]
    expect(bar.supplyDays).toBe(days)
    expect(bar.endMs - bar.startMs).toBe(days * 86400000)
    expect(bar.supplyDaysUnrecorded).toBe(false)
    expect(bar.supplyEndDay).toBe(end)
  })
  it('separates SDK medications by governed ATC level two', () => {
    const medications = [
      medication(),
      medication({
        id: 'med-2',
        medicationCodeableConcept: {
          coding: [{ code: 'RESP-2', display: 'RESPIRATORY DRUG' }],
          text: '另一種呼吸系統用藥',
        },
        drugTerminology: {
          officialNameZh: '另一種呼吸系統用藥',
          officialNameEn: 'ANOTHER RESPIRATORY DRUG',
          atcCode: 'R03AC02',
          atcLevel2Code: 'R03',
          atcLevel2NameEn: 'DRUGS FOR OBSTRUCTIVE AIRWAY DISEASES',
          atcLevel2NameZh: '阻塞性呼吸道疾病用藥',
        },
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories).toHaveLength(2)
    expect(result.current.categories.map(({ key, label }) => ({ key, label })))
      .toEqual([
        {
          key: 'atc-level2:R03',
          label: '阻塞性呼吸道疾病用藥',
        },
        {
          key: 'atc-level2:R05',
          label: '咳嗽與感冒製劑',
        },
      ])
    expect(result.current.categories[1]).toMatchObject({
      nameEn: 'COUGH AND COLD PREPARATIONS',
      nameZh: '咳嗽與感冒製劑',
    })
  })

  it('keeps ATC grouping consistent even when a source category is present', () => {
    const medications = [
      medication({
        category: [{
          coding: [{ code: 'mucolytic', display: 'Mucolytics' }],
          text: '祛痰藥',
        }],
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories).toHaveLength(1)
    expect(result.current.categories[0]).toMatchObject({
      key: 'atc-level2:R05',
      label: '咳嗽與感冒製劑',
    })
  })

  it('falls back to the source category when ATC is unavailable', () => {
    const medications = [
      medication({
        drugTerminology: undefined,
        category: [{
          coding: [{ code: 'mucolytic', display: 'Mucolytics' }],
          text: '祛痰藥',
        }],
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: 'source:mucolytic',
      label: '祛痰藥',
    })
  })

  it('groups by governed source WHO ATC fallback without treating it as official drug-master data', () => {
    const medications = [
      medication({
        drugTerminology: undefined,
        atcClassification: {
          source: 'source-who-atc',
          atcCode: 'A10BK01',
          atcNameEn: 'dapagliflozin',
          atcLevel2Code: 'A10',
          atcLevel2NameEn: 'DRUGS USED IN DIABETES',
          atcLevel2NameZh: '糖尿病用藥',
          atcLevel4Code: 'A10BK',
          atcLevel4NameEn: 'Sodium-glucose co-transporter 2 (SGLT2) inhibitors',
          atcLevel4NameZh: 'SGLT2 抑制劑',
          atcHierarchySnapshotId: 'atc-hierarchy-2026',
        },
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: 'atc-level2:A10',
      label: '糖尿病用藥',
      children: [expect.objectContaining({
        key: 'atc-level4:A10BK',
        label: 'SGLT2 抑制劑',
      })],
    })
    expect(result.current.drugs[0].drugTerminology).toBeUndefined()
  })

  it('prefers a source category over broad level one when level two is unavailable', () => {
    const medications = [
      medication({
        drugTerminology: { atcCode: 'R05CB01' },
        category: [{
          coding: [{ code: 'mucolytic', display: 'Mucolytics' }],
          text: '祛痰藥',
        }],
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: 'source:mucolytic',
      label: '祛痰藥',
    })
  })

  it('falls back to ATC level one only when level two and source category are absent', () => {
    const medications = [
      medication({ drugTerminology: { atcCode: 'R05CB01' } }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: 'atc-level1:R',
      label: '呼吸系統',
    })
  })

  it('uses Other only when level two, source category, and valid ATC are absent', () => {
    const medications = [
      medication({ drugTerminology: undefined }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'patient',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: '__other__',
      label: '其他',
    })
  })

  it('uses ingredient + strength as the compact medical timeline label', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication()],
        'medical',
        'all',
        'Other',
        'en',
        { R: 'Respiratory system' },
      ),
    )

    expect(result.current.drugs[0]).toMatchObject({
      drugName: 'ACETYLCYSTEINE 600 MG',
      drugProductName: 'ACTEIN EFFERVESCENT TABLETS 600MG',
    })
  })

  it('carries the source medication frequency into each timeline prescription', () => {
    const withFrequency = medication({
      dosageInstruction: [{
        timing: { code: { text: 'QDPC' } },
      }],
    })

    const { result } = renderHook(() =>
      useMedicationTimeline(
        [withFrequency],
        'medical',
        'all',
        'Other',
        'en',
        { R: 'Respiratory system' },
      ),
    )

    expect(result.current.drugs[0].bars[0].frequency).toBe('QDPC')
  })

  it('carries an unsupported source dosage instruction into the timeline', () => {
    const localInstruction = medication({
      dosageInstruction: [{ text: 'HOSPITAL-LOCAL-SIG' }],
    })

    const { result } = renderHook(() =>
      useMedicationTimeline([localInstruction], 'medical', 'all', 'Other', 'en'),
    )

    expect(result.current.drugs[0].bars[0].frequency).toBe('HOSPITAL-LOCAL-SIG')
  })

  it('uses the official English level two name in an English UI', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication()],
        'medical',
        'all',
        'Other',
        'en',
        { R: 'Respiratory system' },
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      key: 'atc-level2:R05',
      label: 'COUGH AND COLD PREPARATIONS',
      nameEn: 'COUGH AND COLD PREPARATIONS',
      nameZh: '咳嗽與感冒製劑',
    })
  })

  it('puts package-code variants of the same official product on one drug row', () => {
    const folicTerminology = {
      officialNameZh: '"強生"葉酸膜衣錠５毫克',
      officialNameEn: 'FOLACIN F.C. TABLETS 5MG (FOLIC ACID) "JOHNSON"',
      ingredientText: 'FOLIC ACID 5 MG',
      doseForm: '膜衣錠',
      atcCode: 'B03BB01',
      atcLevel2Code: 'B03',
      atcLevel2NameEn: 'ANTIANEMIC PREPARATIONS',
      atcLevel2NameZh: '抗貧血製劑',
      officialProductUrl:
        'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01034670',
    }
    const medications = [
      medication({
        id: 'folic-00',
        authoredOn: '2026-06-02',
        medicationCodeableConcept: {
          coding: [{ code: 'AC34670100', display: 'FOLACIN F.C. TABLETS 5MG' }],
          text: '"強生"葉酸膜衣錠５毫克',
        },
        drugTerminology: folicTerminology,
      }),
      medication({
        id: 'folic-g0',
        authoredOn: '2026-06-25',
        medicationCodeableConcept: {
          coding: [{ code: 'AC346701G0', display: 'FOLACIN F.C. TABLETS 5MG' }],
          text: '"強生"葉酸膜衣錠５毫克',
        },
        drugTerminology: folicTerminology,
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        'Other',
        'en',
        {},
      ),
    )

    expect(result.current.totalDrugs).toBe(1)
    expect(result.current.drugs[0].refillCount).toBe(2)
    expect(result.current.drugs[0].bars).toHaveLength(2)
    expect(result.current.drugs[0].bars.map((bar) => bar.sourceMedicationCode))
      .toEqual(['AC34670100', 'AC346701G0'])
  })

  it('keeps same-ingredient products with different official licences separate', () => {
    const commonTerminology = {
      officialNameEn: 'FOLIC ACID TABLETS 5MG',
      ingredientText: 'FOLIC ACID 5 MG',
      doseForm: '膜衣錠',
      atcCode: 'B03BB01',
      atcLevel2Code: 'B03',
      atcLevel2NameEn: 'ANTIANEMIC PREPARATIONS',
      atcLevel2NameZh: '抗貧血製劑',
    }
    const medications = [
      medication({
        id: 'product-a',
        medicationCodeableConcept: {
          coding: [{ code: 'NHI-A', display: 'FOLIC ACID A' }],
          text: '葉酸 A',
        },
        drugTerminology: {
          ...commonTerminology,
          officialProductUrl: 'https://example.test/licence/A',
        },
      }),
      medication({
        id: 'product-b',
        medicationCodeableConcept: {
          coding: [{ code: 'NHI-B', display: 'FOLIC ACID B' }],
          text: '葉酸 B',
        },
        drugTerminology: {
          ...commonTerminology,
          officialProductUrl: 'https://example.test/licence/B',
        },
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        'Other',
        'en',
        {},
      ),
    )

    expect(result.current.totalDrugs).toBe(2)
  })

  it('keeps a dense ATC group broad when broad detail is selected', () => {
    const medications = [
      ['antipsychotic-a', 'N05A', '抗精神病藥', 'N05AX', '其他抗精神病藥'],
      ['antipsychotic-b', 'N05A', '抗精神病藥', 'N05AH', '二氮雜䓬類'],
      ['anxiolytic-a', 'N05B', '抗焦慮藥', 'N05BA', '苯二氮平類衍生物'],
      ['anxiolytic-b', 'N05B', '抗焦慮藥', 'N05BX', '其他抗焦慮藥'],
    ].map(([id, level3Code, level3NameZh, level4Code, level4NameZh], index) =>
      medication({
        id,
        authoredOn: `2026-07-0${index + 1}`,
        medicationCodeableConcept: {
          coding: [{ code: id }],
          text: id,
        },
        drugTerminology: {
          officialNameEn: id,
          officialProductUrl: `https://example.test/licence/${id}`,
          atcCode: `${level4Code}01`,
          atcLevel2Code: 'N05',
          atcLevel2NameEn: 'PSYCHOLEPTICS',
          atcLevel2NameZh: '精神安定類藥物',
          atcLevel3Code: level3Code,
          atcLevel3NameEn: level3Code === 'N05A' ? 'ANTIPSYCHOTICS' : 'ANXIOLYTICS',
          atcLevel3NameZh: level3NameZh,
          atcLevel4Code: level4Code,
          atcLevel4NameEn: level4NameZh,
          atcLevel4NameZh: level4NameZh,
        },
      }),
    )

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'atc',
        '2',
      ),
    )

    expect(result.current.categories[0]).toMatchObject({
      code: 'N05',
      drugCount: 4,
    })
    expect(result.current.categories[0].children).toEqual([])
    expect(result.current.categories[0].drugs).toHaveLength(4)
  })

  it('shows level 4 groups directly below level 2 when level 4 is selected', () => {
    const medications = [
      ['ssri', 'N06AB', '選擇性血清素再吸收抑制劑'],
      ['other-antidepressant', 'N06AX', '其他抗憂鬱藥'],
    ].map(([id, level4Code, level4NameZh], index) =>
      medication({
        id,
        authoredOn: `2026-07-1${index}`,
        medicationCodeableConcept: { coding: [{ code: id }], text: id },
        drugTerminology: {
          officialNameEn: id,
          officialProductUrl: `https://example.test/licence/${id}`,
          atcCode: `${level4Code}01`,
          atcLevel2Code: 'N06',
          atcLevel2NameEn: 'PSYCHOANALEPTICS',
          atcLevel2NameZh: '精神興奮／抗憂鬱與失智相關用藥',
          atcLevel3Code: 'N06A',
          atcLevel3NameEn: 'ANTIDEPRESSANTS',
          atcLevel3NameZh: '抗憂鬱藥',
          atcLevel4Code: level4Code,
          atcLevel4NameEn: level4NameZh,
          atcLevel4NameZh: level4NameZh,
        },
      }),
    )

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'atc',
        '4',
      ),
    )

    expect(result.current.categories[0].children?.map((group) => group.code).sort())
      .toEqual(['N06AB', 'N06AX'])
    expect(result.current.categories[0].children?.every((group) => group.depth === 1))
      .toBe(true)
  })

  it('splits the same clinical drug into organization rows without changing its unique-drug count', () => {
    const sharedTerminology = {
      officialNameZh: '共同藥品',
      officialNameEn: 'SHARED PRODUCT',
      ingredientText: 'SHARED INGREDIENT 10 MG',
      officialProductUrl: 'https://example.test/licence/shared',
      atcCode: 'N06AX12',
      atcLevel2Code: 'N06',
      atcLevel2NameZh: '精神興奮／抗憂鬱與失智相關用藥',
    }
    const medications = [
      medication({
        id: 'shared-a',
        authoredOn: '2026-07-01',
        requester: { display: '臺北榮民總醫院' },
        drugTerminology: sharedTerminology,
      }),
      medication({
        id: 'shared-b',
        authoredOn: '2026-07-15',
        requester: { display: '社區藥局' },
        drugTerminology: sharedTerminology,
      }),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'organization',
        '4',
        '未提供機構',
      ),
    )

    expect(result.current.totalDrugs).toBe(1)
    expect(result.current.totalRows).toBe(2)
    expect(result.current.organizationCount).toBe(2)
    expect(result.current.categories.map((group) => group.label).sort())
      .toEqual(['社區藥局', '臺北榮民總醫院'])
    expect(result.current.categories.every((group) => group.drugs.length === 1)).toBe(true)
  })

  it('orders organizations by current medication rows before total row count', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-08-29T12:00:00+08:00').getTime(),
    )
    const organizationMedication = (
      id: string,
      code: string,
      organization: string,
      authoredOn: string,
      supplyDays: number,
    ) => medication({
      id,
      authoredOn,
      requester: { display: organization },
      medicationCodeableConcept: {
        coding: [{ code, display: code }],
        text: code,
      },
      dispenseRequest: {
        expectedSupplyDuration: { value: supplyDays, unit: 'days' },
      },
      drugTerminology: undefined,
    })
    const medications = [
      organizationMedication('larger-past-1', 'LARGER-1', '總數較多醫院', '2026-01-01', 14),
      organizationMedication('larger-past-2', 'LARGER-2', '總數較多醫院', '2026-02-01', 14),
      organizationMedication('larger-current', 'LARGER-3', '總數較多醫院', '2026-08-20', 30),
      organizationMedication('current-1', 'CURRENT-1', '目前用藥較多醫院', '2026-08-10', 30),
      organizationMedication('current-2', 'CURRENT-2', '目前用藥較多醫院', '2026-08-15', 30),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'organization',
        '4',
        '未提供機構',
      ),
    )

    expect(result.current.categories.map((group) => group.label))
      .toEqual(['目前用藥較多醫院', '總數較多醫院'])
    expect(result.current.categories.map((group) => group.currentDrugCount))
      .toEqual([2, 1])
    expect(result.current.categories.map((group) => group.drugCount))
      .toEqual([2, 3])

    nowSpy.mockRestore()
  })

  it('places current medications before history within an organization', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-08-29T12:00:00+08:00').getTime(),
    )
    const organizationMedication = (
      id: string,
      authoredOn: string,
      supplyDays: number,
    ) => medication({
      id,
      authoredOn,
      requester: { display: '排序測試醫院' },
      medicationCodeableConcept: {
        coding: [{ code: id, display: id }],
        text: id,
      },
      dispenseRequest: {
        expectedSupplyDuration: { value: supplyDays, unit: 'days' },
      },
      drugTerminology: undefined,
    })
    const medications = [
      organizationMedication('CURRENT-LATER', '2026-08-20', 30),
      organizationMedication('PAST-EARLIER', '2026-01-01', 14),
      organizationMedication('CURRENT-EARLIER', '2026-08-10', 30),
      organizationMedication('PAST-LATER', '2026-02-01', 14),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'organization',
        '4',
        '未提供機構',
      ),
    )

    expect(result.current.categories[0].currentDrugCount).toBe(2)
    expect(result.current.categories[0].drugs.map((drug) => drug.drugName))
      .toEqual([
        'CURRENT-EARLIER',
        'CURRENT-LATER',
        'PAST-EARLIER',
        'PAST-LATER',
      ])

    nowSpy.mockRestore()
  })

  it('keeps medications first prescribed on the same day together in organization groups', () => {
    const organization = { display: '示範宏恩醫院' }
    const timelineMedication = (
      id: string,
      authoredOn: string,
      ingredientText: string,
      isChronic: boolean,
    ) => medication({
      id,
      authoredOn,
      requester: organization,
      medicationCodeableConcept: {
        coding: [{ code: id, display: ingredientText }],
        text: ingredientText,
      },
      drugTerminology: {
        officialNameEn: ingredientText,
        ingredientText,
        officialProductUrl: `https://example.test/licence/${id}`,
        atcCode: 'R05CB01',
        atcLevel2Code: 'R05',
        atcLevel2NameEn: 'COUGH AND COLD PREPARATIONS',
        atcLevel2NameZh: '咳嗽與感冒製劑',
      },
      ...(isChronic
        ? {
            courseOfTherapyType: {
              coding: [{ code: 'continuous' }],
            },
          }
        : {
            courseOfTherapyType: {
              coding: [{ code: 'acute' }],
            },
          }),
    })
    const medications = [
      timelineMedication('early-chronic', '2026-06-02', 'EARLY CHRONIC', true),
      timelineMedication('later-chronic', '2026-07-01', 'LATER CHRONIC', true),
      timelineMedication('early-acute', '2026-06-02', 'EARLY ACUTE', false),
    ]

    const { result } = renderHook(() =>
      useMedicationTimeline(
        medications,
        'medical',
        'all',
        '其他',
        'zh-TW',
        {},
        'organization',
        '4',
        '未提供機構',
      ),
    )

    const organizationDrugs = result.current.categories[0].drugs
    expect(organizationDrugs.map((drug) => drug.bars[0].authoredOnIso))
      .toEqual(['2026-06-02', '2026-06-02', '2026-07-01'])
    expect(organizationDrugs.map((drug) => drug.prescriptionType))
      .toEqual(['non-chronic', 'chronic', 'chronic'])
  })

  it.each([
    ['3m', 3],
    ['6m', 6],
    ['1y', 12],
    ['3y', 36],
  ] as const)(
    'keeps the %s timeline at its fixed lookback boundary when data is newer',
    (range, months) => {
      const now = new Date('2026-08-28T12:00:00+08:00')
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime())
      const expectedStart = new Date(now)
      expectedStart.setMonth(expectedStart.getMonth() - months)

      const { result } = renderHook(() =>
        useMedicationTimeline(
          [medication({ authoredOn: '2026-08-01' })],
          'medical',
          range,
          '其他',
          'zh-TW',
          zhAtcCategories,
        ),
      )

      expect(result.current.domainStartMs).toBe(expectedStart.getTime())
      expect(result.current.domainEndMs).toBeGreaterThanOrEqual(now.getTime())
      nowSpy.mockRestore()
    },
  )

  it('keeps the all-time range fitted to the earliest medication', () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-08-28T12:00:00+08:00').getTime())
    const earliest = new Date('2026-07-12T00:00:00+08:00').getTime()

    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication({ authoredOn: '2026-07-12' })],
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.domainStartMs).toBe(earliest)
    nowSpy.mockRestore()
  })

  it('does not treat missing prescription-type metadata as non-chronic', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication()],
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.drugs[0].prescriptionType).toBe('unrecorded')
    expect(result.current).toMatchObject({
      chronicCount: 0,
      nonChronicCount: 0,
      unrecordedCount: 1,
    })
  })

  it('only treats an explicitly recorded acute course as non-chronic', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication({
          courseOfTherapyType: {
            coding: [{ code: 'acute' }],
          },
        })],
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.drugs[0].prescriptionType).toBe('non-chronic')
    expect(result.current).toMatchObject({
      chronicCount: 0,
      nonChronicCount: 1,
      unrecordedCount: 0,
    })
  })

  it('keeps an unfamiliar course value unrecorded instead of assuming non-chronic', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [medication({
          courseOfTherapyType: {
            coding: [{ code: 'unknown-source-value' }],
            text: 'Not supplied by source',
          },
        })],
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.drugs[0].prescriptionType).toBe('unrecorded')
  })

  it('keeps a grouped drug unrecorded when acute and missing metadata are mixed', () => {
    const { result } = renderHook(() =>
      useMedicationTimeline(
        [
          medication({ id: 'unknown', authoredOn: '2026-07-01' }),
          medication({
            id: 'acute',
            authoredOn: '2026-07-02',
            courseOfTherapyType: { coding: [{ code: 'acute' }] },
          }),
        ],
        'medical',
        'all',
        '其他',
        'zh-TW',
        zhAtcCategories,
      ),
    )

    expect(result.current.drugs).toHaveLength(1)
    expect(result.current.drugs[0].prescriptionType).toBe('unrecorded')
  })
})
