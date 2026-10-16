"use client"

import { useMemo, useState } from 'react'
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
} from 'recharts'
import { AlertTriangle, Clock3, Info, TrendingDown, TrendingUp } from 'lucide-react'
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
  buildTrendTimeScale,
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

function formatAxisDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: '2-digit',
    month: '2-digit',
  }).format(new Date(timestamp))
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

export function shouldShowTrendPointLabel(
  points: ReadonlyArray<Pick<LabTrendPoint, 'abnormal'>>,
  index: number,
): boolean {
  return points.length <= 8
    || points[index]?.abnormal === true
    || index === points.length - 1
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
}: {
  points: LabTrendPoint[]
  unit?: string
  referenceRange?: LabTrendReferenceRange
  referenceRangeLabel: string
  timeScale: TrendTimeScale
}) {
  const { locale } = useLanguage()
  const zh = locale.startsWith('zh')
  const { domain, ticks } = useMemo(() => {
    if (points.length === 0) return { domain: [0, 1] as [number, number], ticks: [0, 1] }
    let low = Math.min(...points.map((point) => point.value))
    let high = Math.max(...points.map((point) => point.value))
    if (referenceRange?.low !== undefined) low = Math.min(low, referenceRange.low)
    if (referenceRange?.high !== undefined) high = Math.max(high, referenceRange.high)
    return niceAxis(low, high)
  }, [points, referenceRange])
  const labelEveryPoint = points.length <= 8

  if (points.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {zh ? '此時間範圍內少於兩筆可比較結果。' : 'Fewer than two comparable results in this range.'}
      </div>
    )
  }

  return (
    <div
      className="h-[260px] w-full sm:h-[300px]"
      role="img"
      aria-label={zh
        ? `檢驗趨勢圖，共 ${points.length} 筆，時間由左至右`
        : `Lab trend chart with ${points.length} results, oldest to newest`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <LineChart data={points} margin={{ top: 24, right: 18, bottom: 6, left: 2 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={timeScale.domain}
            ticks={timeScale.ticks}
            allowDataOverflow
            tickFormatter={(value: number) => formatAxisDate(value, locale)}
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
                  ? shouldShowTrendPointLabel(points, index)
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
  const group = groups.find(item => item.key === selectedGroupKey) ?? groups[0]
  const chartPoints = useMemo(() => group?.chartPoints ?? [], [group])
  const isOtherGroup = (point: LabTrendPoint) => labTrendGroupKey(point.unit, point.specimen, series.selection.categoryId) !== group?.key
  const otherGroupLabel = zh ? '其他單位／檢體組，未納入目前曲線' : 'Other unit/specimen group; not in the current chart'
  const [window, setWindow] = useState<TrendWindow>(() => initialWindow ?? defaultWindow({ chartPoints }))
  const selectWindow = (value: TrendWindow) => {
    setWindow(value)
    onWindowChange?.(value)
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
    () => buildTrendTimeScale(chartPoints, window),
    [chartPoints, window],
  )
  const visiblePoints = useMemo(() => {
    const [start, end] = timeScale.domain
    return chartPoints.filter((point) => (
      point.timestamp >= start && point.timestamp <= end
    ))
  }, [chartPoints, timeScale])
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
            onChange={(event) => setSelectedGroupKey(event.target.value)}
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
            aria-pressed={window === value}
            className={cn(
              'min-h-[44px] rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              window === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {groups.length > 1 && (
        <p className="text-xs text-muted-foreground" role="status">
          {zh
            ? '可換算的單位已合併；其餘單位或血氣檢體分組顯示，不跨組連線。每組至少兩筆精確數值才畫線，全部紀錄保留於下方。'
            : 'Convertible units are combined; other units or blood-gas specimens are shown in separate groups. Lines require two exact results in a group. All results remain below.'}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        {visibleCompatibility.chartable ? (
          <TrendChart
            points={visiblePoints}
            unit={visibleCompatibility.unit}
            referenceRange={chartReferenceRange?.range}
            referenceRangeLabel={chartReferenceRange?.source === 'shared'
              ? (zh ? '共同參考範圍' : 'Shared range')
              : (zh ? '最新可用參考範圍' : 'Latest available range')}
            timeScale={timeScale}
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
