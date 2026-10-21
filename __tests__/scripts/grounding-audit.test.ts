// The deterministic audit catches unsupported examination names that mere
// citation-resolution misses, while retaining legitimate recommendations and
// prose found inside decoded clinical documents.
import {
  auditSummaryGrounding,
  auditSafetyGrounding,
  buildGroundingAuditInput,
} from '@/scripts/lib/grounding-audit'

// Bundle text that contains a chest X-ray + creatinine + ECG, but NO endoscopy
// and NO echocardiogram.
const clinicalEvidenceText = JSON.stringify({ reports: ['胸腔檢查', '肌酸酐、血', '心電圖'] })
const catalog = [
  { key: 'L1', display: '胸腔檢查（各種角度部位）', resourceType: 'DiagnosticReport' },
  { key: 'L7', display: '肌酸酐、血', resourceType: 'DiagnosticReport' },
  { key: 'L16', display: '心電圖', resourceType: 'DiagnosticReport' },
  { key: 'L30', display: '腹部超音波，追蹤性', resourceType: 'DiagnosticReport' },
  { key: 'E5', display: '門診（K317 胃及十二指腸息肉）', resourceType: 'Encounter' },
]
const input = { clinicalEvidenceText, catalog }

describe('auditSummaryGrounding', () => {
  it('flags a problem whose basis names an absent endoscopy', () => {
    const ai = { problems: [{ label: '胃食道逆流', basis: '內視鏡報告與用藥', sources: ['E5'] }] }
    expect(auditSummaryGrounding(ai, input)).toEqual([
      expect.stringContaining('fabricated test "內視鏡" in problem[0]'),
    ])
  })

  it('does NOT flag a decision that RECOMMENDS an echo (arrange, not asserted)', () => {
    const ai = { problems: [{ label: '心臟', metric: '安排心臟超音波評估；心電圖顯示陳舊性梗塞', sources: ['L16'] }] }
    expect(auditSummaryGrounding(ai, input)).toEqual([])
  })

  it('flags a fabricated finding in the headline', () => {
    const ai = { headline: '因咳血住院與胃鏡檢查（診斷胃炎）' }
    expect(auditSummaryGrounding(ai, input)).toEqual([
      expect.stringContaining('fabricated test "胃鏡" in headline'),
    ])
  })

  it('flags a renal problem citing the chest X-ray (irrelevant citation)', () => {
    const ai = { problems: [{ label: '慢性腎臟病', basis: 'eGFR 32', sources: ['L1', 'L7'] }] }
    const issues = auditSummaryGrounding(ai, input)
    expect(issues).toEqual([expect.stringContaining('renal claim cites imaging L1')])
  })

  it('flags a polyp problem citing the abdominal ultrasound (which says nothing about polyps)', () => {
    const ai = { problems: [{ label: '胃及十二指腸息肉', basis: '腹部超音波', sources: ['L30'] }] }
    expect(auditSummaryGrounding(ai, input)).toEqual([expect.stringContaining('polyp cites imaging L30')])
  })

  it('flags a positional cross-reference', () => {
    const ai = { headline: '請照上述建議追蹤' }
    expect(auditSummaryGrounding(ai, input)).toEqual([expect.stringContaining('positional cross-ref')])
  })

  it('returns [] for a fully grounded summary', () => {
    const ai = {
      headline: '胸部X光追蹤中的慢性腎臟病病人',
      problems: [{ label: '慢性腎臟病', basis: '肌酸酐上升', sources: ['L7'] }],
    }
    expect(auditSummaryGrounding(ai, input)).toEqual([])
  })

  it('searches decoded free text from a Base64 HTML discharge summary', () => {
    const html = '<html><body><p>PANENDOSCOPY. Impression: Reflux esophagitis and erythematous gastritis.</p></body></html>'
    const clinicalData = {
      documentReferences: [{
        id: 'discharge-1',
        status: 'current',
        type: { text: '出院病摘', coding: [{ code: '18842-5' }] },
        content: [{
          attachment: {
            contentType: 'text/html',
            title: '出院病摘',
            data: Buffer.from(html, 'utf8').toString('base64'),
          },
        }],
      }],
    }
    const decodedInput = buildGroundingAuditInput(clinicalData, [{
      key: 'D1',
      display: '出院病摘',
      resourceType: 'DocumentReference',
      resourceId: 'discharge-1',
    }])
    const ai = {
      problems: [{
        label: '逆流性食道炎與胃炎',
        basis: '住院期間接受上消化道內視鏡檢查',
        sources: ['D1'],
        documentEvidence: [{
          source: 'D1',
          quote: 'PANENDOSCOPY. Impression: Reflux esophagitis and erythematous gastritis.',
        }],
      }],
    }

    expect(decodedInput.clinicalEvidenceText).not.toContain('內視鏡')
    expect(decodedInput.clinicalEvidenceText).toContain('PANENDOSCOPY')
    expect(auditSummaryGrounding(ai, decodedInput)).toEqual([])
  })

  it('flags a free-text document claim when its original-language quote is missing or changed', () => {
    const inputWithDocument = {
      clinicalEvidenceText: 'PANENDOSCOPY. Impression: Reflux esophagitis.',
      catalog: [{
        key: 'D1',
        display: '出院病摘',
        resourceType: 'DocumentReference',
        resourceId: 'discharge-1',
        getContentText: () => 'PANENDOSCOPY. Impression: Reflux esophagitis.',
      }],
    }
    const missing = {
      problems: [{ label: '胃炎', basis: '接受胃鏡檢查', sources: ['D1'] }],
    }
    const translatedInsteadOfQuoted = {
      problems: [{
        label: '胃炎',
        basis: '接受胃鏡檢查',
        sources: ['D1'],
        documentEvidence: [{ source: 'D1', quote: '接受胃鏡檢查' }],
      }],
    }

    expect(auditSummaryGrounding(missing, inputWithDocument)).toEqual([
      expect.stringContaining('missing verbatim document evidence for D1'),
    ])
    expect(auditSummaryGrounding(translatedInsteadOfQuoted, inputWithDocument)).toEqual([
      expect.stringContaining('document evidence quote not found verbatim in D1'),
    ])
  })
})

describe('auditSafetyGrounding', () => {
  it('flags a fabricated test asserted in an alert detail', () => {
    const scan = { alerts: [{ title: '胃部風險', detail: '內視鏡顯示胃炎', evidence: [], sources: ['E5'], category: 'other' }] }
    expect(auditSafetyGrounding(scan, input)).toEqual([expect.stringContaining('fabricated test "內視鏡"')])
  })

  it('does NOT flag a test named only in the recommendation field', () => {
    const scan = { alerts: [{ title: '心臟', detail: '心電圖異常', recommendation: '建議安排心臟超音波', evidence: [], sources: ['L16'], category: 'monitoring' }] }
    expect(auditSafetyGrounding(scan, input)).toEqual([])
  })

  it('flags a renal alert citing the chest X-ray', () => {
    const scan = { alerts: [{ title: '腎功能', detail: 'eGFR 32', evidence: [], sources: ['L1'], category: 'renal' }] }
    expect(auditSafetyGrounding(scan, input)).toEqual([expect.stringContaining('renal alert cites imaging L1')])
  })
})
