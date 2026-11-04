import { render, screen } from '@testing-library/react'
import { PatientInfoDisplay } from '@/features/clinical-summary/patient-info/components/PatientInfoDisplay'
import { formatIdentifiers } from '@/features/clinical-summary/patient-info/utils/patient-helpers'
import { LanguageProvider } from '@/src/application/providers/language.provider'

const labels = { nationalId: '身分證字號', medicalRecordNumber: '病歷號', passportNumber: '護照號碼', socialSecurityNumber: '社會安全碼', identifierGeneric: '識別碼' }

it.each([
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id',
  'urn:oid:tw.gov.id-number',
])('shows name, national ID and MRN without expanding details for %s', system => {
  const identifiers = formatIdentifiers({ identifier: [
    { system, value: 'A123456789' },
    { system: 'urn:oid:his.patient.mrn', value: '7654321' },
  ] }, labels)
  render(<LanguageProvider><PatientInfoDisplay patientInfo={{ name: '測試甲', gender: '男性', age: '35', identifiers }} /></LanguageProvider>)
  expect(screen.getByText('測試甲')).toBeVisible()
  expect(screen.getByText('A123456789')).toBeVisible()
  expect(screen.getByText('7654321')).toBeVisible()
  expect(screen.getByText('身分證字號：')).toBeVisible()
  expect(screen.getByText('病歷號：')).toBeVisible()
})

it('does not mislabel an opaque cloud identifier as a national ID', () => {
  expect(formatIdentifiers({ identifier: [{
    system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id', value: 'CLOUD-123',
  }] }, labels)).toEqual([{ label: '識別碼', value: 'CLOUD-123' }])
})
