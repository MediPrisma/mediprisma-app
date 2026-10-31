import { isTrustedSmartIssuer } from '@/src/shared/config/smart-issuer-policy'

describe('SMART issuer policy', () => {
  it('accepts only explicitly configured hospital origins without cloud defaults', () => {
    const options = {
      configuredIssuers: 'https://fhir.hospital.example, https://ehr.hospital.example',
      defaultTrustedOrigins: [],
    }
    expect(isTrustedSmartIssuer('https://fhir.hospital.example/r4', options)).toBe(true)
    expect(isTrustedSmartIssuer('https://launch.smarthealthit.org/v/r4/fhir', options)).toBe(false)
  })

  it('supports an explicitly configured localhost origin across dev ports', () => {
    expect(isTrustedSmartIssuer('http://localhost:5001/fhir', {
      configuredIssuers: 'http://localhost',
      defaultTrustedOrigins: [],
    })).toBe(true)
  })

  it('trusts the MediPrisma School training server by default, and not look-alikes', () => {
    const options = { configuredIssuers: '' }
    expect(isTrustedSmartIssuer('https://school.mediprisma.tw/fhir/RD-0123ABCD', options)).toBe(true)
    expect(isTrustedSmartIssuer('http://school.mediprisma.tw/fhir/RD-0123ABCD', options)).toBe(false)
    expect(isTrustedSmartIssuer('https://school.mediprisma.tw.evil.example/fhir/RD-0123ABCD', options)).toBe(false)
    expect(isTrustedSmartIssuer('https://fhir.mediprisma.tw/cdss/', options)).toBe(false)
  })

  it('does not widen trust for malformed configuration or issuer values', () => {
    expect(isTrustedSmartIssuer('not-a-url', {
      configuredIssuers: 'also-not-a-url',
      defaultTrustedOrigins: [],
    })).toBe(false)
  })
})
