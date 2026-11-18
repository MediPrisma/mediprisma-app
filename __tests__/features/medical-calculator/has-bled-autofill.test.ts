// Owner rule 2026-11-19: prefill everything; the record's reading wins, else 「無」.
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { ConditionEntity, MedicationEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-11-19')
const field = (calcId: string, key: string) => CALCULATORS.find((c) => c.id === calcId)!.inputs.find((i) => i.key === key)!
const obs = (loinc: string, value: number, unit: string, date = '2026-11-01') =>
  ({ id: `o-${loinc}-${value}`, status: 'final', effectiveDateTime: date, code: { coding: [{ system: 'http://loinc.org', code: loinc }] }, valueQuantity: { value, unit } })
const autofill = (observations: object[] = [], conditions: ConditionEntity[] = [], medications: MedicationEntity[] = []) =>
  buildAutofill(observations as never, { age: 75, gender: 'male' }, [], medications, now, conditions, [])
const hasBled = (key: string, data: ReturnType<typeof autofill>) => resolveInput(field('has-bled', key), data)

it('answers H from the latest systolic pressure', () => {
  expect(hasBled('htn', autofill([obs('8480-6', 172, 'mm[Hg]')]))).toMatchObject({ value: 'yes', source: { testName: '最近收縮壓 172 mmHg（請核對未控制高血壓）' } })
  expect(hasBled('htn', autofill([obs('8480-6', 138, 'mm[Hg]')])).value).toBe('no')
  expect(hasBled('htn', autofill()).value).toBe('no')
})

it('converts a kPa systolic pressure before comparing it with 160 mmHg', () => {
  expect(hasBled('htn', autofill([obs('8480-6', 23, 'kPa')]))).toMatchObject({ value: 'yes', source: { testName: '最近收縮壓 173 mmHg（請核對未控制高血壓）' } })
})

it('answers A from creatinine >2.26 mg/dL, in either unit', () => {
  expect(hasBled('renal', autofill([obs('2160-0', 2.5, 'mg/dL')])).value).toBe('yes')
  expect(hasBled('renal', autofill([obs('2160-0', 150, 'umol/L')])).value).toBe('no')
  expect(hasBled('renal', autofill()).value).toBe('no')
})

it('answers A 是 for a kidney transplant', () => {
  const transplant = { id: 'tx', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'Z94.0' }] }, recordedDate: '2025-01-01' } as ConditionEntity
  expect(hasBled('renal', autofill([obs('2160-0', 1.1, 'mg/dL')], [transplant])).value).toBe('yes')
})

it('answers D from a current antiplatelet or NSAID prescription', () => {
  const med = (name: string) => ({ id: name, status: 'active', authoredOn: '2026-11-01', medicationCodeableConcept: { text: name }, drugTerminology: { ingredientText: name } }) as unknown as MedicationEntity
  expect(hasBled('drugs', autofill([], [], [med('Clopidogrel 75 mg')])).value).toBe('yes')
  expect(hasBled('drugs', autofill([], [], [med('Amlodipine 5 mg')])).value).toBe('no')
  expect(hasBled('drugs', autofill()).value).toBe('no')
})

it('does not count diclofenac eye drops as an NSAID', () => {
  const med = (name: string, atc?: string) => ({ id: name, status: 'active', authoredOn: '2026-11-01', medicationCodeableConcept: { text: name }, drugTerminology: { ingredientText: name }, ...(atc ? { atcClassification: { atcCode: atc } } : {}) }) as unknown as MedicationEntity
  expect(hasBled('drugs', autofill([], [], [med('Diclofenac sodium 1 mg/mL 點眼液劑', 'S01BC03')])).value).toBe('no')
  expect(hasBled('drugs', autofill([], [], [med('Diclofenac 25 mg tablet', 'M01AB05')])).value).toBe('yes')
})

it('answers MELD dialysis from the record, else 否', () => {
  expect(resolveInput(field('meld-na', 'dialysis'), autofill([obs('33914-3', 60, 'mL/min/{1.73_m2}')])).value).toBe('no')
  const dialysis = { id: 'hd', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'Z99.2' }] }, recordedDate: '2026-10-01' } as ConditionEntity
  expect(resolveInput(field('meld-3', 'dialysis'), autofill([], [dialysis]))).toMatchObject({ value: 'yes', filled: true })
})
