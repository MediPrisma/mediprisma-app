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

  it('leaves a letterhead without an order-name field as written', () => {
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

describe('extractReportPreview audit of real report formats', () => {
  // Shapes found auditing MediCloud + 健康存摺 reports; wording invented.
  const LETTERHEAD = '正式報告 某某醫院心臟內科報告 病患資訊： 門 診 測試病人 0000000-0 男性 80歲 出生日期： 1946/01/01 申請序號 / 工作號： A0000 開醫囑者： X 測試醫師 報告人： X 測試醫師 檢體： 醫囑名稱： '

  it('starts a letterhead report at the order name, never the identity block', () => {
    const raw = `${LETTERHEAD}E.C.G. (E.K.G) Sinus rhythm Right bundle branch block 操作醫師： DOC0000X測試 判讀醫師： DOC0000X測試 監督醫師： DOC0000X測試`
    expect(extractReportPreview(raw)).toEqual({ text: 'E.C.G. (E.K.G) Sinus rhythm Right bundle branch block' })
  })

  it('accepts a MediCloud field label in front of the letterhead', () => {
    const raw = `病理診斷 1：${LETTERHEAD}CYTOLOGY EX-ASCITES Negative for malignant cells`
    expect(extractReportPreview(raw)?.text).toBe('CYTOLOGY EX-ASCITES Negative for malignant cells')
  })

  it('still prefers a conclusion inside a letterhead report', () => {
    const raw = `${LETTERHEAD}COLOR,M-MODE+2-D ECHO LVEF 60 % Conclusion ＆ Comments 1. Thickened aortic valve. 2. Normal LV systolic function. 操作醫師： DOC0000X測試`
    expect(extractReportPreview(raw)).toEqual({
      label: 'Conclusion ＆ Comments',
      text: '1. Thickened aortic valve. 2. Normal LV systolic function.',
    })
  })

  it('cuts the reader sign-off from a conclusion', () => {
    const raw = 'Findings: increased uptake.\nImpression: ＞ No interval change. 操作醫師： 0000X 判讀醫師： 0000X 監督醫師： 0000X'
    expect(extractReportPreview(raw)?.text).toBe('＞ No interval change.')
    expect(extractReportPreview('Impression: no acute hemorrhage 報告醫師: 測試 放診專字: 第000號')?.text).toBe('no acute hemorrhage')
  })

  it('reads all-caps and banner conclusion headings', () => {
    expect(extractReportPreview('Liver: unremarkable. CONCLUSION: ＞ Stable disease.')).toEqual({ label: 'CONCLUSION', text: '＞ Stable disease.' })
    expect(extractReportPreview('Lungs clear.---IMPRESSION: 1. No metastasis.')).toEqual({ label: 'IMPRESSION', text: '1. No metastasis.' })
    expect(extractReportPreview('Lungs clear. ************** * IMPRESSION * ************** 1. No embolism.')).toEqual({ label: 'IMPRESSION', text: '1. No embolism.' })
  })

  it('reads SONAR DIAGNOSIS up to the procedure note', () => {
    const raw = 'PLEURAL EFFUSION : YES SONAR DIAGNOSIS : Right pleural effusion Echo guided procedure : Thoracentesis'
    expect(extractReportPreview(raw)).toEqual({ label: 'SONAR DIAGNOSIS', text: 'Right pleural effusion' })
  })

  it('reads a bracketed 【Impression】 but not an empty one', () => {
    expect(extractReportPreview('【報告內容】, pleural effusion 【Impression】, pleural effusion, right')).toEqual({ label: 'Impression', text: 'pleural effusion, right' })
    expect(extractReportPreview('【報告內容】 Sinus tachycardia RBBB 【Impression】')).toBeNull()
  })

  it('does not take a preoperative or history DX as the conclusion', () => {
    expect(extractReportPreview('PREOPERATIVE DX: Suspected colon cancer.\nPATHOLOGICAL DIAGNOSIS: Tubular adenoma.')).toEqual({
      label: 'PATHOLOGICAL DIAGNOSIS',
      text: 'Tubular adenoma.',
    })
    expect(extractReportPreview('Clinical history: DX: Lung cancer.\nFindings: No focal lung lesion.')?.label).not.toBe('DX')
    expect(extractReportPreview('DX: Lung cancer, for staging. Lungs are clear.')).toBeNull()
  })

  it('does not take a qualified DX between the SNOMED code and the colon', () => {
    expect(extractReportPreview('SNOMED: 00000-B PREOPERATIVE DX: Suspected colon cancer. GROSS D: Two pieces of tissue.')).toBeNull()
    expect(extractReportPreview('SNOMED: 00000-B Clinical DX: Suspected colon cancer. GROSS D: Two pieces of tissue.')).toBeNull()
  })

  it('reads a pathology DX after several SNOMED codes and line breaks', () => {
    const raw = 'SNOMED:\r    00000-B-M00000 T67000-M81403\r\r\rDX: Colon, biopsy ----- Tubular adenoma GROSS D: Two pieces.'
    expect(extractReportPreview(raw)).toEqual({ label: 'DX', text: 'Colon, biopsy ----- Tubular adenoma' })
    // The source sometimes runs the last code into the label.
    expect(extractReportPreview('SNOMED: 00000-B-M00000DX: Stomach, biopsy ----- Gastritis GROSS D: One piece.')?.text).toBe('Stomach, biopsy ----- Gastritis')
  })

  it('reads the Chang Gung pathology DX up to the gross description', () => {
    const raw = '姓名:測試 性別:男 病理編號:S0000 SNOMED: 00000-B DX: Colon, biopsy ----- Tubular adenoma GROSS D: Two pieces of tissue.'
    expect(extractReportPreview(raw)).toEqual({ label: 'DX', text: 'Colon, biopsy ----- Tubular adenoma' })
  })

  it('does not treat a Clinical Impression as the conclusion', () => {
    const raw = 'Clinical Impression: Lung cancer\nScintigraphic Findings and Impression:\n＞ No bone metastasis.'
    expect(extractReportPreview(raw)).toEqual({ label: 'Impression', text: '＞ No bone metastasis.' })
    expect(extractReportPreview('檢查: chest sonography Clinical Impression: Indication: pleural effusion')).toBeNull()
  })

  it('previews nuclear medicine findings after the study preamble', () => {
    const raw = 'NUCLEAR MEDICINE STUDY: Whole body bone scan\nRADIOPHARMACEUTICAL: Tc-99m MDP\nINDICATION: staging\nSCINTIGRAPHIC FINDINGS:\nIncreased uptake at L2.'
    expect(extractReportPreview(raw)).toEqual({ text: 'Increased uptake at L2.' })
  })

  it('does not double the full stop of "." bullets', () => {
    const raw = 'Conclusions:\n. Thickened aortic valve.\n. No pericardial effusion.'
    expect(extractReportPreview(raw)?.text).toBe('Thickened aortic valve. No pericardial effusion.')
  })
})
