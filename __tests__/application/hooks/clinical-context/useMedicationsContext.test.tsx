import { renderHook, waitFor } from '@testing-library/react'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useMedicationsContext } from '@/src/application/hooks/clinical-context/useMedicationsContext'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({
  useNow: () => new Date('2026-07-10T00:00:00Z').getTime(),
}))

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <AudienceProvider>{children}</AudienceProvider>
  </LanguageProvider>
)

function pastMedication(index: number) {
  return {
    id: `past-med-${index}`,
    status: 'completed',
    authoredOn: `2025-0${index}-01T00:00:00Z`,
    medicationCodeableConcept: { text: `Past Drug ${index}` },
    dispenseRequest: {
      expectedSupplyDuration: { value: 30, unit: 'days' },
    },
  }
}

describe('useMedicationsContext full export', () => {
  it('uses English coding.display for AI context even in patient audience mode', async () => {
    localStorage.setItem('medical-note-audience', 'patient')
    const clinicalData = {
      medications: [{
        id: 'forxiga',
        status: 'active',
        authoredOn: '2026-07-01',
        medicationCodeableConcept: {
          text: '福適佳膜衣錠10毫克',
          coding: [{ display: 'Forxiga Film-coated Tablets 10mg' }],
        },
      }],
    }

    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'all',
      } as any),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      const context = result.current?.items.join('\n') ?? ''
      expect(context).toContain('Forxiga Film-coated Tablets 10mg')
      expect(context).not.toContain('福適佳膜衣錠10毫克')
    })
    localStorage.removeItem('medical-note-audience')
  })

  it('pairs each medication with only its own exact NHI terminology', () => {
    const clinicalData = {
      medications: [{
        id: 'betmiga',
        status: 'active',
        authoredOn: '2026-07-01',
        medicationCodeableConcept: {
          text: '貝坦利持續性藥效錠50毫克',
          coding: [{
            system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code',
            code: 'BC26216100',
            display: 'Betmiga Prolonged-release Tablets 50mg',
          }],
        },
        drugTerminology: {
          source: 'nhi-official-drug-master',
          snapshotId: 'nhi-drug-terminology-20260728',
          officialNameZh: '貝坦利持續性藥效錠50毫克',
          officialNameEn: 'Betmiga Prolonged-release Tablets 50mg',
          ingredientText: 'Mirabegron 50 MG',
          doseForm: '持續性藥效錠',
          atcCode: 'G04BD12',
          atcNameEn: 'mirabegron',
          atcLevel2Code: 'G04',
          atcLevel2NameZh: '泌尿系統用藥',
          atcLevel2NameEn: 'UROLOGICALS',
        },
      }, {
        id: 'other-drug',
        status: 'active',
        authoredOn: '2026-07-02',
        medicationCodeableConcept: {
          coding: [{
            system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code',
            code: 'B000000100',
            display: 'Drug B 10mg',
          }],
        },
        drugTerminology: {
          source: 'nhi-official-drug-master',
          snapshotId: 'nhi-drug-terminology-20260728',
          ingredientText: 'INGREDIENT B 10 MG',
          atcCode: 'A01AA01',
          atcNameEn: 'ingredient-b',
          atcLevel2Code: 'A01',
          atcLevel2NameEn: 'STOMATOLOGICAL PREPARATIONS',
        },
      }],
    }

    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'all',
      } as any),
      { wrapper: Wrapper },
    )

    const betmiga = result.current?.items.find((item) =>
      item.includes('Betmiga Prolonged-release Tablets 50mg'),
    ) ?? ''
    const other = result.current?.items.find((item) =>
      item.includes('Drug B 10mg'),
    ) ?? ''

    expect(betmiga).toContain('NHI terminology matched to this exact medication record')
    expect(betmiga).toContain('NHI code=BC26216100')
    expect(betmiga).toContain('ingredient/strength=Mirabegron 50 MG')
    expect(betmiga).toContain('official product zh=貝坦利持續性藥效錠50毫克')
    expect(betmiga).toContain('dose form=持續性藥效錠')
    expect(betmiga).toContain('ATC=G04BD12 · mirabegron')
    expect(betmiga).toContain('ATC therapeutic subgroup=G04 · UROLOGICALS / 泌尿系統用藥')
    expect(betmiga).not.toContain('INGREDIENT B')

    expect(other).toContain('ingredient/strength=INGREDIENT B 10 MG')
    expect(other).not.toContain('Mirabegron')
    expect(result.current?.items.join('\n')).toContain(
      'each NHI terminology block belongs only to the medication row that contains it',
    )
  })

  it('lists past medications instead of replacing them with an omitted count', () => {
    const clinicalData = {
      medications: [pastMedication(1), pastMedication(2), pastMedication(3)],
    }

    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'all',
      } as any),
      { wrapper: Wrapper },
    )

    const items = result.current?.items ?? []
    const medicationRows = items.filter((item) => item.startsWith('  • Past Drug'))

    expect(items[0]).toBe('Past medications (older than 90 days, 3):')
    expect(medicationRows).toHaveLength(3)
    expect(items.some((item) => item.includes('omitted for brevity'))).toBe(false)
  })

  it('never promotes draft, on-hold, or entered-in-error records to current medication', () => {
    const clinicalData = {
      medications: [
        { id: 'draft', status: 'draft', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Draft Drug' } },
        { id: 'hold', status: 'on-hold', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Held Drug' } },
        { id: 'error', status: 'entered-in-error', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Invalid Drug' } },
      ],
    }
    const all = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'all',
      } as any),
      { wrapper: Wrapper },
    )

    expect(all.result.current?.items).toContain('Other medication records — not active (3):')
    expect(all.result.current?.items.join('\n')).toContain('INVALIDATED—do not treat as a medication')
    expect(all.result.current?.items.join('\n')).toContain('ON HOLD—not currently in use')
    expect(all.result.current?.items.some((item) => item.startsWith('Currently in use'))).toBe(false)

    const activeOnly = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'active',
      } as any),
      { wrapper: Wrapper },
    )
    expect(activeOnly.result.current).toBeNull()
  })

  it('uses the supply window for MediCloud-style unknown status', () => {
    const clinicalData = {
      medications: [
        {
          id: 'unknown-current',
          status: 'unknown',
          authoredOn: '2026-07-08',
          medicationCodeableConcept: { text: 'Unknown status current drug' },
          dispenseRequest: {
            expectedSupplyDuration: { value: 5, unit: 'days' },
          },
        },
        {
          id: 'unknown-expired',
          status: 'unknown',
          authoredOn: '2026-06-01',
          medicationCodeableConcept: { text: 'Unknown status expired drug' },
          dispenseRequest: {
            expectedSupplyDuration: { value: 5, unit: 'days' },
          },
        },
      ],
    }

    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'all',
      } as any, false, new Date('2026-07-10T12:00:00+08:00').getTime()),
      { wrapper: Wrapper },
    )

    expect(result.current?.items).toContain('Currently in use (1):')
    expect(result.current?.items.find((item) => item.includes('Unknown status current drug')))
      .toContain('until 2026-07-13')
    expect(result.current?.items.find((item) => item.includes('Unknown status expired drug')))
      .toContain('last ended 2026-06-06')
  })

  // A chemotherapy patient between cycles has ONE current medicine. The DM
  // regimen dispensed three months ago is what the focus / problems / safety
  // modules actually need, and it used to reach none of them: the floor added
  // the records, then the 使用中 filter cleared the buckets they landed in.
  it('surfaces the floor medicines in their own labelled subsection', () => {
    const clinicalData = {
      medications: [
        {
          id: 'letrozole', status: 'completed', authoredOn: '2026-07-01',
          medicationCodeableConcept: { text: 'LETROZOLE TABLETS 2.5MG' },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
          requester: { display: '臺北榮總' },
        },
        {
          id: 'metformin', status: 'completed', authoredOn: '2026-01-12',
          medicationCodeableConcept: { text: 'Metformin 500mg Tablets' },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
          requester: { display: '示範診所' },
        },
        {
          id: 'glargine', status: 'completed', authoredOn: '2026-01-12',
          medicationCodeableConcept: { text: 'Insulin glargine pen' },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
          requester: { display: '示範診所' },
        },
      ],
    }
    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'active',
      } as any, false, new Date('2026-07-10T00:00:00Z').getTime()),
      { wrapper: Wrapper },
    )

    const items = result.current?.items ?? []
    const text = items.join('\n')
    expect(items).toContain('Currently in use (1):')
    expect(text).toContain('LETROZOLE TABLETS 2.5MG')
    expect(items).toContain('Recently dispensed, supply ended (last 24 months, 2) — NOT currently in use:')
    expect(text).toContain('Metformin 500mg Tablets — last dispensed 2026-01-12 (28d supply, ended 2026-02-09)')
    expect(text).toContain('Insulin glargine pen — last dispensed 2026-01-12 (28d supply, ended 2026-02-09)')
    expect(text).toContain('[開立 by 示範診所]')
    // The existing notes are still there.
    expect(text).toContain('Record-fidelity note:')
    expect(text).toContain('Terminology note:')
  })

  it('words a passed supply as an estimate, not a stop, for the first-visit summary', () => {
    const clinicalData = {
      medications: [{
        id: 'metformin', status: 'completed', authoredOn: '2026-01-12',
        medicationCodeableConcept: { text: 'Metformin 500mg Tablets' },
        dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
        requester: { display: '示範診所' },
      }],
    }
    const render = (wording?: 'neutral') => renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'active',
      } as any, false, new Date('2026-07-10T00:00:00Z').getTime(), wording),
      { wrapper: Wrapper },
    ).result.current?.items.join('\n') ?? ''

    const neutral = render('neutral')
    expect(neutral).not.toContain('NOT currently in use')
    expect(neutral).toContain('estimated supply already passed')
    expect(neutral).toContain('current use is not known from these records')
    expect(neutral).toContain('Metformin 500mg Tablets — last dispensed 2026-01-12 (28d supply, estimated to 2026-02-09)')
    expect(neutral).toContain('a long-acting injection')
    // Every other consumer keeps the established wording.
    expect(render()).toContain('NOT currently in use')
  })

  it('never presents a draft, held or cancelled order as recently dispensed', () => {
    const clinicalData = {
      medications: [
        { id: 'draft', status: 'draft', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Draft Drug' } },
        { id: 'hold', status: 'on-hold', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Held Drug' } },
        { id: 'cancelled', status: 'cancelled', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Cancelled Drug' } },
        {
          id: 'real', status: 'completed', authoredOn: '2026-01-12',
          medicationCodeableConcept: { text: 'Real Dispensed Drug' },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days' } },
        },
      ],
    }
    const { result } = renderHook(
      () => useMedicationsContext(true, clinicalData as any, {
        medicationTimeRange: 'all',
        medicationChronic: 'all',
        medicationStatus: 'active',
      } as any, false, new Date('2026-07-10T00:00:00Z').getTime()),
      { wrapper: Wrapper },
    )
    const text = result.current?.items.join('\n') ?? ''
    expect(text).toContain('Real Dispensed Drug')
    expect(text).not.toContain('Draft Drug')
    expect(text).not.toContain('Held Drug')
    expect(text).not.toContain('Cancelled Drug')
  })
})
