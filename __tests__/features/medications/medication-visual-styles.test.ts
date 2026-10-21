import {
  medicationCategoryChipClass,
  medicationChronicBadgeClass,
  medicationChronicSwatchClass,
  medicationChronicFutureTimelineBarClass,
  medicationChronicTimelineBarClass,
  medicationFutureTimelineSwatchClass,
  medicationIcdChipClass,
  medicationIcdCodeClass,
  medicationIcdDescriptionClass,
  medicationNonChronicFutureTimelineBarClass,
  medicationNonChronicSwatchClass,
  medicationNonChronicTimelineBarClass,
  medicationUnrecordedFutureTimelineBarClass,
  medicationUnrecordedSwatchClass,
  medicationUnrecordedTimelineBarClass,
  getMedicationDaysLeftBadgeClass,
  getMedicationStatusBadgeClass,
} from '@/features/clinical-summary/medications/components/medication-chip-styles'
import {
  clinicalIcdCodeToneClass,
  clinicalIcdDescriptionToneClass,
  clinicalIcdToneClass,
  clinicalTooltipSurfaceClass,
} from '@/features/clinical-summary/components/clinical-metadata-styles'

describe('medication status visual language', () => {
  it('uses one clinical green family for chronic prescriptions across list and timeline', () => {
    const chronicStyles = [
      medicationChronicBadgeClass,
      medicationChronicSwatchClass,
      medicationChronicTimelineBarClass,
    ]

    chronicStyles.forEach((classes) => {
      expect(classes).toContain('teal-')
      expect(classes).not.toMatch(/sky|violet|purple|emerald/)
    })
  })

  it('keeps medication categories in a low-chroma secondary role', () => {
    expect(medicationCategoryChipClass).toContain('bg-secondary/65')
    expect(medicationCategoryChipClass).toContain('text-secondary-foreground/75')
    expect(medicationCategoryChipClass).toContain('dark:bg-secondary/55')
    expect(medicationCategoryChipClass).toContain('max-w-full')
    expect(medicationCategoryChipClass).not.toContain('max-w-[10rem]')
    expect(medicationCategoryChipClass).not.toMatch(/blue-|teal|emerald|amber/)
  })

  it('uses one neutral family for non-chronic medication timeline marks', () => {
    expect(medicationNonChronicSwatchClass).toContain('slate-')
    expect(medicationNonChronicTimelineBarClass).toContain('slate-')
  })

  it('uses restrained amber for unrecorded prescription-type marks', () => {
    expect(medicationUnrecordedSwatchClass).toContain('border-amber-600')
    expect(medicationUnrecordedSwatchClass).toContain('bg-amber-100')
    expect(medicationUnrecordedTimelineBarClass).toContain('fill-amber-100')
    expect(medicationUnrecordedTimelineBarClass).toContain('stroke-amber-600')
    expect(medicationUnrecordedFutureTimelineBarClass).toContain('fill-amber-50')
    expect(medicationUnrecordedFutureTimelineBarClass).toContain('stroke-amber-500')
    expect(medicationUnrecordedTimelineBarClass).not.toMatch(/red-|destructive/)
  })

  it('uses lighter type-aware colours plus a dashed key for after-today periods', () => {
    expect(medicationChronicFutureTimelineBarClass).toContain('fill-teal-100')
    expect(medicationChronicFutureTimelineBarClass).toContain('dark:fill-teal-950/70')
    expect(medicationNonChronicFutureTimelineBarClass).toContain('fill-slate-100')
    expect(medicationNonChronicFutureTimelineBarClass).toContain('dark:fill-slate-950/70')
    expect(medicationFutureTimelineSwatchClass).toContain('border-dashed')
  })

  it('stays neutral from day four onward and escalates only near depletion', () => {
    expect(getMedicationDaysLeftBadgeClass(20)).toContain('text-muted-foreground')
    expect(getMedicationDaysLeftBadgeClass(20)).not.toMatch(/sky-|orange-/)
    expect(getMedicationDaysLeftBadgeClass(20)).not.toContain('bg-muted/45')
    expect(getMedicationDaysLeftBadgeClass(20)).toContain('w-full')
    expect(getMedicationDaysLeftBadgeClass(20)).toContain('min-w-0')
    expect(getMedicationDaysLeftBadgeClass(20)).toContain('max-w-none')
    expect(getMedicationDaysLeftBadgeClass(8)).toContain('bg-transparent')
    expect(getMedicationDaysLeftBadgeClass(7)).toContain('w-full')
    expect(getMedicationDaysLeftBadgeClass(7)).toContain('bg-transparent')
    expect(getMedicationDaysLeftBadgeClass(4)).toContain('bg-transparent')
    expect(getMedicationDaysLeftBadgeClass(3)).toContain('w-full')
    expect(getMedicationDaysLeftBadgeClass(3)).toContain('bg-orange-100')
    expect(getMedicationDaysLeftBadgeClass(0)).toContain('justify-center')
    expect(getMedicationDaysLeftBadgeClass(0)).toContain('bg-orange-100')
    expect(getMedicationDaysLeftBadgeClass(-1)).toContain('text-destructive')
  })

  it('keeps routine active status neutral so it does not compete with chronic type', () => {
    expect(getMedicationStatusBadgeClass('active')).toContain('bg-transparent')
    expect(getMedicationStatusBadgeClass('active')).not.toMatch(/sky|violet|purple/)
    expect(getMedicationStatusBadgeClass('ended')).toContain('bg-transparent')
    expect(getMedicationStatusBadgeClass('ended')).toContain('text-muted-foreground')
    expect(getMedicationStatusBadgeClass('ended')).not.toMatch(/destructive|red-/)
  })

  it('restores the restrained diagnosis tone used by visit-history ICDs', () => {
    expect(medicationIcdChipClass).toContain(clinicalIcdToneClass)
    expect(medicationIcdCodeClass).toContain(clinicalIcdCodeToneClass)
    expect(medicationIcdDescriptionClass).toContain(clinicalIcdDescriptionToneClass)
    expect(medicationIcdChipClass).not.toMatch(/amber-/)
  })

  it('keeps clinical tooltip cards and their arrows on one themed surface', () => {
    expect(clinicalTooltipSurfaceClass).toContain('bg-popover')
    expect(clinicalTooltipSurfaceClass).toContain('text-popover-foreground')
    expect(clinicalTooltipSurfaceClass).toContain('[&_svg]:bg-popover!')
    expect(clinicalTooltipSurfaceClass).toContain('[&_svg]:fill-popover!')
    expect(clinicalTooltipSurfaceClass).not.toContain('bg-foreground')
  })
})
