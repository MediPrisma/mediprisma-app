import {
  HEALTH_BANK_SDK_SECTION_SYSTEM,
  inferGroupFromObservation,
  inferGroupFromDiagnosticReport,
  inferReportDisplayGroup,
  isCancerScreeningCategory,
} from '@/src/shared/utils/report-grouping-helpers'

describe('MediCloud cancer-screening classification', () => {
  const category = [{
    coding: [{
      system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/medcloud-observation-program',
      code: 'CANCER-SCREENING',
      display: '癌症篩檢',
    }],
  }]

  it('uses the explicit source category for cancer-screening observations', () => {
    expect(isCancerScreeningCategory(category)).toBe(true)
    expect(inferGroupFromObservation({ category, code: { text: '大腸癌篩檢' } }))
      .toBe('cancer-screening')
  })

  it('does not infer cancer screening from a tumour-marker name', () => {
    expect(inferGroupFromObservation({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'laboratory',
        }],
      }],
      code: { text: 'CEA cancer marker' },
    })).toBe('lab')
  })
})

describe('inferGroupFromDiagnosticReport', () => {
  it('recognizes a category-less Health Bank chest X-ray by NHI order code', () => {
    expect(inferGroupFromDiagnosticReport({
      code: {
        coding: [{ system: 'nhi', code: '32001C' }],
        text: '胸腔檢查（包括各種角度部位之胸腔檢查）',
      },
      conclusion: 'Radiography of Chest A-P View(Supine)',
    } as any)).toBe('imaging')
  })

  it('recognizes category-less imaging reports by the order title', () => {
    expect(inferGroupFromDiagnosticReport({
      code: { text: 'Radiography of chest' },
    })).toBe('imaging')
  })

  it('keeps a category-less NHI EKG report in the imaging/pathology source group', () => {
    expect(inferGroupFromDiagnosticReport({
      code: {
        coding: [{ system: 'nhi', code: '18001C' }],
        text: '12-lead EKG',
      },
    })).toBe('imaging')
  })

  it('puts every explicitly tagged SDK r8 report in the shared imaging/pathology group', () => {
    expect(inferGroupFromDiagnosticReport({
      meta: {
        tag: [{
          system: HEALTH_BANK_SDK_SECTION_SYSTEM,
          code: 'r8',
          display: 'Imaging or pathology report',
        }],
      },
      code: { text: 'Unmapped r8 report' },
    })).toBe('imaging')
  })

  it('recognizes an older category-less Health Bank pathology report', () => {
    expect(inferGroupFromDiagnosticReport({
      code: {
        coding: [{ system: 'nhi', code: '25004C' }],
        text: '第四級外科病理',
      },
    })).toBe('imaging')
  })

  it('does not infer imaging from conclusion text alone', () => {
    expect(inferGroupFromDiagnosticReport({
      code: { text: 'Discharge summary' },
      conclusion: 'Follow up the prior chest X-ray.',
    } as any)).toBe('other')
  })

  it('preserves an explicit source category over fallback rules', () => {
    expect(inferGroupFromDiagnosticReport({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'LAB',
        }],
      }],
      code: { coding: [{ code: '32001C' }], text: 'Chest X-ray' },
    })).toBe('lab')
  })

  it('recognizes an ImagingStudy link without an explicit category', () => {
    expect(inferGroupFromDiagnosticReport({
      code: { text: 'External study' },
      imagingStudy: [{ reference: 'ImagingStudy/study-1' }],
    })).toBe('imaging')
  })
})

