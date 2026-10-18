"use client"

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisInverseScale,
} from 'recharts'
import { AlertTriangle, CalendarRange, Clock3, Info, RotateCcw, SquareDashedMousePointer, TrendingDown, TrendingUp, ZoomIn } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import {
  assessLabTrendCompatibility,
  groupLabTrendPoints,
  type LabTrendPoint,
  type LabTrendReferenceRange,
  type LabTrendSeries,
} from '@/src/shared/utils/lab-trend.utils'
import { formatNumberSmart } from '../utils/number-format.utils'
import { labTrendGroupKey } from '@/src/shared/utils/lab-trend-group.utils'
import {
  buildCustomTrendTimeScale,
  buildTrendTimeScale,
  findDenseTrendClusters,
  padTrendRange,
  type TrendCluster,
  type TrendCustomRange,
  type TrendTimeScale,
  type TrendWindow,
} from '../utils/trend-time-scale'
import { niceAxis } from './ObservationTrendChart'
import { cn } from '@/src/shared/utils/cn.utils'

interface CumulativeLabTrendDetailProps {
  series: LabTrendSeries
  /** The last range explicitly chosen in the cumulative-report workspace. */
  initialWindow?: TrendWindow
  onWindowChange?: (window: TrendWindow) => void
}

interface CumulativeLabTrendDialogProps extends CumulativeLabTrendDetailProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDateTimeLabel(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const includesTime = /T\d{2}:\d{2}/.test(value)
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includesTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

function formatAxisDate(timestamp: number, locale: string, unit: TrendTimeScale['tickUnit']): string {
  const options: Intl.DateTimeFormatOptions = unit === 'time'
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : unit === 'day'
      ? { month: '2-digit', day: '2-digit' }
      : { year: '2-digit', month: '2-digit' }
  return new Intl.DateTimeFormat(locale, options).format(new Date(timestamp))
}

function formatMonthDay(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(new Date(timestamp))
}

function formatRangeLabel(range: TrendCustomRange, locale: string): string {
  const startYear = new Date(range.start).getFullYear()
  const endYear = new Date(range.end).getFullYear()
  const start = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(range.start))
  const end = startYear === endYear
    ? formatMonthDay(range.end, locale)
    : new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(range.end))
  return `${start}–${end}`
}

function statusLabel(status: string | undefined, zh: boolean): string | undefined {
  if (!status) return undefined
  if (!zh) return status.replace(/-/g, ' ')
  const labels: Record<string, string> = {
    final: '最終結果',
    amended: '已修改',
    corrected: '已更正',
    preliminary: '初步結果',
    registered: '已登記',
    unknown: '狀態未知',
  }
  return labels[status] ?? status
}

function rangeLabel(range: LabTrendReferenceRange | undefined, unit: string | undefined): string | undefined {
  if (!range) return undefined
  if (range.low !== undefined && range.high !== undefined) {
    return `${formatNumberSmart(range.low)}–${formatNumberSmart(range.high)}${unit ? ` ${unit}` : ''}`
  }
  if (range.low !== undefined) return `≥ ${formatNumberSmart(range.low)}${unit ? ` ${unit}` : ''}`
  if (range.high !== undefined) return `≤ ${formatNumberSmart(range.high)}${unit ? ` ${unit}` : ''}`
  return range.text
}

function defaultWindow(series: Pick<LabTrendSeries, 'chartPoints'>): TrendWindow {
  if (series.chartPoints.length < 2) return 'all'
  const latest = series.chartPoints.at(-1)?.timestamp
  if (!latest) return 'all'
  const oneYearAgo = new Date(latest)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  return series.chartPoints.filter((point) => point.timestamp >= oneYearAgo.getTime()).length >= 2
    ? '1y'
    : 'all'
}

function differenceForDisplay(current: number, previous: number): number {
  const decimalPlaces = (value: number) => {
    const text = value.toString().toLowerCase()
    if (text.includes('e-')) return Number(text.split('e-')[1]) || 0
    return text.includes('.') ? text.split('.')[1].length : 0
  }
  const precision = Math.min(6, Math.max(decimalPlaces(current), decimalPlaces(previous)))
  return Number((current - previous).toFixed(precision))
}

const MAX_LABELLED_POINTS = 8
// In a zoomed range a value label shows only when its result sits at least
// this share of the visible span away from both neighbours (~14 px on a
// phone-width plot, ~30 px on desktop: room for a 3–4 character value), so
// labels follow the real spacing rather than a count.
const MIN_ZOOMED_LABEL_GAP_SHARE = 1 / 24

/**
 * Preset windows: every label for up to eight results, else only abnormal
 * results and the latest. Zoomed (`zoomedSpan` = visible domain width in ms):
 * the latest plus every result with room for its label.
 */
