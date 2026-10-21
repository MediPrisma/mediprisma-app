import { buildPatient } from '@/features/ips-export/utils/ips-fhir-mappers'
import { webcrypto } from 'node:crypto'
import { applyUserEnteredPatientProfile } from '@/src/core/entities/patient.entity'
import { PatientMapper } from '@/src/infrastructure/fhir/mappers/patient.mapper'
import { cdssPatientIdentity } from '@/features/clinical-decision-support/telemetry/patient-identity'

const source = {
  id: 'synthetic', resourceType: 'Patient',
  name: [{ use: 'official', text: '陳大明' }], birthDate: '1970-01-15',
  identifier: [{ system: 'https://synthetic.invalid/national-id', value: 'A123***789' }],
}
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
})

test('anonymous source names reject CDSS even if identifying text/date are complete', async () => {
  const patient = PatientMapper.toDomain({ ...source, name: [{ use: 'anonymous', text: '陳大明' }] })!
  expect(patient.deidentified).toBe(true)
  await expect(cdssPatientIdentity(patient)).rejects.toThrow('cdss_patient_deidentified')
})

test('supplementing demographics cannot clear source de-identification', async () => {
  const patient = PatientMapper.toDomain({ ...source, name: [{ use: 'anonymous', text: '陳○明' }], birthDate: '1970' })!
  const supplemented = applyUserEnteredPatientProfile(patient, {
    source: 'user-entered', name: '陳大明', birthDate: '1970-01-15', updatedAt: '2026-10-05T00:00:00Z',
  })
  expect(supplemented.name?.[0].use).toBe('usual')
  expect(supplemented.deidentified).toBe(true)
  await expect(cdssPatientIdentity(supplemented)).rejects.toThrow('cdss_patient_deidentified')
  expect(patient.name?.[0].use).toBe('anonymous')
})

test.each(['A123xxx789', 'A123***789', 'A123****89', 'A123XXXXXX'])('unselected de-identification retains native masked IDs: %s', async value => {
  const patient = PatientMapper.toDomain({ ...source, identifier: [{ ...source.identifier[0], value }] })!
  expect(patient.deidentified).not.toBe(true)
  const identity = await cdssPatientIdentity(patient)
  expect(identity.patient_key_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(identity.patient_identity.identifier_masked).toBe(value.toUpperCase())
})


test('IPS export and reimport cannot erase de-identification after demographic supplementation', async () => {
  const patient = PatientMapper.toDomain({ ...source, name: [{ use: 'anonymous', text: '陳○明' }], birthDate: '1970' })!
  const supplemented = applyUserEnteredPatientProfile(patient, {
    source: 'user-entered', name: '陳大明', birthDate: '1970-01-15', updatedAt: '2026-10-05T00:00:00Z',
  })
  const exported = buildPatient(supplemented, { includeIdentifiers: true }).entry.resource
  const reimported = PatientMapper.toDomain(exported)!
  expect(reimported.deidentified).toBe(true)
  expect(reimported.name?.[0]).toMatchObject({ use: 'anonymous', text: '陳大明' })
  await expect(cdssPatientIdentity(reimported)).rejects.toThrow('cdss_patient_deidentified')
})

test('IPS roundtrip of a non-de-identified patient retains accepted CDSS identity', async () => {
  const patient = PatientMapper.toDomain(source)!
  const reimported = PatientMapper.toDomain(buildPatient(patient, { includeIdentifiers: true }).entry.resource)!
  expect(reimported.deidentified).not.toBe(true)
  expect(await cdssPatientIdentity(reimported)).toEqual(await cdssPatientIdentity(patient))
})
