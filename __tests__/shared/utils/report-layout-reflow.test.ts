import { formatReportText, formatReportTextForClipboard } from '@/src/shared/utils/report-text-format'

// Synthetic values; no local patient narratives are stored in this repository.
const ECHO = 'DOPPLER ＆ ECHOCARDIOGRAPHIC REPORT: Indication: assess LV function ' +
  '-------------------------------------------------------------- ' +
  'IVSd 1.05 (0.6~1.2)cm AO 3.2 (2.3~3.7)cm EF(MM) 65 (Normal≧55)% ' +
  'EF(biplane) (Normal≧55)% Sep e`Vel cm/s E/Sep e` TAPSE (1.6~3.0)cm ' +
  '-------------------------------------------------------------- 二尖瓣 形態 MR:nil MV E/A 60/90cm/s E/A Ratio 0.67 ' +
  '-------------------------------------------------------------- 主動脈瓣 形態 AR:mild AV Vmax 110 cm/s AV VmaxPG 5 mmHg ' +
  'Conclusion: ● Normal wall motion ( EF = 65% ) ● mild AR ' +
  '-------------------------------------------------------------- Short summary: LVIDd = 4.5/LVIDs = 2.7/EF = 65%/'
const RENAL = '腎臟超音波: Left kidney size: 10.2x4.5 cm Right kidney size: 10.1x4.3 cm ' +
  'The left kidney is normal in size. The right kidney is normal in size. ' +
  'There are more than three echo-free lesions (largest 2.05 cm). ' +
  'Impression: . Chronic parenchymal renal disease 慢性腎實質病變 . Bilateral renal cysts 雙側腎水囊'

describe('source report layout', () => {
  it.each([ECHO, ECHO.replaceAll('/', '／').replaceAll('%', '％'), RENAL,
    'Sonar Diagnosis：\rFatty liver\rRENAL STONES',
    'HOLTER REPORT: COMMENTS: 1) Mean HR 80 BPM; 2) No pause greater than 2 sec',
    'NUCLEAR MEDICINE STUDY: Bone scan. SCINTIGRAPHIC FINDINGS :\r* Stationary lesion.',
    'PATHOLOGICAL DIAGNOSIS:\rBenign.\rGROSS FINDING:\rA 0.5 x 0.2 cm fragment.',
    'Impression:\r1＞No stone\r2＞Renal cyst',
    'Findings:\n(1) Mild\n* No mass\n· No fluid',
  ])('preserves every non-whitespace source character: %#', raw => {
    expect(formatReportTextForClipboard(raw).replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''))
  })
  it('separates echo measurements without promoting a reference interval to a result', () => {
    const lines = formatReportText(ECHO)
    expect(lines.find(l => l.measurement?.label === 'EF(biplane)')?.measurement?.value).toBe('(Normal≧55)%')
    expect(lines.find(l => l.measurement?.label === 'E/Sep e`')?.measurement?.value).toBe('')
    expect(lines.find(l => l.measurement?.label === 'AV Vmax')?.measurement?.value).toBe('110 cm/s')
    expect(lines.filter(l => l.marker === '●')).toHaveLength(2)
    expect(lines.at(-1)?.text).toBe('LVIDd = 4.5/LVIDs = 2.7/EF = 65%/')
    expect(lines.at(-1)?.measurement).toBeUndefined()
  })
  it('separates renal sides, descriptions and dot bullets', () => {
    const lines = formatReportText(RENAL)
    expect(lines.some(l => l.text === 'Left kidney size: 10.2x4.5 cm')).toBe(true)
    expect(lines.some(l => l.text === 'The right kidney is normal in size.')).toBe(true)
    expect(lines.filter(l => l.marker === '.')).toHaveLength(2)
  })
  it('restores CR and flattened ECG rows', () => {
    expect(formatReportText('心電圖:\rSinus rhythm\rNormal ECG').map(l => l.text))
      .toEqual(formatReportText('心電圖:    Sinus rhythm    Normal ECG').map(l => l.text))
  })
  it('keeps positional vascular tables together without assigning columns', () => {
    const raw = 'Carotid Sonographic Data: Right      Diam   PI    PSV    EDV    Carotid    (cm)    (cm/s)    ============    CCA Mid    0.6    1.1   63    24    BIF             35.6    ============    Diam: diameter; PI: pulsatility index'
    const lines = formatReportText(raw)
    expect(lines.filter(l => l.monospace)).toHaveLength(1)
    expect(lines.find(l => l.monospace)?.text).toContain('\nCCA Mid    0.6    1.1   63    24\nBIF')
    expect(formatReportTextForClipboard(raw).replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''))
  })
  it('does not interpret an unrelated EF mention or a keyword suffix as a structured row', () => {
    expect(formatReportText('Prior EF(MM) 60%. FamilyHistory: none.'))
      .toEqual([{ text: 'Prior EF(MM) 60%. FamilyHistory: none.', level: 0 }])
  })
})