export function shouldShowTrendPointLabel(
  points: ReadonlyArray<Pick<LabTrendPoint, 'abnormal'> & Partial<Pick<LabTrendPoint, 'timestamp'>>>,
  index: number,
  zoomedSpan?: number,
): boolean {
  if (index === points.length - 1) return true
  if (zoomedSpan === undefined) {
    return points.length <= MAX_LABELLED_POINTS || points[index]?.abnormal === true
  }
  const at = points[index]?.timestamp
  if (at === undefined) return false
  const minGap = zoomedSpan * MIN_ZOOMED_LABEL_GAP_SHARE
  const before = points[index - 1]?.timestamp
  const after = points[index + 1]?.timestamp
  return (before === undefined || at - before >= minGap)
    && (after === undefined || after - at >= minGap)
}

export function resolveTrendChartReferenceRange(
  series: Pick<LabTrendSeries, 'chartPoints' | 'sharedReferenceRange'>,
): { range: LabTrendReferenceRange; source: 'shared' | 'latest' } | undefined {
  if (series.sharedReferenceRange) {
    return { range: series.sharedReferenceRange, source: 'shared' }
  }

  const latestAvailable = [...series.chartPoints].reverse().find((point) => (
    point.referenceRange?.low !== undefined || point.referenceRange?.high !== undefined
  ))?.referenceRange

  return latestAvailable
    ? { range: latestAvailable, source: 'latest' }
    : undefined
}

// Pointer travel below this is a click (which shows the tooltip), not a drag.
const DRAG_MIN_PX = 8

export type TrendDragResult =
  | { kind: 'click' }
  | { kind: 'too-few' }
  | { kind: 'zoom'; start: number; end: number }

/**
 * Decide what a finished drag on the chart means. `from`/`to` are the times
 * under the pointer at press and release, so the box covers exactly what was
 * dragged over; the zoom then spans the first to last result inside it.
 */
export function resolveTrendDragSelection(
  points: ReadonlyArray<Pick<LabTrendPoint, 'timestamp'>>,
  from: number,
  to: number,
  travelledPx: number,
): TrendDragResult {
  if (travelledPx < DRAG_MIN_PX) return { kind: 'click' }
  const inside = selectedTrendPoints(points, from, to)
  if (inside.length < 2) return { kind: 'too-few' }
  return { kind: 'zoom', start: inside[0].timestamp, end: inside[inside.length - 1].timestamp }
}

function selectedTrendPoints<T extends Pick<LabTrendPoint, 'timestamp'>>(
  points: ReadonlyArray<T>,
  from: number,
  to: number,
): T[] {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  return points
    .filter((point) => point.timestamp >= low && point.timestamp <= high)
    .sort((left, right) => left.timestamp - right.timestamp)
}

export interface TrendDragPreview {
  start: number
  end: number
  count: number
}

interface ChartGeometry {
  left: number
  right: number
  invert: (pixel: number) => number
}

/**
 * Lives inside the chart so it can read the plot area and the X scale, which
 * it hands to the pointer handlers on the chart's container. It also draws the
 * selection box, under the pointer and never intercepting it.
 */
function TrendChartDragLayer({
  geometryRef,
  selection,
}: {
  geometryRef: MutableRefObject<ChartGeometry | null>
  selection: { from: number; to: number } | null
}) {
  const plot = usePlotArea()
  const invert = useXAxisInverseScale()
  useEffect(() => {
    geometryRef.current = plot && invert
      ? { left: plot.x, right: plot.x + plot.width, invert: (pixel) => Number(invert(pixel)) }
      : null
  }, [geometryRef, plot, invert])
  if (!plot || !selection) return null
  const x = Math.min(selection.from, selection.to)
  return (
    <rect
      data-testid="trend-drag-selection"
      x={x}
      y={plot.y}
      width={Math.abs(selection.to - selection.from)}
      height={plot.height}
      fill="#2563eb"
      fillOpacity={0.14}
      stroke="#2563eb"
      strokeOpacity={0.7}
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  )
}

function TrendTooltip({
  active,
  payload,
  locale,
  zh,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: LabTrendPoint }>
  locale: string
  zh: boolean
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const range = rangeLabel(point.referenceRange, point.unit)
  const status = statusLabel(point.status, zh)
  return (
    <div className="max-w-64 rounded-lg border bg-background p-2.5 text-xs shadow-lg">
      <div className="font-semibold text-foreground">
        {formatDateTimeLabel(point.effectiveTime, locale)}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('text-base font-bold tabular-nums', point.abnormal && 'text-red-600 dark:text-red-400')}>
          {point.comparator}{formatNumberSmart(point.value)}
        </span>
        {point.unit && <span className="text-muted-foreground">{point.unit}</span>}
        {point.interpretationCode && (
          <span className="rounded border px-1 font-semibold text-foreground">{point.interpretationCode}</span>
        )}
      </div>
      {range && <div className="mt-1 text-muted-foreground">{zh ? '當次參考範圍' : 'Range at this result'}: {range}</div>}
      {status && <div className="text-muted-foreground">{zh ? '狀態' : 'Status'}: {status}</div>}
      {point.performer && <div className="text-muted-foreground">{zh ? '來源' : 'Source'}: {point.performer}</div>}
      {point.specimen && <div className="text-muted-foreground">{zh ? '檢體' : 'Specimen'}: {point.specimen}</div>}
    </div>
  )
}

