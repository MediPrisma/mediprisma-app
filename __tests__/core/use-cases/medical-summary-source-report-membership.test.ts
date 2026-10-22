import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'

it.each(['Observation/same', 'https://foreign.example/fhir/Observation/same', 'Observation/same/_history/2'])('does not recreate rejected source report membership from %s in the summary catalog', reference => {
  const observation = { id: 'same', code: { text: 'Synthetic glucose' }, valueQuantity: { value: 91, unit: 'mg/dL' }, referenceRange: [{ low: { value: 70 }, high: { value: 99 } }] }
  const report = { id: 'report', clinicalSourceNodeKey: 'captured-report', code: { text: 'Synthetic report' }, result: [{ reference }], _observations: [] }
  const catalog = buildSourceCatalog({ observations: [observation], diagnosticReports: [report] } as any)
  expect(catalog.find(row => row.resourceType === 'DiagnosticReport')).toBeDefined()
  expect(catalog.find(row => row.resourceType === 'DiagnosticReport')?.supportsNormalityAssessment).not.toBe(true)
  const outbound = buildSourceCatalog(stripClinicalCaptureMetadata({ observations: [observation], diagnosticReports: [report] }) as any)
  expect(outbound.find(row => row.resourceType === 'DiagnosticReport')?.supportsNormalityAssessment).not.toBe(true)
  const resolved = buildSourceCatalog({ observations: [observation], diagnosticReports: [{ ...report, _observations: [observation] }] } as any)
  expect(resolved.find(row => row.resourceType === 'DiagnosticReport')?.supportsNormalityAssessment).toBe(true)
})
