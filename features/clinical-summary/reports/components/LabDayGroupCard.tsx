// LabDayGroupCard
// Renders a synthetic Row that folds all lab DiagnosticReports sharing
// (collection day, institution, lab category) — the antidote to 健保存摺
// shipping one DR per analyte. The hospital reading unit is one report per
// lab SECTION —「血液一份報告、生化一份報告」— so each card is one such
// report, and a day's cards stack 血液 → 生化 → … in the list (a whole-day
// mega-sheet matched neither the NHI原樣 nor the hospital's model — user
// feedback 2026-07-07).
//
// UX contract (sibling of MultiRegionStudyCard):
//   • The collapsed header alone answers "when / which section / where /
//     how many items / anything abnormal?".
//   • Opening the card opens EVERYTHING inside — a lab report is read top
//     to bottom, so nested panels (CBC…) must not demand a second click.
//   • Every member renders through the SAME ReportRow used by the flat view
//     (with hideMeta — the header already states date + institution; same-
//     analyte serials keep a time-only badge), so trend dialogs / images /
//     bridge-dup badges / 向右展開 / per-DR source identity all keep
//     working. The grouping is display-only.
"use client"

import { useMemo, useState } from 'react'
import { AlertCircle, CalendarDays, ChevronDown } from 'lucide-react'
import { cn } from '@/src/shared/utils/cn.utils'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { getAnalyteDisplayForMode } from '@/src/shared/utils/lab-analyte-display.utils'
import type { Row } from '../types'
import { formatDate } from '../utils/fhir-helpers'
import { countAbnormalInRows } from '../utils/lab-day-grouping'
import { ReportRow } from './ReportRow'
import { useReportNameMode } from '../context/report-name-mode.context'
import { ReportInstitutionLabel } from './ReportInstitutionLabel'
import { REPORT_ABNORMAL_TONE, REPORT_CATEGORY_TONE } from './report-color-roles'
import { ReportSourceProgramBadge } from './ReportSourceProgramBadge'
import { NhiMedicloudSourceIndicator } from './NhiMedicloudSourceIndicator'

interface LabDayGroupCardProps {
  row: Row
  /** Member ids whose accordion should start open (search inner-match /
   *  resource navigation) — merged with ALL member ids because opening the
   *  card opens everything; any hit also auto-opens the card itself. */
  defaultOpen: string[]
  /** Active search query — forwarded for title highlighting; an active
   *  search also auto-opens the card (its members ARE the matches). */
  query?: string
}

const EMPTY_GROUPED_ROWS: Row[] = []

// The card's MEMBERSHIP key is the source's own calendar date
// (`collectionDayKey` = `iso.slice(0, 10)`), so its title has to be the same
// date. Parsing the instant and re-localising it titled a card grouped under
// 2026-01-14 as "2026/1/13" for any reader west of the reporting hospital.
// The shared formatDate reads the date the source wrote, which is that key.
function formatDayLabel(iso?: string): string {
  return formatDate(iso)
}

