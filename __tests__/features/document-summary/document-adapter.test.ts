// Tests the Composition + DocumentReference → DocumentEntry adapter.
// Covers the IPS + 健保存摺 出院病摘 paths that the UI cares about.

import {
  buildDocumentEntries,
  compositionToEntry,
  documentReferenceToEntry,
} from '@/features/clinical-summary/document-summary/utils/document-adapter'

const ZH_DOC_TYPES = {
  ipsPatientSummary: '國際病人摘要 (IPS)',
  dischargeSummary: '出院病摘',
  consultNote: '會診紀錄',
  preventiveMedicineScreening: '成人預防保健',
}

describe('document-adapter', () => {
  describe('compositionToEntry', () => {
    it('returns null for compositions with no renderable narrative', () => {
      const comp: any = {
        id: 'c1',
        date: '2025-01-01',
        type: { coding: [{ code: '60591-5' }] },
        section: [{ title: 'Empty', text: { div: '<div xmlns="http://www.w3.org/1999/xhtml"></div>' } }],
      }
      expect(compositionToEntry(comp, ZH_DOC_TYPES)).toBeNull()
    })

    it('maps an IPS composition to a DocumentEntry with IPS flag', () => {
      const comp: any = {
        id: 'ips-1',
        date: '2025-06-01',
        type: { coding: [{ code: '60591-5', display: 'Patient summary' }] },
        section: [
          {
            title: 'Problem list',
            code: { coding: [{ code: '11450-4' }] },
            text: { div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>HTN</p></div>' },
          },
        ],
      }
      const entry = compositionToEntry(comp, ZH_DOC_TYPES)
      expect(entry).not.toBeNull()
      expect(entry!.sourceKind).toBe('composition')
      expect(entry!.isIps).toBe(true)
      expect(entry!.isDischargeSummary).toBe(false)
      expect(entry!.typeLabel).toBe('國際病人摘要 (IPS)')
      expect(entry!.composition).toBe(comp)
    })

    it('keeps a preventive-care Composition with only top-level narrative', () => {
      const comp: any = {
        id: 'preventive-1',
        date: '2026-07-01',
        type: { coding: [{ system: 'http://loinc.org', code: '75484-6' }] },
        text: { div: '<div><p>成人預防保健總覽</p></div>' },
        section: [],
      }

      const entry = compositionToEntry(comp, ZH_DOC_TYPES)

      expect(entry).not.toBeNull()
      expect(entry!.typeCode).toBe('75484-6')
      expect(entry!.typeLabel).toBe('成人預防保健')
      expect(entry!.composition).toBe(comp)
    })
  })

  describe('documentReferenceToEntry', () => {
    it('returns null when no attachment is renderable (PDF only)', () => {
      const docRef: any = {
        id: 'd1',
        date: '2025-05-23',
        type: { coding: [{ code: '18842-5' }] },
        content: [{ attachment: { contentType: 'application/pdf', data: 'somebase64' } }],
      }
      expect(documentReferenceToEntry(docRef, ZH_DOC_TYPES)).toBeNull()
    })

    it('returns null when content array is empty', () => {
      const docRef: any = {
        id: 'd2',
        date: '2025-05-23',
        type: { coding: [{ code: '18842-5' }] },
        content: [],
      }
      expect(documentReferenceToEntry(docRef, ZH_DOC_TYPES)).toBeNull()
    })

    it('maps an HTML discharge summary attachment to a DocumentEntry', () => {
      const docRef: any = {
        id: 'd3',
        date: '2025-05-23',
        type: {
          coding: [{ system: 'http://loinc.org', code: '18842-5', display: 'Discharge summary' }],
          text: '出院病摘',
        },
        context: {
          period: { start: '2025-05-18', end: '2025-05-22' },
          encounter: [{ reference: 'Encounter/abc123' }],
        },
        content: [
          {
            attachment: {
              contentType: 'text/html',
              data: 'PHA+aGVsbG88L3A+', // <p>hello</p>
              title: '出院病摘 — 長庚嘉義 2025-05-18~2025-05-22',
              size: 16226,
            },
          },
        ],
      }
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES)
      expect(entry).not.toBeNull()
      expect(entry!.sourceKind).toBe('documentReference')
      expect(entry!.typeLabel).toBe('出院病摘')
      expect(entry!.typeCode).toBe('18842-5')
      expect(entry!.isDischargeSummary).toBe(true)
      expect(entry!.isIps).toBe(false)
      expect(entry!.institution).toBe('長庚嘉義')
      expect(entry!.period).toEqual({ start: '2025-05-18', end: '2025-05-22' })
      expect(entry!.encounterRef).toBe('Encounter/abc123')
      expect(entry!.attachment?.contentType).toBe('text/html')
      expect(entry!.attachment?.data).toBe('PHA+aGVsbG88L3A+')
    })

    it('handles plain-text attachments', () => {
      const docRef: any = {
        id: 'd4',
        date: '2024-01-01',
        type: { coding: [{ code: '11488-4' }] },
        content: [{ attachment: { contentType: 'text/plain', data: 'aGVsbG8=' } }],
      }
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES)
      expect(entry).not.toBeNull()
      expect(entry!.typeLabel).toBe('會診紀錄')
    })

    it('does not extract an institution when title has no separator', () => {
      const docRef: any = {
        id: 'd5',
        type: { coding: [{ code: '18842-5' }] },
        content: [
          { attachment: { contentType: 'text/html', data: 'PA==', title: '出院病摘' } },
        ],
      }
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES)
      expect(entry!.institution).toBeUndefined()
    })

    it('pulls primary diagnosis from linked Encounter.reasonCode (zh-TW)', () => {
      const docRef: any = {
        id: 'd-dx',
        date: '2025-05-23',
        type: { coding: [{ code: '18842-5' }] },
        context: { encounter: [{ reference: 'Encounter/enc-1' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const enc: any = {
        id: 'enc-1',
        reasonCode: [
          {
            text: 'R042 咳血',
            coding: [{ code: 'R042', display: 'Hemoptysis' }],
          },
        ],
      }
      const map = new Map([['enc-1', enc]])
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES, map, 'zh-TW')
      expect(entry!.primaryDiagnosis).toEqual({ text: '咳血', code: 'R042' })
    })

    it('pulls primary diagnosis in English when locale === "en"', () => {
      const docRef: any = {
        id: 'd-dx-en',
        date: '2025-05-23',
        type: { coding: [{ code: '18842-5' }] },
        context: { encounter: [{ reference: 'Encounter/enc-1' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const enc: any = {
        id: 'enc-1',
        reasonCode: [
          {
            text: 'R042 咳血',
            coding: [{ code: 'R042', display: 'Hemoptysis' }],
          },
        ],
      }
      const map = new Map([['enc-1', enc]])
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES, map, 'en')
      expect(entry!.primaryDiagnosis).toEqual({ text: 'Hemoptysis', code: 'R042' })
    })

    it('handles urn:uuid encounter references', () => {
      // Some bundles emit `Encounter/<id>`, others raw `<id>`; we strip the
      // type prefix in either case before the map lookup.
      const docRef: any = {
        id: 'd-uuid',
        type: { coding: [{ code: '18842-5' }] },
        context: { encounter: [{ reference: 'Encounter/abc' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const enc: any = { id: 'abc', reasonCode: [{ text: 'J189 肺炎' }] }
      const map = new Map([['abc', enc]])
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES, map, 'zh-TW')
      expect(entry!.primaryDiagnosis?.text).toBe('肺炎')
    })

    it('returns undefined diagnosis when no Encounter is reachable', () => {
      const docRef: any = {
        id: 'd-no-enc',
        type: { coding: [{ code: '18842-5' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const entry = documentReferenceToEntry(docRef, ZH_DOC_TYPES, undefined, 'zh-TW')
      expect(entry!.primaryDiagnosis).toBeUndefined()
    })
  })

  describe('buildDocumentEntries', () => {
    it('merges and sorts both sources newest-first', () => {
      const comp: any = {
        id: 'c1',
        date: '2025-02-01',
        type: { coding: [{ code: '60591-5' }] },
        section: [{ text: { div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>x</p></div>' } }],
      }
      const docRefNew: any = {
        id: 'd-new',
        date: '2025-05-23',
        type: { coding: [{ code: '18842-5' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const docRefOld: any = {
        id: 'd-old',
        date: '2020-09-25',
        type: { coding: [{ code: '18842-5' }] },
        content: [{ attachment: { contentType: 'text/html', data: 'PA==' } }],
      }
      const list = buildDocumentEntries([comp], [docRefNew, docRefOld], ZH_DOC_TYPES)
      expect(list).toHaveLength(3)
      expect(list[0].id).toBe('d-new')
      expect(list[1].id).toBe('c1')
      expect(list[2].id).toBe('d-old')
    })

    it('skips non-renderable entries silently', () => {
      const pdf: any = {
        id: 'pdf',
        date: '2025-01-01',
        type: { coding: [{ code: '18842-5' }] },
        content: [{ attachment: { contentType: 'application/pdf', data: 'PA==' } }],
      }
      expect(buildDocumentEntries([], [pdf], ZH_DOC_TYPES)).toEqual([])
    })

    it('returns [] when no sources contribute anything', () => {
      expect(buildDocumentEntries(undefined, undefined, ZH_DOC_TYPES)).toEqual([])
      expect(buildDocumentEntries([], [], ZH_DOC_TYPES)).toEqual([])
    })
  })
})


describe('outpatient document context', () => {
  const doc = {
    id: 'soap', context: { encounter: [{ reference: 'Encounter/visit' }] },
    content: [{ attachment: { contentType: 'text/plain', data: 'U09BUA==' } }],
  }
  const visit = {
    id: 'visit', class: { code: 'AMB' }, serviceType: { text: '皮膚科' },
    participant: [{ individual: { display: '測試醫師' } }],
    reasonCode: [{ text: 'B02.9,L30.9' }],
    diagnosis: [
      { rank: 2, condition: { reference: 'Condition/secondary' } },
      { rank: 1, condition: { reference: 'Condition/primary' } },
    ],
  }
  const conditions = [
    { id: 'secondary', code: { coding: [{ code: 'L30.9', display: 'Dermatitis' }] } },
    { id: 'primary', code: { text: 'B02.9', coding: [{ code: 'B02.9', display: 'Zoster without complications' }] } },
  ]
  it('uses the linked rank-one condition, including its name, and visit metadata', () => {
    const [entry] = buildDocumentEntries([], [doc], {}, [visit], 'zh-TW', conditions)
    expect(entry.outpatient).toEqual({ department: '皮膚科', physician: '測試醫師' })
    expect(entry.primaryDiagnosis).toEqual({ code: 'B02.9', text: 'Zoster without complications' })
  })
  it('does not borrow an unrelated visit or secondary diagnosis when primary is missing', () => {
    const [entry] = buildDocumentEntries([], [doc], {}, [{ ...visit, serviceType: undefined, participant: [] }], 'zh-TW', [conditions[0]])
    expect(entry.primaryDiagnosis).toBeUndefined()
    expect(entry.outpatient).toEqual({ department: undefined, physician: undefined })
  })
  it('prefers the supplied localized name and preserves the English coding display', () => {
    const localized = [{ ...conditions[1], code: { ...conditions[1].code, text: 'B02.9 帶狀疱疹' } }]
    expect(buildDocumentEntries([], [doc], {}, [visit], 'zh-TW', localized)[0].primaryDiagnosis?.text).toBe('帶狀疱疹')
    expect(buildDocumentEntries([], [doc], {}, [visit], 'en', localized)[0].primaryDiagnosis?.text).toBe('Zoster without complications')
  })
})
