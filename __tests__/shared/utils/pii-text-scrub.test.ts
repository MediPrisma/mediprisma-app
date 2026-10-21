import { scrubFreeText, buildPatientTextLiterals, buildPatientNamePatterns } from '@/src/shared/utils/pii-text-scrub'

describe('source name placeholders in outbound CDSS text', () => {
  it.each(['王小*', '王*明', '*小明'])('matches one Unicode character in %s', name => {
    const patterns = buildPatientNamePatterns({ name: [{ text: name }] })
    expect(scrubFreeText('王小明', [], patterns)).toBe('[已遮蔽]')
    expect(scrubFreeText(name.replaceAll('*', '𠀋'), [], patterns)).toBe('[已遮蔽]')
    expect(scrubFreeText(name.replaceAll('*', '𠀋\u{E0100}'), [], patterns)).toBe('[已遮蔽]')
    expect(scrubFreeText(name.replaceAll('*', '明\uFE00'), [], patterns)).toBe('[已遮蔽]')
    const separated = name.replaceAll('*', '\n')
    expect(scrubFreeText(separated, [], patterns)).toBe(separated)
  })

  it('does not match Latin name placeholders inside clinical words', () => {
    const patterns = buildPatientNamePatterns({ name: [{ text: 'Li*' }] })
    expect(scrubFreeText('Lin has clinical lipid results', [], patterns))
      .toBe('[已遮蔽] has clinical lipid results')
  })

  it('does not turn identifiers or insufficient names into wildcards', () => {
    const patient = { name: [{ text: '王**' }], identifier: [{ value: 'A123*' }] }
    expect(buildPatientNamePatterns(patient)).toEqual([])
    expect(scrubFreeText('A1234 LDL 92', buildPatientTextLiterals(patient), buildPatientNamePatterns(patient)))
      .toBe('A1234 LDL 92')
  })
})

