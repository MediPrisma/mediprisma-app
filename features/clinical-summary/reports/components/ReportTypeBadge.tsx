import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import type { ReportGroup } from '../types'

// Report kind is a category, not a state: one neutral tone for every group,
// so colour in a report list only ever means an abnormal result.
const NEUTRAL_TONE = 'border-transparent bg-transparent px-0 font-normal text-muted-foreground'
const TONE_BY_GROUP: Record<ReportGroup, string> = {
  lab: NEUTRAL_TONE,
  imaging: NEUTRAL_TONE,
  pathology: NEUTRAL_TONE,
  'cancer-screening': NEUTRAL_TONE,
  vitals: NEUTRAL_TONE,
  procedures: NEUTRAL_TONE,
  other: NEUTRAL_TONE,
}

export function ReportTypeBadge({
  group,
  className,
  trailing,
}: {
  group: ReportGroup
  className?: string
  /** Small glyph after the label, for callers that make the badge actionable. */
  trailing?: ReactNode
}) {
  const { t } = useLanguage()
  const labels = t.reports.typeBadges
  const labelByGroup: Record<ReportGroup, string> = {
    lab: labels.lab,
    imaging: labels.imaging,
    pathology: labels.pathology,
    'cancer-screening': labels.cancerScreening,
    vitals: labels.vitals,
    procedures: labels.procedures,
    other: labels.other,
  }

  return (
    <Badge
      variant="outline"
      data-testid="report-type-badge"
      className={cn(
        'shrink-0 px-1.5 py-0 text-[0.6875rem]',
        TONE_BY_GROUP[group],
        className,
      )}
    >
      {labelByGroup[group]}
      {trailing}
    </Badge>
  )
}
