import { render, renderHook } from '@testing-library/react'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { useMedicationTimeline } from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'
import { MedicationItem } from '@/features/clinical-summary/medications/components/MedicationItem'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-01T12:00:00+08:00') }))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW', t: { medications: {} } }) }))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/shared/components/TapTooltip', () => ({ TapTooltip: ({ children }: any) => <>{children}</> }))

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'

function pair(key: string, label: string, code: string, official: string, ingredient: string) {
  const base = { resourceType: 'MedicationRequest', subject: { reference: 'Patient/synthetic' },
    encounter: { reference: 'Encounter/one' }, authoredOn: '2026-09-17', intent: 'order',
    dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd', code: 'd' } } }
  return [
    { ...base, id: `hospital-${key}`, meta: { source: 'ehr-fhir-bridge/scraper' }, status: 'active',
      medicationCodeableConcept: { text: label, coding: [{ system: 'urn:oid:vgh.medication.product', code: label, display: label }] },
      dosageInstruction: [{ text: '1 TAB PO QD', doseAndRate: [{ doseQuantity: { value: 1, unit: 'TAB' } }] }] },
    { ...base, id: `cloud-${key}`, meta: { source: 'https://medcloud2.nhi.gov.tw/' }, status: 'unknown',
      medicationCodeableConcept: { text: official, coding: [{ system: NHI, code, display: official }] },
      supportingInformation: [{ reference: `MedicationKnowledge/knowledge-${key}` }] },
    { resourceType: 'MedicationKnowledge', id: `knowledge-${key}`,
      meta: { source: 'https://data.gov.tw/dataset/23715', tag: [{ system: 'https://nhi-fhir-bridge.github.io/CodeSystem/drug-terminology-snapshot', code: 'nhi-drug-terminology-20260728' }] },
      code: { coding: [{ system: NHI, code, display: official }] },
      ingredient: [{ itemCodeableConcept: { text: ingredient } }], doseForm: { text: '膜衣錠' } },
  ]
}

function collection() {
  return LocalBundleService.parse({ resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic Patient' }] } },
    { resource: { resourceType: 'Encounter', id: 'one', class: { code: 'AMB' }, status: 'finished', period: { start: '2026-09-17' } } },
    ...pair('lipitor', 'Lipitor FC * tab 20 mg', 'BC22890100', 'LIPITOR FILM-COATED TABLETS 20MG', 'ATORVASTATIN (CALCIUM) 20 MG'),
    // Different strength: stays two rows; the hospital brand keeps its own name.
    ...pair('crestor', 'Crestor FC * tab 10 mg', 'BC24129100', 'CRESTOR 20MG FILM-COATED TABLETS', 'ROSUVASTATIN CALCIUM 20 MG'),
  ].map(resource => ('resource' in resource ? resource : { resource }))})!.collection
}

it('names a hospital brand row of a candidate group by the paired cloud ingredient, keeping the brand for product mode', () => {
  const { result } = renderHook(() => useMedicationRows(collection().medications))
  const lipitor = result.current.find(row => row.id === 'hospital-lipitor')!
  expect(result.current.find(row => row.id === 'cloud-lipitor')).toBeUndefined()
  expect(lipitor).toMatchObject({ dataOrigin: 'hospital', title: 'ATORVASTATIN (CALCIUM) 20 MG', secondaryTitle: 'Lipitor FC * tab 20 mg' })
  expect(lipitor.sourceComparison?.status).toBe('candidate')

  const crestor = result.current.find(row => row.id === 'hospital-crestor')!
  expect(crestor.title).toBe('Crestor FC * tab 10 mg')
  expect(crestor.secondaryTitle).toBeUndefined()
  expect(result.current.find(row => row.id === 'cloud-crestor')?.title).toBe('ROSUVASTATIN CALCIUM 20 MG')

  const ingredient = render(<MedicationItem medication={lipitor} nameMode="ingredient" />)
  expect(ingredient.container).toHaveTextContent('ATORVASTATIN (CALCIUM) 20 MG')
  ingredient.unmount()
  const product = render(<MedicationItem medication={lipitor} nameMode="product" />)
  expect(product.container).toHaveTextContent('Lipitor FC * tab 20 mg')
  expect(product.container).not.toHaveTextContent('ATORVASTATIN')
})

it('uses the same ingredient name for the candidate group in the timeline', () => {
  const { result } = renderHook(() => useMedicationTimeline(collection().medications, 'medical', 'all', '其他', 'zh-TW'))
  const names = result.current.drugs.map(drug => [drug.drugName, drug.drugProductName])
  expect(names).toContainEqual(['ATORVASTATIN (CALCIUM) 20 MG', 'Lipitor FC * tab 20 mg'])
  expect(names).toContainEqual(['Crestor FC * tab 10 mg', undefined])
})
