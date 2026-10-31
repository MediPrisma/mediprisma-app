"use client"

// 用藥 — the therapies running (or just stopped) inside the window, with the
// change verdict computed by `classifyMedicationChanges` against the FULL
// prescription history so "new" really means new.
import { Fragment, useMemo, useState, type ReactElement, type Ref } from 'react'
import { Pill } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { formatDate } from '@/src/shared/utils/date.utils'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  getMedicationDaysLeftBadgeClass,
  medicationCategoryChipClass,
  medicationChronicBadgeClass,
} from '@/features/clinical-summary/medications/components/medication-chip-styles'
import { CLINICAL_CATEGORY_TONE } from '@/features/clinical-summary/components/clinical-color-roles'
import { MedicationTerminologyTooltip } from '@/features/clinical-summary/medications/components/MedicationTerminologyTooltip'
import { ReportInstitutionLabel } from '@/features/clinical-summary/reports/components/ReportInstitutionLabel'
import type { OverviewMedItem, OverviewMedsData } from '../hooks/useOverviewData'
import type { OverviewSectionFit } from '../overview.types'
import { OVERVIEW_SECTION_DOM_ID } from '../overview.types'
import { OverviewSectionCard } from './OverviewSectionCard'
import { toMedCopySourceItems } from '../utils/overview-med-copy'
import { MedCopyButtons, MedCopyDialogs, useMedCopyActions } from '@/features/clinical-summary/medications/components/MedCopyActions'
import {
  OverviewEmptyRow,
  OverviewExpandButton,
  OverviewFullListDialog,
  OverviewTruncationNote,
} from './OverviewSectionParts'
import {
  OVERVIEW_CHANGE_PILL_CLASS,
  OVERVIEW_LIST_ROW_CLASS,
  overviewChipClass,
} from './overview-styles'

type MedFilter = 'current' | 'changed' | 'all'

/** Single-line row: 24px of content, the row's 2px border, the 3px stack gap. */

function ChangeBadge({ item, compact }: { item: OverviewMedItem; compact: boolean }) {
  const { t, locale } = useLanguage()
  const strings = t.overview.meds
  const sourceState = ({ cancelled: locale === 'en' ? 'Cancelled' : '已取消',
    'entered-in-error': locale === 'en' ? 'Entered in error' : '誤植紀錄',
    stopped: locale === 'en' ? 'Stopped' : '已停用',
    'on-hold': locale === 'en' ? 'On hold' : '暫停', draft: locale === 'en' ? 'Draft' : '草稿',
  } as Record<string, string>)[item.row.status]
  if (sourceState) return <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-xs">{sourceState}</Badge>
  if (!item.change) return null
  const size = compact ? 'h-[18px] text-[0.625rem]' : 'h-5 text-[0.6875rem]'
  if (item.change.kind === 'added') {
    return (
      <Badge variant="outline" className={cn('shrink-0 border-transparent px-1.5 py-0', size, CLINICAL_CATEGORY_TONE)}>
        {strings.added}
      </Badge>
    )
  }
  if (item.change.kind === 'stopped') {
    return (
      <Badge variant="outline" className={cn('shrink-0 border-transparent bg-muted/60 px-1.5 py-0 text-muted-foreground', size)}>
        {strings.stopped}
      </Badge>
    )
  }
  return (
    <span className={cn(OVERVIEW_CHANGE_PILL_CLASS, 'rounded-md px-1.5', size)}>
      {strings.adjusted}
    </span>
  )
}

/**
 * The drug-master card the 用藥 tab already shows, plus what THIS fill says.
 *
 * Reusing MedicationTerminologyTooltip rather than writing a second card: it
 * is where 中文品名 / 英文品名 / 劑型 / ATC come from, and a private copy here
 * would drift from the tab and from the drug master's own snapshot label. The
 * `extra` block adds the things the terminology record cannot know — the dose,
 * the frequency, how many days were dispensed and how many are left.
 *
 * The WHOLE ROW is the trigger, not just the name: the reader's pointer lands
 * wherever the eye stopped — a dose, a date, the days-left badge — and having
 * to find the drug name to see the drug's details is a rule nobody guesses.
 * The institution label keeps its own tooltip; hovering it wins locally.
 */
