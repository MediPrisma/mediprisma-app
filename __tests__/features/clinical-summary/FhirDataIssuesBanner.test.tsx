import { render, screen } from '@testing-library/react'
import { FhirDataIssuesBanner } from '@/features/clinical-summary/components/FhirDataIssuesBanner'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useLanguage } from '@/src/application/providers/language.provider'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook')
jest.mock('@/src/application/providers/language.provider')

describe('FhirDataIssuesBanner', () => {
  it('does not create a manual reconciliation banner for unavailable content', () => {
    jest.mocked(useLanguage).mockReturnValue({ locale: 'zh-TW' } as any)
    jest.mocked(useClinicalData).mockReturnValue({
      queryIssues: [['MedicationRequest', { resourceType: 'MedicationRequest', state: 'incomplete', medicationContentUncertaintyCount: 1 }]],
      hasBlockingQueryIssues: true, isLoading: false, refetch: jest.fn(),
    } as any)
    render(<FhirDataIssuesBanner />)
    expect(screen.queryByText('部分病歷內容待核對')).not.toBeInTheDocument()
    expect(screen.queryByText('重新查詢')).not.toBeInTheDocument()
    expect(screen.queryByText('查詢失敗')).not.toBeInTheDocument()
  })

  it('shows that a failed clinical query makes the chart incomplete', () => {
    jest.mocked(useLanguage).mockReturnValue({ locale: 'zh-TW' } as any)
    jest.mocked(useClinicalData).mockReturnValue({
      queryIssues: [[
        'AllergyIntolerance',
        {
          resourceType: 'AllergyIntolerance',
          state: 'forbidden',
          httpStatus: 403,
          message: 'Missing patient/AllergyIntolerance.rs scope',
        },
      ]],
      hasBlockingQueryIssues: true,
      isLoading: false,
      refetch: jest.fn(),
    } as any)

    render(<FhirDataIssuesBanner />)

    expect(screen.getByText('部分病歷資料未載入，畫面可能不完整')).toBeInTheDocument()
    expect(screen.getByText('AllergyIntolerance')).toBeInTheDocument()
    expect(screen.getByText('沒有讀取權限（403）')).toBeInTheDocument()
  })
})
