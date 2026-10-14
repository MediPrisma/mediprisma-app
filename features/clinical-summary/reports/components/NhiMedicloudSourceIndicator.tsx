"use client"

import { Info } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { InfoHint } from '@/src/shared/components/InfoHint'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { cn } from '@/src/shared/utils/cn.utils'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'

function SourceDetails({ institution }: { institution?: string }) {
  const { t } = useLanguage()
  const labels = t.reports.sourceProvenance.nhiMedicloud
  const originalInstitution = institution || labels.institutionUnavailable

  return (
    <div data-testid="nhi-medicloud-source-details" className="space-y-1 text-left text-xs leading-relaxed">
      <div>
        <span className="font-semibold">{labels.sourceLabel}：</span>
        {labels.formalName}
      </div>
      <div>
        <span className="font-semibold">{labels.originalInstitutionLabel}：</span>
        {originalInstitution}
      </div>
      <p className="border-t border-current/20 pt-1">
        {labels.tooltip}
      </p>
    </div>
  )
}

/**
 * Observation.extension-derived MediCloud provenance. The compact label keeps
 * dense report lists scannable; the full official name, original institution,
 * and clinical-use caveat remain available by hover, focus, or tap.
 */
export function NhiMedicloudSourceIndicator({
  institution,
  iconOnly = false,
  compact = false,
  className,
  stopPropagation = true,
}: {
  institution?: string
  iconOnly?: boolean
  /** One line for a narrow table cell: icon + institution (or the short
   *  source name when the record carries none). Everything else — the formal
   *  name, the original institution, the caveat — stays in the bubble. */
  compact?: boolean
  className?: string
  stopPropagation?: boolean
}) {
  const { t, locale } = useLanguage()
  const labels = t.reports.sourceProvenance.nhiMedicloud
  const displayInstitution = institution
    ? formatOrganizationDisplay(institution, locale)
    : undefined
  const compactInstitution = displayInstitution || labels.institutionUnavailableCompact
  const accessibleLabel = `${labels.sourceLabel}：${labels.formalName}；${labels.originalInstitutionLabel}：${displayInstitution || labels.institutionUnavailable}`
  const details = <SourceDetails institution={displayInstitution} />

  if (iconOnly) {
    return (
      <InfoHint
        aria-label={accessibleLabel}
        side="top"
        className={cn('h-6 w-6 shrink-0 text-primary/80 hover:text-primary', className)}
        iconClassName="h-3.5 w-3.5"
        contentClassName="max-w-sm"
      >
        {details}
      </InfoHint>
    )
  }

  if (compact) {
    return (
      <TapTooltip
        asChild
        side="top"
        aria-label={accessibleLabel}
        contentClassName="max-w-sm"
        content={details}
        stopPropagation={stopPropagation}
      >
        <span
          tabIndex={0}
          data-testid="nhi-medicloud-source"
          data-compact="true"
          className={cn(
            'inline-flex min-w-0 cursor-pointer touch-manipulation items-center gap-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            className,
          )}
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
          <span className="min-w-0 truncate">{displayInstitution || labels.compactLabel}</span>
        </span>
      </TapTooltip>
    )
  }

  return (
    <TapTooltip
      asChild
      side="top"
      aria-label={accessibleLabel}
      contentClassName="max-w-sm"
      content={details}
      stopPropagation={stopPropagation}
    >
      <span
        tabIndex={0}
        data-testid="nhi-medicloud-source"
        className={cn(
          'inline-flex min-w-0 cursor-pointer touch-manipulation flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        )}
      >
        <span className="inline-flex shrink-0 items-center gap-1">
          <Info className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
          <span className="font-medium text-foreground/80">{labels.shortLabel}</span>
        </span>
        <span className={cn('inline-flex items-center gap-1', displayInstitution ? 'min-w-0 flex-1' : 'shrink-0')}>
          <span className="shrink-0 select-none text-muted-foreground/60" aria-hidden>｜</span>
          <span className={displayInstitution ? 'min-w-0 truncate' : undefined}>{compactInstitution}</span>
        </span>
      </span>
    </TapTooltip>
  )
}
