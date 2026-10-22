"use client"

import { Building2 } from 'lucide-react'
import type { ReportHistoryItem } from '../hooks/useObservationHistory'
import { FormattedReportText } from './FormattedReportText'
import { REPORT_SOURCE_TONE } from './report-color-roles'
import { useLanguage } from '@/src/application/providers/language.provider'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { formatDate as formatCalendarDate } from '@/src/shared/utils/fhir-helpers'

interface ReportHistoryListProps {
  data: ReportHistoryItem[]
}

function formatDate(d: string, locale: string): string {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return d
  }
}

export function ReportHistoryList({ data }: ReportHistoryListProps) {
  const { t, locale } = useLanguage()
  if (data.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        {t.reports.historyEmpty}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.map((item, i) => (
        <div key={item.id || i} className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">{item.calendarDate ? formatCalendarDate(item.calendarDate) : formatDate(item.date, locale)}</span>
            {item.institution && (
              <span className={`inline-flex items-center gap-1 ${REPORT_SOURCE_TONE}`}>
                <Building2 className="h-3 w-3" />
                {formatOrganizationDisplay(item.institution, locale)}
              </span>
            )}
          </div>
          {item.conclusion && (
            <FormattedReportText
              text={item.conclusion}
              className="text-sm leading-relaxed text-foreground/90"
            />
          )}
          {item.notes.length > 0 && (
            <FormattedReportText
              text={item.notes.join('\n\n')}
              className="mt-2 text-sm leading-relaxed text-muted-foreground"
            />
          )}
        </div>
      ))}
    </div>
  )
}
