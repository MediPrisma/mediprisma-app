"use client"

import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TapTooltip } from "@/src/shared/components/TapTooltip"
import { cn } from "@/src/shared/utils/cn.utils"

type CompactLabResultRowProps = {
  title: string
  titleNode?: ReactNode
  value: string
  abnormal?: boolean
  referenceText?: string
  referenceComparison?: 'high' | 'low' | 'normal'
  referenceComparisonLabel?: string
  referenceComparisonTooltip?: string
  rangeUnassessed?: boolean
  rangeUnassessedLabel?: string
  rangeUnassessedTooltip?: string
  leadingTitleContent?: ReactNode
  titleActions?: ReactNode
  afterValue?: ReactNode
  trailingContent?: ReactNode
  className?: string
  titleColumnClassName?: string
  titleClassName?: string
  valueMaxWidthClassName?: string
  /** Let source metadata share the primary row when it genuinely fits.
   *  The metadata wraps as one unit rather than compressing the clinical name. */
  adaptivePhoneLayout?: boolean
  /** Keep `trailingContent` on the PRIMARY line instead of promoting it to the
   *  phone layout's second row. For icon-only trailing (a fold chevron): the
   *  second row exists so a source/date cluster does not squeeze the clinical
   *  name, and spending a whole lane — plus the row gap — on one 12px glyph
   *  cost more height than the glyph. Text-bearing trailing must NOT set this;
   *  it is what the second row is for. */
  trailingInline?: boolean
  /** Align title, clinical value, and metadata as stable scan columns once the
   *  containing report surface is wide enough. Narrow panels keep the existing
   *  adaptive flex/wrap behaviour. */
  alignedDesktopColumns?: boolean
  role?: "button"
  tabIndex?: number
  /** Accessible name for a row that IS the control. Without it the row's whole
   *  reading (name, value, range, source, date) becomes the button's name and
   *  never says what tapping does. */
  ariaLabel?: string
  ariaExpanded?: boolean
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

function normalizeComparableText(text: string): string {
  return text.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim()
}

function shouldShowReferenceRange(value: string, referenceText?: string): boolean {
  if (!referenceText) return false
  return normalizeComparableText(referenceText) !== normalizeComparableText(value)
}

function CompactValue({
  value,
  abnormal,
  maxWidthClassName = "max-w-[9rem]",
}: {
  value: string
  abnormal: boolean
  maxWidthClassName?: string
}) {
  // A truncated result value is the row's whole point, and on touch the hover
  // bubble that held the rest of it was unreachable. Tapping the value drops
  // the truncation so it wraps in place — no bubble to position, nothing to
  // dismiss, and the reading stays selectable/copyable. Desktop keeps the
  // quick hover peek while collapsed.
  const [expanded, setExpanded] = useState(false)
  const isLong = value.length > 20
  const valueClass = cn(
    "text-[0.8125rem] font-bold tabular-nums",
    isLong ? ["shrink truncate", maxWidthClassName] : "shrink-0",
    abnormal ? "text-clinical-abnormal" : "text-foreground",
  )

  if (!isLong) return <span className={valueClass}>{value}</span>

  const toggle = (event: MouseEvent | KeyboardEvent) => {
    // The row itself is often a toggle — revealing the value must not also
    // open/close it.
    event.stopPropagation()
    setExpanded((current) => !current)
  }

  if (expanded) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-expanded
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle(event)
        }}
        className={cn(
          "min-w-0 shrink cursor-pointer touch-manipulation whitespace-normal break-words text-[0.8125rem] font-bold tabular-nums",
          abnormal ? "text-clinical-abnormal" : "text-foreground",
        )}
      >
        {value}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-expanded={false}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggle(event)
          }}
          className={cn(valueClass, "cursor-pointer touch-manipulation")}
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(90vw,24rem)] whitespace-normal break-words text-xs leading-relaxed">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

