import { render, renderHook, screen } from '@testing-library/react'
import { resolveHospitalMedicationName } from '@/src/shared/utils/hospital-medication-names'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { useMedicationTimeline } from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'
import { HospitalMedicationNameDetails } from '@/features/clinical-summary/medications/components/MedicationTerminologyTooltip'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }),
}))

function concept(generic?: string, product?: string) {
  return {
    text: [generic, product].filter(Boolean).join(' / '),
    coding: [
      ...(generic ? [{ system: 'urn:oid:vgh.medication.generic', code: generic, display: generic }] : []),
      ...(product ? [{ system: 'urn:oid:vgh.medication.product', code: product, display: product }] : []),
    ],
  }
}
function medication(generic?: string, product?: string, id = 'med-1') {
  return {
    resourceType: 'MedicationRequest', id, status: 'active', authoredOn: '2026-10-01',
    medicationCodeableConcept: concept(generic, product),
    dispenseRequest: { expectedSupplyDuration: { value: 30, unit: 'days' } },
  }
}

describe('VGH hospital medication ingredient display', () => {
  it('does not hide a same-name same-day prescription from a different clinic', () => {
    const hospital = medication('Letrozole FC tab 2.5 mg', undefined, 'hospital')
    const other = { ...medication(undefined, undefined, 'other'),
      medicationCodeableConcept: { text: 'Letrozole FC tab 2.5 mg' }, requester: { display: 'Other clinic' } }
    const { result } = renderHook(() => useMedicationRows([hospital, other]))
    expect(result.current.map((row) => row.id).sort()).toEqual(['hospital', 'other'])
  })

  it.each(['N', '否', '無', '0', 'UNKNOWN'])('does not label the source self-purchase value %s as self-pay', (value) => {
    const source = { ...medication('Letrozole FC tab 2.5 mg'), note: [{ text: `自購：${value}` }, { text: '非慢箋' }] }
    const { result } = renderHook(() => useMedicationRows([source]))
    expect(result.current[0].selfPurchased).toBe(false)
    expect(result.current[0].isChronic).toBe(false)
  })

  it('retains explicitly recorded self-pay and chronic-prescription markers', () => {
    const source = { ...medication('Letrozole FC tab 2.5 mg'), note: [{ text: '自購：Y' }, { text: '慢簽' }] }
    const { result } = renderHook(() => useMedicationRows([source]))
    expect(result.current[0].selfPurchased).toBe(true)
    expect(result.current[0].isChronic).toBe(true)
  })

  it('uses the same-row explicit generic and retains brand/form/strength for switching and search', () => {
    const source = medication('Letrozole FC tab 2.5 mg', 'Femara FC tab 2.5 mg')
    const original = JSON.stringify(source)
    const { result } = renderHook(() => useMedicationRows([source], 'medical', 'zh-TW'))
    expect(result.current[0]).toMatchObject({
      title: 'Letrozole 2.5 mg', secondaryTitle: 'Femara FC tab 2.5 mg',
      hospitalMedicationName: { source: 'recorded-generic-name', status: 'normalized' },
    })
    expect(result.current[0].drugTerminology).toBeUndefined()
    expect(result.current[0].searchHaystack).toContain('femara')
    expect(result.current[0].searchHaystack).toContain('letrozole')
    expect(JSON.stringify(source)).toBe(original)
  })

  it.each([
    ['Aromasin SC tab 25 mg', 'Exemestane'],
    ['Bio-cal plus chewable tab "pay"', 'Tricalcium phosphate / Cholecalciferol'],
    ['Meitifen SR FC * tab 75 mg', 'Diclofenac sodium'],
    ['PAXLOVID tab (eGFR&gt;59,30 tabs)', 'Nirmatrelvir / Ritonavir'],
  ])('resolves the verified recorded product alias %s', (product, ingredientName) => {
    expect(resolveHospitalMedicationName(concept(undefined, product))).toMatchObject({
      status: 'normalized', ingredientName, source: 'verified-product-alias',
      referenceUrl: expect.stringMatching(/^https:\/\//),
    })
  })

  it('handles a brand incorrectly placed in the generic field without calling it source ingredient evidence', () => {
    expect(resolveHospitalMedicationName(concept('Bio-cal plus chewable tab "pay"'))).toMatchObject({
      source: 'verified-product-alias', ingredientName: 'Tricalcium phosphate / Cholecalciferol',
    })
  })

  it('does not guess a changed strength, another brand variant, arbitrary free text, or another coding system', () => {
    for (const name of ['Aromasin SC tab 50 mg', 'Bio-cal chewable tab "pay"', 'Aromasin Forte SC tab 25 mg']) {
      expect(resolveHospitalMedicationName(concept(undefined, name))).toMatchObject({ status: 'unresolved' })
    }
    expect(resolveHospitalMedicationName({ text: 'Aromasin SC tab 25 mg' } as never)).toBeUndefined()
    expect(resolveHospitalMedicationName({ coding: [{ system: 'https://example.test/drugs', display: 'Aromasin SC tab 25 mg' }] })).toBeUndefined()
  })

  it('leaves conflicting or ambiguous source names unresolved', () => {
    expect(resolveHospitalMedicationName(concept('Letrozole FC tab 2.5 mg', 'Aromasin SC tab 25 mg')))
      .toMatchObject({ status: 'unresolved' })
    expect(resolveHospitalMedicationName(concept('Unknown generic', 'Femara FC tab 2.5 mg')))
      .toMatchObject({ status: 'unresolved' })
    expect(resolveHospitalMedicationName(concept('Aromasin SC tab 25 mg', 'Femara FC tab 2.5 mg')))
      .toMatchObject({ status: 'unresolved' })
    const ambiguous = concept('Letrozole FC tab 2.5 mg', 'Femara FC tab 2.5 mg')
    ambiguous.coding.push({ system: 'urn:oid:vgh.medication.generic', code: 'Trastuzumab Emtansine##*inj100mg', display: 'Trastuzumab Emtansine##*inj100mg' })
    expect(resolveHospitalMedicationName(ambiguous)).toMatchObject({ status: 'unresolved' })
  })

  it('retains combination ingredients and distinguishes trastuzumab emtansine from trastuzumab', () => {
    expect(resolveHospitalMedicationName(concept('Netupitant/Palonosetron cap', 'Akynzeo cap 300 mg/0.5 mg')))
      .toMatchObject({ ingredientName: 'Netupitant / Palonosetron' })
    expect(resolveHospitalMedicationName(concept('Trastuzumab Emtansine##*inj100mg')))
      .toMatchObject({ ingredientName: 'Trastuzumab emtansine' })
    expect(resolveHospitalMedicationName(concept('Trastuzumab "USA" ##* inj 1 mg')))
      .toMatchObject({ ingredientName: 'Trastuzumab' })
  })

  it('copies only recorded product strength and never substitutes prescribed dose or package size', () => {
    const source = { ...medication('Trastuzumab Emtansine##*inj100mg'), dosageInstruction: [{ text: 'Administer 250 mg' }] }
    const { result } = renderHook(() => useMedicationRows([source], 'medical', 'zh-TW'))
    expect(result.current[0].title).toBe('Trastuzumab emtansine 100 mg')
    expect(resolveHospitalMedicationName(concept('Benazon oint 20 g'))?.recordedStrengthText).toBeUndefined()
    expect(resolveHospitalMedicationName(concept('Platycodon fluidextract 120 ml'))?.recordedStrengthText).toBeUndefined()
    expect(resolveHospitalMedicationName(concept('Dextrose "YF"5%/0.45%NSinj 500ml')))
      .toMatchObject({ ingredientName: 'Dextrose / Sodium chloride', recordedStrengthText: '5% / 0.45%' })
  })

  it('keeps distinct source products and strengths separate despite identical ingredient labels', () => {
    const sources = [
      medication('Trastuzumab Emtansine##*inj100mg', 'Kadcyla powder for##* infu 100mg'),
      medication('Trastuzumab Emtansine##*inj160mg', 'Kadcyla powder for##* infu 160mg', 'med-2'),
    ]
    const { result } = renderHook(() => useMedicationRows(sources, 'medical', 'zh-TW'))
    expect(result.current).toHaveLength(2)
    expect(result.current[0].title).toBe('Trastuzumab emtansine 100 mg')
    expect(result.current[1].title).toBe('Trastuzumab emtansine 160 mg')
    expect(result.current[0].drugKey).not.toBe(result.current[1].drugKey)
    const timeline = renderHook(() => useMedicationTimeline(sources, 'medical', 'all', '其他'))
    expect(timeline.result.current.drugs).toHaveLength(2)
    expect(timeline.result.current.drugs[0]).toMatchObject({
      drugName: 'Trastuzumab emtansine 100 mg', hospitalMedicationName: { status: 'normalized' },
    })
  })

  it('preserves exact official NHI terminology precedence and patient source-language behavior', () => {
    const source = medication('Letrozole FC tab 2.5 mg', 'Femara FC tab 2.5 mg')
    const official = { ...source, drugTerminology: { ingredientText: 'LETROZOLE 2.5 MG', officialNameEn: 'Official Femara' } }
    const medical = renderHook(() => useMedicationRows([official], 'medical', 'zh-TW'))
    expect(medical.result.current[0]).toMatchObject({ title: 'LETROZOLE 2.5 MG', secondaryTitle: 'Official Femara' })
    expect(medical.result.current[0].hospitalMedicationName).toBeUndefined()
    const patient = renderHook(() => useMedicationRows([source], 'patient', 'zh-TW'))
    expect(patient.result.current[0].title).toBe(source.medicationCodeableConcept.text)
    expect(patient.result.current[0].secondaryTitle).toBeUndefined()
  })

  it('shows original fields, unresolved state, and an auditable reference instead of an NHI-match claim', () => {
    const name = resolveHospitalMedicationName(concept(undefined, 'Aromasin SC tab 25 mg'))!
    const view = render(<HospitalMedicationNameDetails name={name} />)
    expect(screen.getByText('Exemestane')).toBeInTheDocument()
    expect(screen.getByText('Aromasin SC tab 25 mg')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '成分對照來源' })).toHaveAttribute('href', name.referenceUrl)
    expect(screen.queryByText('健保藥品主檔')).not.toBeInTheDocument()
    view.rerender(<HospitalMedicationNameDetails name={resolveHospitalMedicationName(concept(undefined, 'Unknown brand'))!} />)
    expect(screen.getByText('成分未確認')).toBeInTheDocument()
    expect(screen.getByText('Unknown brand')).toBeInTheDocument()
  })
})
