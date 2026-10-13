import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import { getSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { listClinicalDocuments } from '@/src/core/utils/clinical-documents.utils'
import { scopeClinicalDataForNhiLipidAi } from '@/src/core/utils/nhi-lipid-ai-scope.utils'

function ids(records: ReadonlyArray<{ id?: string }> | undefined): string[] {
  return (records ?? []).map((record) => record.id ?? '')
}

describe('scopeClinicalDataForNhiLipidAi', () => {
  it('retains the measurements and treatment signals used by Table 1', () => {
    const observations = [
      ['tc', '2093-3', 'Total cholesterol'],
      ['ldl', '2089-1', 'LDL cholesterol'],
      ['hdl', '2085-9', 'HDL cholesterol'],
      ['tg', '2571-8', 'Triglycerides'],
      ['non-hdl', '43396-1', 'Non-HDL cholesterol'],
      ['glucose', '2345-7', 'Glucose'],
      ['hba1c', '4548-4', 'Hemoglobin A1c'],
      ['waist', '8280-0', 'Waist circumference'],
      ['creatinine', '2160-0', 'Creatinine'],
      ['egfr', '33914-3', 'eGFR'],
      ['uacr', '14959-1', 'Urine albumin/creatinine ratio'],
      ['cac', 'local-cac', 'Coronary artery calcium score'],
    ].map(([id, code, display]) => ({ id, code: { coding: [{ code, display }] } }))
    const scoped = scopeClinicalDataForNhiLipidAi({
      observations,
      conditions: [
        { id: 'family-history', code: { text: 'Family history of premature CAD' } },
        { id: 'metabolic', code: { text: 'Metabolic syndrome' } },
        { id: 'predialysis-ckd', code: { text: 'Chronic kidney disease' } },
      ],
      medications: [
        { id: 'ezetimibe', medicationCodeableConcept: { text: 'Ezetimibe' } },
        { id: 'losartan', medicationCodeableConcept: { text: 'Losartan' } },
        { id: 'gliclazide', medicationCodeableConcept: { text: 'Gliclazide' } },
      ],
      procedures: [{ id: 'dialysis', code: { text: 'Peritoneal dialysis' } }],
    })

    expect(ids(scoped.observations)).toEqual(observations.map((observation) => observation.id))
    expect(ids(scoped.conditions)).toEqual(['family-history', 'metabolic', 'predialysis-ckd'])
    expect(ids(scoped.medications)).toEqual(['ezetimibe', 'losartan', 'gliclazide'])
    expect(ids(scoped.procedures)).toEqual(['dialysis'])
  })

  it('keeps Table 1 evidence and removes unrelated chart data before formatting or catalog creation', () => {
    const ldl = {
      id: 'ldl',
      code: { coding: [{ code: '2089-1', display: 'LDL cholesterol' }] },
      valueQuantity: { value: 142, unit: 'mg/dL' },
      encounter: { reference: 'Encounter/lipid-visit' },
    }
    const wbc = {
      id: 'wbc',
      code: { coding: [{ code: '6690-2', display: 'WBC' }] },
      valueQuantity: { value: 8.2, unit: '10*3/uL' },
    }
    const input = {
      conditions: [
        { id: 'cad', code: { coding: [{ code: 'I25.10', display: 'Coronary artery disease' }] } },
        { id: 'dermatitis', code: { coding: [{ code: 'L30.9', display: 'Dermatitis' }] } },
      ],
      medications: [
        {
          id: 'atorvastatin',
          medicationCodeableConcept: { text: 'Atorvastatin 20 mg' },
          atcClassification: { atcCode: 'C10AA05' },
          encounter: { reference: 'Encounter/lipid-visit' },
        },
        {
          id: 'metformin',
          medicationCodeableConcept: { text: 'Metformin' },
          atcClassification: { atcCode: 'A10BA02' },
        },
        {
          id: 'amoxicillin',
          medicationCodeableConcept: { text: 'Amoxicillin' },
          atcClassification: { atcCode: 'J01CA04' },
          reasonCode: [{ text: 'Hypertension' }],
        },
      ],
      medicationRemainingSummaries: [{ id: 'remaining-antibiotic' }],
      allergies: [{ id: 'allergy' }],
      observations: [
        ldl,
        wbc,
        {
          id: 'sodium',
          code: { coding: [{ code: '2951-2', display: 'Sodium' }] },
          valueQuantity: { value: 140, unit: 'mmol/L' },
        },
        {
          id: 'creatinine',
          code: { coding: [{ code: '2160-0', display: 'Creatinine' }] },
          valueQuantity: { value: 1.2, unit: 'mg/dL' },
        },
        {
          id: 'cac-score',
          code: { text: 'Coronary artery calcium score' },
          valueQuantity: { value: 420, unit: 'Agatston' },
        },
      ],
      vitalSigns: [
        {
          id: 'blood-pressure',
          code: { coding: [{ code: '85354-9', display: 'Blood pressure' }] },
          component: [{
            code: { coding: [{ code: '8480-6', display: 'Systolic blood pressure' }] },
            valueQuantity: { value: 136, unit: 'mmHg' },
          }],
        },
        {
          id: 'temperature',
          code: { coding: [{ code: '8310-5', display: 'Body temperature' }] },
          valueQuantity: { value: 36.7, unit: 'Cel' },
        },
      ],
      diagnosticReports: [
        {
          id: 'mixed-lab',
          code: { text: 'CBC and lipid panel' },
          result: [{ reference: 'Observation/ldl' }, { reference: 'Observation/wbc' }],
          _observations: [ldl, wbc],
          conclusion: 'WBC normal. LDL remains elevated.',
        },
        {
          id: 'cbc-only',
          code: { text: 'Complete blood count' },
          result: [{ reference: 'Observation/wbc' }],
          _observations: [wbc],
          conclusion: 'WBC normal.',
        },
        {
          id: 'carotid-report',
          code: { text: 'Carotid ultrasound' },
          conclusion: 'Left carotid artery stenosis 72%.',
          imagingStudy: [{ reference: 'ImagingStudy/carotid-study' }],
        },
        {
          id: 'pathology-report',
          code: { text: 'Surgical pathology' },
          conclusion: 'Biopsy negative; history of hypertension.',
        },
      ],
      imagingStudies: [
        { id: 'carotid-study', description: 'Carotid duplex study' },
        { id: 'knee-xray', description: 'Knee radiograph' },
      ],
      procedures: [
        { id: 'pci', code: { text: 'Percutaneous coronary intervention' } },
        { id: 'dialysis', code: { text: 'Hemodialysis session' } },
        { id: 'cataract', code: { text: 'Cataract extraction' }, reasonCode: [{ text: 'Hypertension' }] },
      ],
      encounters: [
        { id: 'lipid-visit', reasonCode: [{ text: 'Coronary artery disease follow-up' }] },
        { id: 'skin-visit', reasonCode: [{ text: 'Dermatitis' }] },
      ],
      compositions: [
        {
          id: 'vascular-note',
          title: 'Cardiology note',
          text: { div: '<div>Current smoker.<br/>WBC 8.2.<br/>Continue atorvastatin.</div>' },
        },
        {
          id: 'skin-note',
          title: 'Dermatology note',
          text: { div: '<div>Dry skin. Sodium 140.</div>' },
        },
        {
          id: 'pathology-note',
          title: 'Surgical pathology',
          text: { div: '<div>Hypertension. Biopsy negative.</div>' },
        },
      ],
      documentReferences: [],
      immunizations: [{ id: 'immunization' }],
      consents: [{ id: 'consent' }],
      devices: [{ id: 'device' }],
      carePlans: [{ id: 'care-plan' }],
    } as unknown as ClinicalDataCollection

    const scoped = scopeClinicalDataForNhiLipidAi(input)

    expect(ids(scoped.conditions)).toEqual(['cad'])
    expect(ids(scoped.medications)).toEqual(['atorvastatin', 'metformin'])
    expect(ids(scoped.observations)).toEqual(['ldl', 'creatinine', 'cac-score'])
    expect(ids(scoped.vitalSigns)).toEqual(['blood-pressure'])
    expect(ids(scoped.diagnosticReports)).toEqual(['mixed-lab', 'carotid-report'])
    expect(scoped.diagnosticReports?.[0]).toMatchObject({
      result: [{ reference: 'Observation/ldl' }],
      _observations: [expect.objectContaining({ id: 'ldl' })],
      code: undefined,
      conclusion: undefined,
    })
    expect(ids(scoped.imagingStudies)).toEqual(['carotid-study', 'knee-xray'])
    expect(ids(scoped.procedures)).toEqual(['pci', 'dialysis'])
    expect(ids(scoped.encounters)).toEqual(['lipid-visit'])
    expect(ids(scoped.compositions)).toEqual(['vascular-note'])
    expect(scoped.medicationRemainingSummaries).toEqual([])
    expect(scoped.allergies).toEqual([])
    expect(scoped.immunizations).toEqual([])
    expect(scoped.consents).toEqual([])
    expect(scoped.devices).toEqual([])
    expect(scoped.carePlans).toEqual([])

    const documentText = listClinicalDocuments(scoped).map((document) => document.text).join('\n')
    expect(documentText).toContain('Current smoker')
    expect(documentText).toContain('Continue atorvastatin')
    expect(documentText).not.toContain('WBC')

    const catalog = getSourceCatalog(scoped, 'en')
    const catalogText = catalog.map((source) => source.getContentText?.() ?? '').join('\n')
    expect(catalog.map((source) => source.resourceId)).toEqual(expect.arrayContaining([
      'atorvastatin',
      'metformin',
      'ldl',
      'creatinine',
      'cac-score',
      'mixed-lab',
      'carotid-report',
      'pci',
      'dialysis',
      'vascular-note',
    ]))
    expect(catalog.map((source) => source.resourceId)).not.toEqual(expect.arrayContaining([
      'wbc',
      'sodium',
      'cbc-only',
      'pathology-report',
      'cataract',
      'skin-note',
      'pathology-note',
    ]))
    expect(catalogText).not.toMatch(/WBC|CBC|Sodium|pathology|Biopsy/i)
  })

  it('keeps every non-X-ray exam and only the latest paired X-ray with intact narratives', () => {
    const abdominalCtReport = {
      id: 'abdominal-ct-report',
      code: { text: 'CT abdomen and pelvis' },
      effectiveDateTime: '2025-03-01T10:00:00Z',
      imagingStudy: [{ reference: 'ImagingStudy/abdominal-ct' }],
      conclusion: 'No acute abdominal process. Incidental calcification of the abdominal aorta.',
      note: [{ text: 'Narrative must remain complete, including unrelated abdominal findings.' }],
      presentedForm: [{
        title: 'CT image',
        contentType: 'image/jpeg',
        data: 'BASE64_PIXEL_DATA_MUST_NOT_ENTER_THE_PROMPT',
      }],
    }
    const renalUltrasoundReport = {
      id: 'renal-ultrasound-report',
      code: { text: 'Renal ultrasound' },
      effectiveDateTime: '2024-06-01',
      imagingStudy: [{ reference: 'ImagingStudy/renal-ultrasound' }],
      conclusion: 'Simple left renal cyst. Otherwise unremarkable.',
    }
    const brainMriReport = {
      id: 'brain-mri-report',
      code: { text: 'Brain MRI' },
      effectiveDateTime: '2024-07-01',
      imagingStudy: [{ reference: 'ImagingStudy/brain-mri' }],
      conclusion: 'No acute intracranial lesion. Compared with a prior X-ray.',
    }
    const oldXrayReport = {
      id: 'old-xray-report',
      code: { text: 'Chest radiograph' },
      effectiveDateTime: '2025-01-02',
      imagingStudy: [{ reference: 'ImagingStudy/old-xray' }],
      conclusion: 'Old chest radiograph narrative.',
    }
    const latestXrayReport = {
      id: 'latest-xray-report',
      code: { text: 'Plain film of the knee' },
      // The report date is the newest available date for the paired exam,
      // even though the study metadata itself carries an older timestamp.
      issued: '2026-04-03T08:30:00Z',
      imagingStudy: [{ reference: 'ImagingStudy/latest-xray' }],
      conclusion: 'Latest knee radiograph narrative.',
    }
    const pathologyReport = {
      id: 'pathology-report',
      code: { text: 'Surgical pathology' },
      issued: '2026-09-01',
      conclusion: 'Biopsy specimen with no malignancy.',
    }
    // Older MediCloud bundles labelled some CT/MRI reports Pathology when the
    // narrative quoted a prior biopsy; the NHI order code identifies the exam.
    const legacyPathologyLabelledMri = {
      id: 'legacy-mri-report',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'PAT',
          display: 'Pathology',
        }],
      }],
      code: { coding: [{ code: '33085B' }], text: 'Brain MRI with contrast' },
      effectiveDateTime: '2024-08-01',
      conclusion: 'Old lacunar infarct. Known lung cancer, pathological diagnosis reviewed.',
    }
    const input = {
      imagingStudies: [
        {
          id: 'abdominal-ct',
          started: '2025-03-01T09:30:00Z',
          modality: [{ code: 'CT', display: 'Computed Tomography' }],
          description: 'CT abdomen and pelvis',
        },
        {
          id: 'renal-ultrasound',
          started: '2024-06-01',
          modality: [{ code: 'US', display: 'Ultrasound' }],
          description: 'Unrelated renal ultrasound',
        },
        {
          id: 'brain-mri',
          started: '2024-07-01',
          modality: [{ code: 'MR', display: 'Magnetic Resonance' }],
          description: 'Unrelated brain MRI',
        },
        {
          id: 'old-xray',
          started: '2025-01-02',
          modality: [{ code: 'DX', display: 'Digital Radiography' }],
        },
        {
          id: 'latest-xray',
          started: '2026-01-01',
          modality: [{ code: 'CR', display: 'Computed Radiography' }],
        },
      ],
      diagnosticReports: [
        abdominalCtReport,
        renalUltrasoundReport,
        brainMriReport,
        oldXrayReport,
        latestXrayReport,
        pathologyReport,
        legacyPathologyLabelledMri,
      ],
    } as unknown as ClinicalDataCollection

    const scoped = scopeClinicalDataForNhiLipidAi(input)

    expect(ids(scoped.imagingStudies)).toEqual([
      'abdominal-ct',
      'renal-ultrasound',
      'brain-mri',
      'latest-xray',
    ])
    expect(ids(scoped.diagnosticReports)).toEqual([
      'abdominal-ct-report',
      'renal-ultrasound-report',
      'brain-mri-report',
      'latest-xray-report',
      'legacy-mri-report',
    ])
    expect(scoped.diagnosticReports?.[0]?.conclusion).toBe(abdominalCtReport.conclusion)
    expect(scoped.diagnosticReports?.[0]?.note).toEqual(abdominalCtReport.note)
    expect(scoped.diagnosticReports?.[0]?.presentedForm).toEqual([{
      title: 'CT image',
      contentType: 'image/jpeg',
    }])

    const catalog = getSourceCatalog(scoped, 'en')
    const catalogText = catalog.map((source) => source.getContentText?.() ?? '').join('\n')
    expect(catalogText).toContain(abdominalCtReport.conclusion)
    expect(catalogText).toContain(abdominalCtReport.note[0].text)
    expect(catalogText).toContain(renalUltrasoundReport.conclusion)
    expect(catalogText).toContain(brainMriReport.conclusion)
    expect(catalogText).toContain(latestXrayReport.conclusion)
    expect(catalogText).not.toContain(oldXrayReport.conclusion)
    expect(catalogText).not.toContain(pathologyReport.conclusion)
    expect(catalogText).not.toContain('BASE64_PIXEL_DATA_MUST_NOT_ENTER_THE_PROMPT')
  })
  it('reads cross-institution lab names through the shared dictionary and keeps vascular sentences whole', () => {
    const input = {
      observations: [
        { id: 'tg-bare', code: { text: 'TG', coding: [{ system: 'https://cloud.example.invalid/lab', code: 'TG' }] }, valueQuantity: { value: 180 } },
        { id: 'lipo-hdl', code: { text: 'Lipo_HDL', coding: [{ system: 'https://cloud.example.invalid/lab', code: 'Lipo_HDL' }] }, valueQuantity: { value: 42 } },
        { id: 'glu-ac', code: { text: 'GLU AC' }, valueQuantity: { value: 110 } },
        { id: 'wbc', code: { text: 'WBC', coding: [{ system: 'http://loinc.org', code: '6690-2' }] }, valueQuantity: { value: 8 } },
      ],
      conditions: [
        { id: 'old-cva', code: { text: 'Old CVA' } },
        { id: 'nstemi', code: { text: 'NSTEMI, s/p PCI' } },
        { id: 'gout', code: { text: 'Gout' } },
      ],
      compositions: [
        {
          id: 'cath-note',
          title: 'Cardiac catheterization',
          text: { div: '<div>s/p PCI to LAD in 2024, RCA 80% stenosis untreated.<br/>Sodium 140.</div>' },
        },
      ],
    } as unknown as ClinicalDataCollection

    const scoped = scopeClinicalDataForNhiLipidAi(input)

    expect(ids(scoped.observations)).toEqual(['tg-bare', 'lipo-hdl', 'glu-ac'])
    expect(ids(scoped.conditions)).toEqual(['old-cva', 'nstemi'])
    const documentText = listClinicalDocuments(scoped).map((document) => document.text).join('\n')
    expect(documentText).toContain('RCA 80% stenosis untreated')
    expect(documentText).not.toContain('Sodium')
  })

})
