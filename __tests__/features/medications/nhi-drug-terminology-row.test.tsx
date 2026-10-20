import { renderHook } from '@testing-library/react'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import {
  MEDCLOUD_ATC_LEVEL_3_URL,
  MEDCLOUD_SOURCE_DRUG_CLASS_URL,
} from '@/src/shared/constants/medcloud.constants'

const medication = {
  resourceType: 'MedicationRequest',
  id: 'mr-1',
  status: 'active',
  authoredOn: '2024-04-01',
  medicationCodeableConcept: {
    text: '來源中文藥名',
    coding: [{
      system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code',
      code: 'AC49322100',
      display: 'Source English name',
    }],
  },
  category: [{
    text: '痰液溶解劑 (MUCOLYTIC AGENTS)',
    coding: [{ code: 'mucolytic', display: 'MUCOLYTIC AGENTS' }],
  }],
  drugTerminology: {
    source: 'nhi-official-drug-master',
    snapshotId: 'nhi-drug-terminology-20260728',
    officialNameZh: '官方中文藥名',
    officialNameEn: 'Official English name',
    ingredientText: 'BUPROPION HYDROCHLORIDE 150 MG',
    doseForm: '持續性藥效膜衣錠',
    atcCode: 'N06AX12',
    atcNameEn: 'bupropion',
  },
}