describe('inferReportDisplayGroup', () => {
  it.each(['SP', 'CP', 'PAT', 'CG', 'GE', 'PATH', 'CYT'])(
    'puts the v2-0074 %s category in Pathology',
    (code) => {
      expect(inferReportDisplayGroup({
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code,
          }],
        }],
        code: { text: 'Tissue report' },
      })).toBe('pathology')
    },
  )

  it.each([
    ['15001C', '婦科細胞病理'],
    ['15017C', '非婦科細胞病理'],
    ['25003C', '第三級外科病理'],
    ['25004C', '第四級外科病理'],
    ['25006B', '外科病理'],
    ['25012B', '免疫組織化學'],
    ['25024C', '第五級外科病理'],
    ['25025C', '第六級外科病理'],
    ['30103B', '病理檢查'],
    ['30105B', '病理檢查'],
  ])('recognizes category-less NHI pathology order %s', (code, text) => {
    expect(inferReportDisplayGroup({
      code: { coding: [{ system: 'nhi', code }], text },
    })).toBe('pathology')
  })

  it('recognizes category-less pathology by the report order title', () => {
    expect(inferReportDisplayGroup({
      code: { text: 'Histopathology biopsy report' },
    })).toBe('pathology')
  })

  it('keeps an unknown SDK r8 report in Imaging when no pathology signal exists', () => {
    expect(inferReportDisplayGroup({
      meta: {
        tag: [{ system: HEALTH_BANK_SDK_SECTION_SYSTEM, code: 'r8' }],
      },
      code: { text: 'Unmapped r8 report' },
    })).toBe('imaging')
  })

  it.each([
    'RAD', 'IMG',
    'CT', 'NMR', 'RX',
    'RUS', 'CUS', 'OUS', 'VUS',
    'NMS', 'XRC',
    'EC', 'OTH',
    'MR', 'US',
  ])('puts the v2-0074 %s category in Imaging', (code) => {
    expect(inferReportDisplayGroup({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code,
        }],
      }],
      code: {
        text: code === 'EC'
          ? '12-lead EKG'
          : code === 'OTH'
            ? 'Upper GI endoscopy report'
            : 'Diagnostic report',
      },
    })).toBe('imaging')
  })

  it('preserves an explicit laboratory category over a pathology-like title', () => {
    expect(inferReportDisplayGroup({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'LAB',
        }],
      }],
      code: { coding: [{ code: '30101B' }], text: 'Pathology molecular panel' },
    })).toBe('lab')
  })

  it.each([
    ['33085B', '磁振造影－有造影劑 ;(Magnetic resonance imaging-with contrast)'],
    ['33072B', 'CT, with/without contrast'],
    ['32001C', '胸腔檢查 ;(Chest view)'],
    ['19001C', '腹部超音波 ;(Abdominal ultrasound)'],
    ['28016C', '上消化道泛內視鏡檢查 ;(Panendoscopy)'],
  ])('keeps NHI category-2 report order %s in Imaging despite a Pathology category', (code, text) => {
    expect(inferReportDisplayGroup({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'PAT',
          display: 'Pathology',
        }],
        text: '特殊造影檢查',
      }],
      code: { coding: [{ system: 'https://example.org/local-report-code', code, display: text }], text },
      conclusion: 'Indications: lung cancer. PATHOLOGICAL DIAGNOSIS: carcinoma.',
    })).toBe('imaging')
  })

  it('keeps the bridge-shaped legacy MRI report in Imaging', () => {
    // Shape of a MediCloud bundle built before the bridge fix: unpromoted
    // order code under the bridge's local report-code system.
    expect(inferReportDisplayGroup({
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'PAT',
          display: 'Pathology',
        }],
        text: '特殊造影檢查',
      }],
      code: {
        coding: [{
          system: 'https://nhi-fhir-bridge.local/CodeSystem/his-local-report',
          code: '33085B',
          display: '磁振造影－有造影劑 ;(Magnetic resonance imaging-with contrast)',
        }],
        text: '磁振造影－有造影劑 ;(Magnetic resonance imaging-with contrast)',
      },
    })).toBe('imaging')
  })

  it('keeps ultrasound-guided biopsy with a Pathology category in Pathology', () => {
    expect(inferReportDisplayGroup({
      category: [{
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'PAT' }],
      }],
      code: { coding: [{ code: '19007C' }], text: '超音波導引(為組織切片，抽吸、注射等)' },
    })).toBe('pathology')
  })

  it('does not infer Pathology from conclusion text alone', () => {
    expect(inferReportDisplayGroup({
      code: { text: 'Consultation note' },
      conclusion: 'Prior biopsy and pathology were reviewed.',
    })).toBe('other')
  })
})
