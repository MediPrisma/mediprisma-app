import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { MEDCLOUD_DEMO_DATA_AS_OF_MS } from '@/src/shared/constants/demo-data.constants'
import bundle from '../../../public/demo/demo-medcloud-bundle.json'

// The 雲端病歷 demo patient, mapped as an import maps it: the DOAC dose
// calculator's patient questions fill from the record (owner 2026-10-28).
// Serum bilirubin is the one left blank: this patient has none.
type Resource = { resourceType: string; [key: string]: any }
const resources = (bundle as { entry: { resource: Resource }[] }).entry.map((e) => e.resource)
const of = (type: string) => resources.filter((r) => r.resourceType === type)

describe('DOAC calculator on the 雲端病歷 demo patient', () => {
  it('fills dialysis, liver, liver tests, pregnancy, GI risk and the regimen', () => {
    const observations = of('Observation').map((r) => FhirMapper.toObservation(r as any))
    const patient = of('Patient')[0]!
    const autofill = buildAutofill(
      observations as unknown as Parameters<typeof buildAutofill>[0],
      { age: 80, gender: patient.gender },
      of('DiagnosticReport').map((r) => FhirMapper.toDiagnosticReport(r as any, observations)),
      of('MedicationRequest').map((r) => FhirMapper.toMedication(r as any)),
      new Date(MEDCLOUD_DEMO_DATA_AS_OF_MS),
      [],
      of('Encounter').map((r) => FhirMapper.toEncounter(r)),
    )
    const calc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
    const value = (key: string) => resolveInput(calc.inputs.find((input) => input.key === key)!, autofill).value
    expect(Object.fromEntries(['dialysis', 'liver', 'liver_enzymes', 'bilirubin_high', 'pregnancy', 'gi_risk', 'regimen'].map((key) => [key, value(key)])))
      .toEqual({ dialysis: 'no', liver: 'none', liver_enzymes: 'no', bilirubin_high: '', pregnancy: 'no', gi_risk: 'no', regimen: 'none' })
  })
})
