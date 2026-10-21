import {
  REPORT_ABNORMAL_TONE,
  REPORT_ACTIVE_CONTROL_TONE,
  REPORT_CATEGORY_TONE,
  REPORT_SOURCE_TONE,
} from '@/features/clinical-summary/reports/components/report-color-roles'

describe('report dark-mode colour roles', () => {
  it('marks selection and source with ink, not colour', () => {
    expect(REPORT_ACTIVE_CONTROL_TONE).toContain('text-foreground')
    expect(REPORT_ACTIVE_CONTROL_TONE).not.toContain('text-primary')
    expect(REPORT_SOURCE_TONE).toContain('text-muted-foreground')
  })

  it('keeps classification neutral and reserves coral for abnormal findings', () => {
    expect(REPORT_CATEGORY_TONE).toContain('text-muted-foreground')
    expect(REPORT_CATEGORY_TONE).not.toMatch(/bg-(?:emerald|green|blue|teal)/)
    expect(REPORT_ABNORMAL_TONE).toContain('dark:text-clinical-abnormal')
    expect(REPORT_ABNORMAL_TONE).toContain('dark:bg-clinical-abnormal')
  })

  it('does not reintroduce competing emerald, blue, or rose dark variants', () => {
    const darkRoles = [
      REPORT_ACTIVE_CONTROL_TONE,
      REPORT_CATEGORY_TONE,
      REPORT_SOURCE_TONE,
      REPORT_ABNORMAL_TONE,
    ].join(' ')

    expect(darkRoles).not.toMatch(/dark:(?:bg|text|ring)-(?:emerald|blue|rose)/)
  })
})
