"use client"

// 就診 — the same VisitRecord + EncounterDetails model the 就診紀錄 tab uses,
// drawn as one dense line per visit under a month-scaled timeline.
import { useMemo, useState, type Ref } from 'react'
import { Calendar, PanelRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOptionalRightDetail } from '@/src/application/providers/right-detail.provider'
import { formatDate } from '@/src/shared/utils/date.utils'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { clinicalTooltipSurfaceClass } from '@/features/clinical-summary/components/clinical-metadata-styles'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  CLINICAL_ABNORMAL_TONE,
  CLINICAL_CATEGORY_TONE,
  CLINICAL_INPATIENT_TONE,
} from '@/features/clinical-summary/components/clinical-color-roles'
import {
  clinicalIcdChipClass,
  clinicalIcdCodeClass,
  clinicalIcdDescriptionClass,
} from '@/features/clinical-summary/components/clinical-metadata-styles'
import { VisitDetailContent } from '@/features/clinical-summary/visit-history/components/VisitDetailContent'
import { ReportInstitutionLabel } from '@/features/clinical-summary/reports/components/ReportInstitutionLabel'
import type { VisitRecord } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'
import type { OverviewVisitItem, OverviewVisitsData } from '../hooks/useOverviewData'
import type { OverviewSectionFit } from '../overview.types'
import { OVERVIEW_SECTION_DOM_ID } from '../overview.types'
import type { OverviewWindow } from '../utils/overview-selectors'
import { OverviewSectionCard } from './OverviewSectionCard'
import {
  OverviewEmptyRow,
  OverviewExpandButton,
  OverviewFullListDialog,
  OverviewTruncationNote,
} from './OverviewSectionParts'
import {
  OVERVIEW_ICON_ACTION_CLASS,
  OVERVIEW_LIST_ROW_CLASS,
  OVERVIEW_META_BADGE_CLASS,
  overviewChipClass,
} from './overview-styles'
import { VisitTimeline } from './VisitTimeline'

type VisitFilter = 'all' | 'emergency' | 'inpatient' | 'outpatient'

/** Single-line row: 26px of content, the row's 2px border, the 4px stack gap. */
/** Compact timeline strip (32px) plus the 8px gap that follows it. */

const TYPE_TONE: Record<string, string> = {
  emergency: CLINICAL_ABNORMAL_TONE,
  inpatient: CLINICAL_INPATIENT_TONE,
}

function matchesFilter(visit: VisitRecord, filter: VisitFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'outpatient') {
    return visit.type === 'outpatient' || visit.type === 'outpatient-or-emergency'
  }
  return visit.type === filter
}

