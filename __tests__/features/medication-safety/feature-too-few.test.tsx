import { render, screen } from '@testing-library/react'
import MedicationSafetyFeature from '@/features/medication-safety/Feature'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

const row = (id: string, title: string): MedicationRow =>
  ({ id, title, status: 'active', isInactive: false, isChronic: false, refillCount: 1, searchHaystack: '' })

jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW' }) }))
jest.mock('@/features/clinical-summary/medications/hooks/useInteractionCheck', () => ({
  useInteractionCheck: () => ({
    state: { status: 'too-few', localRowIds: ['oint', 'oint-2'] },
    rows: [row('oint', 'NEOMYCIN (SULFATE) 3.5 MG/GM'), row('oint-2', 'NEOMYCIN (SULFATE) 3.5 MG/GM'), row('tab', 'WARFARIN SODIUM 1 MG')],
    retry: () => {},
  }),
}))

describe('MedicationSafetyFeature', () => {
  it('names the skin preparations left out even when too few ingredients remain to check', () => {
    render(<MedicationSafetyFeature />)
    expect(screen.getByRole('status')).toHaveTextContent('可檢核的成分不足兩項，交互作用未檢核。')
    expect(screen.getByText('外用藥不列入檢核：NEOMYCIN (SULFATE) 3.5 MG/GM')).toBeInTheDocument()
  })
})
