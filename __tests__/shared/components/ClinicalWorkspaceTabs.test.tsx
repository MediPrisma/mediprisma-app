/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { ClipboardList } from 'lucide-react'

import { Tabs } from '@/components/ui/tabs'
import {
  ClinicalTabList,
  ClinicalTabTrigger,
} from '@/src/shared/components/clinical-workspace'

describe('Clinical workspace tabs', () => {
  it('names a labelled tab by its words alone', () => {
    render(
      <Tabs defaultValue="summary">
        <ClinicalTabList>
          <ClinicalTabTrigger
            value="summary"
            icon={ClipboardList}
            iconVisibility="panel"
            label="醫療摘要"
          />
        </ClinicalTabList>
      </Tabs>,
    )

    const tab = screen.getByRole('tab', { name: '醫療摘要' })
    expect(tab).toHaveAttribute('title', '醫療摘要')
    expect(tab.querySelector('svg')).toBeNull()
    expect(tab.querySelector('span')).toHaveClass('truncate')
    expect(tab.querySelector('span')).not.toHaveClass('@max-[28rem]:hidden')
  })

  it('keeps an icon only where the label is hidden', () => {
    render(
      <Tabs defaultValue="summary">
        <ClinicalTabList>
          <ClinicalTabTrigger
            value="summary"
            icon={ClipboardList}
            label="醫療摘要"
            labelVisibility="never"
          />
        </ClinicalTabList>
      </Tabs>,
    )

    const tab = screen.getByRole('tab', { name: '醫療摘要' })
    expect(tab.querySelector('svg')).not.toBeNull()
    expect(tab).toHaveAttribute('aria-label', '醫療摘要')
  })
})
