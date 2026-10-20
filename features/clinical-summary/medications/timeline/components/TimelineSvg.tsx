// SVG Gantt chart for medication refill history.
//
// Layout:
//   - One row per drug, grouped by ATC hierarchy or organization.
//   - Nested group headers make adaptive ATC expansion visible.
//   - X-axis: time (date range), ticks at year boundaries.
//   - Y-axis: drug labels (left column, scrollable with the chart).
//
// The SVG is sized in pixels — the parent provides `width`. Height = number
// of rows × ROW_HEIGHT (+ category header rows). No virtualisation in MVP
// — for 50+ drugs we revisit.
"use client"

import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import {
  isTimelineDrugCurrent,
  type CategoryGroup,
  type RefillBar,
  type TimelineDrug,
} from '../hooks/useMedicationTimeline'
import {
  medicationChronicFutureTimelineBarClass,
  medicationChronicTimelineBarClass,
  medicationNonChronicFutureTimelineBarClass,
  medicationNonChronicTimelineBarClass,
  medicationUnrecordedFutureTimelineBarClass,
  medicationUnrecordedTimelineBarClass,
} from '../../components/medication-chip-styles'
import { HospitalMedicationNameDetails, MedicationTerminologyTooltip } from '../../components/MedicationTerminologyTooltip'

interface TimelineSvgProps {
  categories: CategoryGroup[]
  domainStartMs: number
  domainEndMs: number
  width: number
}

const ROW_HEIGHT = 18
const CATEGORY_HEADER_HEIGHT = 22
const ORGANIZATION_HEADER_HEIGHT = 24
const CATEGORY_HEADER_LINE_HEIGHT = 14
const LABEL_COLUMN_WIDTH = 180
const AXIS_HEIGHT = 22
const BAR_HEIGHT = 10
const BAR_VERTICAL_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2
const CATEGORY_GAP = 4
const GROUP_DEPTH_INDENT = 12
const DRUG_LABEL_INDENT = 12

interface HoverState {
  bar: RefillBar
  segment: 'elapsed' | 'future'
  drugName: string
  drugProductName?: string
  drugTerminology?: TimelineDrug['drugTerminology']
  hospitalMedicationName?: TimelineDrug['hospitalMedicationName']
  xPx: number
  yPx: number
  containerLeftPx: number
  containerRightPx: number
}

function shortYmd(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Build adaptive time ticks instead of showing only year boundaries. A
 * three-month view otherwise has a blank axis for most of the year, which
 * makes refill positions needlessly hard to interpret.
 */
function buildTimeTicks(
  domainStartMs: number,
  domainEndMs: number,
  chartWidth: number,
  xScale: (ms: number) => number,
  locale: string,
) {
  const spanDays = (domainEndMs - domainStartMs) / 86_400_000
  const stepMonths = spanDays <= 400 ? 1 : spanDays <= 1_600 ? 3 : 12
  const start = new Date(domainStartMs)
  const candidates = [domainStartMs]

  let cursor: Date
  if (stepMonths === 12) {
    cursor = new Date(start.getFullYear() + 1, 0, 1)
  } else if (stepMonths === 3) {
    const nextQuarterMonth = Math.floor(start.getMonth() / 3) * 3 + 3
    cursor = new Date(start.getFullYear(), nextQuarterMonth, 1)
  } else {
    cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  }

  while (cursor.getTime() < domainEndMs) {
    candidates.push(cursor.getTime())
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + stepMonths,
      1,
    )
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    year: spanDays > 400 ? 'numeric' : '2-digit',
    month: spanDays > 1_600 ? undefined : 'short',
    day: spanDays <= 100 ? 'numeric' : undefined,
  })

  let previousX = -Infinity
  return candidates.flatMap((ms) => {
    const x = xScale(ms)
    if (x - previousX < 48 || x > chartWidth - 28) return []
    previousX = x
    return [{ x, label: formatter.format(new Date(ms)) }]
  })
}

