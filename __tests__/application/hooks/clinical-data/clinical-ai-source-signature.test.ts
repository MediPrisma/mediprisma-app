import { clinicalAiSourceSignature } from '@/src/application/hooks/ai-generation/use-clinical-ai-input.hook'
import { stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'

it('ignores capture-only node keys but changes for clinical values, patient and selection scope', () => {
  const patient = { id: 'synthetic-patient' }
  const scope = { selectedHospital: 'one' }
  const input: any = { observations: [{ id: 'result', clinicalSourceNodeKey: 'capture-one', valueQuantity: { value: 7 } }], diagnosticReports: [{ id: 'r', clinicalSourceNodeKey: 'report-one', _observations: [{ id: 'result', clinicalSourceNodeKey: 'capture-one', valueQuantity: { value: 7 } }] }] }
  const next = JSON.parse(JSON.stringify(input))
  next.observations[0].clinicalSourceNodeKey = 'capture-two'
  next.diagnosticReports[0].clinicalSourceNodeKey = 'report-two'
  next.diagnosticReports[0]._observations[0].clinicalSourceNodeKey = 'capture-two'
  const signature = clinicalAiSourceSignature(patient, scope, input, [])
  expect(clinicalAiSourceSignature(patient, scope, next, [])).toBe(signature)
  expect(clinicalAiSourceSignature({ id: 'other-patient' }, scope, input, [])).not.toBe(signature)
  expect(clinicalAiSourceSignature(patient, { selectedHospital: 'two' }, input, [])).not.toBe(signature)
  next.observations[0].valueQuantity.value = 8
  expect(clinicalAiSourceSignature(patient, scope, next, [])).not.toBe(signature)
  expect(JSON.stringify(stripClinicalCaptureMetadata(input))).not.toContain('clinicalSourceNodeKey')
  expect(input.observations[0].clinicalSourceNodeKey).toBe('capture-one')
})
