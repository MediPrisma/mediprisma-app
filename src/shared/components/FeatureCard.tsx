// Unified Feature Card Wrapper Component
import { ReactNode } from 'react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingSkeleton } from './LoadingSkeleton'
import { ErrorMessage } from './ErrorMessage'
import { EmptyState } from './EmptyState'
import { FEATURE_CARD_THEMES, UI_COLORS } from '@/src/shared/config/ui-theme.config'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/src/shared/utils/cn.utils'

interface FeatureCardProps {
  /** Card header text. Pass empty string / undefined to render without a
   *  header — the content area then sits flush with the top border. */
  title?: string
  featureId?: string // Used to look up theme from FEATURE_CARD_THEMES
  icon?: LucideIcon // Optional custom icon override
  colorKey?: keyof typeof UI_COLORS // Optional custom color override
  isLoading?: boolean
  error?: Error | null
  isEmpty?: boolean
  emptyMessage?: string
  titleAccessory?: ReactNode
  headerAction?: ReactNode
  /** One row: title, content and action side by side. For a card whose whole
   *  content is a line or two of context, so it does not spend a header row
   *  on it. The content drops below the title when the card is too narrow. */
  inline?: boolean
  className?: string
  children: ReactNode
}

export function FeatureCard({
  title,
  featureId,
  icon: customIcon,
  isLoading = false,
  error = null,
  isEmpty = false,
  emptyMessage = "No data available",
  titleAccessory,
  headerAction,
  inline = false,
  className,
  children
}: FeatureCardProps) {
  // Get theme from registry or use defaults
  const theme = featureId ? FEATURE_CARD_THEMES[featureId] : null
  const Icon = customIcon || theme?.icon
  const hasTitle = !!title

  const titleContent = (
    <>
      <span
        data-slot="clinical-section-marker"
        aria-hidden="true"
        className="h-4 w-0.5 shrink-0 rounded-sm bg-primary/70"
      />
      {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      {title}
      {titleAccessory}
    </>
  )
  const body = (
    <>
      {isLoading && (inline ? <div className="h-5 w-2/3 animate-pulse rounded bg-muted" /> : <LoadingSkeleton />)}
      {!isLoading && error && <ErrorMessage error={error} context={(title ?? featureId ?? '').toLowerCase()} />}
      {!isLoading && !error && isEmpty && <EmptyState message={emptyMessage} />}
      {!isLoading && !error && !isEmpty && children}
    </>
  )

  if (inline) {
    // Title | content | action on one row; min-h-8 matches the action button
    // so the title and the content's first line share a baseline. Under 36rem
    // of card width it becomes a wrapping row: title, then the action beside
    // it or — with enlarged text — on the next line, then the content on a
    // line of its own. The action wraps before the title shrinks, and a title
    // wider than the card (Patient Information at 200% text) wraps its words.
    return (
      <Card className={cn("@container/inline-card gap-0 rounded-lg border-border bg-card py-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:shadow-none dark:hover:shadow-none", className)}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 px-3 sm:px-5 @max-[36rem]/inline-card:flex @max-[36rem]/inline-card:flex-wrap @max-[36rem]/inline-card:items-center">
          {hasTitle && (
            <CardTitle className="col-start-1 row-start-1 flex min-h-8 items-center gap-2 text-base">
              {titleContent}
            </CardTitle>
          )}
          <div
            data-slot="card-content"
            className={cn(
              "row-start-1 min-w-0 py-1.5 text-sm leading-5 @max-[36rem]/inline-card:order-last @max-[36rem]/inline-card:basis-full @max-[36rem]/inline-card:pt-0.5",
              hasTitle ? "col-start-2" : "col-span-2 col-start-1",
            )}
          >
            {body}
          </div>
          {headerAction && (
            <div data-slot="card-action" className="col-start-3 row-start-1 flex min-h-8 items-center justify-end gap-1 @max-[36rem]/inline-card:ml-auto @max-[36rem]/inline-card:flex-wrap">
              {headerAction}
            </div>
          )}
        </div>
      </Card>
    )
  }

  return (
  // Base Card is `flex flex-col gap-6 py-6` (shadcn). That 24px flex-gap +
  // 24px vertical padding makes the title↔content spacing feel too airy for
  // dense clinical cards, so tighten both here — phones use the densest
  // spacing so real clinical content starts earlier, while md+ preserves the
  // established desktop rhythm. A neutral boundary replaces accent stripes:
  // clinical color is reserved for status, severity, and selected state.
    <Card className={cn("gap-2 rounded-lg border-border bg-card py-2 shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:shadow-none dark:hover:shadow-none md:py-3", className)}>
      {hasTitle && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {titleContent}
          </CardTitle>
          {headerAction && <CardAction>{headerAction}</CardAction>}
        </CardHeader>
      )}
      <CardContent className="px-3 sm:px-5">
        {body}
      </CardContent>
    </Card>
  )
}
