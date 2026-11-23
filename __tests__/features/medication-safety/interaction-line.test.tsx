import { render, screen } from '@testing-library/react'
import { InteractionLine } from '@/features/medication-safety/InteractionLine'
import type { MedicationSafetyTab } from '@/features/medication-safety/useMedicationSafetyTab'

let tab: MedicationSafetyTab
jest.mock('@/features/medication-safety/useMedicationSafetyTab', () => ({
  MEDICATION_SAFETY_FEATURE_ID: 'medication-safety',
  useMedicationSafetyTab: () => tab,
}))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW' }) }))
jest.mock('@/src/application/providers/right-panel.provider', () => ({ useRightPanel: () => ({ revealTab: jest.fn() }) }))

const base: MedicationSafetyTab = { visible: true, unreachable: false, count: 0, avoid: 0, unchecked: 0, notRun: false }

describe('InteractionLine', () => {
  it('says "not checked" when nothing could be sent, not "none found"', () => {
    tab = { ...base, unchecked: 5, notRun: true }
    render(<InteractionLine />)
    expect(screen.getByRole('button')).toHaveTextContent('交互作用未檢核')
    expect(screen.getByRole('button')).not.toHaveTextContent('未發現')
  })

  it('leaves unmatched drugs to the 安全 tab once the check ran', () => {
    tab = { ...base, unchecked: 1 }
    render(<InteractionLine />)
    expect(screen.getByRole('button')).toHaveTextContent('交互作用：未發現需注意的組合')
    expect(screen.getByRole('button')).not.toHaveTextContent('未檢核')
  })
})