function VisitStat({ label, count, attention = false }: {
  label: string
  count: number
  attention?: boolean
}) {
  if (attention) {
    return (
      <span className={cn(
        'inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[0.5625rem] font-medium leading-none',
        CLINICAL_ABNORMAL_TONE,
      )}>
        <span className="whitespace-nowrap">{label}</span>
        <span className="tabular-nums">{count}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex h-4 shrink-0 items-center gap-0.5 border-l border-border/60 pl-1 text-[0.5625rem] leading-none first:border-l-0 first:pl-0">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-foreground/[0.06] px-0.5 font-semibold tabular-nums text-foreground/80 dark:bg-foreground/[0.08]">
        {count}
      </span>
    </span>
  )
}

export function OverviewVisitsSection({
  data,
  window,
  fit,
  flash = false,
  headingRef,
}: {
  data: OverviewVisitsData
  window: OverviewWindow
  fit: OverviewSectionFit
  flash?: boolean
  headingRef?: Ref<HTMLDivElement>
}) {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const rightDetail = useOptionalRightDetail()
  const [filter, setFilter] = useState<VisitFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const badges = t.visitHistory.badges as Record<string, string>
  const target = {
    resourceType: 'Encounter',
    resourceId: data.items[0]?.visit.id,
    tabLabel: t.tabs.visits,
  }

  const matched = useMemo(
    () => data.items.filter((item) => matchesFilter(item.visit, filter)),
    [data.items, filter],
  )

  // Every matched row renders; the card scrolls. See the meds section — the
  // row budget only ever existed to avoid a scrollbar the reader wanted.
  const shown = matched
  const hidden = 0
  // Keep each record on one line in both stacked and side-by-side layouts.
  const compact = true

  const chips: { id: VisitFilter; label: string; enabled: boolean }[] = [
    { id: 'all', label: strings.visits.all, enabled: true },
    { id: 'emergency', label: badges.emergency, enabled: data.emergencyCount > 0 },
    { id: 'inpatient', label: badges.inpatient, enabled: data.inpatientCount > 0 },
    { id: 'outpatient', label: badges.outpatient, enabled: data.outpatientCount > 0 },
  ]

  const openInRightPane = (item: OverviewVisitItem) => {
    if (!rightDetail) return
    rightDetail.toggleDetail({
      sourceId: item.visit.id,
      title: (
        <span className="flex items-center gap-1.5">
          <span>{formatDate(item.visit.date, locale)}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {badges[item.visit.type] ?? badges.other}
          </span>
        </span>
      ),
      node: (
        <VisitDetailContent
          details={item.details}
          documents={item.documents}
          abnormalCount={item.abnormalCount}
          showMedicationExecutionPeriods={item.visit.type === 'inpatient'}
        />
      ),
    })
  }

  // One renderer for the card and the full-length dialog (see
  // OverviewExpandButton): two copies of a clinical row would drift.
  const renderRows = (items: OverviewVisitItem[]) => (
  <div className={cn('flex min-w-0 shrink-0 flex-col', compact ? 'gap-1' : 'gap-1.5')}>
    {items.map((item) => {
      const { visit } = item
      const primaryIcd = visit.icdCodes[0]
      const extraIcdCount = Math.max(0, visit.icdCodes.length - 1)
      const showRange = !!visit.endDate
        && visit.endDate.slice(0, 10) !== visit.date.slice(0, 10)
      const dateLabel = showRange
        ? `${formatDate(visit.date, locale)} ~ ${formatDate(visit.endDate, locale)}`
        : formatDate(visit.date, locale)
      const selected = selectedId === visit.id
      const isRightActive = rightDetail?.detail?.sourceId === visit.id
      // Only the abnormal count survives on the overview row.
      // 診斷／檢驗／處置／用藥 are inventory: they say a visit HAS
      // records without saying anything about the patient, and at
      // this width they crowded — and visibly overlapped — the one
      // thing the row exists to show, the diagnosis. The full counts
      // are one click away on 就診紀錄. Abnormal stays because it is
      // the only one that carries a finding rather than a tally.
      const stats = item.abnormalCount > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          <VisitStat
            label={(t.visitHistory as any).abnormal ?? 'Abnormal'}
            count={item.abnormalCount}
            attention
          />
        </span>
      ) : null
      const icdChip = primaryIcd && (
        <span
          className={cn(clinicalIcdChipClass, 'min-w-0 flex-1', compact && 'h-[18px] max-w-none text-[0.6875rem]')}
          title={primaryIcd.description
            ? `${primaryIcd.code} ${primaryIcd.description}`
            : primaryIcd.code}
        >
          <span className={clinicalIcdCodeClass}>{primaryIcd.code}</span>
          {primaryIcd.description && (
            <span className={clinicalIcdDescriptionClass}>{primaryIcd.description}</span>
          )}
        </span>
      )
      // Same behaviour as the 就診 tab's +N: the remaining diagnoses are read
      // on hover / tap / focus rather than being a count with nothing behind
      // it. Same list shape too (code in mono, description beside it), so the
      // two surfaces read alike.
      const moreIcd = extraIcdCount > 0 && (
        <TapTooltip
          asChild
          aria-label={strings.visits.moreIcd.replace('{count}', String(extraIcdCount))}
          contentClassName={cn(
            clinicalTooltipSurfaceClass,
            'max-h-[min(20rem,60vh)] max-w-[min(90vw,32rem)] overflow-y-auto p-2.5 text-xs leading-relaxed',
          )}
          content={(
            <div className="space-y-1.5">
              {visit.icdCodes.slice(1).map((icd, index) => (
                <div
                  key={`${icd.code}-${index}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2"
                >
                  <span className="font-mono font-semibold text-secondary-foreground">
                    {icd.code}
                  </span>
                  {icd.description && (
                    <span className="whitespace-normal break-words text-secondary-foreground/80">
                      {icd.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        >
          <span
            tabIndex={0}
            className={cn(
              OVERVIEW_META_BADGE_CLASS,
              'cursor-help',
              compact ? 'h-[18px] text-[0.625rem]' : 'h-5 text-[0.6875rem]',
            )}
          >
            +{extraIcdCount}
          </span>
        </TapTooltip>
      )

      return (
        <div
          key={visit.id}
          data-overview-visit={visit.id}
          className={cn(
            OVERVIEW_LIST_ROW_CLASS,
            (selected || isRightActive) && 'border-primary/40 bg-primary/5',
          )}
        >
          <div className={cn(
            'flex min-w-0 items-center gap-1.5 px-2',
            compact ? 'h-[26px]' : 'py-1',
          )}>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 border-transparent px-1.5 py-0',
                compact ? 'h-[18px] text-[0.625rem]' : 'h-5 text-[0.6875rem]',
                TYPE_TONE[visit.type] ?? CLINICAL_CATEGORY_TONE,
              )}
            >
              {badges[visit.type] ?? badges.other}
            </Badge>
            {/* `VisitRecord.department` is the bridge's SOURCE
                CHANNEL — 「IC卡資料」/「申報資料」/「雲端病歷」 —
                and only falls back to a real department on legacy
                bundles. Every row therefore repeated the same word
                while taking width from the institution and the
                diagnosis. Provenance belongs on 就診紀錄, where a
                row has space to say it once and mean it. */}
            {visit.institution && (
              <ReportInstitutionLabel
                institution={visit.institution}
                locale={locale}
                className={cn('shrink text-[0.6875rem]', compact ? 'max-w-[7rem]' : 'max-w-[9rem]')}
              />
            )}
            {visit.sourceComparisonStatus && visit.sourceComparisonStatus !== 'confirmed' && <span className="shrink-0 text-xs" title={locale === 'en' ? 'Source visit identity is unconfirmed' : '兩邊原始就診紀錄均保留，尚未確認為同一次就診'}>{locale === 'en' ? 'Compare sources' : '待核對'}</span>}
            <span className={cn(
              'shrink-0 whitespace-nowrap font-medium tabular-nums text-foreground',
              compact ? 'text-xs' : 'text-[0.8125rem]',
            )}>
              {dateLabel}
            </span>
            {compact && icdChip}
            {compact && moreIcd}
            {compact && stats}
            {!compact && rightDetail && (
              <button
                type="button"
                className={cn(OVERVIEW_ICON_ACTION_CLASS, 'ml-auto')}
                title={t.visitHistory.openRight}
                aria-label={t.visitHistory.openRight}
                onClick={() => openInRightPane(item)}
              >
                <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {!compact && (primaryIcd || item.diagnosisCount > 0) && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 pb-1">
              {icdChip}
              {moreIcd}
              <span className="ml-auto flex items-center gap-1">{stats}</span>
            </div>
          )}
        </div>
      )
    })}
  </div>
  )

  // One definition, two places: the card header and the expanded dialog, both
  // driving the same `filter` state.
        const filterChips = chips.filter((chip) => chip.enabled).map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            className={overviewChipClass(filter === chip.id)}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
      ))

  return (
    <OverviewSectionCard
      id={OVERVIEW_SECTION_DOM_ID.visits}
      icon={Calendar}
      title={strings.sections.visits}
      count={data.items.some((item) => item.visit.sourceComparisonStatus && item.visit.sourceComparisonStatus !== 'confirmed')
        ? `${data.count} ${locale === 'en' ? 'record groups' : '組紀錄'}`
        : strings.counts.visits.replace('{count}', String(data.count))}
      bounded={fit.bounded}
      flash={flash}
      headingRef={headingRef}
      actions={(
        <>
          {filterChips}
          <OverviewExpandButton
            label={t.overview.expandList}
            onClick={() => setListOpen(true)}
            disabled={matched.length === 0}
          />
        </>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {matched.length > 0 && (
          <VisitTimeline
            items={matched}
            window={window}
            selectedId={selectedId}
            onSelect={setSelectedId}
            compact={compact}
          />
        )}
        {shown.length === 0 ? (
          <OverviewEmptyRow hasWindowData={data.items.length > 0} />
        ) : (
          <>
            <div className={cn('min-w-0', fit.bounded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
              {renderRows(shown)}
            </div>
            <OverviewTruncationNote hiddenCount={hidden} target={target} always />
            <OverviewFullListDialog
              open={listOpen}
              onOpenChange={setListOpen}
              title={strings.sections.visits}
              subtitle={matched.some((item) => item.visit.sourceComparisonStatus && item.visit.sourceComparisonStatus !== 'confirmed')
                ? `${matched.length} ${locale === 'en' ? 'record groups' : '組紀錄'}`
                : strings.counts.visits.replace('{count}', String(matched.length))}
              filters={filterChips}
            >
              {renderRows(matched)}
            </OverviewFullListDialog>
          </>
        )}
      </div>
    </OverviewSectionCard>
  )
}
