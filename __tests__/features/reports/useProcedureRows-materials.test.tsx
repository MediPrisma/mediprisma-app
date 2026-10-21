import { renderHook } from '@testing-library/react'
import { useProcedureRows } from '@/features/clinical-summary/reports/hooks/useProcedureRows'
import type { ProcedureSpecialMaterialEntity } from '@/src/core/entities/clinical-data.entity'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW,
  }),
}))

const material = (id: string, procedureId: string): ProcedureSpecialMaterialEntity => ({
  id,
  procedureReference: `Procedure/${procedureId}`,
  nameZh: `示例醫材 ${id}`,
  licenseNumbers: [],
  relationshipStatus: 'inferred',
})

const nhiCode = (code: string, display: string) => ({
  coding: [{ system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/nhi-medical-order-code', code, display }],
  text: display,
})

const materialSections = (row: any) =>
  row.obs[0].component.filter((c: any) => c._isProcedureMaterials)

describe('useProcedureRows special materials', () => {
  it('keeps a grouped child procedure\'s materials under that child and counts them', () => {
    const procedures = [
      {
        id: 'lead',
        code: nhiCode('00001B', '示例主手術'),
        performedDateTime: '2026-01-02',
        specialMaterials: [material('m-lead', 'lead')],
      },
      {
        id: 'child',
        code: nhiCode('00002B', '示例次手術'),
        performedDateTime: '2026-01-02',
        partOf: [{ reference: 'Procedure/lead' }],
        specialMaterials: [material('m-child-1', 'child'), material('m-child-2', 'child')],
      },
    ]

    const { result } = renderHook(() => useProcedureRows(procedures))

    expect(result.current).toHaveLength(1)
    const [row] = result.current as any[]
    expect(row.specialMaterialCount).toBe(3)

    const components = row.obs[0].component
    const sections = materialSections(row)
    expect(sections.map((s: any) => s._materials.map((m: any) => m.id))).toEqual([
      ['m-lead'],
      ['m-child-1', 'm-child-2'],
    ])
    expect(sections[0]._materialsProcedureTitle).toBeUndefined()
    expect(sections[1]._materialsProcedureTitle).toBe('示例次手術')

    // The child's materials sit directly after the child's own entry.
    const childIndex = components.findIndex((c: any) => c._isProcedureChild)
    expect(components[childIndex + 1]).toBe(sections[1])
  })

  it('leaves rows without materials untouched', () => {
    const { result } = renderHook(() => useProcedureRows([
      { id: 'plain', code: nhiCode('00003B', '示例手術'), performedDateTime: '2026-01-03' },
    ]))

    const [row] = result.current as any[]
    expect(row.specialMaterialCount).toBe(0)
    expect(materialSections(row)).toEqual([])
  })
})
