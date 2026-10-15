import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { en } from '@/src/shared/i18n/locales/en'

// 民眾 audience reads the summary as `{ ...medicalSummary, ...medicalSummary.patient }`:
// every problem-list string a patient can see must have a plain override, with
// no 慢箋 jargon and 待確認 rather than the clinician's 待核對.
const PROBLEM_KEYS = [
  'problemColumns', 'problemBasisLabel', 'problemMetricNeedsReview', 'problemManagedByInferred',
  'problemInferredFromMedication', 'problemSingleUnassessedLab', 'problemShortSpanChronic',
  'problemMedicationAlsoFor', 'problemMedicationReview', 'problemManagedByOrganizationLatest',
  'problemsTitle', 'problemsSubtitle', 'problemsLegend', 'verifyFlag',
] as const

test.each([['zh-TW', zhTW], ['en', en]] as const)('%s patient problem list wording', (_locale, locale) => {
  const patient = (locale as any).medicalSummary.patient
  for (const key of PROBLEM_KEYS) expect(patient).toHaveProperty(key)
  const text = JSON.stringify(PROBLEM_KEYS.map((key) => patient[key]))
  expect(text).not.toMatch(/慢箋|待核對|需核對|refill|to verify|check source/)
})