export function TimelineSvg({ categories, domainStartMs, domainEndMs, width }: TimelineSvgProps) {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const [hover, setHover] = useState<HoverState | null>(null)
  const [collapsedOrganizationKeys, setCollapsedOrganizationKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [todayMs] = useState(() => Date.now())
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const mt = (t.medications as any)
  const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth
  const tooltipWidth = Math.min(360, viewportWidth - 8)

  useLayoutEffect(() => {
    if (!hover || !tooltipRef.current) return
    const measuredHeight = Math.ceil(tooltipRef.current.getBoundingClientRect().height)
    setTooltipHeight((current) => current === measuredHeight ? current : measuredHeight)
  }, [hover, tooltipWidth])

  if (categories.length === 0 || width < 200) return null

  const chartWidth = Math.max(width - LABEL_COLUMN_WIDTH, 100)
  const range = Math.max(domainEndMs - domainStartMs, 1)
  const xScale = (ms: number) => ((ms - domainStartMs) / range) * chartWidth

  // ── Layout pass: assign Y position to each row ─────────────────────────
  type Row =
    | { kind: 'category'; y: number; height: number; group: CategoryGroup }
    | { kind: 'drug'; y: number; drug: TimelineDrug; depth: number }

  const rows: Row[] = []
  let cursorY = AXIS_HEIGHT
  const appendGroup = (group: CategoryGroup) => {
    const isOrganization = group.level === 'organization'
    const isCollapsed = isOrganization && collapsedOrganizationKeys.has(group.key)
    const headerHeight = isOrganization
      ? ORGANIZATION_HEADER_HEIGHT
      : CATEGORY_HEADER_HEIGHT
    rows.push({
      kind: 'category',
      y: cursorY,
      height: headerHeight,
      group,
    })
    cursorY += headerHeight
    if (isCollapsed) return
    const depth = group.depth ?? 0
    for (const drug of group.drugs) {
      rows.push({ kind: 'drug', y: cursorY, drug, depth })
      cursorY += ROW_HEIGHT
    }
    for (const child of group.children ?? []) appendGroup(child)
  }
  for (const group of categories) {
    appendGroup(group)
    cursorY += CATEGORY_GAP
  }
  const totalHeight = cursorY

  const timeTicks = buildTimeTicks(
    domainStartMs,
    domainEndMs,
    chartWidth,
    xScale,
    locale,
  )
  const todayX = xScale(todayMs)
  const tooltipViewportMargin = 4
  const tooltipGap = 8
  const tooltipLeft = hover
    ? (() => {
      const viewportMin = tooltipViewportMargin
      const viewportMax = Math.max(
        viewportMin,
        viewportWidth - tooltipWidth - tooltipViewportMargin,
      )
      const fitsTimeline = hover.containerRightPx - hover.containerLeftPx
        >= tooltipWidth + tooltipViewportMargin * 2
      const minimum = fitsTimeline
        ? Math.max(viewportMin, hover.containerLeftPx + tooltipViewportMargin)
        : viewportMin
      const maximum = fitsTimeline
        ? Math.min(
          viewportMax,
          hover.containerRightPx - tooltipWidth - tooltipViewportMargin,
        )
        : viewportMax
      return Math.min(
        Math.max(hover.xPx - tooltipWidth / 2, minimum),
        Math.max(minimum, maximum),
      )
    })()
    : tooltipViewportMargin
  const tooltipTop = hover
    ? (() => {
      const viewportHeight = typeof window === 'undefined'
        ? Number.POSITIVE_INFINITY
        : window.innerHeight
      const above = hover.yPx - tooltipHeight - tooltipGap
      const below = hover.yPx + BAR_HEIGHT / 2 + tooltipGap
      if (tooltipHeight > 0 && above >= tooltipViewportMargin) return above
      if (below + tooltipHeight <= viewportHeight - tooltipViewportMargin) return below
      return Math.max(
        tooltipViewportMargin,
        viewportHeight - tooltipHeight - tooltipViewportMargin,
      )
    })()
    : tooltipViewportMargin

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        width={width}
        height={totalHeight}
        className="block"
        onMouseLeave={() => setHover(null)}
      >
        {/* ── X-axis: year labels + grid lines ──────────────────────── */}
        {timeTicks.map((tk) => (
          <g key={`tick-${tk.label}`}>
            <line
              x1={LABEL_COLUMN_WIDTH + tk.x}
              x2={LABEL_COLUMN_WIDTH + tk.x}
              y1={AXIS_HEIGHT - 2}
              y2={totalHeight}
              strokeWidth={1}
              className="stroke-border"
            />
            <text
              x={LABEL_COLUMN_WIDTH + tk.x + 3}
              y={14}
              fontSize={11}
              className="fill-muted-foreground"
            >
              {tk.label}
            </text>
          </g>
        ))}

        {/* ── Rows ──────────────────────────────────────────────────── */}
        {rows.map((row, idx) => {
          if (row.kind === 'category') {
            const depth = row.group.depth ?? 0
            const headerX = 6 + depth * GROUP_DEPTH_INDENT
            const count = row.group.drugCount ?? row.group.drugs.length
            const isOrganization = row.group.level === 'organization'
            const isCollapsed = isOrganization
              && collapsedOrganizationKeys.has(row.group.key)
            const originalEnglish = locale !== 'en'
              && row.group.nameZh === row.group.label
              && row.group.nameEn
              && row.group.nameEn !== row.group.label
                ? row.group.nameEn
                : undefined
            const hasAtcDetails = Boolean(row.group.code || originalEnglish)
            const headerContent = (
              <span className="inline-flex items-center whitespace-nowrap">
                {isOrganization ? (
                  <span aria-hidden="true" className="mr-1 inline-block w-2.5 text-muted-foreground">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                ) : null}
                {row.group.label}{' '}
                <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>
                  {isOrganization
                    ? `(${mt.timelineCurrentMedication ?? 'Current medication'} ${row.group.currentDrugCount ?? 0} / ${mt.timelineOrganizationTotal ?? 'total'} ${count})`
                    : `(${count})`}
                </span>
              </span>
            )
            return (
              <g
                key={`cat-${idx}`}
                data-timeline-group-depth={depth}
                data-timeline-group-level={row.group.level}
                data-timeline-group-header-lines={1}
                data-timeline-group-collapsed={isOrganization ? String(isCollapsed) : undefined}
              >
                <rect
                  x={0}
                  y={row.y}
                  width={width}
                  height={row.height}
                  className={depth === 0 ? 'fill-muted/55' : 'fill-muted/25'}
                />
                <foreignObject
                  x={headerX}
                  y={row.y}
                  width={Math.max(width - headerX - 6, 80)}
                  height={row.height}
                  style={{ overflow: 'visible' }}
                >
                  <div
                    // @ts-expect-error xmlns is valid here
                    xmlns="http://www.w3.org/1999/xhtml"
                    style={{
                      color: 'var(--foreground)',
                      boxSizing: 'border-box',
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: `${CATEGORY_HEADER_LINE_HEIGHT}px`,
                      minHeight: '100%',
                      overflow: 'visible',
                      paddingBlock: isOrganization ? 0 : 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isOrganization ? (
                      <button
                        type="button"
                        data-timeline-organization-toggle
                        aria-expanded={!isCollapsed}
                        aria-label={`${
                          isCollapsed
                            ? mt.timelineExpandOrganization ?? 'Expand organization'
                            : mt.timelineCollapseOrganization ?? 'Collapse organization'
                        }：${row.group.label}`}
                        className="inline-flex min-h-6 appearance-none items-center rounded-[2px] border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        style={{ color: 'inherit', font: 'inherit', lineHeight: 'inherit' }}
                        onClick={() => {
                          setHover(null)
                          setCollapsedOrganizationKeys((current) => {
                            const next = new Set(current)
                            if (next.has(row.group.key)) next.delete(row.group.key)
                            else next.add(row.group.key)
                            return next
                          })
                        }}
                      >
                        {headerContent}
                      </button>
                    ) : hasAtcDetails ? (
                      <TapTooltip
                        asChild
                        selectable
                        side="top"
                        sideOffset={4}
                        contentClassName="max-w-[min(90vw,28rem)] whitespace-normal text-left"
                        contentTestId="timeline-atc-group-details"
                        content={(
                          <div className="space-y-1">
                            {row.group.code ? (
                              <div>
                                <span className="text-background/70">
                                  {mt.terminologyAtcLabel ?? 'ATC'}：
                                </span>
                                <span className="font-mono font-medium">{row.group.code}</span>
                              </div>
                            ) : null}
                            {originalEnglish ? (
                              <div>
                                <div className="text-[0.6875rem] text-background/70">
                                  {mt.timelineAtcOriginalEnglishLabel ?? 'WHO English original'}
                                </div>
                                <div className="font-medium leading-relaxed">{originalEnglish}</div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      >
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label={[
                            row.group.label,
                            row.group.code
                              ? `${mt.terminologyAtcLabel ?? 'ATC'}：${row.group.code}`
                              : undefined,
                            originalEnglish
                              ? `${mt.timelineAtcOriginalEnglishLabel ?? 'WHO English original'}：${originalEnglish}`
                              : undefined,
                          ].filter(Boolean).join('。')}
                          className="inline-block cursor-help appearance-none whitespace-nowrap rounded-[2px] border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          style={{ color: 'inherit', font: 'inherit', lineHeight: 'inherit' }}
                        >
                          {headerContent}
                        </button>
                      </TapTooltip>
                    ) : headerContent}
                  </div>
                </foreignObject>
              </g>
            )
          }

          const drug = row.drug
          const isCurrent = isTimelineDrugCurrent(drug, todayMs)
          const drugLabelX = 6
            + row.depth * GROUP_DEPTH_INDENT
            + DRUG_LABEL_INDENT
          return (
            <g
              key={drug.drugKey}
              data-timeline-drug-current={isCurrent ? 'true' : 'false'}
              data-timeline-drug-depth={row.depth}
            >
              {isCurrent ? (
                <rect
                  data-timeline-current-row
                  aria-hidden="true"
                  x={0}
                  y={row.y}
                  width={width}
                  height={ROW_HEIGHT}
                  className="fill-primary/[0.06] dark:fill-primary/10"
                />
              ) : null}
              {/* drug name label (left column) */}
              <foreignObject
                x={drugLabelX}
                y={row.y}
                width={LABEL_COLUMN_WIDTH - drugLabelX - 4}
                height={ROW_HEIGHT}
              >
                <MedicationTerminologyTooltip
                  medication={{ drugTerminology: drug.drugTerminology, hospitalMedicationName: drug.hospitalMedicationName }}
                  enabled
                >
                  <div
                    // @ts-expect-error xmlns is valid here
                    xmlns="http://www.w3.org/1999/xhtml"
                    data-timeline-drug-label
                    title={[
                      drug.drugName,
                      drug.drugProductName,
                    ].filter(Boolean).join(' · ')}
                    tabIndex={drug.drugTerminology || drug.hospitalMedicationName ? 0 : undefined}
                    className={drug.drugTerminology || drug.hospitalMedicationName
                      ? 'cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                      : undefined}
                    style={{
                      fontSize: 11,
                      lineHeight: `${ROW_HEIGHT}px`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--foreground)',
                      fontWeight: drug.prescriptionType === 'chronic' ? 600 : 500,
                    }}
                  >
                    {drug.bars.some(bar => bar.sourceComparisonUnconfirmed) && <span className="font-semibold">{locale === 'en' ? 'Compare · ' : '待核對 · '}</span>}{drug.drugName}
                  </div>
                </MedicationTerminologyTooltip>
              </foreignObject>

              {/* refill bars */}
              {drug.bars.map((bar) => {
                const x1 = xScale(bar.startMs)
                const x2 = xScale(bar.endMs)
                const hasElapsedSegment = bar.startMs < todayMs
                const hasFutureSegment = bar.endMs > todayMs
                const elapsedEndX = xScale(Math.min(bar.endMs, todayMs))
                const futureStartX = xScale(Math.max(bar.startMs, todayMs))

                const showBarHover = (
                  e: MouseEvent<SVGRectElement>,
                  segment: HoverState['segment'],
                ) => {
                  const rect = (e.target as SVGRectElement).getBoundingClientRect()
                  const containerRect = (e.target as SVGRectElement)
                    .closest('svg')
                    ?.getBoundingClientRect()
                  setHover({
                    bar,
                    segment,
                    drugName: drug.drugName,
                    drugProductName: drug.drugProductName,
                    drugTerminology: drug.drugTerminology,
                    hospitalMedicationName: drug.hospitalMedicationName,
                    xPx: rect.left + rect.width / 2,
                    yPx: rect.top + rect.height / 2,
                    containerLeftPx: containerRect?.left ?? 0,
                    containerRightPx: containerRect?.right ?? width,
                  })
                }

                return (
                  <g key={bar.refillId}>
                    {hasElapsedSegment && (
                      <rect
                        data-timeline-segment="elapsed"
                        data-timeline-prescription-type={drug.prescriptionType}
                        x={LABEL_COLUMN_WIDTH + x1}
                        y={row.y + BAR_VERTICAL_OFFSET}
                        width={Math.max(elapsedEndX - x1, 1)}
                        height={BAR_HEIGHT}
                        strokeWidth={0.5}
                        rx={1}
                        className={
                          drug.prescriptionType === 'chronic'
                            ? medicationChronicTimelineBarClass
                            : drug.prescriptionType === 'non-chronic'
                              ? medicationNonChronicTimelineBarClass
                              : medicationUnrecordedTimelineBarClass
                        }
                        onMouseEnter={(e) => showBarHover(e, 'elapsed')}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                    {hasFutureSegment && (
                      <rect
                        data-timeline-segment="future"
                        data-timeline-prescription-type={drug.prescriptionType}
                        x={LABEL_COLUMN_WIDTH + futureStartX}
                        y={row.y + BAR_VERTICAL_OFFSET}
                        width={Math.max(x2 - futureStartX, 1)}
                        height={BAR_HEIGHT}
                        strokeWidth={0.75}
                        strokeDasharray="2 1.5"
                        rx={1}
                        className={
                          drug.prescriptionType === 'chronic'
                            ? medicationChronicFutureTimelineBarClass
                            : drug.prescriptionType === 'non-chronic'
                              ? medicationNonChronicFutureTimelineBarClass
                              : medicationUnrecordedFutureTimelineBarClass
                        }
                        onMouseEnter={(e) => showBarHover(e, 'future')}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Keep today above the medication segments so the transition
            boundary remains visible; pointer events stay with the bars. */}
        {todayX >= 0 && todayX <= chartWidth && (
          <line
            data-timeline-today
            x1={LABEL_COLUMN_WIDTH + todayX}
            x2={LABEL_COLUMN_WIDTH + todayX}
            y1={AXIS_HEIGHT - 2}
            y2={totalHeight}
            strokeWidth={1}
            strokeDasharray="2,2"
            pointerEvents="none"
            className="stroke-destructive"
          />
        )}
      </svg>

      {/* ── Hover tooltip ──────────────────────────────────────────── */}
      {hover && (
        <div
          ref={tooltipRef}
          data-testid="timeline-medication-tooltip"
          className="pointer-events-none fixed z-50 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: tooltipLeft,
            top: tooltipTop,
            width: tooltipWidth,
          }}
        >
          <div className="min-w-0 whitespace-normal break-words font-semibold [overflow-wrap:anywhere]">
            {hover.drugName}
          </div>
          {hover.drugProductName && (
            <div className="min-w-0 whitespace-normal break-words text-[0.6875rem] text-muted-foreground [overflow-wrap:anywhere]">
              {hover.drugProductName}
            </div>
          )}
          {hover.segment === 'future' && (
            <div className="mb-1 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground">
              <span className="inline-block h-1.5 w-3 rounded-[1px] border border-dashed border-muted-foreground/70 bg-muted/25" />
              {mt.timelineAfterToday ?? 'After today'}
            </div>
          )}
          {!hover.drugTerminology && hover.hospitalMedicationName && (
            <HospitalMedicationNameDetails name={hover.hospitalMedicationName} />
          )}
          {hover.drugTerminology && (
            <dl className="mt-1 grid grid-cols-[minmax(6.5rem,2fr)_minmax(0,3fr)] gap-x-2 gap-y-0.5 border-t pt-1 text-[0.6875rem]">
              {hover.drugTerminology.ingredientText && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyIngredientLabel ?? 'Ingredient / strength'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.ingredientText}
                  </dd>
                </>
              )}
              {hover.drugTerminology.officialNameZh && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyOfficialNameZhLabel ?? '中文品名'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.officialNameZh}
                  </dd>
                </>
              )}
              {hover.drugTerminology.officialNameEn && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyOfficialNameEnLabel ?? 'English name'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.officialNameEn}
                  </dd>
                </>
              )}
              {hover.drugTerminology.doseForm && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyDoseFormLabel ?? 'Dose form'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.doseForm}
                  </dd>
                </>
              )}
              {hover.drugTerminology.atcCode && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyAtcLabel ?? 'ATC'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.atcCode}
                    {(hover.drugTerminology.atcNameEn || hover.drugTerminology.atcNameZh) && (
                      <> · {hover.drugTerminology.atcNameEn || hover.drugTerminology.atcNameZh}</>
                    )}
                  </dd>
                </>
              )}
              {hover.drugTerminology.atcLevel2Code && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyAtcLevel2Label ?? 'ATC subgroup'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.atcLevel2Code}
                    {(hover.drugTerminology.atcLevel2NameEn
                      || hover.drugTerminology.atcLevel2NameZh) && (
                      <> · {
                        locale === 'en'
                          ? hover.drugTerminology.atcLevel2NameEn
                            || hover.drugTerminology.atcLevel2NameZh
                          : hover.drugTerminology.atcLevel2NameZh
                            || hover.drugTerminology.atcLevel2NameEn
                      }</>
                    )}
                  </dd>
                </>
              )}
              {hover.drugTerminology.atcLevel4Code && (
                <>
                  <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {mt.terminologyAtcLevel4Label ?? 'ATC level 4'}
                  </dt>
                  <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {hover.drugTerminology.atcLevel4Code}
                    {(hover.drugTerminology.atcLevel4NameEn
                      || hover.drugTerminology.atcLevel4NameZh) && (
                      <> · {
                        locale === 'en'
                          ? hover.drugTerminology.atcLevel4NameEn
                            || hover.drugTerminology.atcLevel4NameZh
                          : hover.drugTerminology.atcLevel4NameZh
                            || hover.drugTerminology.atcLevel4NameEn
                      }</>
                    )}
                  </dd>
                </>
              )}
              <dt className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                {mt.terminologySnapshotLabel ?? 'Version'}
              </dt>
              <dd className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                {hover.drugTerminology.snapshotId}
              </dd>
              <div className="col-span-2 mt-0.5 border-t pt-0.5 text-muted-foreground">
                {mt.terminologySource ?? 'NHI drug master'}
              </div>
            </dl>
          )}
          <div className="text-muted-foreground">
            {shortYmd(hover.bar.startMs)} → {shortYmd(hover.bar.endMs)}
            <span className="ml-1">{hover.bar.supplyDaysUnrecorded ? (locale === 'en' ? '(duration not provided; date marker only)' : '（未提供天數，僅標示紀錄日期）') : `(${hover.bar.supplyDays}d)`}</span>
          </div>
          {hover.bar.selfPurchased && <div>{locale === 'en' ? 'Self-pay' : '自費／自購'}</div>}
          {hover.bar.sourceComparison && <div className="whitespace-normal break-words">{hover.bar.sourceComparison}</div>}
          {hover.bar.sourceStatus && <div>{locale === 'en' ? 'Source status: ' : '來源狀態：'}{hover.bar.sourceStatus}</div>}
          {hover.bar.frequency && (
            <div className="min-w-0 whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]">
              {mt.dosageInstructionLabel ?? mt.frequencyLabel ?? 'Dosage instructions'}:{' '}
              <span className="font-semibold text-foreground">{hover.bar.frequency}</span>
            </div>
          )}
          {hover.bar.pharmacy && (
            <div className="min-w-0 whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]">
              {mt.pharmacyLabel ?? 'Dispensed at'}: {hover.bar.pharmacy}
            </div>
          )}
          {audience === 'medical' && hover.bar.icdCode && (
            <div className="min-w-0 whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]">
              {mt.billingIcdLabel ?? 'Billing ICD'}:{' '}
              <span className="font-mono">{hover.bar.icdCode}</span>
              {hover.bar.icdText && <span className="ml-1">{hover.bar.icdText}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
