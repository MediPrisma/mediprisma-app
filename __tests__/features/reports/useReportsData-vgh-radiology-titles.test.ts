import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'

// Synthetic copies shaped like a VGH in-house radiology report and its NHI
// cloud upload: VGH 8-digit order code, title-only exam name and a
// "Date Of Examination" header; the cloud copy has an NHI code and its
// generic Chinese/English label. The finding text is fictional.
const BODY = '> Synthetic finding: no definite fracture line is noted in this fictional study.\n> Mild degenerative change, regular follow up is suggested.'
const RAD = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]

function hospital(title: string, header: string, extra: Record<string, unknown> = {}): any {
  return {
    resourceType: 'DiagnosticReport', id: 'hospital', status: 'final', category: RAD,
    subject: { reference: 'Patient/synthetic' }, effectiveDateTime: '2026-06-24T10:00:00+08:00',
    meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
    code: { text: title, coding: [{ system: 'urn:oid:vgh.order', code: '15000000' }] },
    conclusion: `${header}\n Date Of Examination:2026/06/24 10:00:00\n Date Of RCP:2026/06/24\n\n ${BODY}`,
    ...extra,
  }
}

function cloud(code: string, label: string, extra: Record<string, unknown> = {}): any {
  return {
    resourceType: 'DiagnosticReport', id: `cloud-${code}`, status: 'final', category: RAD,
    subject: { reference: 'Patient/synthetic' }, effectiveDateTime: '2026-06-24',
    meta: { source: 'https://medcloud2.nhi.gov.tw/' }, performer: [{ display: '臺北榮總' }],
    code: { text: label, coding: [{ system: 'https://example.test/order', code, display: label }] },
    conclusion: BODY,
    ...extra,
  }
}

const rows = (reports: any[]) => buildReportsData(reports).reportRows.length

describe('VGH radiology titles pair with their NHI cloud copy', () => {
  it.each([
    ['lower abdomen sonogram', hospital('SONOGRAM- LOWER ABDOMEN', 'SONOGRAM, LOWER ABDOMEN'), cloud('19005C', '其他超音波 ;(Echo for others)')],
    ['abdominal CT', hospital('CT/ABD-LIVER-SPLEEN-BILIARY DUCT', 'CT ABD-LIVER-SPLEEN-BILIARY DUCT'),
      cloud('33072B', '電腦斷層造影  －  有/無造影劑 ;(Computed tomography (C. T.)- with/without contrast)')],
    ['pelvis and hip radiograph', hospital('PELVIS & RT HIP LAT-----THR', 'PELVIS & RT HIP LAT ----- THR'),
      cloud('32023C', '骨盆及髖關節檢查（包括各種角度與部位之檢查） ;(View of pelvis and hip joint (including each side))')],
  ])('shows one row for a %s', (_name, h, c) => {
    expect(rows([h, c])).toBe(1)
    const keys = reportDisplayGroupingKeys([h, c])
    expect(keys.get(h)).toMatch(/^cross-source\|/)
    expect(keys.get(h)).toBe(keys.get(c))
  })

  it('keeps a lower abdomen sonogram apart from a cloud abdominal (liver, gallbladder, spleen) sonogram', () => {
    const c = cloud('19001C', '腹部超音波（包括肝liver, 膽囊gall bladder, 胰pancreas,脾spleen） ;(Abdominal ultrasound)')
    expect(rows([hospital('SONOGRAM- LOWER ABDOMEN', 'SONOGRAM, LOWER ABDOMEN'), c])).toBe(2)
  })

  it('keeps upper and lower abdomen apart', () => {
    const c = cloud('19005C', 'Sonogram, upper abdomen')
    expect(rows([hospital('SONOGRAM- LOWER ABDOMEN', 'SONOGRAM, LOWER ABDOMEN'), c])).toBe(2)
  })

  it('keeps a right hip radiograph apart from a left hip copy', () => {
    const c = cloud('32023C', 'Left hip lateral view')
    expect(rows([hospital('PELVIS & RT HIP LAT-----THR', 'PELVIS & RT HIP LAT ----- THR'), c])).toBe(2)
  })

  it('still fails closed for exam names outside the vocabulary', () => {
    const spine = cloud('32011C', '脊椎檢查（包括各種角度部位之頸椎、胸椎、腰椎、薦椎、尾骨及薦髂關節等之檢查） ;(Spine view)')
    expect(rows([hospital('C- SPINE AP- LATERAL', 'C-SPINE AP, LATERAL'), spine])).toBe(2)
    const knee = cloud('19005C', '其他超音波 ;(Echo for others)')
    expect(rows([hospital('SONOGRAM- KNEE', 'SONOGRAM, KNEE'), knee])).toBe(2)
  })

  it('does not read projection words as a radiograph when another method is named', () => {
    // "LAT" alone must not turn a hospital mammogram into an X-ray that could
    // pair with a cloud radiograph of the same text.
    const c = cloud('32023C', '骨盆及髖關節檢查（包括各種角度與部位之檢查） ;(View of pelvis and hip joint (including each side))')
    expect(rows([hospital('MAMMOGRAPHY- RT LAT', 'MAMMOGRAPHY, RT LAT'), c])).toBe(2)
  })

  it('does not pair different findings', () => {
    const c = cloud('19005C', '其他超音波 ;(Echo for others)', { conclusion: `${BODY} Additional cloud-only sentence.` })
    expect(rows([hospital('SONOGRAM- LOWER ABDOMEN', 'SONOGRAM, LOWER ABDOMEN'), c])).toBe(2)
  })
})
