"use client"

// Title + date range + the 1／3／6 個月／1 年 range chips + 專注總覽.
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useWorkspacePanels } from '@/src/application/providers/workspace-panels.provider'
import { useHydrated } from '@/src/shared/hooks/use-hydrated.hook'
import { formatDate } from '@/src/shared/utils/date.utils'
import { overviewChipClass } from './overview-styles'
import {
  OVERVIEW_RANGE_MONTHS,
  type OverviewRangeMonths,
  type OverviewWindow,
} from '../utils/overview-selectors'

export function OverviewHeader({
  window,
  onRangeChange,
}: {
  window: OverviewWindow
  onRangeChange: (months: OverviewRangeMonths) => void
}) {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const ranges = strings.ranges as Record<string, string>
  // Absent outside the workspace shell (and in unit tests) — then the control
  // simply is not offered. The split it acts on does not exist below md.
  const panels = useWorkspacePanels()
  // A TOGGLE, not a one-way door. On a display too narrow for the 2×2 the
  // shell collapses the feature panel by itself, and a control that merely
  // disappeared at that point would leave the AI summary with no visible way
  // back — the collapsed rail alone is easy to miss on the far edge.
  const featuresHidden = panels?.collapsed === 'right'
  const showToggle = !!panels && (panels.collapsed === null || featuresHidden)
  // The window ends on the READER's today, which the server cannot know: it
  // runs in its own time zone (UTC is a day behind Taipei until 08:00), and a
  // static export prints the day it was built. So the server HTML carries the
  // label with every digit masked — identical on both sides for any day, and
  // the same width under tabular numerals, so the range chips do not jump when
  // the real dates arrive right after hydration.
  const hydrated = useHydrated()
  const rangeText = strings.rangeLabel
    .replace('{start}', formatDate(window.startDay, locale))
    .replace('{end}', formatDate(window.endDay, locale))

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[0.9375rem] font-semibold text-foreground">
          {window.months === 12
            ? strings.yearTitle
            : strings.title.replace('{months}', String(window.months))}
        </span>
        <span
          className={`truncate text-xs tabular-nums text-muted-foreground${hydrated ? '' : ' invisible'}`}
        >
          {hydrated ? rangeText : rangeText.replace(/\d/g, '0')}
        </span>
      </div>
      <div
        className="flex items-center gap-1.5"
        role="group"
        aria-label={strings.rangeAriaLabel}
      >
        {OVERVIEW_RANGE_MONTHS.map((months) => (
          <button
            key={months}
            type="button"
            aria-pressed={window.months === months}
            className={overviewChipClass(window.months === months)}
            onClick={() => onRangeChange(months)}
          >
            {ranges[String(months)]}
          </button>
        ))}
        {showToggle && (
          <button
            type="button"
            title={featuresHidden ? t.header.showFeaturesHint : t.header.focusOverviewHint}
            aria-label={featuresHidden ? t.header.showFeaturesHint : t.header.focusOverviewHint}
            aria-pressed={featuresHidden}
            onClick={() => panels?.setCollapsed(featuresHidden ? null : 'right')}
            className={`${overviewChipClass(featuresHidden)} hidden items-center gap-1 md:inline-flex`}
          >
            {featuresHidden
              ? <PanelRightOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              : <PanelRightClose className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {featuresHidden ? t.header.showFeatures : t.header.focusOverview}
          </button>
        )}
      </div>
    </div>
  )
}
