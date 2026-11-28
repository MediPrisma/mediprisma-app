'use client'

import { Map } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useGuidedTourStore } from './guided-tour.store'
import { useUnseenNews } from './use-unseen-news'

/** The entry to the tour hub, inside the header menu. */
export function TourHubMenuItem({ disabled = false }: { disabled?: boolean }) {
  const { locale } = useLanguage()
  const openHub = useGuidedTourStore((state) => state.openHub)
  const unseen = useUnseenNews().length
  const english = locale === 'en'

  return (
    <DropdownMenuItem
      disabled={disabled}
      className="min-h-[36px] gap-2 max-md:min-h-[44px]"
      // Let the menu finish closing (and hand focus back) before the hub
      // dialog takes focus; opening in the same tick loses the dialog's focus.
      onSelect={() => { window.setTimeout(openHub, 0) }}
    >
      <Map className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1">{english ? 'Tours' : '導覽中心'}</span>
      {unseen > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-[18px] text-primary-foreground">
          {unseen}
          <span className="sr-only">{english ? ' new' : ' 項新功能'}</span>
        </span>
      )}
    </DropdownMenuItem>
  )
}
