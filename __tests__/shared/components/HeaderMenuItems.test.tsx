/**
 * @jest-environment jsdom
 */
// The header's less-used controls are entries of one menu on every screen
// size. This renders them inside an open menu and checks the entries and the
// current audience/language they show; opening the submenus is verified in
// the browser (Radix pointer events are unreliable in jsdom).
import { fireEvent, render, screen } from '@testing-library/react'
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
  beforeEach(() => localStorage.clear())

  it('lists import, tours, audience, language and display settings', () => {
    renderMenu()
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names).toEqual(['匯入資料', '導覽中心', '使用身份醫療人員', '語言繁體中文', '顯示與關於'])
  })

  it('shows the 民眾 badge only in the 民眾 view, and one click on it goes back', () => {
    localStorage.setItem('medical-note-audience', 'patient')
    renderMenu()
    // The open menu hides the rest of the page from the accessibility tree.
    fireEvent.click(screen.getByRole('button', { name: '切回醫療人員', hidden: true }))
    expect(screen.queryByRole('button', { name: '切回醫療人員', hidden: true })).not.toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('使用身份醫療人員')
  })
})
