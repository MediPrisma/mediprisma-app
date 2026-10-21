import { render, screen } from '@testing-library/react'
import LiveEducation from '@/features/personalized-education/LiveFeature'
import { getEnabledRightPanelFeatures } from '@/src/shared/config/right-panel-registry'

// Mock only loaded patient data and providers; render the selected LiveFeature
// with the real education registry, engine, private content and presentation.
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: { id: 'education-patient', resourceType: 'Patient', age: 56 }, loading: false, error: null }),
}))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({
    conditions: [{ id: 'diabetes', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' }] } }],
    encounters: [], observations: [], medications: [], isLoading: false, error: null, hasBlockingQueryIssues: false,
  }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'patient' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: { errors: { retry: '重試' } } }),
}))

const missingEducation = process.env.TEST_OPTIONAL_EDUCATION === 'missing'

test.each(['/', '/app/', '/app-hmc/'])('patient + Beta education on %s matches installed content', route => {
  window.history.replaceState({}, '', route)
  const features = (audience: 'patient' | 'medical', beta: boolean) => getEnabledRightPanelFeatures(audience, { betaFeaturesEnabled: beta }).map(feature => feature.id)
  expect(features('patient', true)).toContain('personalized-education')
  expect(features('medical', true)).not.toContain('personalized-education')
  expect(features('patient', false)).not.toContain('personalized-education')
  render(<LiveEducation />)
  if (missingEducation) {
    expect(screen.getByText('此部署尚未安裝個人化衛教內容。')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '這次的糖尿病照護摘要' })).not.toBeInTheDocument()
  } else {
    expect(screen.getByRole('heading', { name: '這次的糖尿病照護摘要' })).toBeVisible()
    expect(screen.queryByText('此部署尚未安裝個人化衛教內容。')).not.toBeInTheDocument()
  }
})
