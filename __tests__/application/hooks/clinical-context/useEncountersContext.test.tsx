import { renderHook } from '@testing-library/react'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useEncountersContext } from '@/src/application/hooks/clinical-context/useEncountersContext'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({
  useNow: () => new Date('2026-07-10T00:00:00Z').getTime(),
}))

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <AudienceProvider>{children}</AudienceProvider>
  </LanguageProvider>
)

function activeMedication(index: number) {
  return {
    id: `med-${index}`,
    status: 'active',
    encounter: { reference: 'Encounter/enc-1' },
    authoredOn: '2026-07-01T00:00:00Z',
    medicationCodeableConcept: { text: `Drug ${String(index).padStart(2, '0')}` },
    dispenseRequest: {
      expectedSupplyDuration: { value: 30, unit: 'days' },
    },
  }
}

describe('useEncountersContext medication chronology', () => {
  it('uses the English medication coding display in the visit-linked row', () => {
    const medication = {
      ...activeMedication(1),
      medicationCodeableConcept: {
        text: '福適佳膜衣錠10毫克',
        coding: [{ display: 'Forxiga Film-coated Tablets 10mg' }],
      },
    }
    const clinicalData = {
      encounters: [{ id: 'enc-1', period: { start: '2026-07-01T00:00:00Z' } }],
      medications: [medication],
    }

    const { result } = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all'),
      { wrapper: Wrapper },
    )
    const context = result.current?.items.join('\n') ?? ''

    expect(context.match(/Forxiga Film-coated Tablets 10mg/g)).toHaveLength(1)
    expect(context).not.toContain('福適佳膜衣錠10毫克')
    expect(context).not.toContain('Currently active medication records')
  })

  it('keeps every visit-linked medication row without repeating the active regimen summary', () => {
    const clinicalData = {
      encounters: [{
        id: 'enc-1',
        period: { start: '2026-07-01T00:00:00Z' },
      }],
      medications: Array.from({ length: 18 }, (_, index) => activeMedication(index + 1)),
    }

    const { result } = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all'),
      { wrapper: Wrapper },
    )

    const items = result.current?.items ?? []
    const medicationRows = items.filter((item) => item.startsWith('      • Drug'))

    expect(items[0]).toBe('Recent visits (showing 1 of 1):')
    expect(medicationRows).toHaveLength(18)
    expect(medicationRows.at(-1)).toContain('Drug 18')
    expect(items.some((item) => item.includes('Currently active medication records'))).toBe(false)
    expect(items.join('\n')).toContain("'Patient's Medications' is the authoritative regimen list")
    expect(items.some((item) => item.includes('…and'))).toBe(false)
  })

  it('names no medicine under a visit when asked only for the count (初診快覽)', () => {
    const clinicalData = {
      encounters: [{
        id: 'enc-1',
        period: { start: '2026-07-01T00:00:00Z' },
        reasonCode: [{ text: '肺炎' }],
      }],
      medications: [activeMedication(1), activeMedication(2)],
    }

    const { result } = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all', { visitMedications: 'count' }),
      { wrapper: Wrapper },
    )
    const context = result.current?.items.join('\n') ?? ''

    expect(context).toContain('Medications prescribed or dispensed at this visit: 2')
    expect(context).toContain("does not state any medicine's indication")
    expect(context).not.toContain('Drug 01')
  })

  it('includes every selected encounter instead of silently limiting the export to 10 visits', () => {
    const clinicalData = {
      encounters: Array.from({ length: 29 }, (_, index) => ({
        id: `enc-${index + 1}`,
        period: { start: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00Z` },
      })),
      medications: [],
    }

    const { result } = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all'),
      { wrapper: Wrapper },
    )

    const items = result.current?.items ?? []
    const visitRows = items.filter((item) => item.startsWith('▶ '))

    expect(items[0]).toBe('Recent visits (showing 29 of 29):')
    expect(visitRows).toHaveLength(29)
    expect(items.some((item) => item.includes('omitted for brevity'))).toBe(false)
  })

  it('marks a not-done procedure as NOT PERFORMED and honours category switches', () => {
    const clinicalData = {
      encounters: [{ id: 'enc-1', period: { start: '2026-07-01T00:00:00Z' } }],
      medications: [activeMedication(1)],
      procedures: [{
        id: 'proc-1',
        status: 'not-done',
        encounter: { reference: 'Encounter/enc-1' },
        performedDateTime: '2026-07-01T00:00:00Z',
        code: { text: 'Bronchoscopy' },
      }],
    }

    const withProcedure = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all', {
        includeMedications: false,
        includeProcedures: true,
        filters: { procedureTimeRange: 'all', procedureVersion: 'all' },
      }),
      { wrapper: Wrapper },
    )
    const included = withProcedure.result.current?.items.join('\n') ?? ''
    expect(included).toContain('Bronchoscopy [status: not-done; NOT PERFORMED]')
    expect(included).not.toContain('Drug 01')

    const withoutProcedure = renderHook(
      () => useEncountersContext(true, clinicalData as any, 'all', {
        includeMedications: false,
        includeProcedures: false,
      }),
      { wrapper: Wrapper },
    )
    expect(withoutProcedure.result.current?.items.join('\n')).not.toContain('Bronchoscopy')
  })
})
