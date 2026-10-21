import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import {
  ALL_DATA_FILTERS,
  ALL_DATA_SELECTION,
} from '@/src/shared/constants/data-selection.constants'

const NOW = Date.parse('2026-07-13T12:00:00+08:00')

describe('scopeClinicalDataForAi', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  const input = {
    encounters: [
      { id: 'recent-visit', period: { start: '2026-07-01' } },
      { id: 'old-visit', period: { start: '2020-01-01' } },
      { id: 'undated-visit' },
    ],
    medications: [
      { id: 'active-med', status: 'active', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Active drug' } },
      { id: 'bad-med', status: 'entered-in-error', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'Invalid drug' } },
    ],
    procedures: [{ id: 'procedure', status: 'completed', performedDateTime: '2026-07-02' }],
    allergies: [{ id: 'allergy' }],
    diagnosticReports: [{
      id: 'lab-report',
      status: 'final',
      category: [{ coding: [{ code: 'LAB' }] }],
      effectiveDateTime: '2026-07-02',
    }],
    documentReferences: [
      { id: 'selected-doc' },
      { id: 'excluded-doc' },
    ],
  } as any

  it('removes deselected categories from every structured AI side channel', () => {
    const selection = {
      ...ALL_DATA_SELECTION,
      medications: false,
      allergies: false,
      labReports: false,
      procedures: false,
    }
    const scoped = scopeClinicalDataForAi(input, selection, ALL_DATA_FILTERS, ['selected-doc'], NOW)

    expect(scoped.medications).toEqual([])
    expect(scoped.allergies).toEqual([])
    expect(scoped.procedures).toEqual([])
    expect(scoped.diagnosticReports).toEqual([])
    expect(scoped.documentReferences?.map((document) => document.id)).toEqual(['selected-doc'])
  })

  it('applies the same bounded visit and active-medication semantics used by the context', () => {
    const filters = {
      ...ALL_DATA_FILTERS,
      encounterTimeRange: '1m' as const,
      medicationStatus: 'active' as const,
      medicationTimeRange: '1m' as const,
    }
    const scoped = scopeClinicalDataForAi(input, ALL_DATA_SELECTION, filters, [], NOW)

    expect(scoped.encounters?.map((encounter) => encounter.id)).toEqual(['recent-visit'])
    expect(scoped.medications?.map((medication) => medication.id)).toEqual(['active-med'])
  })

  it('keeps excluded clinical domains out of structured AI and citation scope', () => {
    const domainInput = {
      encounters: [
        {
          id: 'dental-visit',
          period: { start: '2026-07-01' },
          serviceType: { coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/service-type',
            code: '88',
          }] },
        },
        { id: 'rehab-visit', period: { start: '2026-07-01' } },
        { id: 'ordinary-visit', period: { start: '2026-07-01' } },
      ],
      procedures: [
        {
          id: 'physical-therapy',
          status: 'completed',
          performedDateTime: '2026-07-01',
          code: { text: '物理治療' },
          encounter: { reference: 'Encounter/rehab-visit' },
        },
        {
          id: 'ordinary-procedure',
          status: 'completed',
          performedDateTime: '2026-07-01',
          code: { text: 'Appendectomy' },
          encounter: { reference: 'Encounter/ordinary-visit' },
        },
      ],
    } as any

    const scoped = scopeClinicalDataForAi(
      domainInput,
      ALL_DATA_SELECTION,
      ALL_DATA_FILTERS,
      [],
      NOW,
    )

    expect(scoped.encounters?.map((record) => record.id)).toEqual(['ordinary-visit'])
    expect(scoped.procedures?.map((record) => record.id)).toEqual(['ordinary-procedure'])
  })

  it('keeps report-member observations when the lab section uses its empty-window fallback', () => {
    const labInput = {
      observations: [{
        id: 'old-creatinine',
        status: 'final',
        effectiveDateTime: '2020-01-01',
        code: { text: 'CREA' },
        valueQuantity: { value: 1.4, unit: 'mg/dL' },
      }],
      diagnosticReports: [{
        id: 'old-lab-report',
        status: 'final',
        effectiveDateTime: '2020-01-01',
        category: [{ coding: [{ code: 'LAB' }] }],
        result: [{ reference: 'Observation/old-creatinine' }],
      }],
    } as any
    const filters = {
      ...ALL_DATA_FILTERS,
      labReportTimeRange: '1m' as const,
      labDepth: 'latest' as const,
    }
    const scoped = scopeClinicalDataForAi(labInput, ALL_DATA_SELECTION, filters, [], NOW)

    expect(scoped.diagnosticReports?.map((report) => report.id)).toEqual(['old-lab-report'])
    expect(scoped.observations?.map((observation) => observation.id)).toContain('old-creatinine')
  })

  it('does not reintroduce a lab panel excluded by the panel filter', () => {
    const labInput = {
      observations: [{
        id: 'creatinine',
        status: 'final',
        effectiveDateTime: '2026-07-01',
        code: { text: 'CREA' },
        valueQuantity: { value: 1.4, unit: 'mg/dL' },
      }],
      diagnosticReports: [{
        id: 'chem-report',
        status: 'final',
        effectiveDateTime: '2026-07-01',
        category: [{ coding: [{ code: 'LAB' }] }],
        result: [{ reference: 'Observation/creatinine' }],
      }],
    } as any
    const scoped = scopeClinicalDataForAi(
      labInput,
      ALL_DATA_SELECTION,
      { ...ALL_DATA_FILTERS, labPanelIds: 'cbc' },
      [],
      NOW,
    )

    expect(scoped.diagnosticReports).toEqual([])
    expect(scoped.observations).toEqual([])
  })

  it('applies latest-per-study-name to standalone ImagingStudy sources', () => {
    const imagingInput = {
      imagingStudies: [
        { id: 'old-ct', started: '2024-01-01', description: 'Chest CT' },
        { id: 'new-ct', started: '2026-01-01', description: 'Chest CT' },
        { id: 'xray', started: '2025-01-01', description: 'Chest X-ray' },
      ],
    } as any
    const scoped = scopeClinicalDataForAi(
      imagingInput,
      ALL_DATA_SELECTION,
      { ...ALL_DATA_FILTERS, imagingReportVersion: 'latest' },
      [],
      NOW,
    )

    expect(scoped.imagingStudies?.map((study) => study.id).sort()).toEqual(['new-ct', 'xray'])
  })

  it('removes attachment capability URLs at the structured-AI scope boundary', () => {
    const sensitiveUrl = 'https://meddcm.nhi.gov.tw/zfp/IMME/secret-payload_123456'
    const imagingInput = {
      diagnosticReports: [{
        id: 'viewer-report',
        status: 'final',
        category: [{ coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'RAD',
        }] }],
        code: { text: 'Chest imaging' },
        effectiveDateTime: '2026-07-01',
        extension: [{
          url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-nhi-viewer-request',
          extension: [
            { url: 'version', valueInteger: 1 },
            { url: 'patient-context-hash', valueString: 'secret-patient-hash' },
            { url: 'ipl-case-seq-no', valueString: 'secret-case-number' },
          ],
        }, {
          url: 'https://example.org/fhir/StructureDefinition/ordinary-extension',
          valueString: 'keep-me',
        }],
        presentedForm: [{
          contentType: 'text/html',
          title: 'NHI image viewer',
          url: sensitiveUrl,
        }],
      }],
    } as any

    const scoped = scopeClinicalDataForAi(
      imagingInput,
      ALL_DATA_SELECTION,
      ALL_DATA_FILTERS,
      [],
      NOW,
    )

    expect(scoped.diagnosticReports).toHaveLength(1)
    expect(scoped.diagnosticReports?.[0].presentedForm?.[0]).toEqual({
      contentType: 'text/html',
      title: 'NHI image viewer',
    })
    expect(scoped.diagnosticReports?.[0].extension).toEqual([{
      url: 'https://example.org/fhir/StructureDefinition/ordinary-extension',
      valueString: 'keep-me',
    }])
    expect(JSON.stringify(scoped)).not.toContain('secret-payload')
    expect(JSON.stringify(scoped)).not.toContain('secret-patient-hash')
    expect(JSON.stringify(scoped)).not.toContain('secret-case-number')
    // Scoping must not mutate the UI/source collection that still needs the
    // direct user-activated link.
    expect(imagingInput.diagnosticReports[0].presentedForm[0].url).toBe(sensitiveUrl)
  })
})

it('strips local source join keys from selected AI rows and report members', () => {
  const observation = { id: 'result', status: 'final', clinicalSourceNodeKey: 'local-capture', code: { text: 'Synthetic test' }, valueQuantity: { value: 7 }, effectiveDateTime: '2026-07-02', category: [{ coding: [{ code: 'laboratory' }] }] }
  const data: any = { observations: [observation], diagnosticReports: [{ id: 'report', clinicalSourceNodeKey: 'local-report', status: 'final', code: { text: 'Synthetic report' }, effectiveDateTime: '2026-07-02', category: [{ coding: [{ code: 'LAB' }] }], result: [{ reference: 'Observation/result' }], _observations: [observation] }] }
  const scoped = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [], NOW)
  expect(scoped.diagnosticReports).toHaveLength(1)
  expect(JSON.stringify(scoped)).not.toContain('clinicalSourceNodeKey')
  expect(scoped.diagnosticReports![0]._observations![0].valueQuantity?.value).toBe(7)
  expect(data.diagnosticReports[0].clinicalSourceNodeKey).toBe('local-report')
})
