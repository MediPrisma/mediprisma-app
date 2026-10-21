// Shared class strings for the 總覽 tab.
//
// Everything here composes tokens that already exist elsewhere in the app —
// no new colour values are introduced, so dark mode and future palette moves
// come for free. Only the compact geometry (heights the design brief pins) is
// local to this tab.
import {
  CLINICAL_ABNORMAL_TONE,
  CLINICAL_INPATIENT_TONE,
  CLINICAL_LIST_ROW_HOVER_TONE,
  CLINICAL_LIST_ROW_TONE,
  CLINICAL_SOURCE_TONE,
} from '@/features/clinical-summary/components/clinical-color-roles'
import { REPORT_ACTIVE_CONTROL_TONE } from '@/features/clinical-summary/reports/components/report-color-roles'
import { RIGHT_PANE_ACTION_CLASSES } from '@/src/shared/config/ui-theme.config'
import { cn } from '@/src/shared/utils/cn.utils'

/** Pill filter chip. Active state reuses the reports workspace control tone. */
export const OVERVIEW_CHIP_BASE =
  'inline-flex h-6 shrink-0 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'

export function overviewChipClass(active: boolean): string {
  return cn(
    OVERVIEW_CHIP_BASE,
    active && `${REPORT_ACTIVE_CONTROL_TONE} font-semibold`,
  )
}

/** 24px square icon button that opens the owning tab (外開 / 向右展開). */
export const OVERVIEW_ICON_ACTION_CLASS = cn(
  RIGHT_PANE_ACTION_CLASSES,
  // RIGHT_PANE_ACTION_CLASSES is `hidden … md:inline-flex` because the right
  // pane does not exist on a phone. This control only switches tabs, so it is
  // useful at every width.
  'inline-flex! h-6 w-6 shrink-0 p-0',
)

export const OVERVIEW_LIST_ROW_CLASS = cn(
  'min-w-0 overflow-hidden rounded-lg border transition-colors',
  CLINICAL_LIST_ROW_TONE,
  CLINICAL_LIST_ROW_HOVER_TONE,
)

export const OVERVIEW_SOURCE_CLASS = cn(
  'inline-flex min-w-0 items-center gap-1',
  CLINICAL_SOURCE_TONE,
)

/** Neutral metadata badge (科別, 分類) — the same tone VisitItem uses. */
export const OVERVIEW_META_BADGE_CLASS =
  'inline-flex shrink-0 items-center py-0 text-muted-foreground'

export const OVERVIEW_ATTENTION_PILL_CLASS = cn(
  'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 font-medium',
  CLINICAL_ABNORMAL_TONE,
)

export const OVERVIEW_INPATIENT_PILL_CLASS = cn(
  'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 font-medium',
  CLINICAL_INPATIENT_TONE,
)

/** 異動 pill (用藥 tile + row). Amber = "changed, check it", not an alert. */
export const OVERVIEW_CHANGE_PILL_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50/70 px-1.5 font-medium text-amber-900/85 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200/85'

export const OVERVIEW_EMPTY_CLASS =
  'py-2 text-center text-xs text-muted-foreground'

export const OVERVIEW_TRUNCATION_CLASS =
  'mt-auto flex shrink-0 items-center gap-1 pt-0.5 text-[0.6875rem] leading-3 text-muted-foreground'