const UPPER_ENDOSCOPY = 'HP FAST： - (陰性) Chief Complain： N , ULCER , L\'T 4.25CM ' +
  'Medication： Example medication 200mg po , oral spray 10% 1-2 puff ' +
  'Findings： The procedure was done smoothly from esophagus to the second portion of duodenum.The endoscopic findings were described as below : ' +
  'Esophagus : Several erosions were observed. One or more mucosal breaks confined to the folds, each no longer than 5mm. ' +
  'Stomach : The stomach was well-inflated with clear gastric lumen. Multiple healing ulcers with shallow erosions were found in the antrum. ' +
  'Duodenum : No definite pathologic finding was observed. A : BIOPSY-POLYP- , Duodenum , biopsy;0.4CM ' +
  'Diagnosis： GU-S GASTRITIS GERD, LA GRADE A DUODENUM POLYP X 1 S/P BX-20 ' +
  'Others： EXAMPLE SCOPE 內視鏡序號:SYNTHETIC 技術員：TEST'

describe('upper endoscopy organ sections', () => {
  it('separates organ findings, biopsy, diagnoses and equipment metadata in a flattened report', () => {
    const lines = formatReportText(UPPER_ENDOSCOPY)
    expect(lines.filter(l => l.heading).map(l => l.text)).toEqual([
      'HP FAST：', 'Chief Complain： N , ULCER , L\'T 4.25CM',
      'Medication： Example medication 200mg po , oral spray 10% 1-2 puff', 'Findings：',
      'Esophagus:', 'Stomach:', 'Duodenum:', 'Diagnosis：', 'Others：', '技術員：TEST',
    ])
    expect(lines.find(l => l.text === '(陰性)')?.marker).toBe('-')
    expect(lines.find(l => l.text.includes('biopsy;0.4CM'))?.marker).toBe('A:')
    const diagnosis = lines.findIndex(l => l.text === 'Diagnosis：')
    expect(lines.slice(diagnosis + 1, diagnosis + 5).map(l => l.text))
      .toEqual(['GU-S', 'GASTRITIS', 'GERD, LA GRADE A', 'DUODENUM POLYP X 1 S/P BX-20'])
    expect(lines.slice(diagnosis + 1, diagnosis + 5).every(l => l.level === 1)).toBe(true)
    expect(lines.some(l => l.text === 'The endoscopic findings were described as below :')).toBe(true)
    expect(formatReportTextForClipboard(UPPER_ENDOSCOPY).replace(/\s/g, ''))
      .toBe(UPPER_ENDOSCOPY.replace(/\s/g, ''))
  })
  it('supports the line-broken version and a bullet glued to the negative result', () => {
    const raw = UPPER_ENDOSCOPY.replace('- (陰性)', '\r•(陰性)\r')
      .replace('GU-S GASTRITIS GERD, LA GRADE A DUODENUM POLYP', 'GU-S\rGASTRITIS\rGERD, LA GRADE A\rDUODENUM POLYP')
    const lines = formatReportText(raw)
    expect(lines.find(l => l.text === '(陰性)')?.marker).toBe('•')
    expect(lines.some(l => l.text === 'GERD, LA GRADE A')).toBe(true)
    expect(formatReportTextForClipboard(raw).replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''))
  })
  it('does not split unknown uppercase diagnosis prose or change measurements', () => {
    const raw = UPPER_ENDOSCOPY.replace('GU-S GASTRITIS GERD, LA GRADE A DUODENUM POLYP X 1 S/P BX-20',
      'CHRONIC GASTRITIS WITH INTESTINAL METAPLASIA')
    const lines = formatReportText(raw)
    expect(lines.some(l => l.text === 'CHRONIC GASTRITIS WITH INTESTINAL METAPLASIA')).toBe(true)
    expect(formatReportTextForClipboard(raw)).toContain('4.25CM')
    expect(formatReportTextForClipboard(raw)).toContain('10% 1-2 puff')
    expect(formatReportTextForClipboard(raw)).toContain('5mm')
  })
})