function MedicationRowTooltip({
  item,
  children,
}: {
  item: OverviewMedItem
  children: ReactElement
}) {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const { row } = item
  // Dose and frequency are separate source fields; the row joins them to save
  // width, the card keeps them apart because they answer different questions
  // ("how much" vs "how often") and either can be absent on its own.
  const dose = item.change?.kind === 'adjusted' && item.change.previousDose
    ? `${item.change.previousDose} → ${row.dose ?? ''}`.trim()
    : row.dose
  const remaining = item.daysRemaining
  const usedUpText = remaining !== undefined && remaining < 0
    ? strings.meds.daysUsedUp.replace('{days}', String(Math.abs(remaining)))
    : undefined
  const entry = (label: string, value?: string | number | null): [string, string][] => (
    value === undefined || value === null || value === '' || value === '—'
      ? []
      : [[label, String(value)]]
  )
  const rows: [string, string][] = [
    ...entry(strings.meds.detailDose, dose),
    ...entry(strings.meds.detailFrequency, row.frequency),
    ...entry(strings.meds.detailRoute, row.route),
    ...entry(strings.meds.detailQuantity, row.totalQuantity),
    ...entry(strings.meds.detailDurationDays, row.durationDays === undefined
      ? undefined
      : strings.meds.detailDaysValue.replace('{days}', String(row.durationDays))),
    ...entry(strings.meds.detailInstitution, item.institution),
    ...entry(strings.meds.detailPrescribed, item.day ? formatDate(item.day, locale) : undefined),
    ...entry(strings.meds.detailEnds, row.endDate ? formatDate(row.endDate, locale) : undefined),
    // The badge on the row shows this too, but the card is where a reader
    // checks it against the dates above without doing the arithmetic.
    ...entry(strings.meds.detailRemaining, remaining === undefined
      ? undefined
      : remaining < 0
        ? item.row.displayRemainingSource === 'app-estimate'
          ? strings.meds.daysUsedUpEstimate.replace('{days}', String(Math.abs(remaining)))
          : usedUpText
        : strings.meds.daysLeft.replace('{days}', String(remaining))),
  ]
  return (
    <MedicationTerminologyTooltip
      medication={row}
      enabled
      extra={rows.length === 0 ? undefined : (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-left">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-secondary-foreground/65">{label}</dt>
              <dd className="min-w-0 break-words font-medium">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    >
      {children}
    </MedicationTerminologyTooltip>
  )
}

export function OverviewMedsSection({
  data,
  fit,
  flash = false,
  headingRef,
}: {
  data: OverviewMedsData
  fit: OverviewSectionFit
  flash?: boolean
  headingRef?: Ref<HTMLDivElement>
}) {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const strings = t.overview
  // 複製現在用藥 is a clinician's paste into their own chart — medical only.
  const canCopy = audience === 'medical'
  const copySources = useMemo(() => toMedCopySourceItems(data.items), [data.items])
  const copyState = useMedCopyActions(copySources, 'overview_meds')
  // 使用中 by default: the card answers "what is this patient on", and 全部
  // stays one click away for the times that is not the question.
  const [filter, setFilter] = useState<MedFilter>('current')
  const [listOpen, setListOpen] = useState(false)
  const target = {
    resourceType: 'MedicationRequest',
    resourceId: data.items[0]?.id,
    tabLabel: t.tabs.medications,
  }

  const matched = useMemo(() => data.items.filter((item) => {
    // 異動 spans the whole window — "what changed" is not answerable from the
    // current list alone, since a therapy stopped two months ago is exactly
    // the kind of change worth seeing. 全部 is the window unfiltered.
    if (filter === 'changed') return !!item.change
    if (filter === 'all') return true
    return item.isCurrent
  }), [data.items, filter])

  // Every matched row renders; the card scrolls. Cutting the list to what
  // fitted meant the reader could not reach a medication without leaving the
  // card, and the row budget had to be re-measured on every resize to stay
  // honest about it.
  const shown = matched
  const hidden = 0
  // Keep each record on one line in both stacked and side-by-side layouts.
  const compact = true

  const chips: { id: MedFilter; label: string; enabled: boolean }[] = [
    { id: 'current', label: strings.meds.current, enabled: true },
    { id: 'changed', label: strings.meds.changed, enabled: data.changeCount > 0 },
    { id: 'all', label: strings.meds.all, enabled: true },
  ]

  // One renderer, two surfaces: the card shows what fits, the dialog shows
  // the same rows at full length. Divergence between them would be a bug
  // nobody notices, so there is only ever one copy of this markup.
  const renderRows = (items: OverviewMedItem[], expanded = false) => (
  <div className={cn('flex min-w-0 shrink-0 flex-col', compact ? 'gap-[3px]' : 'gap-1.5')}>
    {items.map((item) => {
      const dose = item.change?.kind === 'adjusted' && item.change.previousDose
        ? `${item.change.previousDose} → ${item.doseText}`
        : item.doseText
      const daysLeft = item.daysRemaining
      const chronicBadge = item.isChronic && (
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 px-1.5 py-0',
            compact ? 'h-[18px] text-[0.625rem]' : 'h-5 text-[0.6875rem]',
            medicationChronicBadgeClass,
          )}
        >
          {strings.meds.chronicBadge}
        </Badge>
      )
      const sourceBadge = item.row.selfPurchased && (
        <span className="shrink-0 rounded-sm bg-muted px-1 text-xs font-medium">
          {locale === 'en' ? 'Self-pay' : '自購'}
        </span>
      )
      const daysBadge = daysLeft !== undefined && (
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 px-1.5 py-0',
            compact ? 'h-[18px] text-[0.625rem]' : 'h-5 text-[0.6875rem]',
            getMedicationDaysLeftBadgeClass(daysLeft),
            // The medication list sizes this badge for a grid column
            // (`w-full`); in a single flex line it has to hug its text.
            'w-auto max-w-none shrink-0',
          )}
        >
          {daysLeft < 0
            ? strings.meds.daysUsedUp.replace('{days}', String(Math.abs(daysLeft)))
            : strings.meds.daysLeft.replace('{days}', String(daysLeft))}
        </Badge>
      )
      // Space priority on a crowded single line: the trailing status
      // badges must never be clipped, the drug name gives up width
      // last, and the institution absorbs the squeeze first (it
      // shrinks several times faster). The pharmacological category is
      // deliberately absent from the one-line row — at this width it
      // truncated to 「Psycholepti…」, which identifies nothing, while
      // eating the space the frequency and the issuing institution
      // need. The full category stays on the 用藥 tab.
      const nameClass = cn(
        'truncate font-semibold',
        compact ? 'min-w-0 max-w-[38%] shrink text-xs' : 'shrink text-[0.8125rem]',
        // Muted, never struck through. A drug name is the one thing on this
        // row that has to stay readable, and a line drawn across
        // "DEXTROMETHORPHAN HYDROBROMIDE" costs more legibility than it buys —
        // the 停用 badge beside it already says the prescription has ended.
        item.isInactive ? 'text-muted-foreground' : 'text-foreground',
      )

      if (compact) {
        return (
          <MedicationRowTooltip key={item.id} item={item}>
            <div
              tabIndex={0}
              className={cn(OVERVIEW_LIST_ROW_CLASS, 'flex h-6 items-center gap-1 px-2')}
            >
            <ChangeBadge item={item} compact />
            <span className={nameClass}>{item.title}</span>
            {sourceBadge}
            {dose && (
              <span className="shrink-0 whitespace-nowrap text-[0.6875rem] text-muted-foreground">
                {dose}
              </span>
            )}
            {item.institution && (
              <ReportInstitutionLabel
                institution={item.institution}
                locale={locale}
                className="min-w-0 flex-1 shrink-[4] text-[0.6875rem]"
              />
            )}
            {(!fit.bounded || expanded) && item.row.durationDays !== undefined && (
              <span className="shrink-0 whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">
                {strings.meds.prescribedDays.replace('{days}', String(item.row.durationDays))}
              </span>
            )}
            {item.day && (
              <span className="shrink-0 whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">
                {formatDate(item.day, locale)}
              </span>
            )}
            {chronicBadge}
            {daysBadge}
            </div>
          </MedicationRowTooltip>
        )
      }

      return (
        <MedicationRowTooltip key={item.id} item={item}>
        <div tabIndex={0} className={cn(OVERVIEW_LIST_ROW_CLASS, 'px-3 py-1')}>
          <div className="flex min-w-0 items-center gap-1.5">
            <ChangeBadge item={item} compact={false} />
            <span className={nameClass}>{item.title}</span>
            {sourceBadge}
            {dose && (
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {dose}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {chronicBadge}
              {daysBadge}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {item.category && (
              <span className={cn(medicationCategoryChipClass, 'text-[0.6875rem]')}>
                {item.category}
              </span>
            )}
            {item.institution && (
              <ReportInstitutionLabel
                institution={item.institution}
                locale={locale}
                className="max-w-[12rem] text-[0.6875rem]"
              />
            )}
            {item.day && (
              <span className="whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">
                {formatDate(item.day, locale)}
              </span>
            )}
          </div>
        </div>
        </MedicationRowTooltip>
      )
    })}
  </div>
  )

  // One definition, two places: the card header and the expanded dialog. They
  // drive the same `filter` state, so changing it in either updates both.
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
      id={OVERVIEW_SECTION_DOM_ID.meds}
      icon={Pill}
      title={strings.sections.meds}
      count={strings.counts.meds.replace('{count}', String(data.count))}
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
      {canCopy && <MedCopyDialogs state={copyState} />}
      {shown.length === 0 ? (
        <>
          <OverviewEmptyRow hasWindowData={data.items.length > 0} />
          {canCopy && (
            <div className="flex justify-end">
              <MedCopyButtons state={copyState} />
            </div>
          )}
        </>
      ) : (
        <>
          <div className={cn('min-w-0', fit.bounded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
            {renderRows(shown)}
          </div>
          {/* 複製｜編輯 sit on the footer line, beside the route to the 用藥
              tab — the same place as the 檢驗 card's 自訂 actions — so the
              header never grows a second line however narrow the card. */}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {/* Always offered: the default list is deliberately only what the
                patient is on now, so an empty 「另 N 項」 does not mean the
                chart holds nothing else. */}
            {/* Wrapped: the note's own mt-auto would otherwise pin it to the
                bottom of this row instead of centring it beside the buttons. */}
            <div className="min-w-0">
              <OverviewTruncationNote hiddenCount={hidden} target={target} always />
            </div>
            {canCopy && <MedCopyButtons state={copyState} />}
          </div>
          <OverviewFullListDialog
            open={listOpen}
            onOpenChange={setListOpen}
            title={strings.sections.meds}
            subtitle={strings.counts.meds.replace('{count}', String(matched.length))}
            filters={filterChips}
          >
            {renderRows(matched, true)}
          </OverviewFullListDialog>
        </>
      )}
    </OverviewSectionCard>
  )
}