describe('useMedicationRows — official NHI terminology view model', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-04-02T00:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('prioritizes ingredient + strength and retains the product name for medical users', () => {
    const { result } = renderHook(() =>
      useMedicationRows([medication], 'medical', 'zh-TW'),
    )

    expect(result.current[0]).toMatchObject({
      title: 'BUPROPION HYDROCHLORIDE 150 MG',
      secondaryTitle: 'Official English name',
      drugTerminology: medication.drugTerminology,
    })
    expect(result.current[0].searchHaystack).toEqual(
      expect.stringContaining('官方中文藥名'),
    )
    expect(result.current[0].searchHaystack).toEqual(
      expect.stringContaining('bupropion hydrochloride 150 mg'),
    )
    expect(result.current[0].searchHaystack).toEqual(
      expect.stringContaining('n06ax12'),
    )
  })

  it('shows the official Chinese name to a zh-TW patient audience', () => {
    const { result } = renderHook(() =>
      useMedicationRows([medication], 'patient', 'zh-TW'),
    )

    expect(result.current[0].title).toBe('官方中文藥名')
  })

  it('shows only the category language selected by the UI locale', () => {
    const zh = renderHook(() =>
      useMedicationRows([medication], 'medical', 'zh-TW'),
    )
    const en = renderHook(() =>
      useMedicationRows([medication], 'medical', 'en'),
    )

    expect(zh.result.current[0].category).toBe('痰液溶解劑')
    expect(en.result.current[0].category).toBe('MUCOLYTIC AGENTS')
    expect(zh.result.current[0].searchHaystack).toContain('mucolytic agents')
  })

  it('uses the MediCloud ATC3 group in the existing category slot', () => {
    const cloudMedication = {
      ...medication,
      extension: [{
        url: MEDCLOUD_ATC_LEVEL_3_URL,
        valueCoding: { system: 'http://www.whocc.no/atc', code: 'N06' },
      }],
      drugTerminology: {
        ...medication.drugTerminology,
        atcLevel2Code: 'N06',
        atcLevel2NameZh: '精神興奮劑',
        atcLevel2NameEn: 'PSYCHOANALEPTICS',
      },
    }

    const zh = renderHook(() =>
      useMedicationRows([cloudMedication], 'medical', 'zh-TW'),
    )
    const en = renderHook(() =>
      useMedicationRows([cloudMedication], 'medical', 'en'),
    )

    expect(zh.result.current[0].category).toBe('精神興奮劑')
    expect(en.result.current[0].category).toBe('PSYCHOANALEPTICS')
    expect(zh.result.current[0].searchHaystack).toContain('精神興奮劑')
  })

  it('uses the source ATC3 name when MediCloud carries a display instead of a code', () => {
    const cloudMedication = {
      ...medication,
      extension: [{
        url: MEDCLOUD_SOURCE_DRUG_CLASS_URL,
        valueString: '甲狀腺治療（Thyroid therapy）',
      }],
      drugTerminology: {
        ...medication.drugTerminology,
        atcLevel2Code: 'H03',
        atcLevel2NameZh: 'APP 翻譯分類',
      },
    }

    const zh = renderHook(() =>
      useMedicationRows([cloudMedication], 'medical', 'zh-TW'),
    )
    const en = renderHook(() =>
      useMedicationRows([cloudMedication], 'medical', 'en'),
    )

    expect(zh.result.current[0].category).toBe('甲狀腺治療')
    expect(en.result.current[0].category).toBe('Thyroid therapy')
  })

  it('shows only the institution name from a legacy requester display', () => {
    const legacyRequester = {
      ...medication,
      requester: { display: '新北市聯合醫院;門診;0131020016' },
    }
    const codeOnlyRequester = {
      ...medication,
      id: 'mr-code-only',
      requester: { display: '0131020016' },
    }

    const { result } = renderHook(() =>
      useMedicationRows([legacyRequester, codeOnlyRequester], 'medical', 'zh-TW'),
    )

    expect(result.current.find((row) => row.id === 'mr-1')?.pharmacy)
      .toBe('新北市聯合醫院 門診')
    expect(result.current.find((row) => row.id === 'mr-code-only')?.pharmacy)
      .toBeUndefined()
  })

  it('adds the structured MediCloud care setting to a name-only requester', () => {
    const cloudRequester = {
      ...medication,
      requester: { display: '新北市聯合醫院' },
      extension: [{
        url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-setting',
        valueString: '住院',
      }],
    }

    const { result } = renderHook(() =>
      useMedicationRows([cloudRequester], 'medical', 'zh-TW'),
    )

    expect(result.current[0].pharmacy).toBe('新北市聯合醫院 住院')
    expect(result.current[0].searchHaystack).not.toContain('0131020016')
  })

  it('does not replace a zh-TW patient source name with an English-only enrichment', () => {
    const englishOnlyTerminology = {
      ...medication,
      drugTerminology: {
        ...medication.drugTerminology,
        officialNameZh: undefined,
      },
    }
    const { result } = renderHook(() =>
      useMedicationRows([englishOnlyTerminology], 'patient', 'zh-TW'),
    )

    expect(result.current[0].title).toBe('來源中文藥名')
  })

  it('aggregates refill counts across package-code variants of one official product', () => {
    const productUrl =
      'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01034670'
    const folicBase = {
      ...medication,
      medicationCodeableConcept: {
        text: '"強生"葉酸膜衣錠５毫克',
        coding: [{ code: 'AC34670100', display: 'FOLACIN F.C. TABLETS 5MG' }],
      },
      drugTerminology: {
        ...medication.drugTerminology,
        officialProductUrl: productUrl,
        ingredientText: 'FOLIC ACID 5 MG',
        doseForm: '膜衣錠',
      },
    }
    const packageVariant = {
      ...folicBase,
      id: 'mr-2',
      authoredOn: '2024-04-02',
      medicationCodeableConcept: {
        ...folicBase.medicationCodeableConcept,
        coding: [{ code: 'AC346701G0', display: 'FOLACIN F.C. TABLETS 5MG' }],
      },
    }

    const { result } = renderHook(() =>
      useMedicationRows([folicBase, packageVariant], 'medical', 'zh-TW'),
    )

    expect(result.current).toHaveLength(2)
    expect(result.current[0].drugKey).toBe(result.current[1].drugKey)
    expect(result.current[0].refillCount).toBe(2)
    expect(result.current[1].refillCount).toBe(2)
  })

  it('uses the exact source period end instead of adding the inclusive day count again', () => {
    const inpatientOrder = {
      ...medication,
      meta: { source: 'ehr-fhir-bridge/scraper' },
      status: 'completed',
      authoredOn: '2025-05-20T00:00:00+08:00',
      dispenseRequest: {
        validityPeriod: {
          start: '2025-05-20T00:00:00+08:00',
          end: '2025-05-21T23:59:59+08:00',
        },
      },
    }

    const { result } = renderHook(() =>
      useMedicationRows([inpatientOrder], 'medical', 'zh-TW'),
    )

    expect(result.current[0].durationDays).toBe(2)
    expect(result.current[0].endDate).toBe(
      new Date(inpatientOrder.dispenseRequest.validityPeriod.end).toLocaleDateString(),
    )
  })

  it('preserves a composite hospital frequency code from the dosage text', () => {
    const sourceSig = {
      ...medication,
      dosageInstruction: [{ text: '1 tablet QDPC' }],
    }

    const { result } = renderHook(() =>
      useMedicationRows([sourceSig], 'medical', 'zh-TW'),
    )

    expect(result.current[0].frequency).toBe('1 tablet QDPC')
    expect(result.current[0].searchHaystack).toContain('qdpc')
  })

  it('keeps an unsupported source dosage instruction visible', () => {
    const localInstruction = {
      ...medication,
      dosageInstruction: [{ text: 'HOSPITAL-LOCAL-SIG' }],
    }

    const { result } = renderHook(() =>
      useMedicationRows([localInstruction], 'medical', 'zh-TW'),
    )

    expect(result.current[0].frequency).toBe('HOSPITAL-LOCAL-SIG')
    expect(result.current[0].searchHaystack).toContain('hospital-local-sig')
  })

  it('combines a structured frequency with its after-meal timing', () => {
    const structuredSig = {
      ...medication,
      dosageInstruction: [{
        timing: {
          code: { coding: [{ code: 'BID' }] },
          repeat: { frequency: 2, period: 1, periodUnit: 'd', when: ['PC'] },
        },
      }],
    }

    const { result } = renderHook(() =>
      useMedicationRows([structuredSig], 'medical', 'zh-TW'),
    )

    expect(result.current[0].frequency).toBe('BIDPC')
  })

  it('maps structured dispense quantity and days into separate row facts', () => {
    const cloudPrescription = {
      ...medication,
      dosageInstruction: [{ text: 'QOD' }],
      dispenseRequest: {
        quantity: { value: 15 },
        expectedSupplyDuration: { value: 30, unit: 'days', code: 'd' },
      },
    }

    const { result } = renderHook(() =>
      useMedicationRows([cloudPrescription], 'medical', 'zh-TW'),
    )

    expect(result.current[0]).toMatchObject({
      frequency: 'QOD',
      totalQuantity: 15,
      durationDays: 30,
    })
  })
})