export function LabDayGroupCard({ row, defaultOpen, query }: LabDayGroupCardProps) {
  const { t, locale } = useLanguage()
  const tr = (t as any).reports
  const members = row.groupedRows ?? EMPTY_GROUPED_ROWS

  // Auto-open when a search is active (the filtered members are exactly the
  // matches the user wants to see) or when navigation / inner-match targets a
  // member. Manual toggle overrides until the auto signal changes again.
  const autoOpen = !!query?.trim() || members.some((m) => defaultOpen.includes(m.id))
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? autoOpen

  // Analyte labels must match what ObservationBlock would have shown inside
  // the (former) nested panel — audience-aware canonical short codes for
  // clinicians, lay names for patients.
  const { audience } = useAudience()
  const nameMode = useReportNameMode()

  // FLATTEN multi-analyte panels: a hospital lab report is a flat list of
  // analytes — "Creatinine, serum ▸ (CREA, EGFR)" as a box-inside-the-box
  // read as visual noise (user feedback 2026-07-07). Each analyte becomes a
  // sibling pseudo-row rendered through the SAME ReportRow single-value
  // branch as everything else, so trend / abnormal / ref-range / serial-time
  // behaviours are identical. rawTitle stays the DR's, so the trend dialog's
  // history lookup still finds the panel series. Members that can't flatten
  // (image sets, 0-obs DRs) render whole, as before.
  const displayRows = useMemo(() => {
    const out: Row[] = []
    for (const m of members) {
      if (m.obs.length === 0 || (m.images && m.images.length > 0)) {
        out.push(m)
        continue
      }
      m.obs.forEach((o, i) => {
        const label = getAnalyteDisplayForMode(o, audience, locale, nameMode)
        out.push({
          ...m,
          id: `${m.id}::obs${i}`,
          title: label && label !== '—' ? label : m.title,
          obs: [o],
          images: undefined,
          // The dup badge describes the DR, not each analyte — first row only.
          bridgeDupCount: i === 0 ? m.bridgeDupCount : undefined,
          isPossibleDuplicate: i === 0 ? m.isPossibleDuplicate : undefined,
        })
      })
    }
    return out
  }, [members, audience, locale, nameMode])

  // Opening the card opens EVERYTHING inside it. Rows mount when the card
  // opens, so their uncontrolled accordions / long-text states pick this up
  // as initial state; each can still be collapsed by hand afterwards.
  const allRowsOpen = useMemo(
    () => [...new Set([...defaultOpen, ...displayRows.map((m) => m.id)])],
    [defaultOpen, displayRows],
  )

  const abnormalCount = useMemo(() => countAbnormalInRows(members), [members])
  // "N 項" = analyte count, matching the flat view's per-panel count: a CBC
  // panel contributes its analytes; narrative / 0-obs reports count as 1.
  const itemCount = useMemo(
    () => members.reduce((n, m) => n + Math.max(1, m.obs.length), 0),
    [members],
  )

  // Section chip label — names the card's ACTUAL contents in the cumulative
  // report's category vocabulary (血液 / 生化 / …). A chem card that absorbed
  // plain glucose reads 生化 / 血糖 / 生化・血糖 per dayGroupLabelIds; other
  // cards name their single category. 'other' falls back to the 其他 label.
  const labelId = (id: string) =>
    id !== 'other'
      ? ((tr.cumulativeCategories as Record<string, string> | undefined)?.[id] ?? id)
      : ((tr.otherSubgroup as string) || 'Other')
  const labelIds = row.dayGroupLabelIds ?? (row.dayGroupCategoryId ? [row.dayGroupCategoryId] : [])
  const categoryLabel = labelIds.length ? labelIds.map(labelId).join('・') : ((tr.otherSubgroup as string) || 'Other')

  const dayLabel = formatDayLabel(row.effectiveDate)

  return (
    <div className="rounded-lg border bg-muted/40">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
        className="relative flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg py-2.5 pl-3 pr-9 text-left transition-colors hover:bg-muted/70"
      >
        <span
          data-testid="lab-day-identity-columns"
          className="grid min-w-0 flex-1 basis-[20rem] grid-cols-[1rem_4.5rem_minmax(0,1fr)] items-center gap-x-1 gap-y-1 @min-[300px]:grid-cols-[1rem_4.5rem_4.5rem_minmax(0,1fr)] @min-[560px]:grid-cols-[1rem_6rem_10rem_minmax(0,1fr)] @min-[560px]:gap-x-2"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span
            data-testid="lab-day-date"
            className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground"
          >
            {dayLabel}
          </span>
          <span
            data-testid="lab-day-classification"
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span
              data-testid="lab-day-category"
              className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium', REPORT_CATEGORY_TONE)}
            >
              {categoryLabel}
            </span>
            <ReportSourceProgramBadge
              sourceProgram={row.sourceProgram}
              label={(tr.sourcePrograms as { adultPreventive?: string } | undefined)?.adultPreventive}
            />
          </span>
          <span
            data-testid="lab-day-institution-slot"
            className={cn(
              'flex min-w-0 w-full',
              row.sourceProvenance === 'nhi-medicloud'
                ? '[grid-column:2/-1] [grid-row:2] @min-[900px]:[grid-column:4/5] @min-[900px]:[grid-row:1]'
                : 'col-span-2 col-start-2 row-start-2 @min-[300px]:col-span-1 @min-[300px]:col-start-4 @min-[300px]:row-start-1',
            )}
          >
            {row.sourceProvenance === 'nhi-medicloud' ? (
              <NhiMedicloudSourceIndicator institution={row.institution} className="min-w-0 max-w-full" />
            ) : row.institution ? (
              <ReportInstitutionLabel
                institution={row.institution}
                hospitalSource={row.hospitalSource}
                locale={locale}
                className="min-w-0 flex-1 max-w-full"
              />
            ) : null}
          </span>
        </span>
        <span
          data-testid="lab-day-metrics"
          className="ml-auto grid shrink-0 grid-cols-[5.5rem_6.5rem] items-center gap-2 tabular-nums"
        >
          <span
            data-testid="lab-day-item-count"
            className="justify-self-end whitespace-nowrap text-xs text-muted-foreground"
          >
            {(tr.labDayCount as string).replace('{n}', String(itemCount))}
          </span>
          {abnormalCount > 0 && (
            <span
              data-testid="lab-day-abnormal-count"
              className={cn('inline-flex shrink-0 justify-self-start items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', REPORT_ABNORMAL_TONE)}
            >
              <AlertCircle className="h-3 w-3" aria-hidden />
              {(tr.abnormalCount as string).replace('{n}', String(abnormalCount))}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'absolute right-3 top-1/2 h-4 w-4 shrink-0 -translate-y-1/2 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="space-y-0 border-t border-border/60 px-1.5 py-1.5">
          {displayRows.map((m) => (
            <ReportRow key={m.id} row={m} defaultOpen={allRowsOpen} query={query} hideMeta />
          ))}
        </div>
      )}
    </div>
  )
}