const NUMBERED_ENDOSCOPY = `Endoscopy: 內視鏡編號: SYNTHETIC
1.Indication: UGI bleeding
2.The benefits and risks are discussed,
and consent is obtained.
3.Pre-procedure assessment:
1)The vital signs (including blood pressure, heart rate, and
respiratory rate): stable
6.Sedation: midazolam 2
mg IV, alfentanyl 0.5mg IV
9.Time record:
1)Starting time:
2)End time:
12.Findings and interventions:
1)Hypopharynx:
a. normal.
2)Esophagus:
a. mucosa break of Z-line ＜ 5 mm.
3)Stomach:
a. reddish patches over antrum.
4)Duodenum:
a. negative down to 2nd portion.
5)Jejunum:
a. not reached.
14.Acute complication: non
Impression:
Reflux esophagitis, L.A. grade A
Erythematous gastritis
*no active bleeder nor ulcer/mass can be seen
Recommendation: correlate with clinical finding`

describe('numbered endoscopy hierarchy', () => {
  it.each([NUMBERED_ENDOSCOPY, NUMBERED_ENDOSCOPY.replaceAll(')Esophagus:', ')\nEsophagus:'), NUMBERED_ENDOSCOPY.replace(/[\s\S]*?(?=Impression:)/, body => body.replaceAll('\n', ' '))])('keeps a numbered heading and its marker together: %#', raw => {
    const lines = formatReportText(raw)
    expect(lines.some(l => l.marker && !l.text)).toBe(false)
    expect(lines.find(l => l.marker === '1.' && l.text.startsWith('Indication:'))).toBeDefined()
    expect(lines.find(l => l.text === 'Esophagus:')).toMatchObject({ marker: '2)', level: 2, heading: true })
    expect(lines.find(l => l.text === 'Stomach:')).toMatchObject({ marker: '3)', level: 2, heading: true })
    expect(lines.find(l => l.text === 'mucosa break of Z-line ＜ 5 mm.')).toMatchObject({ marker: 'a.', level: 3 })
    expect(lines.find(l => l.marker === '6.')?.text).toBe('Sedation: midazolam 2 mg IV, alfentanyl 0.5mg IV')
    expect(lines.find(l => l.text === 'Reflux esophagitis, L.A. grade A')).toBeDefined()
    expect(lines.find(l => l.text === 'Erythematous gastritis')).toBeDefined()
    expect(lines.find(l => l.marker === '*')?.text).toBe('no active bleeder nor ulcer/mass can be seen')
    expect(formatReportTextForClipboard(raw).replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''))
  })
})


it('keeps wrapped letter-colon items in source order in numbered endoscopy', () => {
  const raw = 'Endoscopy: Findings and interventions:\n1)Neoplastic lesion:\nA: A 0.5 cm polyp, cold snare\npolypectomy\nB: A second polyp.'
  expect(formatReportTextForClipboard(raw).replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''))
})
