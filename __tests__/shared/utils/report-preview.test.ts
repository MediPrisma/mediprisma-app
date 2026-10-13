import { extractReportPreview } from '@/src/shared/utils/report-preview'

// Synthetic reports shaped like the structures seen in real bridge captures.
// Clinical wording is invented.

describe('extractReportPreview', () => {
  it('returns null for blank input', () => {
    expect(extractReportPreview('')).toBeNull()
    expect(extractReportPreview('   ')).toBeNull()
    expect(extractReportPreview(undefined)).toBeNull()
  })

  it('previews the Impression of a CT whose first line is acquisition detail', () => {
    const raw = 'Computed Tomography of Brain Without Enhancement Show:Method: Axial noncontrast 5 mm sections from the skull base to the vertex were obtained.Impression:1. No apparent ICH2. Mild cortical atrophy.Other Interpretations:Mucosal thickening of maxillary sinus.'
    expect(extractReportPreview(raw)).toEqual({
      label: 'Impression',
      text: '1. No apparent ICH 2. Mild cortical atrophy.',
    })
  })

  it('stops at the next section heading', () => {
    const raw = 'Findings:\nA 1.2 cm nodule.\nConclusion:\nBenign-appearing nodule.\nRecommendation: follow up in 6 months'
    expect(extractReportPreview(raw)).toEqual({ label: 'Conclusion', text: 'Benign-appearing nodule.' })
  })

  it('keeps the source heading spelling and measurements verbatim', () => {
    const raw = 'Sonar of abdomen.\nIMP: 1. PARENCHYMAL LIVER DISEASE 2. GB polyp 0.5 cm'
    expect(extractReportPreview(raw)).toEqual({
      label: 'IMP',
      text: '1. PARENCHYMAL LIVER DISEASE 2. GB polyp 0.5 cm',
    })
  })

  it('prefers Impression over an earlier endoscopy-style Diagnosis heading', () => {
    const raw = 'Diagnosis: rule out mass\nFindings: a small cyst.\nImpression: Simple renal cyst.'
    expect(extractReportPreview(raw)?.label).toBe('Impression')
  })

  it('uses the first conclusion when an addendum repeats the heading', () => {
    const raw = 'Impression: Original verdict.\nComment: addendum follows\nImpression: Addendum verdict.'
    expect(extractReportPreview(raw)?.text).toBe('Original verdict.')
  })

  it('drops the stray punctuation a source leaves after the colon', () => {
    const raw = 'Findings: unremarkable.\nImpression:. Essentially negative study.'
    expect(extractReportPreview(raw)?.text).toBe('Essentially negative study.')
  })

  it('recognises a combined "CT findings and conclusion:" heading', () => {
    const raw = 'BRAIN CT without contrast\nMulti-slice brain CT scan without contrast was performed.\nCT findings and conclusion:\n1. Mild brain atrophy.\n2. No hematoma.'
    expect(extractReportPreview(raw)).toEqual({
      label: 'CT findings and conclusion',
      text: '1. Mild brain atrophy. 2. No hematoma.',
    })
  })

  it('previews echo Interpretation Summary', () => {
    const raw = 'Left Ventricle\nNormal size.\nInterpretation Summary\nPreserved LV systolic function.'
    expect(extractReportPreview(raw)).toEqual({ label: 'Interpretation Summary', text: 'Preserved LV systolic function.' })
  })

  it('skips a chest X-ray study-name lead-in when there is no conclusion heading', () => {
    const raw = 'Radiography of Chest A-P View(Supine) Show:Borderline cardiomegaly. Tortuosity of thoracic aorta.'
    const preview = extractReportPreview(raw)
    expect(preview?.label).toBeUndefined()
    expect(preview?.text).toBe('Borderline cardiomegaly. Tortuosity of thoracic aorta.')
  })

  it('skips a leading Method section when no conclusion heading exists', () => {
    const raw = 'MRI of brain Show:\nMethod: T1WI and T2WI axial images.\n1. No abnormal enhancing lesion.\n2. Mild sinusitis.'
    expect(extractReportPreview(raw)).toEqual({ text: '1. No abnormal enhancing lesion. 2. Mild sinusitis.' })
  })

  it('leaves a report unchanged when its first line is already the verdict', () => {
    expect(extractReportPreview('Sinus rhythm with premature atrial complexes. Otherwise normal ECG.')).toBeNull()
    expect(extractReportPreview('＞ Mild fatty change of liver parenchyma.\n＞ No ascites.')).toBeNull()
  })

  it('leaves a report unchanged when skipping the preamble would leave nothing', () => {
    expect(extractReportPreview('History: lung nodule follow-up, s/p wedge resection in 2024.')).toBeNull()
  })

  it('does not skip a letterhead into the patient identity block', () => {
    const raw = '正式報告 某某醫院心臟內科報告\n病患資訊： 門診 測試病人\n報告人： 測試醫師'
    expect(extractReportPreview(raw)).toBeNull()
  })
})

describe('extractReportPreview preamble landing', () => {
  it('does not preview a History paragraph that runs on past its heading', () => {
    const raw = 'History:\nlung nodule follow-up\nwedge resection in 2024\nCT of chest without contrast enhancement shows:\nComparison: 2026/07/07\n- Lung/airway: a 1 cm nodule.'
    expect(extractReportPreview(raw)).toBeNull()
  })

  it('lands on list items after a Comparison line', () => {
    const raw = 'Comparison: 2025/08/06 CT of the chest with contrast enhancement shows:\n＞ A small nodule in RLL.\n＞ No pleural effusion.'
    expect(extractReportPreview(raw)).toEqual({ text: '＞ A small nodule in RLL. ＞ No pleural effusion.' })
  })
})

describe('extractReportPreview review regressions', () => {
  it('keeps a numbered History list as written instead of previewing it as findings', () => {
    const raw = 'History:\n1. Prior lung cancer.\n2. Status post lobectomy.\nFindings: New right lower lobe nodule.'
    expect(extractReportPreview(raw)).toBeNull()
  })

  it('keeps a History section after a study lead-in as written', () => {
    const raw = 'CT of chest Show:\nHistory:\n1. Prior lung cancer.\n2. Status post lobectomy.'
    expect(extractReportPreview(raw)).toBeNull()
  })

  it('recognises "Interpretation Summary:" with a colon and inline text', () => {
    const raw = 'Left Ventricle\nNormal size.\nInterpretation Summary: Reduced LV systolic function.'
    expect(extractReportPreview(raw)).toEqual({
      label: 'Interpretation Summary',
      text: 'Reduced LV systolic function.',
    })
  })

  it('carries lines after an inline conclusion heading', () => {
    const raw = 'Left Ventricle\nNormal size.\nInterpretation Summary:\nReduced LV systolic function.\nMild MR.'
    expect(extractReportPreview(raw)).toEqual({
      label: 'Interpretation Summary',
      text: 'Reduced LV systolic function. Mild MR.',
    })
  })
})
