import {
  FhirMapper,
  groupSpecialMaterialsByProcedure,
} from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import {
  MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM,
  MEDCLOUD_SPECIAL_MATERIAL_CODE,
  MEDCLOUD_SPECIAL_MATERIAL_EXTENSION_URL,
} from '@/src/shared/constants/medcloud.constants'
import type { Basic, FhirExtension } from '@/src/shared/types/fhir.types'

function materialBasic(id: string, fields: FhirExtension[]): Basic {
  return {
    resourceType: 'Basic',
    id,
    code: {
      coding: [{ system: MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM, code: MEDCLOUD_SPECIAL_MATERIAL_CODE }],
    },
    extension: [{ url: MEDCLOUD_SPECIAL_MATERIAL_EXTENSION_URL, extension: fields }],
  } as Basic
}

const linkedFields: FhirExtension[] = [
  { url: 'materialCode', valueString: 'FBTEST000001' },
  { url: 'nameZh', valueString: '示例雙極人工髖關節' },
  { url: 'nameEn', valueString: 'EXAMPLE BIPOLAR HIP' },
  { url: 'materialType', valueString: '骨科類' },
  { url: 'licenseNumber', valueString: '測試許可證A+測試許可證B' },
  { url: 'visitDate', valueDate: '2026-01-02' },
  { url: 'quantity', valueDecimal: 1 },
  { url: 'dataSource', valueString: '申報' },
  { url: 'relatedProcedure', valueReference: { reference: 'Procedure/proc-1' } },
  { url: 'relationshipStatus', valueCode: 'inferred' },
  { url: 'relationshipBasis', valueString: 'Same date and diagnosis.' },
]

describe('special-material records', () => {
  it('groups linked materials by the procedure they reference', () => {
    const grouped = groupSpecialMaterialsByProcedure([
      materialBasic('m-1', linkedFields),
      materialBasic('m-1', linkedFields),
      materialBasic('m-2', linkedFields.filter((f) => f.url !== 'relatedProcedure')),
      { resourceType: 'Basic', id: 'other', code: { coding: [{ system: MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM, code: 'medication-remaining-summary' }] } } as Basic,
    ])

    expect([...grouped.keys()]).toEqual(['proc-1'])
    expect(grouped.get('proc-1')).toEqual([{
      id: 'm-1',
      procedureReference: 'Procedure/proc-1',
      materialCode: 'FBTEST000001',
      nameZh: '示例雙極人工髖關節',
      nameEn: 'EXAMPLE BIPOLAR HIP',
      materialType: '骨科類',
      quantity: 1,
      visitDate: '2026-01-02',
      licenseNumbers: ['測試許可證A', '測試許可證B'],
      dataSource: '申報',
      relationshipStatus: 'inferred',
      relationshipBasis: 'Same date and diagnosis.',
    }])
  })

  it('attaches materials only to the procedure they point at', () => {
    const grouped = groupSpecialMaterialsByProcedure([materialBasic('m-1', linkedFields)])

    const linked = FhirMapper.toProcedure({ resourceType: 'Procedure', id: 'proc-1' } as any, grouped)
    const other = FhirMapper.toProcedure({ resourceType: 'Procedure', id: 'proc-2' } as any, grouped)
    const plain = FhirMapper.toProcedure({ resourceType: 'Procedure', id: 'proc-1' } as any)

    expect(linked.specialMaterials?.map((m) => m.id)).toEqual(['m-1'])
    expect(other).not.toHaveProperty('specialMaterials')
    expect(plain).not.toHaveProperty('specialMaterials')
  })
})
