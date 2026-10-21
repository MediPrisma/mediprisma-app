"use client"

import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { cn } from '@/src/shared/utils/cn.utils'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { REPORT_SOURCE_TONE } from './report-color-roles'
import { sourceInstitutionDisplay } from '../utils/source-institution-display'
import type { HospitalSource } from '../adapters/vghtpe-source-display'

/** Backwards-compatible name for report callers and tests. */
export const formatReportInstitution = formatOrganizationDisplay

/** Compact institution label that always exposes its complete source text.
 *  The label truncates, so "which hospital ran this?" lives ONLY in the bubble
 *  — TapTooltip keeps that answer reachable on a touch screen. By default it
 *  also stops the tap from propagating, so ordinary report rows reveal the
 *  name instead of toggling the row. */
export function ReportInstitutionLabel({
  institution,
  hospitalSource,
  className,
  stopPropagation = true,
  locale = 'zh-TW',
}: {
  institution: string
  hospitalSource?: HospitalSource
  className?: string
  /** Keep the default tooltip-only tap in ordinary report rows. Group-header
   *  buttons can opt out so the institution still toggles the whole row. */
  stopPropagation?: boolean
  locale?: string
}) {
  const { name: institutionName, suffix: sourceSuffix, label: displayInstitution } = sourceInstitutionDisplay(institution, hospitalSource, locale)
  return (
    <TapTooltip
      side="top"
      aria-label={displayInstitution}
      contentClassName="max-w-sm break-words text-left"
      content={displayInstitution}
      stopPropagation={stopPropagation}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-xs',
        REPORT_SOURCE_TONE,
        className,
      )}
    >
      <span className="truncate">{institutionName}</span>
      {sourceSuffix && <span className="min-w-0 truncate">{sourceSuffix}</span>}
    </TapTooltip>
  )
}
