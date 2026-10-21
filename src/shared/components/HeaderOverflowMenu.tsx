// Mobile-only header overflow menu.
//
// On desktop (≥1024px) Audience + Language live as visible controls in the
// header, so there's nothing left to collapse — this component renders
// nothing. On mobile the chips would clip, so we collapse them into a
// kebab `⋯` menu alongside a link into Settings → 顯示與關於 (which
// houses theme, connection info, feedback, and about).
//
// Pattern: Radix DropdownMenu wrapping an icon-only trigger. The whole wrapper
// carries `sm:hidden` so desktop doesn't even mount the trigger.
'use client'

import {
  MoreHorizontal,
  Palette,
  Stethoscope,
  User as UserIcon,
  Languages,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience, type Audience } from '@/src/application/providers/audience.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { getLocaleDisplayName, locales, type Locale } from '@/src/shared/i18n/i18n.config'
import type { ReactNode } from 'react'

const AUDIENCE_ORDER: Audience[] = ['medical', 'patient']

export function HeaderOverflowMenu({
  tourMenu,
  hasNews = false,
}: {
  tourMenu?: ReactNode
  /** Something new waits in the tour hub, whose entry lives in this menu.
   *  A dot on the trigger is the only signal; nothing pops over the chart. */
  hasNews?: boolean
}) {
  const { t, locale, setLocale } = useLanguage()
  const { audience, setAudience } = useAudience()
  const { setActiveTab } = useRightPanel()

  return (
    // Keep the compact menu through tablet widths; the full Audience/Language
    // controls return only once the two-panel workspace has desktop room.
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-tour="header-more"
            className="relative h-9 w-9 text-muted-foreground shadow-none hover:text-foreground hover:shadow-none max-md:h-[44px] max-md:w-[44px]"
            aria-label={(t.header as any)?.moreMenu ?? '更多'}
          >
            <MoreHorizontal className="h-4 w-4" />
            {hasNews && (
              <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t.audience.switcherLabel}
          </DropdownMenuLabel>
          {AUDIENCE_ORDER.map((value) => {
            const ItemIcon = value === 'medical' ? Stethoscope : UserIcon
            const label = value === 'medical' ? t.audience.medical : t.audience.patient
            return (
              <DropdownMenuItem
                key={value}
                onClick={() => setAudience(value)}
                className={`gap-2 ${audience === value ? 'bg-accent' : ''}`}
              >
                <ItemIcon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Languages className="h-4 w-4" />
              {t.header.language}: {getLocaleDisplayName(locale, locale)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                {(Object.keys(locales) as Locale[]).map((loc) => (
                  <DropdownMenuRadioItem key={loc} value={loc}>
                    {getLocaleDisplayName(loc, locale)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {tourMenu}

          <DropdownMenuSeparator />

          {/* All the other formerly-header items (theme, connection info,
              feedback, version) now live in this Settings sub-tab. */}
          <DropdownMenuItem
            onClick={() => setActiveTab('settings', 'display')}
            className="gap-2"
          >
            <Palette className="h-4 w-4" />
            {(t.settings as any).display ?? '顯示與關於'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
