// 成分名／商品名 applies to the history too: with nothing running there is no
// 使用中 header, and the switch must not vanish with it.
import { fireEvent, render, screen } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

const stopped = {
  id: 'h1',
  title: 'DONEPEZIL HCL 5 MG',
  secondaryTitle: 'Aricept',
  status: 'completed',
  isInactive: true,
  isChronic: false,
  searchHaystack: '',
  startedOn: '2026/8/5',
  endDate: '2026/9/3',
} as MedicationRow

it('offers 成分名／商品名 when every drug is in the history', () => {
  const onNameModeChange = jest.fn()
  render(
    <MedicationList
      medications={[stopped]}
      isLoading={false}
      error={null}
      showNameModeSwitch
      onNameModeChange={onNameModeChange}
      activeActions={<button type="button">複製</button>}
    />,
  )
  expect(screen.queryByRole('button', { name: /使用中/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '商品名' }))
  expect(onNameModeChange).toHaveBeenCalledWith('product')
  // Beside the copy actions, in a row that may wrap rather than clip on a phone.
  const row = screen.getByTestId('medication-list-controls')
  expect(row).toContainElement(screen.getByRole('button', { name: '複製' }))
  expect(row).toHaveClass('flex-wrap')
})
