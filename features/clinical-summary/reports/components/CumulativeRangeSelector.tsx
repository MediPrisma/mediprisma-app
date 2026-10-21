"use client"

// 顯示範圍 + 版面 segmented controls for the cumulative report toolbar.
//
// Both are radio groups rather than dropdowns: the whole point of the stacked
// layout is that the clinician can retune "how much history" in one click
// while reading, and a menu costs two.
import { Rows3, Table2 } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { cn } from "@/src/shared/utils/cn.utils"
import {
  CUMULATIVE_RANGE_IDS,
  type CumulativeRangeId,
} from "../utils/cumulative-range.utils"
import type { CumulativeLayoutMode } from "@/src/application/stores/cumulative-report-prefs.store"

const SEGMENT_GROUP_CLASSES =
  "inline-flex items-center gap-px"
// Touch targets: phones get the repo's 36px floor, desktop stays compact so
// the toolbar keeps its single-row height.
const SEGMENT_CLASSES =
  "inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[0.6875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:min-h-[36px] max-md:px-2.5"
const SEGMENT_ACTIVE_CLASSES = "bg-foreground/[0.07] font-semibold text-foreground"
const SEGMENT_IDLE_CLASSES = "text-muted-foreground hover:text-foreground"

export function useCumulativeRangeLabels(): Record<CumulativeRangeId, string> {
  const { t } = useLanguage()
  const strings = (t.reports as any).cumulativeRange ?? {}
  return {
    latest1: strings.latest1 ?? '最新一筆',
    latest3: strings.latest3 ?? '最新三筆',
    months3: strings.months3 ?? '最近三個月',
    months6: strings.months6 ?? '最近半年',
    year1: strings.year1 ?? '最近一年',
    all: strings.all ?? '全部',
  }
}

export function CumulativeRangeSelector({
  value,
  onChange,
  className,
  scrollable = false,
}: {
  value: CumulativeRangeId
  onChange: (range: CumulativeRangeId) => void
  className?: string
  /** Phone toolbar row: the range options do not fit, so the pill row scrolls
   *  sideways instead of wrapping into a second line. */
  scrollable?: boolean
}) {
  const { t } = useLanguage()
  const strings = (t.reports as any).cumulativeRange ?? {}
  const labels = useCumulativeRangeLabels()
  const groupLabel = strings.label ?? '顯示範圍'

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-1",
        scrollable && "w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <span className="shrink-0 whitespace-nowrap text-[0.6875rem] text-muted-foreground">
        {groupLabel}
      </span>
      <div role="radiogroup" aria-label={groupLabel} className={SEGMENT_GROUP_CLASSES}>
        {CUMULATIVE_RANGE_IDS.map((id) => {
          const active = id === value
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(id)}
              className={cn(SEGMENT_CLASSES, active ? SEGMENT_ACTIVE_CLASSES : SEGMENT_IDLE_CLASSES)}
            >
              {labels[id]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CumulativeLayoutToggle({
  value,
  onChange,
  className,
}: {
  value: CumulativeLayoutMode
  onChange: (mode: CumulativeLayoutMode) => void
  className?: string
}) {
  const { t } = useLanguage()
  const strings = (t.reports as any).cumulativeLayout ?? {}
  const groupLabel = strings.label ?? '版面'
  const options: Array<{ id: CumulativeLayoutMode; label: string; Icon: typeof Table2 }> = [
    { id: 'tabs', label: strings.tabs ?? '分頁', Icon: Table2 },
    { id: 'stacked', label: strings.stacked ?? '直式', Icon: Rows3 },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={cn(SEGMENT_GROUP_CLASSES, "shrink-0", className)}
    >
      {options.map(({ id, label }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={cn(SEGMENT_CLASSES, active ? SEGMENT_ACTIVE_CLASSES : SEGMENT_IDLE_CLASSES)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
