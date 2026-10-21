import { fireEvent, render, screen } from '@testing-library/react'
import { ObservationBlock } from '@/features/clinical-summary/reports/components/ObservationBlock'
import type { Observation } from '@/features/clinical-summary/reports/types'
import type { ProcedureSpecialMaterialEntity } from '@/src/core/entities/clinical-data.entity'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))

const material: ProcedureSpecialMaterialEntity = {
  id: 'm-1',
  procedureReference: 'Procedure/proc-1',
  materialCode: 'FBTEST000001',
  nameZh: '示例雙極人工髖關節',
  nameEn: 'EXAMPLE BIPOLAR HIP',
  materialType: '骨科類',
  quantity: 1,
  licenseNumbers: ['測試許可證A', '測試許可證B'],
  relationshipStatus: 'inferred',
  relationshipBasis: 'Same date and diagnosis.',
}

function renderBlock(materials: ProcedureSpecialMaterialEntity[]) {
  const observation = {
    resourceType: 'Observation',
    id: 'procedure-main',
    code: { text: '主手術' },
    component: [
      { code: { text: '健保醫令碼' }, valueString: '00000B · 示例手術' },
      { code: { text: '使用醫材' }, valueString: '', _isProcedureMaterials: true, _materials: materials },
    ],
    _detailsOnly: true,
  } as unknown as Observation
  return render(<ObservationBlock observation={observation} />)
}

describe('ProcedureMaterialsSection', () => {
  it('lists the material under the surgery with its code, type and quantity', () => {
    renderBlock([material])

    const section = screen.getByTestId('procedure-materials')
    expect(section).toHaveTextContent('使用醫材')
    expect(section).toHaveTextContent('1 項 · 特材申報')
    expect(screen.getByText('示例雙極人工髖關節')).toBeInTheDocument()
    expect(screen.getByText('EXAMPLE BIPOLAR HIP')).toBeInTheDocument()
    expect(screen.getByText('FBTEST000001')).toBeInTheDocument()
    expect(section).toHaveTextContent('骨科類')
    expect(section).toHaveTextContent('數量 1')
    expect(section).toHaveTextContent('許可證 2 張')
  })

  it('labels an inferred link and explains its basis on request', () => {
    renderBlock([material])

    expect(screen.getByText('推定關聯')).toBeInTheDocument()
    fireEvent.click(screen.getByText('為何連到此手術？'))
    expect(screen.getByText(zhTW.procedures.materials.inferredExplanation)).toBeVisible()
    expect(screen.getByText('來源說明：Same date and diagnosis.')).toBeInTheDocument()
    expect(screen.getByText('測試許可證B')).toBeInTheDocument()
  })

  it('does not call a source-confirmed link inferred', () => {
    renderBlock([{ ...material, relationshipStatus: 'confirmed', licenseNumbers: [] }])

    expect(screen.queryByText('推定關聯')).not.toBeInTheDocument()
    expect(screen.queryByText('為何連到此手術？')).not.toBeInTheDocument()
  })
})
