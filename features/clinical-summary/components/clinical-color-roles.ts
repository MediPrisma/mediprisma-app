/**
 * Shared colour roles for dense clinical lists.
 *
 * These roles keep visit and report metadata in the same visual language:
 * category = emerald, inpatient = blue, source = blue, attention = coral.
 * Dark mode deliberately collapses non-semantic category colour into the
 * neutral secondary surface while retaining the inpatient distinction.
 */
export const CLINICAL_CATEGORY_TONE =
  'bg-transparent text-muted-foreground dark:border-transparent'

export const CLINICAL_INPATIENT_TONE =
  'bg-foreground/[0.07] text-foreground'

export const CLINICAL_SOURCE_TONE = 'text-muted-foreground'

export const CLINICAL_ABNORMAL_TONE =
  'bg-red-50 text-red-700 dark:bg-clinical-abnormal/10 dark:text-clinical-abnormal dark:ring-1 dark:ring-inset dark:ring-clinical-abnormal/25'

export const CLINICAL_LIST_ROW_TONE = 'rounded-none border-transparent border-b-border/70 bg-transparent'

export const CLINICAL_LIST_ROW_HOVER_TONE = 'hover:bg-muted'

export const CLINICAL_COUNT_TONE = 'text-muted-foreground'
