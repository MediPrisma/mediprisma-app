// The less-used header controls, as entries of the header's one menu
// (HeaderAuthButton renders them under the account section): import, tours,
// audience, language, and the link into Settings → 顯示與關於 (theme,
// connection info, feedback, about). Phone and desktop get the same menu.
//
// Import and tours belong to their own features, so the header passes them in.
'use client'

import {
  Palette,
  Stethoscope,
  User as UserIcon,
  Languages,
  X,
} from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience, type Audience } from '@/src/application/providers/audience.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { getLocaleDisplayName, locales, type Locale } from '@/src/shared/i18n/i18n.config'
import type { ReactNode } from 'react'

const AUDIENCE_ORDER: Audience[] = ['medical', 'patient']

export function HeaderMenuItems({
  importMenu,
  tourMenu,
}: {
  importMenu?: ReactNode
  tourMenu?: ReactNode
}) {
  const { t, locale, setLocale } = useLanguage()
  const { audience, setAudience } = useAudience()
  const { setActiveTab } = useRightPanel()
  const audienceLabel = (value: Audience) => (value === 'medical' ? t.audience.medical : t.audience.patient)
  const AudienceIcon = audience === 'medical' ? Stethoscope : UserIcon

  return (
    <>
      {importMenu}
      {tourMenu}
      {(importMenu || tourMenu) && <DropdownMenuSeparator />}

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="min-h-[36px] gap-2 max-md:min-h-[44px]">
          <AudienceIcon className="h-4 w-4" />
          <span className="flex-1">{t.audience.switcherLabel}</span>
          <span className="text-xs text-muted-foreground">{audienceLabel(audience)}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={audience} onValueChange={(value) => setAudience(value as Audience)}>
            {AUDIENCE_ORDER.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {audienceLabel(value)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="min-h-[36px] gap-2 max-md:min-h-[44px]">
          <Languages className="h-4 w-4" />
          <span className="flex-1">{t.header.language}</span>
          <span className="text-xs text-muted-foreground">{getLocaleDisplayName(locale, locale)}</span>
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

      <DropdownMenuItem
        onSelect={() => setActiveTab('settings', 'display')}
        className="min-h-[36px] gap-2 max-md:min-h-[44px]"
      >
        <Palette className="h-4 w-4" />
        {(t.settings as any).display ?? '顯示與關於'}
      </DropdownMenuItem>
    </>
  )
}

/** Shown in the header only while the app is in the non-default 民眾 view,
 *  so a clinician is never in it without knowing; one click goes back (the
 *  same shape as the 示範資料 badge). */
export function PatientAudienceBadge() {
  const { t } = useLanguage()
  const { audience, setAudience } = useAudience()
  if (audience !== 'patient') return null
  return (
    <button
      type="button"
      onClick={() => setAudience('medical')}
      title={t.audience.backToMedical}
      aria-label={t.audience.backToMedical}
      className="group flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-sky-500/10 dark:text-sky-300 dark:ring-1 dark:ring-inset dark:ring-sky-500/25 dark:hover:bg-sky-500/15 max-md:h-[44px] max-md:rounded-md max-md:px-2.5"
    >
      <UserIcon className="h-3 w-3" aria-hidden="true" />
      {t.audience.patient}
      <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </button>
  )
}
