'use client'

import { Map } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useGuidedTourStore } from './guided-tour.store'
import { useUnseenNews } from './use-unseen-news'

function NewsDot({ count, english }: { count: number; english: boolean }) {
  if (count === 0) return null
  return (
    <>
      <span aria-hidden="true" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
      <span className="sr-only">{english ? `${count} new` : `${count} 項新功能`}</span>
    </>
  )
}

/** The header entry to the tour hub, with a dot while something is new. */
export function TourHubButton({ disabled = false }: { disabled?: boolean }) {
  const { locale } = useLanguage()
  const openHub = useGuidedTourStore((state) => state.openHub)
  const unseen = useUnseenNews().length
  const english = locale === 'en'
  const label = english ? 'Tours' : '導覽中心'

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      data-tour="tour-hub-button"
      onClick={openHub}
      className="relative hidden h-9 gap-1.5 px-0 sm:inline-flex sm:w-9 lg:w-auto lg:px-3 @max-[72rem]:w-9 @max-[72rem]:px-0"
      title={label}
      aria-label={label}
    >
      <Map className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline @max-[72rem]:hidden">{english ? 'Tours' : '導覽'}</span>
      <NewsDot count={unseen} english={english} />
    </Button>
  )
}

/** The same entry inside the compact header's 更多 menu. */
export function TourHubMenuItem({ disabled = false }: { disabled?: boolean }) {
  const { locale } = useLanguage()
  const openHub = useGuidedTourStore((state) => state.openHub)
  const unseen = useUnseenNews().length
  const english = locale === 'en'

  return (
    <DropdownMenuItem
      disabled={disabled}
      className="min-h-[44px] gap-2"
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
