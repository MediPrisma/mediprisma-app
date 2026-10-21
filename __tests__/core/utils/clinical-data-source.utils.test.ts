import { detectClinicalDataSource } from '@/src/core/utils/clinical-data-source.utils'

const medcloud = { meta: { source: 'https://medcloud2.nhi.gov.tw/', tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module' }] } }
const healthBank = { meta: { source: 'nhi-fhir-bridge/scraper' } }

describe('detectClinicalDataSource', () => {
  it('reads the bridge from each resource\'s own provenance', () => {
    expect(detectClinicalDataSource({ observations: [medcloud], medications: [{}] })).toBe('nhi-medcloud')
    expect(detectClinicalDataSource({ encounters: [healthBank] })).toBe('nhi-health-bank')
  })

  it('does not mistake the MediCloud bridge\'s vendored health-bank mapper for 健康存摺', () => {
    // The MediCloud bridge vendors the 健康存摺 mapper, so its resources can
    // also say nhi-fhir-bridge; the MediCloud marker decides.
    const vendored = { meta: { source: 'nhi-fhir-bridge/scraper', tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/source-program' }] } }
    expect(detectClinicalDataSource({ observations: [vendored, medcloud] })).toBe('nhi-medcloud')
  })

  it('matches the provenance host exactly, not anywhere in the string', () => {
    const sdk = { meta: { source: 'https://nhi-fhir-bridge.github.io/source/health-bank-sdk-json' } }
    expect(detectClinicalDataSource({ observations: [sdk] })).toBe('nhi-health-bank')
    expect(detectClinicalDataSource({ observations: [{ meta: { source: 'medcloud2.nhi.gov.tw/viewer' } }] })).toBe('nhi-medcloud')
    for (const source of [
      'https://medcloud2.nhi.gov.tw.example.com/',
      'https://example.com/?from=medcloud2.nhi.gov.tw',
      'https://example.com/nhi-fhir-bridge/scraper',
      'https://nhi-fhir-bridge.github.io.example.com/source',
    ]) {
      expect(detectClinicalDataSource({ observations: [{ meta: { source } }] })).toBe('other')
    }
    expect(detectClinicalDataSource({ observations: [{ meta: { tag: [{ system: 'https://example.com/cloud-wildcatch.invalid/fhir' }] } }] })).toBe('other')
  })

  it('treats a mixed or unmarked chart as other', () => {
    expect(detectClinicalDataSource({ observations: [medcloud], encounters: [healthBank] })).toBe('other')
    expect(detectClinicalDataSource({ observations: [{}] })).toBe('other')
    expect(detectClinicalDataSource(null)).toBe('other')
  })
})
