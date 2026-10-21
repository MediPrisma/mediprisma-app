import {
  CLINICAL_ABNORMAL_TONE,
  CLINICAL_CATEGORY_TONE,
  CLINICAL_SOURCE_TONE,
} from '@/features/clinical-summary/components/clinical-color-roles'

/**
 * Shared colour roles for the report workspace.
 *
 * Dark mode deliberately uses a small palette in dense lists:
 * - primary blue: interaction, selection, and source links
 * - neutral secondary: report classification
 * - clinical coral: findings that require attention
 *
 * Keeping these roles here prevents each report component from introducing a
 * slightly different emerald, blue, or rose treatment.
 */
export const REPORT_ACTIVE_CONTROL_TONE = 'bg-foreground/[0.07] text-foreground'

export const REPORT_CATEGORY_TONE = CLINICAL_CATEGORY_TONE

export const REPORT_SOURCE_TONE = CLINICAL_SOURCE_TONE

export const REPORT_ABNORMAL_TONE = CLINICAL_ABNORMAL_TONE
