import {
  clinicalIcdCodeToneClass,
  clinicalIcdDescriptionToneClass,
  clinicalIcdToneClass,
} from '@/features/clinical-summary/components/clinical-metadata-styles'

const MEDICATION_CATEGORY_CHIP_BASE =
  "inline-flex h-5 min-w-0 items-center overflow-hidden rounded-sm bg-secondary/65 px-1.5 py-0 text-[0.6875rem] font-medium text-secondary-foreground/75 dark:bg-secondary/55 dark:text-secondary-foreground/80"

export const medicationCategoryChipClass =
  `${MEDICATION_CATEGORY_CHIP_BASE} max-w-full`

export const medicationHistoryCategoryChipClass =
  `${MEDICATION_CATEGORY_CHIP_BASE} max-w-[9rem]`

// Billing ICD shares the same quiet diagnostic role as visit-history ICDs.
// Its sand tone stays restrained; remaining supply uses a separate status
// palette below so the two fields do not compete.
export const medicationIcdChipClass =
  `inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-sm px-1.5 py-0 text-xs ${clinicalIcdToneClass}`

export const medicationIcdCodeClass =
  `shrink-0 font-mono font-medium ${clinicalIcdCodeToneClass}`

export const medicationIcdDescriptionClass =
  `min-w-0 truncate ${clinicalIcdDescriptionToneClass}`

const MEDICATION_DAYS_LEFT_BASE =
  "rounded-sm border px-1.5 py-0 tabular-nums shadow-none"
const MEDICATION_DAYS_LEFT_NUMERIC =
  "w-full min-w-0 max-w-none justify-center text-center"
const MEDICATION_DAYS_LEFT_LABEL =
  "justify-center"

export function getMedicationDaysLeftBadgeClass(daysRemaining: number) {
  if (daysRemaining < 0) {
    return `${MEDICATION_DAYS_LEFT_BASE} ${MEDICATION_DAYS_LEFT_LABEL} border-destructive/35 bg-destructive/10 text-destructive dark:bg-destructive/15`
  }
  if (daysRemaining === 0) {
    return `${MEDICATION_DAYS_LEFT_BASE} ${MEDICATION_DAYS_LEFT_LABEL} border-orange-400 bg-orange-100 text-orange-950 dark:border-orange-500/60 dark:bg-orange-500/20 dark:text-orange-100`
  }
  if (daysRemaining <= 3) {
    return `${MEDICATION_DAYS_LEFT_BASE} ${MEDICATION_DAYS_LEFT_NUMERIC} border-orange-400 bg-orange-100 text-orange-950 dark:border-orange-500/60 dark:bg-orange-500/20 dark:text-orange-100`
  }
  return `${MEDICATION_DAYS_LEFT_BASE} ${MEDICATION_DAYS_LEFT_NUMERIC} border-transparent bg-transparent text-muted-foreground`
}

// Chronic-prescription visual language is shared by the list badge and the
// timeline. A plain outline names the prescription type; colour stays
// reserved for supply that is running out.
export const medicationChronicBadgeClass =
  "border-border bg-transparent text-foreground/80"

export function getMedicationStatusBadgeClass(status: string) {
  return status.toLowerCase() === "active"
    ? "border-transparent bg-transparent text-foreground/70"
    : "border-transparent bg-transparent text-muted-foreground"
}

export const medicationChronicSwatchClass =
  "border-teal-700 bg-teal-200 dark:border-teal-400 dark:bg-teal-800/70"

export const medicationChronicTimelineBarClass =
  "fill-teal-200 stroke-teal-700 dark:fill-teal-800/70 dark:stroke-teal-400"

// A future segment retains its medication-type hue but lowers the visual
// weight and adds a dashed outline. This keeps prescription-type meaning intact
// while making "after today" readable without relying on colour alone.
export const medicationChronicFutureTimelineBarClass =
  "fill-teal-100 stroke-teal-500 dark:fill-teal-950/70 dark:stroke-teal-400/80"

export const medicationNonChronicSwatchClass =
  "border-slate-500 bg-slate-200 dark:border-muted-foreground dark:bg-muted"

export const medicationNonChronicTimelineBarClass =
  "fill-slate-200 stroke-slate-500 dark:fill-muted dark:stroke-muted-foreground"

export const medicationNonChronicFutureTimelineBarClass =
  "fill-slate-100 stroke-slate-400 dark:fill-slate-950/70 dark:stroke-slate-400/80"

// Missing prescription-type metadata is a provenance uncertainty, so it uses
// a restrained amber treatment already established for unconfirmed data. It
// must not reuse non-chronic slate or the brighter risk/error colours.
export const medicationUnrecordedSwatchClass =
  "border-amber-600 bg-amber-100 dark:border-amber-400 dark:bg-amber-900/50"

export const medicationUnrecordedTimelineBarClass =
  "fill-amber-100 stroke-amber-600 dark:fill-amber-900/50 dark:stroke-amber-400"

export const medicationUnrecordedFutureTimelineBarClass =
  "fill-amber-50 stroke-amber-500 dark:fill-amber-950/40 dark:stroke-amber-400/80"

export const medicationFutureTimelineSwatchClass =
  "border-dashed border-muted-foreground/70 bg-muted/25 dark:border-muted-foreground/80 dark:bg-muted/15"
