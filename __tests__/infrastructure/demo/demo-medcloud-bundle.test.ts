import { getPatientDisplayName, type PatientEntity } from '@/src/core/entities/patient.entity'
import {
  clinicalNowMs,
  DEMO_DATA_AS_OF_MS,
  MEDCLOUD_DEMO_DATA_AS_OF_MS,
  MEDCLOUD_DEMO_PATIENT_ID,
} from '@/src/shared/constants/demo-data.constants'
import medcloudBundle from '../../../public/demo/demo-medcloud-bundle.json'
import healthBankBundle from '../../../public/demo/demo-bundle.json'

type Resource = { resourceType: string; id: string; [key: string]: unknown }
const resources = (medcloudBundle as { entry: { resource: Resource }[] }).entry.map((e) => e.resource)
const patientOf = (bundle: { entry: { resource: unknown }[] }) =>
  bundle.entry.map((e) => e.resource as Resource).find((r) => r.resourceType === 'Patient') as unknown as PatientEntity

describe('雲端病歷 demo bundle', () => {
  it('is the same de-identified patient as the 健康存摺 demo', () => {
    const patient = patientOf(medcloudBundle)
    const healthBank = patientOf(healthBankBundle)
    expect(patient.id).toBe(MEDCLOUD_DEMO_PATIENT_ID)
    expect(getPatientDisplayName(patient, 'zh-TW')).toBe(getPatientDisplayName(healthBank, 'zh-TW'))
    expect(getPatientDisplayName(patient, 'en')).toBe(getPatientDisplayName(healthBank, 'en'))
    expect(patient.birthDate).toBe(healthBank.birthDate)
    expect(patient.gender).toBe(healthBank.gender)
  })

  it('carries only fake institutions and provider codes', () => {
    const organizations = resources.filter((r) => r.resourceType === 'Organization')
    expect(organizations.length).toBeGreaterThan(0)
    for (const org of organizations) {
      expect(String(org.name)).toMatch(/^示範/)
      for (const id of (org.identifier as { value: string }[] | undefined) ?? []) {
        expect(id.value).toMatch(/^0+\d{1,2}$/)
      }
    }
  })

  it('drops the NHI image-viewer request, which would ask NHI for a real patient', () => {
    expect(JSON.stringify(medcloudBundle)).not.toContain('medcloud-nhi-viewer-request')
  })

  it('keeps every internal reference resolvable after the ids were replaced', () => {
    const ids = new Set(resources.map((r) => `${r.resourceType}/${r.id}`))
    const unresolved: string[] = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === 'reference' && typeof value === 'string' && /^[A-Z][A-Za-z]+\/[^/]+$/.test(value) && !ids.has(value)) {
          unresolved.push(value)
        } else walk(value)
      }
    }
    resources.forEach(walk)
    expect(unresolved).toEqual([])
  })

  it('is judged against its own as-of date, not the 健康存摺 one', () => {
    expect(clinicalNowMs(true, MEDCLOUD_DEMO_PATIENT_ID)).toBe(MEDCLOUD_DEMO_DATA_AS_OF_MS)
    expect(clinicalNowMs(true, 'demo-patient-1')).toBe(DEMO_DATA_AS_OF_MS)
    const newest = resources
      .flatMap((r) => [r.authoredOn, r.effectiveDateTime, r.occurrenceDateTime])
      .filter((d): d is string => typeof d === 'string')
      .sort()
      .at(-1)!
    expect(Date.parse(`${newest.slice(0, 10)}T00:00:00+08:00`)).toBeLessThanOrEqual(MEDCLOUD_DEMO_DATA_AS_OF_MS)
  })
})