describe('scrubFreeText', () => {
  it('masks TW national IDs (身分證字號)', () => {
    expect(scrubFreeText('病患 A123456789 於本院住院')).toBe('病患 [已遮蔽] 於本院住院')
    expect(scrubFreeText('B234567890')).toBe('[已遮蔽]')
  })

  it('masks new-format resident IDs (居留證統一證號)', () => {
    expect(scrubFreeText('id: A812345678')).toBe('id: [已遮蔽]')
    expect(scrubFreeText('id: A912345678')).toBe('id: [已遮蔽]')
  })

  it('masks lowercase TW IDs and other explicitly labeled personal IDs', () => {
    expect(scrubFreeText('id: a123456789')).toBe('id: [已遮蔽]')
    expect(scrubFreeText('護照號碼：AB-778899')).toBe('護照號碼：[已遮蔽]')
    expect(scrubFreeText('健保卡號 000012345678')).toBe('健保卡號 [已遮蔽]')
  })

  it('masks email addresses without requiring a label', () => {
    expect(scrubFreeText('請寄至 Amy.Chen+care@example.com 追蹤')).toBe('請寄至 [已遮蔽] 追蹤')
  })

  it('masks labeled Gregorian and ROC birth dates but keeps clinical dates', () => {
    expect(scrubFreeText('出生日期：1962-04-15')).toBe('出生日期：[已遮蔽]')
    expect(scrubFreeText('生日 民國51年4月15日')).toBe('生日 [已遮蔽]')
    expect(scrubFreeText('2025-11-20 採檢')).toBe('2025-11-20 採檢')
  })

  it('masks labeled phone numbers and addresses', () => {
    expect(scrubFreeText('電話：(02) 2345-6789 分機 123')).toBe('電話：[已遮蔽]')
    expect(scrubFreeText('地址：台北市中正區健康路99號\n診斷：肺炎'))
      .toBe('地址：[已遮蔽]\n診斷：肺炎')
  })

  it('masks adjacent identity fields in a flattened one-line report', () => {
    const input =
      '姓名：王小明 身分證：F223456789 出生日期：1962-04-15' +
      '病歷號碼：MRN-7788電話：0912-345-678' +
      '地址：台北市中正區健康路99號病理診斷：高血壓'
    const output = scrubFreeText(input)
    expect(output).not.toMatch(/王小明|F223456789|1962-04-15|MRN-7788|0912-345-678|健康路99號/)
    expect(output).toContain('病理診斷：高血壓')
  })

  it('does NOT mask lab values, dates, or plain numbers', () => {
    const text = 'WBC 4180 /uL, Cr 1.2 mg/dL, 2025-11-20 採檢, HbA1c 7.2%'
    expect(scrubFreeText(text)).toBe(text)
  })

  it('does NOT mask ID-like strings embedded in longer tokens', () => {
    // 9 digits after the letter (not 8) — not a valid ID shape
    expect(scrubFreeText('order A1234567890 shipped')).toBe('order A1234567890 shipped')
  })

  it('masks labeled chart numbers but keeps the label', () => {
    expect(scrubFreeText('病歷號：12345678 男性')).toBe('病歷號：[已遮蔽] 男性')
    expect(scrubFreeText('Chart No: AB-123456')).toBe('Chart No: [已遮蔽]')
    expect(scrubFreeText('MRN 87654321')).toBe('MRN [已遮蔽]')
  })

  it('masks labeled patient names but keeps the label', () => {
    expect(scrubFreeText('姓名：王小明 65歲男性')).toBe('姓名：[已遮蔽] 65歲男性')
    expect(scrubFreeText('Patient Name: Wang 65y')).toBe('Patient Name: [已遮蔽] 65y')
  })

  it('keeps adjacent clinical fields when masking names in flattened text', () => {
    expect(scrubFreeText('姓名：王小明診斷：肺炎')).toBe('姓名：[已遮蔽]診斷：肺炎')
    expect(scrubFreeText('Patient Name: Amy Chen Diagnosis: pneumonia'))
      .toBe('Patient Name: [已遮蔽] Diagnosis: pneumonia')
  })

  it('masks caller-provided patient literals wherever they appear', () => {
    const out = scrubFreeText('王小明先生因胸痛入院，王小明主訴…', ['王小明'])
    expect(out).toBe('[已遮蔽]先生因胸痛入院，[已遮蔽]主訴…')
  })

  it('matches caller-provided Latin literals case-insensitively', () => {
    expect(scrubFreeText('AMY CHEN returns today', ['Amy Chen']))
      .toBe('[已遮蔽] returns today')
  })

  it('leaves clinical narrative untouched', () => {
    const text =
      'CT abdomen: fatty liver, gallbladder sludge. 建議追蹤。Impression: r/o HCC, ' +
      'S/P PCI 2023, EF 45%, NYHA Fc II'
    expect(scrubFreeText(text)).toBe(text)
  })

  it('handles empty / falsy input', () => {
    expect(scrubFreeText('')).toBe('')
  })
})

describe('buildPatientTextLiterals', () => {
  it('collects FHIR name.text, family+given (CJK joined), and identifiers', () => {
    const literals = buildPatientTextLiterals({
      id: 'patient-1',
      name: [{ text: '王小明', family: '王', given: ['小明'] }],
      identifier: [{ value: 'A123456789' }],
    })
    expect(literals).toContain('王小明')
    expect(literals).toContain('A123456789')
    expect(literals).toContain('patient-1')
  })

  it('collects exact birth date, telecom, and full-address literals', () => {
    const literals = buildPatientTextLiterals({
      birthDate: '1962-04-15',
      telecom: [{ value: '0912-345-678' }, { value: 'amy@example.com' }],
      address: [{ text: '台北市中正區健康路99號', line: ['健康路99號'] }],
    })
    expect(literals).toEqual(expect.arrayContaining([
      '1962-04-15',
      '0912-345-678',
      'amy@example.com',
      '台北市中正區健康路99號',
      '健康路99號',
    ]))
  })

  it('drops too-short literals that would mass-mask clinical text', () => {
    const literals = buildPatientTextLiterals({
      id: '12',
      name: [{ family: '王', given: [] }],
    })
    expect(literals).not.toContain('王')
    expect(literals).not.toContain('12')
  })

  it('returns [] for null / non-object input', () => {
    expect(buildPatientTextLiterals(null)).toEqual([])
    expect(buildPatientTextLiterals(undefined)).toEqual([])
    expect(buildPatientTextLiterals('x')).toEqual([])
  })
})
