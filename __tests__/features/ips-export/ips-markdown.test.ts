import { buildIpsMarkdown } from '@/features/ips-export/utils/ips-markdown'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import type { PatientEntity } from '@/src/core/entities/patient.entity'

function emptyCollection(): ClinicalDataCollection {
  return {
    conditions: [],
    medications: [],
    medicationRemainingSummaries: [],
    allergies: [],
    observations: [],
    vitalSigns: [],
    diagnosticReports: [],
    imagingStudies: [],
    procedures: [],
    encounters: [],
    documentReferences: [],
    compositions: [],
    immunizations: [],
    consents: [],
    devices: [],
    carePlans: [],
  }
}

const PATIENT: PatientEntity = {
  id: 'pat-1',
  resourceType: 'Patient',
  name: [{ given: ['Test'], family: 'Patient' }],
  gender: 'female',
  birthDate: '1980-01-15',
}

describe('buildIpsMarkdown', () => {
  it('renders a deterministic Markdown companion summary from curated IPS data', () => {
    const data = emptyCollection()
    data.conditions = [
      {
        id: 'dm',
        clinicalStatus: 'active',
        recordedDate: '2024-03-01',
        code: {
          text: '第二型糖尿病',
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
        },
      },
    ]
    data.medications = [
      {
        id: 'm1',
        medicationCodeableConcept: { text: 'Metformin 500mg' },
        status: 'active',
        authoredOn: '2024-03-01',
        dosageInstruction: [{ text: '1 tab BID' }],
      },
    ]
    data.observations = [
      {
        id: 'o1',
        code: { text: 'Glucose', coding: [{ system: 'http://loinc.org', code: '2345-7' }] },
        valueQuantity: { value: 99, unit: 'mg/dL' },
        effectiveDateTime: '2024-03-01',
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('format: clinical-summary-markdown')
    expect(md).toContain('source: taiwan-nhi-my-health-bank')
    expect(md).toContain('clinical_attestation: none')
    expect(md).toContain('generated_at: "2026-06-24T00:00:00.000Z"')
    expect(md).toContain('## Patient')
    expect(md).toContain('- Name: Test Patient')
    expect(md).toContain('## Active Problems')
    // Problem label + Code column come from the SOURCE ICD-10 coding only — the
    // app attaches no SNOMED CT.
    expect(md).toContain('Type 2 diabetes mellitus')
    expect(md).toContain('ICD-10 E11.9')
    expect(md).not.toContain('SNOMED CT 44054006')
    expect(md).toContain('## Medication Summary')
    expect(md).toContain('Metformin 500mg')
    expect(md).toContain('## Diagnostic Results')
    expect(md).toContain('| Date | Glucose (mg/dL) |')
    expect(md).toContain('| 2024-03-01 | 99 |')
  })

  it('writes a +08:00 midnight onset on the day the source recorded', () => {
    const data = emptyCollection()
    data.conditions = [
      {
        id: 'dm',
        clinicalStatus: 'active',
        code: { text: 'Type 2 diabetes mellitus', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9' }] },
        onsetDateTime: '2026-10-23T00:00:00+08:00',
      },
    ]

    const md = buildIpsMarkdown({ patient: PATIENT, data, generatedAt: new Date('2026-10-24T00:00:00Z') })

    expect(md).toContain('2026-10-23')
    expect(md).not.toContain('2026-10-22')
  })

  it('can mask direct patient identifiers and states the masking limit', () => {
    const md = buildIpsMarkdown({
      patient: {
        ...PATIENT,
        id: 'secret-patient-id',
        identifier: [{ system: 'urn:test:mrn', value: 'MRN-123' }],
      },
      data: emptyCollection(),
      generatedAt: new Date('2026-06-24T00:00:00Z'),
      includePatientIdentifiers: false,
    })

    expect(md).toContain('identifiers_included: false')
    expect(md).toContain('contains_phi: possible')
    expect(md).toContain('- Name: Identity masked by the exporter')
    expect(md).not.toContain('Test Patient')
    expect(md).not.toContain('secret-patient-id')
    expect(md).not.toContain('MRN-123')
    expect(md).not.toContain('1980-01-15')
  })

  it('keeps per-cell units when a cumulative column still has mixed units', () => {
    const data = emptyCollection()
    data.observations = [
      {
        id: 'hb-g-dl',
        code: { text: 'Hemoglobin', coding: [{ system: 'http://loinc.org', code: '718-7' }] },
        valueQuantity: { value: 13.2, unit: 'g/dL' },
        effectiveDateTime: '2026-01-02',
      },
      {
        id: 'hb-g-l',
        code: { text: 'Hemoglobin', coding: [{ system: 'http://loinc.org', code: '718-7' }] },
        valueQuantity: { value: 132, unit: 'g/L' },
        effectiveDateTime: '2026-01-01',
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('| Date | Hb |')
    expect(md).toContain('| 2026-01-02 | 13.2 g/dL |')
    expect(md).toContain('| 2026-01-01 | 132 g/L |')
  })

  it('renders patient identifier systems as labels instead of clickable namespace URLs', () => {
    const md = buildIpsMarkdown({
      patient: {
        ...PATIENT,
        identifier: [
          {
            system: 'https://twcore.mohw.gov.tw/IdentifierSystem/national-id',
            value: 'A123456789',
          },
        ],
      },
      data: emptyCollection(),
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('- Identifiers: National ID: A123456789')
    expect(md).not.toContain('https://twcore.mohw.gov.tw/IdentifierSystem/national-id')
  })

  it('marks confirmed AI-inferred problems without asking an LLM to rewrite them', () => {
    const data = emptyCollection()
    data.conditions = [
      {
        id: 'inferred-1',
        clinicalStatus: 'active',
        code: { text: 'Chronic kidney disease' },
        _inferred: {
          inferenceConfidence: 'medium',
          evidence: [{ kind: 'lab', label: 'eGFR low', sourceId: 'o1' }],
          rationale: 'Persistently reduced renal function.',
        },
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('Chronic kidney disease')
    expect(md).toContain('AI-inferred (medium confidence)')
  })

  it('localizes medication columns and separates supply from directions', () => {
    const data = emptyCollection()
    data.medications = [
      {
        id: 'eye-drop',
        medicationCodeableConcept: {
          text: 'PATEAR EYE LOTIONS "PATRON"',
          coding: [{ system: 'urn:oid:nhi.drug', code: 'A022473429' }],
        },
        status: 'active',
        authoredOn: '2026-06-23',
        dosageInstruction: [{ text: '給藥總量 1，給藥日數 28 天（平均每日 0.04）' }],
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      labels: {
        medications: '用藥摘要',
        medicationTable: {
          medication: '藥品',
          status: '狀態',
          directions: '用法',
          supply: '供應量',
          date: '日期',
          code: '代碼',
        },
      },
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('| 藥品 | 狀態 | 用法 | 供應量 | 日期 | 代碼 |')
    expect(md).toContain('| PATEAR EYE LOTIONS "PATRON" | active | - | 給藥總量 1，給藥日數 28 天 | 2026-06-23 | NHI A022473429 |')
    expect(md).not.toContain('平均每日')
    expect(md).not.toContain('0.04')
  })

  it('pivots DiagnosticReport member observations under the urine specimen category', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'urine-report',
        code: { text: 'Urinalysis, routine' },
        effectiveDateTime: '2026-01-27',
        _observations: [
          {
            id: 'nitrite',
            code: { text: 'NITRITE' },
            valueString: 'Negative',
            effectiveDateTime: '2026-01-27',
            specimen: { display: 'Urine' },
          },
          {
            id: 'glucose',
            code: { text: 'GLUCOSE' },
            valueString: '4+ (2000)',
            effectiveDateTime: '2026-01-27',
            specimen: { display: 'Urine' },
          },
        ],
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('### Urine - Chemistry')
    expect(md).toContain('| Date | Glucose | NITRITE |')
    expect(md).toContain('| 2026-01-27 | 4+ (2000) | Negative |')
    expect(md).not.toContain('### 2026-01-27 - Urinalysis, routine - Laboratory - Specimen: Urine')
    expect(md).not.toContain('| Date | Result | Value / Conclusion | Group |')
  })

  it('keeps single-result lab DiagnosticReports in cumulative tables', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'trop-report',
        code: { text: 'TROP' },
        effectiveDateTime: '2026-06-07',
        _observations: [
          {
            id: 'trop',
            code: { text: 'TROP' },
            valueQuantity: { value: 0.01, unit: 'ng/mL' },
            effectiveDateTime: '2026-06-07',
            specimen: { display: 'Blood' },
          },
        ],
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('### Biochem - Cardiac')
    expect(md).toContain('| Date | TROP (ng/mL) |')
    expect(md).toContain('| 2026-06-07 | 0.01 |')
    expect(md).not.toContain('### 2026-06-07 - TROP - Laboratory - Specimen: Blood')
  })

  it('keeps urine albumin and creatinine ratio observations in the same table', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'urine-ratio-report',
        code: { text: 'Urine spot ratio' },
        effectiveDateTime: '2026-01-28',
        _observations: [
          {
            id: 'malb',
            code: { text: 'MALB' },
            valueQuantity: { value: 80, unit: 'mg/L' },
            interpretation: { coding: [{ code: 'H' }] },
            effectiveDateTime: '2026-01-28',
            specimen: { display: 'Urine' },
          },
          {
            id: 'urine-crea',
            code: { text: 'CREA' },
            valueQuantity: { value: 100, unit: 'mg/dL' },
            effectiveDateTime: '2026-01-28',
            specimen: { display: 'Urine' },
          },
          {
            id: 'acr',
            code: { text: '微白蛋白/肌酐酸比值' },
            valueString: '1+ (80) POS',
            effectiveDateTime: '2026-01-28',
            specimen: { display: 'Urine' },
          },
        ],
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('### Urine - Spot Ratios')
    expect(md).toContain('| Date | MALB (mg/dL) | CREA (mg/dL) | ACR |')
    expect(md).toContain('| 2026-01-28 | 8 H | 100 | 1+ (80) POS |')
    expect(md).not.toContain('### Urine\n\n| Date | 微白蛋白/肌酐酸比值 |')
  })

  it('separates laboratory and imaging results when both are present', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      {
        id: 'ecg-report',
        code: { text: '心電圖' },
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
        effectiveDateTime: '2026-06-07',
        conclusion: 'Sinus bradycardia.',
      },
      {
        id: 'trop-report',
        code: { text: 'TROP' },
        effectiveDateTime: '2026-06-07',
        _observations: [
          {
            id: 'trop',
            code: { text: 'TROP' },
            valueQuantity: { value: 0.01, unit: 'ng/mL' },
            effectiveDateTime: '2026-06-07',
            specimen: { display: 'Blood' },
          },
        ],
      },
    ]

    const md = buildIpsMarkdown({
      patient: PATIENT,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    const labIndex = md.indexOf('### Laboratory')
    const imagingIndex = md.indexOf('### Imaging & studies')
    const tropIndex = md.indexOf('#### Biochem - Cardiac')
    const ecgIndex = md.indexOf('#### 2026-06-07 - 心電圖')

    expect(labIndex).toBeGreaterThan(-1)
    expect(imagingIndex).toBeGreaterThan(labIndex)
    expect(tropIndex).toBeGreaterThan(labIndex)
    expect(tropIndex).toBeLessThan(imagingIndex)
    expect(ecgIndex).toBeGreaterThan(imagingIndex)
    expect(md).toContain('Sinus bradycardia.')
    expect(md).not.toContain('| Date | Study | Value / Conclusion |')
  })

  it('does not dump raw FHIR JSON object shapes into the Markdown file', () => {
    const md = buildIpsMarkdown({
      patient: PATIENT,
      data: emptyCollection(),
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    expect(md).toContain('## Active Problems')
    expect(md).toContain('_No information available._')
    expect(md).not.toContain('"resourceType"')
    expect(md).not.toContain('medicationCodeableConcept')
  })
})