function CompactReferenceRange({
  referenceText,
  value,
}: {
  referenceText?: string
  value: string
}) {
  if (!referenceText || !shouldShowReferenceRange(value, referenceText)) return null

  // Most ranges are short clinical values such as "[3.5–5.1 mmol/L]" and
  // should be readable without another tap. Only complex stratified ranges
  // collapse to a tappable/hoverable label.
  if (referenceText.length <= 22) {
    return (
      <span
        data-testid="reference-range-inline"
        className="shrink-0 whitespace-nowrap text-[0.6875rem] text-muted-foreground"
      >
        {referenceText}
      </span>
    )
  }

  // The collapsed label is the ONLY way to read a stratified range on a touch
  // layout, and at 0.6875rem its own line box is barely 16px of tap target.
  // `-my/py` pads the hit area out by 20px without changing what the row
  // measures: the padding is cancelled by an equal negative margin, so the
  // analyte lane still lays out at its text height at ANY root size. Scoped to
  // <768 (the app's md split) like the row's other touch targets; md+ keeps the
  // bare label and hover.
  //
  // md+: 12rem is the FLOOR, not the ceiling. A nested panel row has no
  // institution/date beside it, and a fixed 144px cut a stratified range off
  // with half the row still empty. `w-0 grow` takes whatever the cluster has
  // spare while contributing only the 12rem minimum to the cluster's
  // min-content — so a crowded row holds open exactly as before — and
  // `max-w-max` stops at the text's end, keeping a high/low badge beside the
  // range instead of pushed to the row's edge.
  return (
    <TapTooltip
      content={referenceText}
      aria-label={`參考範圍 ${referenceText}`}
      contentClassName="max-h-[50vh] max-w-[min(90vw,28rem)] overflow-y-auto whitespace-normal break-words text-xs leading-relaxed"
      className="inline-flex min-w-0 max-w-[8rem] shrink max-md:-my-[10px] max-md:py-[10px] sm:max-w-[12rem] md:w-0 md:min-w-[12rem] md:max-w-max md:grow"
    >
      <span
        data-testid="reference-range-truncated"
        className="min-w-0 truncate text-[0.6875rem] text-muted-foreground"
      >
        {referenceText}
      </span>
    </TapTooltip>
  )
}

function RangeUnassessedBadge({
  label = "未判讀",
  tooltip = "此項沒有來源異常標示；參考範圍包含多組條件、複雜文字、單位不一致或資料不完整，因此未自動比對。",
}: {
  label?: string
  tooltip?: string
}) {
  // 「未判讀」 says nothing on its own — WHY the app did not assess this value
  // lives only in the bubble, and a clinician reading on an iPad could never
  // open it. Tap now reveals the same explanation.
  return (
    <TapTooltip
      content={tooltip}
      aria-label={label}
      contentClassName="max-w-[min(90vw,22rem)] whitespace-normal text-xs leading-relaxed"
      className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0 text-[0.625rem] font-medium text-slate-600 dark:border-border dark:bg-muted/40 dark:text-muted-foreground"
    >
      {label}
    </TapTooltip>
  )
}

function ReferenceComparisonBadge({
  comparison,
  label,
  tooltip = "來源未提供異常標示；系統依單一、可解析且單位相容的參考區間比對。僅表示數值與該區間的關係，不代表臨床診斷。",
}: {
  comparison: 'high' | 'low'
  label?: string
  tooltip?: string
}) {
  const visibleLabel = label ?? (comparison === 'high' ? '高於參考' : '低於參考')
  return (
    <TapTooltip
      content={tooltip}
      aria-label={visibleLabel}
      contentClassName="max-w-[min(90vw,24rem)] whitespace-normal text-xs leading-relaxed"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0 text-[0.625rem] font-medium',
        comparison === 'high'
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
          : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
      )}
    >
      {visibleLabel}
    </TapTooltip>
  )
}