function TrendChart({
  points,
  unit,
  referenceRange,
  referenceRangeLabel,
  timeScale,
  zoomed,
  denseRuns,
  onDragPreview,
  onDragEnd,
}: {
  points: LabTrendPoint[]
  unit?: string
  referenceRange?: LabTrendReferenceRange
  referenceRangeLabel: string
  timeScale: TrendTimeScale
  zoomed: boolean
  /** Crowded runs to tint on the plot, matching the dense-run buttons. */
  denseRuns: TrendCluster[]
  /** The live selection while dragging; null once the drag ends. */
  onDragPreview: (preview: TrendDragPreview | null) => void
  onDragEnd: (result: TrendDragResult) => void
}) {
  const { locale } = useLanguage()
  const zh = locale.startsWith('zh')
  // Drag-to-zoom draws a free box: it follows the pointer and is converted to
  // times with the chart's own X scale. Pointer events on the container (with
  // capture) keep the drag going over dots, labels and the axes; the ref is the
  // source of truth so nothing can revive a finished drag.
  type Drag = { pointerId: number; from: number; to: number }
  const geometryRef = useRef<ChartGeometry | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const setDrag = (next: Drag | null) => {
    dragRef.current = next
    setDragState(next)
  }
  const pointerX = (event: ReactPointerEvent<HTMLDivElement>) => {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left
    const geometry = geometryRef.current
    return geometry ? Math.min(geometry.right, Math.max(geometry.left, x)) : x
  }
  const preview = (from: number, to: number): TrendDragPreview | null => {
    const geometry = geometryRef.current
    if (!geometry || Math.abs(to - from) < DRAG_MIN_PX) return null
    const start = geometry.invert(Math.min(from, to))
    const end = geometry.invert(Math.max(from, to))
    return { start, end, count: selectedTrendPoints(points, start, end).length }
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    setDrag(null)
    onDragPreview(null)
    const geometry = geometryRef.current
    if (!commit || !geometry) return
    const to = pointerX(event)
    const result = resolveTrendDragSelection(
      points,
      geometry.invert(current.from),
      geometry.invert(to),
      Math.abs(to - current.from),
    )
    if (result.kind !== 'click') onDragEnd(result)
  }
  const { domain, ticks } = useMemo(() => {
    if (points.length === 0) return { domain: [0, 1] as [number, number], ticks: [0, 1] }
    let low = Math.min(...points.map((point) => point.value))
    let high = Math.max(...points.map((point) => point.value))
    if (referenceRange?.low !== undefined) low = Math.min(low, referenceRange.low)
    if (referenceRange?.high !== undefined) high = Math.max(high, referenceRange.high)
    return niceAxis(low, high)
  }, [points, referenceRange])
  const labelEveryPoint = !zoomed && points.length <= MAX_LABELLED_POINTS
  const zoomedSpan = zoomed ? timeScale.domain[1] - timeScale.domain[0] : undefined

  if (points.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {zh ? '此時間範圍內少於兩筆可比較結果。' : 'Fewer than two comparable results in this range.'}
      </div>
    )
  }

  return (
    <div
      className="h-[260px] w-full cursor-crosshair select-none sm:h-[300px]"
      data-testid="trend-chart-drag-surface"
      onPointerDown={(event) => {
        // Touch keeps scrolling the page; touch users zoom with 自訂範圍.
        if (event.pointerType === 'touch' || event.button !== 0) return
        const geometry = geometryRef.current
        const x = event.clientX - event.currentTarget.getBoundingClientRect().left
        if (!geometry || x < geometry.left || x > geometry.right) return
        event.preventDefault()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
        setDrag({ pointerId: event.pointerId, from: x, to: x })
      }}
      onPointerMove={(event) => {
        const current = dragRef.current
        if (!current || current.pointerId !== event.pointerId) return
        const to = pointerX(event)
        setDrag({ ...current, to })
        onDragPreview(preview(current.from, to))
      }}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      role="img"
      aria-label={zh
        ? `檢驗趨勢圖，共 ${points.length} 筆，時間由左至右`
        : `Lab trend chart with ${points.length} results, oldest to newest`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <LineChart
          data={points}
          margin={{ top: 24, right: 18, bottom: 6, left: 2 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={timeScale.domain}
            ticks={timeScale.ticks}
            allowDataOverflow
            tickFormatter={(value: number) => formatAxisDate(value, locale, timeScale.tickUnit)}
            tick={{ fontSize: 10 }}
            tickLine={false}
            interval={0}
            padding={{ left: 18, right: 18 }}
            className="text-muted-foreground"
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            width={46}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatNumberSmart(value)}
            label={{
              value: unit || '',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, textAnchor: 'middle' },
            }}
            className="text-muted-foreground"
          />
          <Tooltip
            // Hidden while dragging so it never covers the box being drawn.
            active={drag ? false : undefined}
            content={(props) => (
              <TrendTooltip
                active={props.active}
                payload={props.payload as unknown as ReadonlyArray<{ payload?: LabTrendPoint }> | undefined}
                locale={locale}
                zh={zh}
              />
            )}
          />

          {referenceRange?.low !== undefined && referenceRange?.high !== undefined && (
            <ReferenceArea
              y1={referenceRange.low}
              y2={referenceRange.high}
              fill="var(--chart-2)"
              fillOpacity={0.09}
              stroke="none"
              label={{
                value: referenceRangeLabel,
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'var(--chart-2)',
              }}
            />
          )}
          {denseRuns.map((run) => (
            <ReferenceArea
              key={run.start}
              x1={run.start}
              x2={run.end}
              fill="#f59e0b"
              fillOpacity={0.14}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          {referenceRange?.low !== undefined && (
            <ReferenceLine y={referenceRange.low} stroke="var(--chart-2)" strokeOpacity={0.55} strokeDasharray="4 4" />
          )}
          {referenceRange?.high !== undefined && (
            <ReferenceLine y={referenceRange.high} stroke="var(--chart-2)" strokeOpacity={0.55} strokeDasharray="4 4" />
          )}

          <Line
            type="linear"
            dataKey="value"
            isAnimationActive={false}
            stroke="#2563eb"
            strokeWidth={2}
            connectNulls={false}
            dot={(props: any) => {
              const { cx, cy, payload, index } = props
              const point = payload as LabTrendPoint
              if (cx == null || cy == null) return <g key={point?.id ?? index} />
              if (point.critical) {
                return (
                  <path
                    key={point.id}
                    d={`M ${cx} ${cy - 6} L ${cx + 6} ${cy} L ${cx} ${cy + 6} L ${cx - 6} ${cy} Z`}
                    fill="#dc2626"
                    stroke="hsl(var(--card))"
                    strokeWidth={1.5}
                  />
                )
              }
              return (
                <circle
                  key={point.id}
                  cx={cx}
                  cy={cy}
                  r={point.abnormal ? 5 : 4}
                  fill={point.preliminary ? 'hsl(var(--card))' : point.abnormal ? '#dc2626' : '#2563eb'}
                  stroke={point.abnormal ? '#dc2626' : '#2563eb'}
                  strokeWidth={point.preliminary ? 2.5 : 1.5}
                  strokeDasharray={point.preliminary ? '2 1' : undefined}
                />
              )
            }}
            activeDot={{ r: 7, fill: '#2563eb', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
          >
            <LabelList
              dataKey="value"
              content={(props: any) => {
                const { x, y, value, index } = props
                const point = typeof index === 'number' ? points[index] : undefined
                const show = typeof index === 'number'
                  ? shouldShowTrendPointLabel(points, index, zoomedSpan)
                  : labelEveryPoint
                if (!show || x == null || y == null || typeof value !== 'number') return null
                return (
                  <text
                    x={x}
                    y={y - 10}
                    textAnchor="middle"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      fill: point?.abnormal ? '#dc2626' : 'hsl(var(--foreground))',
                    }}
                  >
                    {formatNumberSmart(value)}
                  </text>
                )
              }}
            />
          </Line>

          <TrendChartDragLayer geometryRef={geometryRef} selection={drag} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CumulativeLabTrendDetail({
  series,
  initialWindow,
  onWindowChange,
}: CumulativeLabTrendDetailProps) {
  const { locale } = useLanguage()
  const zh = locale.startsWith('zh')
  const groups = useMemo(() => groupLabTrendPoints(series.points, series.selection.categoryId), [series.points, series.selection.categoryId])
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  // A zoomed range belongs to this analyte and group only; unlike the preset
  // window it is not reported through onWindowChange. It holds the selected
  // first and last results' times, unpadded: it decides which results are
  // shown and labels the range, while only the axis domain is padded.
  const [customRange, setCustomRange] = useState<TrendCustomRange | null>(null)
  const [zoomNotice, setZoomNotice] = useState('')
  const [dragPreview, setDragPreview] = useState<TrendDragPreview | null>(null)
  // Keyboard-operable equivalent of drag-to-zoom: pick the first and last
  // result by index into chartPoints. null while the picker is closed.
  const [rangePicker, setRangePicker] = useState<{ start: number; end: number } | null>(null)
  const group = groups.find(item => item.key === selectedGroupKey) ?? groups[0]
  const chartPoints = useMemo(() => group?.chartPoints ?? [], [group])
  const isOtherGroup = (point: LabTrendPoint) => labTrendGroupKey(point.unit, point.specimen, series.selection.categoryId) !== group?.key
  const otherGroupLabel = zh ? '其他單位／檢體組，未納入目前曲線' : 'Other unit/specimen group; not in the current chart'
  const [window, setWindow] = useState<TrendWindow>(() => initialWindow ?? defaultWindow({ chartPoints }))
  const selectWindow = (value: TrendWindow) => {
    setWindow(value)
    setCustomRange(null)
    setZoomNotice('')
    onWindowChange?.(value)
  }
  const zoomTo = (start: number, end: number) => {
    setCustomRange({ start, end })
    setZoomNotice('')
  }
  const clearZoom = () => {
    setCustomRange(null)
    setZoomNotice('')
  }

  const latest = group?.points.at(-1)
  const newestOverall = series.points.at(-1)
  const previousComparable = chartPoints.length >= 2
    ? chartPoints.at(-2)
    : undefined
  const delta = latest?.plotEligible && previousComparable
    ? differenceForDisplay(latest.value, previousComparable.value)
    : undefined

  const timeScale = useMemo(
    () => customRange
      ? buildCustomTrendTimeScale(padTrendRange(customRange.start, customRange.end))
      : buildTrendTimeScale(chartPoints, window),
    [chartPoints, customRange, window],
  )
  const visiblePoints = useMemo(() => {
    const [start, end] = customRange ? [customRange.start, customRange.end] : timeScale.domain
    return chartPoints.filter((point) => (
      point.timestamp >= start && point.timestamp <= end
    ))
  }, [chartPoints, customRange, timeScale])
  const denseClusters = useMemo(
    // Runs are judged against whatever is on screen, so a wide custom range
    // that still squeezes a run keeps offering to zoom into it. Only shown
    // results count: the padded axis domain can reach past a picked end.
    () => findDenseTrendClusters(visiblePoints, timeScale.domain),
    [visiblePoints, timeScale],
  )
  const toggleRangePicker = () => {
    if (rangePicker) {
      setRangePicker(null)
      return
    }
    // Start from what the chart shows now; fall back to the whole group.
    const first = visiblePoints.length > 0 ? chartPoints.indexOf(visiblePoints[0]) : -1
    const last = visiblePoints.length > 0 ? chartPoints.indexOf(visiblePoints[visiblePoints.length - 1]) : -1
    setRangePicker({
      start: first >= 0 ? first : 0,
      end: last >= 0 ? last : chartPoints.length - 1,
    })
  }
  const visibleCompatibility = useMemo(
    () => assessLabTrendCompatibility(visiblePoints, series.selection.categoryId),
    [series.selection.categoryId, visiblePoints],
  )
  const chartReferenceRange = useMemo(
    () => resolveTrendChartReferenceRange({
      chartPoints: visiblePoints,
      sharedReferenceRange: group?.sharedReferenceRange,
    }),
    [group?.sharedReferenceRange, visiblePoints],
  )

  const strings = {
    latest: groups.length > 1 ? (zh ? '本組最新結果' : 'Latest result in this group') : (zh ? '最新結果' : 'Latest result'),
    previous: zh ? '較前次' : 'vs previous',
    history: zh ? '精確數值' : 'Exact results',
    rangeVaries: zh
      ? '部分歷史參考範圍缺漏或依院所、日期不同；圖中綠色區域僅顯示最新可用參考範圍，仍請以各筆原始範圍判讀。'
      : 'Some historical ranges are missing or vary by source or date. The green area shows only the latest available range; interpret each result using its original range.',
    sameDay: zh
      ? '含同日多筆結果；趨勢依來源時間排序，詳細時間保留於下方紀錄。'
      : 'Includes multiple same-day results; source times are preserved below.',
    inferred: zh
      ? '部分單位由轉換器依已審核規則推估。'
      : 'Some units were inferred under an audited conversion policy.',
    mixedUnits: zh
      ? '所選時間範圍包含無法安全合併的不同單位，因此不連成趨勢線。'
      : 'The selected time range contains incompatible units, so no trend line is drawn.',
    mixedSpecimens: zh
      ? '所選時間範圍的血氣結果包含不同檢體，需分開判讀，因此不連成同一條趨勢線。'
      : 'Blood-gas results in the selected range use different specimens and are not joined into one line.',
    insufficient: zh
      ? '至少需要兩筆具日期、可比較的精確數值才會顯示趨勢線。'
      : 'At least two dated, comparable exact values are required for a trend line.',
  }

  const unavailableText = visibleCompatibility.unavailableReason === 'mixed-units'
    ? strings.mixedUnits
    : visibleCompatibility.unavailableReason === 'mixed-specimens'
      ? strings.mixedSpecimens
      : strings.insufficient

  return (
    <div className="min-w-0 space-y-3" data-testid="cumulative-trend-detail">
      {groups.length > 1 && (
        <label className="block space-y-1 text-xs font-medium">
          <span>{zh ? '繪圖單位／檢體' : 'Chart unit / specimen'}</span>
          <select
            className="min-h-[44px] w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground"
            value={group?.key}
            onChange={(event) => {
              setSelectedGroupKey(event.target.value)
              clearZoom()
              setRangePicker(null)
            }}
          >
            {groups.map(item => (
              <option key={item.key} value={item.key}>
                {item.unit || (zh ? '未提供單位' : 'Unit not provided')}
                {series.selection.categoryId === 'bloodgas' ? ` · ${item.specimen || (zh ? '未提供檢體' : 'Specimen not provided')}` : ''}
                {` · ${item.chartPoints.length} ${zh ? '筆精確數值' : item.chartPoints.length === 1 ? 'exact result' : 'exact results'}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{strings.latest}</div>
          {latest ? (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={cn(
                'text-2xl font-bold tabular-nums tracking-tight',
                latest.abnormal && 'text-red-600 dark:text-red-400',
              )}>
                {latest.comparator}{formatNumberSmart(latest.value)}
              </span>
              {latest.unit && <span className="text-sm text-muted-foreground">{latest.unit}</span>}
              {latest.interpretationCode && (
                <span className={cn(
                  'rounded-md border px-1.5 py-0.5 text-xs font-bold',
                  latest.critical
                    ? 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
                    : latest.abnormal
                      ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'border-border bg-background text-muted-foreground',
                )}>
                  {latest.interpretationCode}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">—</div>
          )}
          {latest && (
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDateTimeLabel(latest.effectiveTime, locale)}
              {latest.performer ? ` · ${latest.performer}` : ''}
            </div>
          )}
        </div>
        {delta !== undefined && (
          <div className="min-w-0 rounded-lg border bg-background px-3 py-2 text-left sm:text-right">
            <div className="text-[0.6875rem] text-muted-foreground">{strings.previous}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 font-semibold tabular-nums text-foreground">
              {delta > 0 ? <TrendingUp className="h-4 w-4" /> : delta < 0 ? <TrendingDown className="h-4 w-4" /> : null}
              {delta > 0 ? '+' : ''}{delta}
            </div>
          </div>
        )}
      </div>

      {latest && newestOverall && newestOverall.timestamp > latest.timestamp && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? `另有較新結果（${formatDateTimeLabel(newestOverall.effectiveTime, locale)}）位於其他單位／檢體組，可切換查看。`
            : `A newer result (${formatDateTimeLabel(newestOverall.effectiveTime, locale)}) is in another unit/specimen group; select that group to view it.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={zh ? '趨勢時間範圍' : 'Trend time range'}>
        {([
          ['6m', zh ? '6 個月' : '6 months'],
          ['1y', zh ? '1 年' : '1 year'],
          ['3y', zh ? '3 年' : '3 years'],
          ['all', zh ? '全部' : 'All'],
        ] as Array<[TrendWindow, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => selectWindow(value)}
            aria-pressed={!customRange && window === value}
            className={cn(
              'min-h-[44px] rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              !customRange && window === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
        {/* The custom range is the fifth time-range option, styled like the
            presets so it reads as one of the choices. It opens the start/end
            picker; the zoomed range and 還原 live in the chart's status row,
            so this row keeps its width and never wraps on zoom. */}
        {chartPoints.length >= 2 && (
          <button
            type="button"
            onClick={toggleRangePicker}
            aria-expanded={!!rangePicker}
            aria-controls="cumulative-trend-range-picker"
            aria-pressed={!!customRange}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              customRange || rangePicker
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
            {zh ? '自訂範圍' : 'Custom range'}
          </button>
        )}
      </div>

      {rangePicker && (
        <div
          id="cumulative-trend-range-picker"
          className="grid gap-2 rounded-lg border bg-muted/20 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          {(['start', 'end'] as const).map((edge) => (
            <label key={edge} className="block min-w-0 space-y-1 text-xs font-medium">
              <span>{edge === 'start' ? (zh ? '起' : 'From') : (zh ? '迄' : 'To')}</span>
              <select
                className="min-h-[44px] w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground"
                value={rangePicker[edge]}
                onChange={(event) => setRangePicker({ ...rangePicker, [edge]: Number(event.target.value) })}
              >
                {chartPoints.map((point, index) => (
                  <option key={point.id} value={index}>
                    {formatDateTimeLabel(point.effectiveTime, locale)} · {point.comparator}{formatNumberSmart(point.value)}{point.unit ? ` ${point.unit}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            disabled={rangePicker.end <= rangePicker.start}
            onClick={() => zoomTo(chartPoints[rangePicker.start].timestamp, chartPoints[rangePicker.end].timestamp)}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-primary bg-primary/10 px-4 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-muted-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
            {zh ? '放大' : 'Zoom'}
          </button>
          {rangePicker.end <= rangePicker.start && (
            <p className="text-xs text-muted-foreground sm:col-span-3">
              {zh ? '迄點需晚於起點，至少包含兩筆結果。' : 'Pick an end result after the start; at least two results are needed.'}
            </p>
          )}
        </div>
      )}

      {groups.length > 1 && (
        <p className="text-xs text-muted-foreground" role="status">
          {zh
            ? '可換算的單位已合併；其餘單位或血氣檢體分組顯示，不跨組連線。每組至少兩筆精確數值才畫線，全部紀錄保留於下方。'
            : 'Convertible units are combined; other units or blood-gas specimens are shown in separate groups. Lines require two exact results in a group. All results remain below.'}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        {visibleCompatibility.chartable && visiblePoints.length >= 2 && (
          // One status row with a steady place above the plot: how to zoom, the
          // live selection, or the zoomed range on the left; the dense-run
          // zoom and 還原 on the right. Nothing above the chart shifts on zoom.
          <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/30 px-3 py-1.5">
            <p
              aria-live="polite"
              className={cn(
                'flex min-w-0 flex-1 basis-56 items-center gap-1.5 text-xs',
                zoomNotice
                  ? 'text-amber-700 dark:text-amber-300'
                  : dragPreview ? 'font-medium text-primary' : 'text-foreground/80',
              )}
            >
              {zoomNotice ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {zoomNotice}
                </>
              ) : dragPreview ? (
                <>
                  <SquareDashedMousePointer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {dragPreview.count >= 2
                    ? (zh
                      ? `選取 ${formatRangeLabel(dragPreview, locale)} · ${dragPreview.count} 筆，放開即可放大`
                      : `Selecting ${formatRangeLabel(dragPreview, locale)} · ${dragPreview.count} results; release to zoom`)
                    : (zh ? '框內需至少兩筆結果才能放大' : 'Include at least two results to zoom')}
                </>
              ) : customRange ? (
                <>
                  <ZoomIn className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-semibold text-primary">
                      {zh ? '已放大' : 'Zoomed to'} {formatRangeLabel(customRange, locale)}
                    </span>
                    {` · ${visiblePoints.length} ${zh ? '筆' : 'results'}`}
                  </span>
                </>
              ) : (
                <>
                  {/* Dragging needs a mouse; touch users get the 自訂範圍 route. */}
                  <SquareDashedMousePointer className="hidden h-3.5 w-3.5 shrink-0 text-primary pointer-fine:inline" aria-hidden="true" />
                  <CalendarRange className="h-3.5 w-3.5 shrink-0 text-primary pointer-fine:hidden" aria-hidden="true" />
                  <span className="hidden pointer-fine:inline">
                    {zh ? '在圖上按住滑鼠左右拖曳，框出要放大的時間' : 'Click and drag across the chart to box the period to zoom into'}
                  </span>
                  <span className="pointer-fine:hidden">
                    {zh ? '用「自訂範圍」選擇要放大的時間' : 'Use 「Custom range」 to pick a period to zoom into'}
                  </span>
                </>
              )}
            </p>
            {denseClusters.map((cluster) => (
              <button
                key={cluster.start}
                type="button"
                onClick={() => zoomTo(cluster.start, cluster.end)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                {zh ? '放大密集區' : 'Zoom dense run'} {formatMonthDay(cluster.start, locale)}–{formatMonthDay(cluster.end, locale)}（{cluster.count} {zh ? '筆' : 'results'}）
              </button>
            ))}
            {customRange && (
              <button
                type="button"
                onClick={clearZoom}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {zh ? '還原' : 'Reset'}
              </button>
            )}
          </div>
        )}
        {visibleCompatibility.chartable ? (
          <TrendChart
            points={visiblePoints}
            unit={visibleCompatibility.unit}
            referenceRange={chartReferenceRange?.range}
            referenceRangeLabel={chartReferenceRange?.source === 'shared'
              ? (zh ? '共同參考範圍' : 'Shared range')
              : (zh ? '最新可用參考範圍' : 'Latest available range')}
            timeScale={timeScale}
            zoomed={!!customRange}
            denseRuns={denseClusters}
            onDragPreview={(preview) => {
              setDragPreview(preview)
              if (preview) setZoomNotice('')
            }}
            onDragEnd={(result) => {
              if (result.kind === 'zoom') zoomTo(result.start, result.end)
              else setZoomNotice(zh ? '選取範圍內少於兩筆結果，未放大。' : 'Fewer than two results selected; not zoomed.')
            }}
          />
        ) : (
          <div className="flex min-h-56 items-center justify-center p-6 text-center">
            <div className="max-w-md">
              <AlertTriangle className="mx-auto h-6 w-6 text-amber-600" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">{unavailableText}</p>
            </div>
          </div>
        )}
      </div>

      {(group?.referenceRangesVary || series.sameDayMultiple || series.points.some((point) => point.unitInferred)) && (
        <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          {group?.referenceRangesVary && <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{strings.rangeVaries}</p>}
          {series.sameDayMultiple && <p className="flex gap-2"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{strings.sameDay}</p>}
          {series.points.some((point) => point.unitInferred) && <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{strings.inferred}</p>}
        </div>
      )}

      <section className="min-w-0" aria-labelledby="cumulative-trend-history-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id="cumulative-trend-history-title" className="text-sm font-semibold text-foreground">{strings.history}</h3>
          <span className="text-xs text-muted-foreground">{series.points.length} {zh ? '筆' : 'results'}</span>
        </div>
        <div className="space-y-2 sm:hidden">
          {[...series.points].reverse().map((point) => (
            <article key={point.id} className="rounded-lg border bg-card p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="text-muted-foreground">{formatDateTimeLabel(point.effectiveTime, locale)}</div>
                <div className={cn('shrink-0 text-right font-semibold tabular-nums', point.abnormal && 'text-red-600 dark:text-red-400')}>
                  {point.comparator}{formatNumberSmart(point.value)} {point.unit}
                  {point.interpretationCode && <span className="ml-1 rounded border px-1 text-[0.625rem]">{point.interpretationCode}</span>}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-muted-foreground">
                <span>{zh ? '參考' : 'Range'}</span>
                <span>{rangeLabel(point.referenceRange, point.unit) || '—'}</span>
                <span>{zh ? '狀態' : 'Status'}</span>
                <span>{statusLabel(point.status, zh) || '—'}{point.corrected ? ` · ${zh ? '修訂' : 'revised'}` : ''}</span>
                {isOtherGroup(point) && <><span>{zh ? '趨勢' : 'Trend'}</span><span>{otherGroupLabel}</span></>}
                {point.performer && <><span>{zh ? '來源' : 'Source'}</span><span>{point.performer}</span></>}
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border sm:block">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-2.5 py-2 text-left font-medium">{zh ? '採檢時間' : 'Effective time'}</th>
                <th className="px-2.5 py-2 text-right font-medium">{zh ? '結果' : 'Result'}</th>
                <th className="px-2.5 py-2 text-left font-medium">{zh ? '當次參考範圍' : 'Range at result'}</th>
                <th className="px-2.5 py-2 text-left font-medium">{zh ? '狀態／來源' : 'Status / source'}</th>
              </tr>
            </thead>
            <tbody>
              {[...series.points].reverse().map((point) => (
                <tr key={point.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-2.5 py-2 text-foreground">
                    {formatDateTimeLabel(point.effectiveTime, locale)}
                  </td>
                  <td className={cn('whitespace-nowrap px-2.5 py-2 text-right font-semibold tabular-nums', point.abnormal && 'text-red-600 dark:text-red-400')}>
                    {point.comparator}{formatNumberSmart(point.value)} {point.unit}
                    {point.interpretationCode && <><span aria-hidden="true"> </span><span className="ml-1 rounded border px-1 text-[0.625rem]">{point.interpretationCode}</span></>}
                  </td>
                  <td className="px-2.5 py-2 text-muted-foreground">
                    {rangeLabel(point.referenceRange, point.unit) || '—'}
                  </td>
                  <td className="px-2.5 py-2 text-muted-foreground">
                    <div>{statusLabel(point.status, zh) || '—'}{point.corrected ? ` · ${zh ? '修訂' : 'revised'}` : ''}</div>
                    {isOtherGroup(point) && <div>{otherGroupLabel}</div>}
                    {point.performer && <div className="mt-0.5 max-w-56 truncate" title={point.performer}>{point.performer}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export function CumulativeLabTrendDialog({
  title,
  series,
  open,
  onOpenChange,
  initialWindow,
  onWindowChange,
}: CumulativeLabTrendDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-4 sm:p-6" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <CumulativeLabTrendDetail
          series={series}
          initialWindow={initialWindow}
          onWindowChange={onWindowChange}
        />
      </DialogContent>
    </Dialog>
  )
}
