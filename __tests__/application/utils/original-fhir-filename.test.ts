/** @jest-environment node */
import { originalFhirFilename } from '@/src/application/utils/original-fhir-filename'
import type { PatientEntity } from '@/src/core/entities/patient.entity'

const date = new Date(2026, 9, 21)
const patient: PatientEntity = { resourceType: 'Patient', id: 'patient-123', name: [{ text: '王小明' }] }

it('prefers a national ID over an earlier chart number', () => {
  expect(originalFhirFilename({ ...patient, identifier: [
    { type: { coding: [{ code: 'MR' }] }, value: 'MR-456' },
    { system: 'https://example.test/IdentifierSystem/national-id', value: 'A123456789' },
  ] }, date)).toBe('FHIR_original_王小明_A123456789_20261021.json')
})

it('keeps masked identifiers recognizable and removes unsafe filename characters', () => {
  expect(originalFhirFilename({ ...patient, name: [{ text: '王/小:明' }], identifier: [
    { type: { coding: [{ code: 'NI' }] }, value: 'A12345****' },
  ] }, date)).toBe('FHIR_original_王_小_明_A12345XXXX_20261021.json')
})

it('uses a chart number, then the source Patient ID when no national ID exists', () => {
  expect(originalFhirFilename({ ...patient, identifier: [{ type: { coding: [{ code: 'MR' }] }, value: 'MR-456' }] }, date))
    .toBe('FHIR_original_王小明_MR-456_20261021.json')
  expect(originalFhirFilename(patient, date)).toBe('FHIR_original_王小明_patient-123_20261021.json')
})

it('retains a generic download when patient metadata is missing or malformed', () => {
  expect(originalFhirFilename(null, date)).toBe('FHIR_original_20261021.json')
  expect(originalFhirFilename({ ...patient, name: 'invalid' } as unknown as PatientEntity, date))
    .toBe('FHIR_original_20261021.json')
})

it('bounds long Unicode filenames while keeping the date and .json extension', () => {
  const filename = originalFhirFilename({ ...patient, name: [{ text: '病'.repeat(500) }] }, date)
  expect(Buffer.byteLength(filename, 'utf8')).toBeLessThan(255)
  expect(filename).toMatch(/_20261021\.json$/)
  expect(filename).not.toContain('\uFFFD')
})
