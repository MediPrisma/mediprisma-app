/**
 * @jest-environment jsdom
 */
// The header's less-used controls are entries of one menu on every screen
// size. This renders them inside an open menu and checks the entries and the
// current audience/language they show; opening the submenus is verified in
// the browser (Radix pointer events are unreliable in jsdom).
import { render, screen } from '@testing-library/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { HeaderMenuItems, PatientAudienceBadge } from '@/src/shared/components/HeaderMenuItems'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { RightPanelProvider } from '@/src/application/providers/right-panel.provider'

function renderMenu() {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightPanelProvider>
          <PatientAudienceBadge />
          <DropdownMenu open>
            <DropdownMenuTrigger>menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <HeaderMenuItems
                importMenu={<DropdownMenuItem>匯入資料</DropdownMenuItem>}
                tourMenu={<DropdownMenuItem>導覽中心</DropdownMenuItem>}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </RightPanelProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

describe('HeaderMenuItems', () => {
  it('lists import, tours, audience, language and display settings', () => {
    renderMenu()
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names).toEqual(['匯入資料', '導覽中心', '使用身份醫療人員', '語言繁體中文', '顯示與關於'])
  })

  it('keeps the 民眾 badge out of the header in the default medical view', () => {
    renderMenu()
    expect(screen.queryByText('民眾')).not.toBeInTheDocument()
  })
})
