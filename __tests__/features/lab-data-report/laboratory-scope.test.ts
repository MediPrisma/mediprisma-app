import { isLaboratoryObservation } from '@/features/lab-data-report/utils/laboratory-scope'
import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'

const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category'
const observation = (category: unknown, resourceType = 'Observation') => ({ resourceType, category })
const coding = (code: string, system: string | null = OBS_CATEGORY) =>
  ({ coding: [system === null ? { code } : { system, code }] })

describe('isLaboratoryObservation', () => {
  it.each([
    ['laboratory', [coding('laboratory')], true],
    ['legacy system', [coding('laboratory', 'http://hl7.org/fhir/observation-category')], true],
    ['single CodeableConcept', coding('laboratory'), true],
    ['laboratory + local code', [coding('laboratory'), coding('chemistry', 'urn:local')], true],
    ['survey', [coding('survey')], false],
    ['vital-signs', [coding('vital-signs')], false],
    ['laboratory + survey', [coding('laboratory'), coding('survey')], false],
    ['laboratory + exam from another system', [coding('laboratory'), coding('exam', 'urn:local')], false],
    ['no system', [coding('laboratory', null)], false],
    ['local code only', [coding('LAB', 'urn:local')], false],
    ['no category', undefined, false],
  ])('%s', (_label, category, expected) => {
    expect(isLaboratoryObservation(observation(category))).toBe(expected)
  })

  it('is false for anything that is not an Observation', () => {
    expect(isLaboratoryObservation(observation([coding('laboratory')], 'DiagnosticReport'))).toBe(false)
    expect(isLaboratoryObservation(null)).toBe(false)
  })

  it('accepts the app\'s mapped ObservationEntity, which has no resourceType', () => {
    const entity = FhirMapper.toObservation({
      resourceType: 'Observation',
      id: 'x',
      status: 'final',
      code: { text: 'WBC' },
      category: [coding('laboratory')],
    } as any)
    expect('resourceType' in entity).toBe(false)
    expect(isLaboratoryObservation(entity)).toBe(true)
    expect(isLaboratoryObservation({ ...entity, category: [coding('survey')] })).toBe(false)
  })
})
