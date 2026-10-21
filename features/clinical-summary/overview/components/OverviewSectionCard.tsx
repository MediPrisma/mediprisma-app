"use client"

// Thin wrapper over the shared Card primitives with the same anatomy as
// FeatureCard (marker · icon · title · count, actions on the right), plus the
// two things the overview needs and FeatureCard deliberately does not offer:
// a header-right control slot and a height-bounded, non-scrolling body.
import type { ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/src/shared/utils/cn.utils'

export function OverviewSectionCard({
  id,
  title,
  count,
  actions,
  children,
  bounded = false,
  contentRef,
  flash = false,
  headingRef,
}: {
  id?: string
  /** Accepted for callers; a section is named by its title alone. */
  icon?: LucideIcon
  title: string
  count?: string
  actions?: ReactNode
  children: ReactNode
  /** Wide 2×2 mode: the card fills its grid cell and clips instead of
   *  scrolling, so the caller can decide how many rows to render. */
  bounded?: boolean
  contentRef?: Ref<HTMLDivElement>
  /** Narrow mode: the section was just jumped to from the header tiles. */
  flash?: boolean
  headingRef?: Ref<HTMLDivElement>
}) {
  return (
    <Card
      id={id}
      data-overview-section={id}
      className={cn(
        'reveal-scope gap-2 rounded-none border-0 bg-panel py-3 shadow-none',
        // Fill the grid cell rather than hugging the content: the row budget is
        // measured from the content box, so a card that shrank to fit an empty
        // state would never grow back.
        bounded && 'min-h-0 flex-1 overflow-hidden',
      )}
    >
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-1 sm:px-4">
        <CardTitle
          ref={headingRef}
          className={cn(
            'flex min-w-0 flex-auto items-baseline gap-2 text-sm font-semibold tracking-tight',
            flash && 'resource-flash',
          )}
        >
          <span className="whitespace-nowrap">{title}</span>
          {count && (
            <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </CardTitle>
        {actions && (
          <CardAction className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">{actions}</CardAction>
        )}
      </CardHeader>
      <CardContent
        ref={contentRef}
        className={cn(
          'px-1 sm:px-4',
          bounded && 'flex min-h-0 flex-1 flex-col overflow-hidden',
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}
