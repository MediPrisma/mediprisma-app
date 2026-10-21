import { webcrypto } from 'node:crypto'
import { cdssPatientIdentity } from '@/features/clinical-decision-support/telemetry/patient-identity'
import {
  getPatientDisplayName,
  type PatientEntity,
} from '@/src/core/entities/patient.entity'
import demoBundle from '../../../public/demo/demo-bundle.json'

function isPatientEntity(resource: unknown): resource is PatientEntity {
  if (!resource || typeof resource !== 'object') return false
  const candidate = resource as { resourceType?: unknown; id?: unknown }
  return candidate.resourceType === 'Patient' && typeof candidate.id === 'string'
}

describe('demo bundle patient identity', () => {
  it('provides both local-script and Romanized display names', () => {
    const patient = demoBundle.entry
      .map((entry: { resource: unknown }) => entry.resource)
      .find(isPatientEntity)

    expect(patient).toBeDefined()
    expect(getPatientDisplayName(patient ?? null, 'zh-TW')).toBe('陳大明')
    expect(getPatientDisplayName(patient ?? null, 'en')).toBe('Da-Ming Chen')
  })
})

// Exercise the actual shipped fixture against the save/history identity boundary.
it('provides a stable CDSS key while sending only masked Demo identifiers', async () => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  const patient = demoBundle.entry.map((entry: { resource: unknown }) => entry.resource).find(isPatientEntity)
  expect(patient).toBeDefined()
  const identity = await cdssPatientIdentity(patient!)
  expect(identity.patient_key_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(await cdssPatientIdentity(JSON.parse(JSON.stringify(patient)))).toEqual(identity)
  expect(identity.patient_identity).toEqual({
    name_masked: '陳○明',
    birth_year: '1932',
    identifier_masked: 'A123XXX789',
    identifier_system: 'https://twcore.mohw.gov.tw/IdentifierSystem/national-id',
  })
  expect(JSON.stringify(identity)).not.toContain('陳大明')
  expect(JSON.stringify(identity)).not.toContain('1932-01-15')
})

it('keeps embedded discharge-summary patient banners consistent with the Demo identity', () => {
  const resources = demoBundle.entry.map((entry) => entry.resource)
  const documents = resources.filter((resource) => resource.resourceType === 'DocumentReference')
  expect(documents.length).toBeGreaterThan(0)
  for (const document of documents) {
    for (const content of ('content' in document ? document.content : []) ?? []) {
      const attachment = content.attachment
      if (attachment.contentType !== 'text/html' || !attachment.data) continue
      const html = Buffer.from(attachment.data, 'base64').toString('utf8')
      expect(html).toContain('陳大明')
      expect(html).toContain('A123XXX789')
      expect(html).not.toContain('陳○明')
      expect(html).not.toContain('A123456789')
    }
  }
})


it('normalizes lowercase middle-three masking without changing the CDSS key', async () => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  const patient = demoBundle.entry.map((entry: { resource: unknown }) => entry.resource).find(isPatientEntity)
  expect(patient).toBeDefined()
  const lowercasePatient = JSON.parse(JSON.stringify(patient)) as PatientEntity
  lowercasePatient.identifier![0].value = 'A123xxx789'
  expect(await cdssPatientIdentity(lowercasePatient)).toEqual(await cdssPatientIdentity(patient!))
})


it.each(['F111xxx111', 'F111XXX111', 'F111***222', 'F111****22'])('accepts cloud-style masking: %s', async identifier => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  const patient = demoBundle.entry.map((entry: { resource: unknown }) => entry.resource).find(isPatientEntity)
  const maskedPatient = JSON.parse(JSON.stringify(patient)) as PatientEntity
  maskedPatient.identifier![0].value = identifier
  const identity = await cdssPatientIdentity(maskedPatient)
  expect(identity.patient_key_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(identity.patient_identity.identifier_masked).toBe(identifier.toUpperCase())
})
