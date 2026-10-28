// The registry's rules only: every feature card is a stub, so the test does not
// load the cards' providers (Firebase, React Query).
jest.mock('@/features/clinical-summary/patient-info/PatientInfoCard', () => ({ PatientInfoCard: () => null }))
jest.mock('@/features/clinical-summary/vitals/VitalsCard', () => ({ VitalsCard: () => null }))
jest.mock('@/features/clinical-summary/medications/MedListCard', () => ({ MedListCard: () => null }))
jest.mock('@/features/clinical-summary/allergies/AllergiesCard', () => ({ AllergiesCard: () => null }))
jest.mock('@/features/clinical-summary/diagnosis/DiagnosisCard', () => ({ DiagnosesCard: () => null }))
jest.mock('@/features/clinical-summary/problem-list/ProblemListCard', () => ({ ProblemListCard: () => null }))
jest.mock('@/features/clinical-summary/advance-directives/AdvanceDirectivesCard', () => ({ AdvanceDirectivesCard: () => null }))
jest.mock('@/features/clinical-summary/devices/DevicesCard', () => ({ DevicesCard: () => null }))
jest.mock('@/features/clinical-summary/care-plans/CarePlansCard', () => ({ CarePlansCard: () => null }))
jest.mock('@/features/clinical-summary/document-summary', () => ({ DocumentSummaryCard: () => null }))
jest.mock('@/features/clinical-summary/reports/ReportsCard', () => ({ ReportsCard: () => null }))
jest.mock('@/features/clinical-summary/visit-history', () => ({ VisitHistoryCard: () => null }))
jest.mock('@/features/clinical-summary/overview', () => ({ OverviewCard: () => null }))
jest.mock('@/features/clinical-summary/last-outpatient', () => ({ LastOutpatientCard: () => null }))

import { getEnabledTabs, getFeaturesForTab } from '@/src/shared/config/feature-registry'

describe('feature registry: 上次門診 tab', () => {
  it('is not listed unless the chart holds a hospital outpatient visit', () => {
    expect(getEnabledTabs().map((tab) => tab.id)).not.toContain('last-outpatient')
    expect(getEnabledTabs({ hasHospitalOutpatientVisit: false }).map((tab) => tab.id)).not.toContain('last-outpatient')
  })

  it('is listed right after 總覽, with every other tab unchanged', () => {
    const without = getEnabledTabs().map((tab) => tab.id)
    const withVisit = getEnabledTabs({ hasHospitalOutpatientVisit: true }).map((tab) => tab.id)
    expect(withVisit).toEqual(['overview', 'last-outpatient', ...without.slice(1)])
    expect(without).toEqual(['overview', 'patient', 'visits', 'reports', 'meds', 'documents'])
  })

  it('renders the last-outpatient feature', () => {
    expect(getFeaturesForTab('last-outpatient').map((feature) => feature.id)).toEqual(['last-outpatient'])
  })
})