export function CompactLabResultRow({
  title,
  titleNode,
  value,
  abnormal = false,
  referenceText,
  referenceComparison,
  referenceComparisonLabel,
  referenceComparisonTooltip,
  rangeUnassessed = false,
  rangeUnassessedLabel,
  rangeUnassessedTooltip,
  leadingTitleContent,
  titleActions,
  afterValue,
  trailingContent,
  className,
  titleColumnClassName,
  titleClassName,
  valueMaxWidthClassName,
  adaptivePhoneLayout = false,
  trailingInline = false,
  alignedDesktopColumns = false,
  role,
  tabIndex,
  ariaLabel,
  ariaExpanded,
  onClick,
  onKeyDown,
}: CompactLabResultRowProps) {
  return (
    <div
      role={role}
      data-testid="compact-lab-result-row"
      data-mobile-adaptive={adaptivePhoneLayout ? "true" : undefined}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        // No touch-height floor. A result row is ONE line of 9-10px text, and
        // reserving 36-38px for an icon-sized tap target inside it read as a
        // box of padding with a number lost in the middle. The row itself is
        // the target instead (`role=button` + `onClick` from the host): ~343px
        // wide against ~24px tall is a far easier hit than a 36px square, so
        // the height can go back to what the content needs. The 36px rule still
        // governs small ISOLATED controls — see ObservationLongitudinalAction,
        // which keeps its box wherever the button, not the row, owns the tap.
        "grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-0.5 overflow-hidden rounded-md border bg-muted/40 px-2 py-1 sm:flex sm:px-2.5 sm:py-1.5",
        // Icon-only trailing joins the primary line: a third auto column at the
        // row's end (the grid is phone-only — `sm:flex` takes over above it, so
        // the column count is irrelevant there and md+ is untouched).
        trailingInline && "max-sm:grid-cols-[minmax(0,1fr)_auto_auto]",
        adaptivePhoneLayout && "min-[380px]:flex min-[380px]:flex-wrap min-[380px]:gap-x-1 min-[380px]:px-2.5 min-[380px]:py-1.5",
        alignedDesktopColumns && "@min-[800px]:!grid @min-[800px]:grid-cols-[minmax(12rem,1fr)_auto_auto] @min-[800px]:items-center",
        abnormal && "border-red-200 bg-red-50/30 dark:border-rose-500/25 dark:bg-rose-500/[0.06]",
        className,
      )}
    >
      <div className={cn(
        "flex min-w-0 basis-[45%] shrink-0 grow-0 items-center gap-1.5",
        adaptivePhoneLayout && "min-[380px]:min-w-[3.75rem] min-[380px]:basis-auto min-[380px]:flex-1 min-[380px]:shrink",
        alignedDesktopColumns && "@min-[800px]:basis-auto @min-[800px]:grow-0 @min-[800px]:shrink",
        titleColumnClassName,
      )} data-testid="compact-lab-title">
        {leadingTitleContent}
        {/* The analyte name truncates, and on a phone the hover bubble was the
            only place the rest of it existed — unreachable with a finger.
            TapTooltip keeps the desktop hover peek and adds the tap. */}
        <TapTooltip
          content={title}
          aria-label={title}
          asChild
          contentClassName="max-w-[min(90vw,24rem)] whitespace-normal break-words"
        >
          <span
            tabIndex={0}
            className={cn("truncate text-[0.8125rem] font-semibold text-foreground", titleClassName)}
          >
            {titleNode ?? title}
          </span>
        </TapTooltip>
        {titleActions}
      </div>
      {/* No `min-w-0` here, deliberately. The value and its reference range are
          the clinical payload and neither can give ground on its own — a short
          value is `shrink-0` and the inline range is `whitespace-nowrap` — so
          zeroing this cluster's minimum let it shrink below its content and the
          range PAINTED OVER the institution/date cluster beside it instead of
          anything truncating. Flexbox's automatic minimum size (min-content)
          now holds the cluster open; the slack comes out of the title (which
          truncates) or the meta (which wraps, then clips). */}
      <div className={cn(
        "flex items-center justify-end gap-1.5",
        adaptivePhoneLayout
          // Single-line adaptive row: hug the content. `flex-1` (basis 0) was
          // the second half of the overlap — a 0 hypothetical main size means
          // the flex line always "fits", so the meta cluster never wrapped to
          // line 2 the way this layout intends; it stayed put and got painted
          // over. `flex-none` restores the wrap and leaves `ml-auto` working.
          ? "min-[380px]:flex-none min-[380px]:justify-start"
          : "sm:flex-1 sm:justify-start",
        alignedDesktopColumns && "@min-[800px]:!justify-end",
      )} data-testid="compact-lab-value">
        <CompactValue value={value} abnormal={abnormal} maxWidthClassName={valueMaxWidthClassName} />
        {afterValue}
        <CompactReferenceRange referenceText={referenceText} value={value} />
        {(referenceComparison === 'high' || referenceComparison === 'low') && (
          <ReferenceComparisonBadge
            comparison={referenceComparison}
            label={referenceComparisonLabel}
            tooltip={referenceComparisonTooltip}
          />
        )}
        {rangeUnassessed && (
          <RangeUnassessedBadge
            label={rangeUnassessedLabel}
            tooltip={rangeUnassessedTooltip}
          />
        )}
      </div>
      {/* `empty:hidden`, not just the `trailingContent &&` guard: hosts pass a
          FRAGMENT whose contents are all conditional (ReportRow's institution /
          date / duplicate warning all drop out under `hideMeta`), which is
          truthy even when it renders no DOM at all. Such a div still claimed
          the second grid row plus the row gap. `display: none` takes it out of
          the grid entirely, so the row collapses to its primary line. */}
      {trailingContent && (
        <div className={cn(
          "flex min-w-0 items-center justify-start overflow-hidden empty:hidden sm:col-auto sm:row-auto sm:shrink-0",
          // Icon-only trailing rides the primary line's third column; anything
          // text-bearing keeps the full-width second row, which is what stops a
          // source/date cluster from squeezing the clinical name.
          trailingInline ? "col-start-3 row-start-1 shrink-0" : "col-span-2 row-start-2",
          adaptivePhoneLayout && "min-[380px]:col-auto min-[380px]:row-auto min-[380px]:ml-auto min-[380px]:shrink-0",
          alignedDesktopColumns && "@min-[800px]:!ml-0",
        )} data-testid="compact-lab-meta">
          {trailingContent}
        </div>
      )}
    </div>
  )
}
