import { renderHook } from '@testing-library/react'
import { useProcedureRows } from '@/features/clinical-summary/reports/hooks/useProcedureRows'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW,
  }),
}))

const zhTW = jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW

// MediCloud (雲端病歷) rewrites the NHI 醫令 coding to TW Core's
// `…/medical-service-payment-tw`; the row must still read as an NHI order.
describe('useProcedureRows with MediCloud NHI order coding', () => {
  it('labels the source as an NHI order and shows the order code', () => {
    const procedures = [{
      id: 'p1',
      code: {
        coding: [{
          system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw',
          code: '47041C',
          display: '示例處置',
        }],
        text: '示例處置',
      },
      performedDateTime: '2026-03-04',
    }]

    const { result } = renderHook(() => useProcedureRows(procedures))
    const [row] = result.current as any[]
    const components = row.obs[0].component
    expect(JSON.stringify(row)).toContain(zhTW.procedures.sourceNhiOrder)
    expect(components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: { text: zhTW.procedures.orderCode },
        valueString: '47041C · 示例處置',
      }),
    ]))
  })
})
