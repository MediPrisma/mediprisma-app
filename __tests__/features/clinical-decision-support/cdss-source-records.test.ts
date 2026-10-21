import type { CdssPatientProfile, CdssResult } from '@voho0000/personalized-care'
import { cdssSourceRecords } from '@/features/clinical-decision-support/telemetry/source-records'

test('retains outside hospital and unknown provenance for sources the CDSS profile actually references', () => {
  const profile = { id: 'patient', facts: {
    ldl: { zh: 'LDL', en: 'LDL', numericValue: 92, sources: [{ resourceType: 'Observation', resourceId: 'lab-1' }] },
    image: { zh: '影像', en: 'Image', sources: [{ resourceType: 'DiagnosticReport', resourceId: 'report-1' }] },
    unknown: { zh: '檢查', en: 'Exam', sources: [{ resourceType: 'Observation', resourceId: 'lab-unknown' }] },
    age: { zh: '68', en: '68', sources: [{ resourceType: 'Patient', resourceId: 'patient' }] },
  } } as CdssPatientProfile
  const result = { recommendations: [] } as unknown as CdssResult
  const records = cdssSourceRecords(profile, result,
    [{ id: 'lab-1', performer: [{ display: '臺大醫院' }] }, { id: 'lab-unknown' }, { id: 'unused', performer: [{ display: '臺北榮民總醫院' }] }],
    [{ id: 'report-1', performer: [{ display: '臺北榮民總醫院' }] }],
  )
  expect(records).toEqual(expect.arrayContaining([
    expect.objectContaining({ resource_type: 'Observation', resource_id: 'lab-1', source_institution: '臺大醫院' }),
    expect.objectContaining({ resource_type: 'DiagnosticReport', resource_id: 'report-1', source_institution: '臺北榮民總醫院' }),
    expect.objectContaining({ resource_type: 'Observation', resource_id: 'lab-unknown', source_institution: null }),
  ]))
  expect(records).not.toEqual(expect.arrayContaining([expect.objectContaining({ resource_id: 'unused' })]))
  expect(records).not.toEqual(expect.arrayContaining([expect.objectContaining({ resource_type: 'Patient' })]))
})
