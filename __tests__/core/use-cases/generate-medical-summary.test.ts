// Medical Summary use-case tests — the anti-hallucination contract:
// citations resolve against the app-built catalog; unknown keys stay visible
// as unverified. 影像與病理重點 is covered in report-highlights-finalize.test.ts.
import {
  GenerateMedicalSummaryUseCase,
  buildSourceCatalog,
  buildCoverageStats,
  buildLongitudinalInvestigationContext,
  scopeDocumentSources,
  classifyEncounterClass,
  normaliseSummarySourceKey,
} from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { verifyDocumentQuote } from '@/src/core/utils/document-evidence.utils'
import {
  MEDICAL_SUMMARY_CARD_IDS,
  MEDICAL_SUMMARY_MODULE_IDS,
} from '@/src/core/entities/medical-summary.entity'
import {
  MEDICAL_SUMMARY_CARD_REGISTRY,
  registeredMedicalSummaryCards,
} from '@/src/core/use-cases/medical-summary/medical-summary-card-registry'

const useCase = new GenerateMedicalSummaryUseCase()

const CATALOG_INPUT = {
  encounters: [
    {
      id: 'enc-1',
      period: { start: '2026-06-12T09:00:00+08:00' },
      type: [{ text: '內分泌科門診' }],
      serviceProvider: { display: '甲醫學中心' },
    },
    {
      id: 'enc-2',
      period: { start: '2026-05-02T22:10:00+08:00' },
      class: { display: 'emergency' },
      serviceProvider: { display: '丙醫院' },
    },
    {
      id: 'enc-3',
      period: { start: '2026-03-10T00:00:00+08:00', end: '2026-03-16T00:00:00+08:00' },
      class: { code: 'IMP', display: 'inpatient encounter' },
      reasonCode: [{ text: '肺炎' }],
      serviceProvider: { display: '甲醫學中心' },
    },
  ],
  medications: [
    {
      id: 'med-1',
      authoredOn: '2026-05-30',
      medicationCodeableConcept: { text: 'Metformin 500mg' },
      requester: { display: '乙診所' },
    },
  ],
  procedures: [],
  diagnosticReports: [
    {
      id: 'rep-1',
      code: { text: 'HbA1c' },
      effectiveDateTime: '2026-04-18',
      performer: [{ display: '甲醫學中心' }],
    },
  ],
  conditions: [
    { id: 'cond-1', code: { text: '第2型糖尿病' }, recordedDate: '2023-07-01' },
  ],
}

describe('buildSourceCatalog', () => {
  it('builds keyed entries with dates and organizations from the bundle', () => {
    const catalog = buildSourceCatalog(CATALOG_INPUT)
    const byKey = new Map(catalog.map((c) => [c.key, c]))

    expect(byKey.get('E1')).toMatchObject({
      resourceType: 'Encounter',
      resourceId: 'enc-1',
      date: '2026-06-12',
      organization: '甲醫學中心',
    })
    // Encounter.class → deterministic 住院/急診/門診 subtype (never the AI's).
    expect(byKey.get('E2')?.encounterClass).toBe('emergency') // via display text
    expect(byKey.get('E3')?.encounterClass).toBe('inpatient') // via v3-ActCode IMP
    expect(byKey.get('E3')?.endDate).toBe('2026-03-16')
    expect(byKey.get('E1')?.encounterClass).toBeUndefined() // no class field

    // Sorted most-recent-first: E2 is the older ER visit.
    expect(byKey.get('E2')).toMatchObject({ resourceId: 'enc-2', date: '2026-05-02' })
    expect(byKey.get('M1')).toMatchObject({
      resourceId: 'med-1',
      display: 'Metformin 500mg',
      organization: '乙診所',
    })
    expect(byKey.get('L1')).toMatchObject({ resourceId: 'rep-1', display: 'HbA1c' })
    expect(byKey.get('C1')).toMatchObject({ resourceId: 'cond-1' })
  })

  it('cites Health Bank lab Observations without indexing their bridge-generated report containers', () => {
    const catalog = buildSourceCatalog({
      diagnosticReports: [
        {
          id: 'synthetic-cbc',
          meta: { source: 'nhi-fhir-bridge/scraper' },
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
          code: { text: 'CBC' },
          result: [{ reference: 'Observation/hb' }],
          effectiveDateTime: '2026-05-05',
        },
        {
          id: 'real-r8-report',
          meta: {
            source: 'https://nhi-fhir-bridge.github.io/source/health-bank-sdk-json',
            tag: [{
              system: 'https://nhi-fhir-bridge.github.io/CodeSystem/health-bank-sdk-section',
              code: 'r8',
            }],
          },
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
          code: { text: 'Chest X-ray' },
          conclusion: 'No acute pulmonary finding.',
          effectiveDateTime: '2026-05-04',
        },
      ],
      observations: [{
        id: 'hb',
        meta: { source: 'nhi-fhir-bridge/scraper' },
        code: { text: 'Hb' },
        effectiveDateTime: '2026-05-05',
        valueQuantity: { value: 9.2, unit: 'g/dL' },
      }],
    })

    expect(catalog.find((source) => source.resourceId === 'synthetic-cbc')).toBeUndefined()
    expect(catalog.find((source) => source.resourceId === 'hb')).toMatchObject({
      key: 'O1',
      resourceType: 'Observation',
      display: 'Hb',
    })
    expect(catalog.find((source) => source.resourceId === 'real-r8-report')).toMatchObject({
      key: 'L2',
      resourceType: 'DiagnosticReport',
    })
  })

  it('does not classify an ordinary server DiagnosticReport as a synthetic Health Bank grouping', () => {
    const catalog = buildSourceCatalog({
      diagnosticReports: [{
        id: 'server-cbc',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
        code: { text: 'CBC' },
        result: [{ reference: 'Observation/server-hb' }],
        effectiveDateTime: '2026-05-05',
      }],
    })

    expect(catalog).toEqual([
      expect.objectContaining({ resourceId: 'server-cbc', resourceType: 'DiagnosticReport' }),
    ])
  })

  it('uses English encounter type and ICD display while preserving the organization', () => {
    const [source] = buildSourceCatalog({
      encounters: [{
        id: 'enc-bph',
        class: { code: 'AMB', display: 'ambulatory' },
        type: [{
          text: '門診',
          coding: [{ code: 'outpatient', display: '門診' }],
        }],
        reasonCode: [{
          text: 'N400 良性攝護腺增生未伴有下泌尿道症狀',
          coding: [{
            system: 'http://hl7.org/fhir/sid/icd-10-cm',
            code: 'N40.0',
            display: 'Benign prostatic hyperplasia without lower urinary tract symptoms',
          }],
        }],
        serviceProvider: { display: '示範長青醫院' },
      }],
    }, 'en')

    expect(source).toMatchObject({
      display: 'Outpatient (N40.0 Benign prostatic hyperplasia without lower urinary tract symptoms)',
      organization: '示範長青醫院',
    })
  })

  it('reuses the Reports-area English order name for imaging citations', () => {
    const [source] = buildSourceCatalog({
      diagnosticReports: [{
        id: 'chest-xray',
        code: {
          text: '胸腔檢查（包括各種角度部位之胸腔檢查）',
          coding: [{
            code: '32001C',
            display: '胸腔檢查（包括各種角度部位之胸腔檢查）',
          }],
        },
        effectiveDateTime: '2026-06-02',
        performer: [{ display: '示範長青醫院' }],
      }],
    }, 'en')

    expect(source).toMatchObject({
      display: 'Chest X-ray',
      organization: '示範長青醫院',
    })
  })

  it('keeps every selected medication citable without a hidden catalog cap', () => {
    const recentAcute = Array.from({ length: 41 }, (_, index) => ({
      id: `acute-${index}`,
      authoredOn: `2026-06-${String(30 - (index % 20)).padStart(2, '0')}`,
      medicationCodeableConcept: {
        coding: [{ system: 'nhi', code: `A${index}`, display: `Acute ${index}` }],
      },
    }))
    const oldChronic = {
      id: 'old-chronic-forxiga',
      authoredOn: '2024-01-01',
      medicationCodeableConcept: {
        coding: [{ system: 'nhi', code: 'BC26476100', display: 'Forxiga Film-coated Tablets 10mg' }],
      },
      courseOfTherapyType: {
        coding: [{ code: 'continuous' }],
      },
    }

    const medicationSources = buildSourceCatalog({
      medications: [...recentAcute, oldChronic],
    }).filter((source) => source.resourceType.startsWith('Medication'))

    expect(medicationSources).toHaveLength(42)
    expect(medicationSources.some((source) => source.resourceId === 'old-chronic-forxiga')).toBe(true)
  })

  it('uses English medication coding displays in the AI source catalog', () => {
    const [source] = buildSourceCatalog({
      medications: [{
        id: 'forxiga-bilingual',
        medicationCodeableConcept: {
          text: '福適佳膜衣錠10毫克',
          coding: [{ display: 'Forxiga Film-coated Tablets 10mg' }],
        },
      }],
    })

    expect(source.display).toBe('Forxiga Film-coated Tablets 10mg')
  })
})

describe('buildSourceCatalog — care plans', () => {
  it('adds care plans as navigable "K" entries (title/date/org from the plan)', () => {
    const catalog = buildSourceCatalog({
      carePlans: [
        {
          id: 'cp-1',
          title: '末期腎臟病前期照護計畫',
          period: { start: '2024-06-13' },
          author: { display: '示範北辰醫院' },
        },
      ],
    } as never)
    const k1 = catalog.find((c) => c.key === 'K1')
    expect(k1).toMatchObject({
      resourceType: 'CarePlan',
      resourceId: 'cp-1',
      display: '末期腎臟病前期照護計畫',
      date: '2024-06-13',
      organization: '示範北辰醫院',
    })
  })
})

describe('buildSourceCatalog — clinical documents', () => {
  it('adds navigable D keys for DocumentReference and Composition resources', () => {
    const catalog = buildSourceCatalog({
      documentReferences: [
        {
          id: 'discharge-1',
          type: { text: '出院病摘' },
          date: '2026-06-20',
          context: { period: { start: '2026-06-02', end: '2026-06-05' } },
          author: [{ display: '甲醫院' }],
        },
      ],
      compositions: [
        {
          id: 'ips-1',
          title: 'International Patient Summary',
          date: '2026-07-01',
          author: [{ display: '乙醫院' }],
        },
      ],
    } as never)

    expect(catalog.find((source) => source.key === 'D1')).toMatchObject({
      resourceType: 'Composition',
      resourceId: 'ips-1',
      display: 'International Patient Summary',
      date: '2026-07-01',
      organization: '乙醫院',
    })
    expect(catalog.find((source) => source.key === 'D2')).toMatchObject({
      resourceType: 'DocumentReference',
      resourceId: 'discharge-1',
      display: '出院病摘',
      date: '2026-06-02',
      organization: '甲醫院',
    })
  })

  it('exposes only documents included in the AI context and renumbers D keys', () => {
    const scoped = scopeDocumentSources([
      { key: 'E1', resourceType: 'Encounter', resourceId: 'enc-1', display: 'visit' },
      { key: 'D1', resourceType: 'Composition', resourceId: 'doc-new', display: 'IPS' },
      { key: 'D2', resourceType: 'DocumentReference', resourceId: 'doc-selected', display: '出院病摘' },
    ], ['doc-selected'])

    expect(scoped.map((source) => [source.key, source.resourceId])).toEqual([
      ['E1', 'enc-1'],
      ['D1', 'doc-selected'],
    ])
  })

  it('uses the linked Encounter institution when a discharge summary has no author', () => {
    const catalog = buildSourceCatalog({
      encounters: [{
        id: 'enc-discharge',
        serviceProvider: { display: '長庚嘉義' },
      }],
      documentReferences: [{
        id: 'discharge-without-author',
        type: { text: '出院病摘' },
        context: {
          encounter: [{ reference: 'Encounter/enc-discharge' }],
          period: { start: '2025-05-18' },
        },
        content: [{
          attachment: {
            title: '出院病摘 — 長庚嘉義 2025-05-18~2025-05-22',
          },
        }],
      }],
    } as never)

    expect(catalog.find((source) => source.resourceId === 'discharge-without-author')).toMatchObject({
      resourceType: 'DocumentReference',
      organization: '長庚嘉義',
    })
  })

  it('falls back to the bridge document title when no structured institution exists', () => {
    const catalog = buildSourceCatalog({
      documentReferences: [{
        id: 'title-only-document',
        content: [{
          attachment: {
            title: '出院病摘 — 長庚嘉義 2025-05-18~2025-05-22',
          },
        }],
      }],
    } as never)

    expect(catalog.find((source) => source.resourceId === 'title-only-document')?.organization)
      .toBe('長庚嘉義')
  })
})

describe('buildLongitudinalInvestigationContext', () => {
  it('surfaces serial labs and imaging from all available reports so they are not labeled single', () => {
    const bridgeLabMeta = { meta: { source: 'nhi-fhir-bridge/scraper' } }
    const input = {
      diagnosticReports: [
        {
          ...bridgeLabMeta,
          id: 'a1c-new',
          category: [{ text: 'Laboratory' }],
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-06-02',
          result: [{ reference: 'Observation/obs-a1c-new' }],
        },
        {
          ...bridgeLabMeta,
          id: 'a1c-old',
          category: [{ text: 'Laboratory' }],
          code: { text: 'HbA1c' },
          effectiveDateTime: '2025-12-09',
          result: [{ reference: 'Observation/obs-a1c-old' }],
        },
        {
          ...bridgeLabMeta,
          id: 'a1c-mid-1',
          category: [{ text: 'Laboratory' }],
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-03-10',
          result: [{ reference: 'Observation/obs-a1c-mid-1' }],
        },
        {
          ...bridgeLabMeta,
          id: 'a1c-mid-2',
          category: [{ text: 'Laboratory' }],
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-01-08',
          result: [{ reference: 'Observation/obs-a1c-mid-2' }],
        },
        {
          ...bridgeLabMeta,
          id: 'psa-new',
          category: [{ text: 'Laboratory' }],
          code: { text: 'PSA' },
          effectiveDateTime: '2026-06-02',
          result: [{ reference: 'Observation/obs-psa-new' }],
        },
        {
          ...bridgeLabMeta,
          id: 'psa-old',
          category: [{ text: 'Laboratory' }],
          code: { text: 'PSA' },
          effectiveDateTime: '2025-02-10',
          result: [{ reference: 'Observation/obs-psa-old' }],
        },
        {
          id: 'cxr-new',
          category: [{ text: 'Radiology' }],
          code: { text: '胸腔檢查' },
          effectiveDateTime: '2026-06-02',
          conclusion: 'Tortuosity thoracic aorta. Borderline cardiomegaly.',
        },
        {
          id: 'cxr-old',
          category: [{ text: 'Radiology' }],
          code: { text: '胸腔檢查' },
          effectiveDateTime: '2026-05-25',
          conclusion: 'Widening of upper mediastinum. Cardiomegaly.',
        },
      ],
      observations: [
        {
          id: 'obs-a1c-new',
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-06-02',
          valueQuantity: { value: 6.6, unit: '%' },
        },
        {
          id: 'obs-a1c-old',
          code: { text: 'HbA1c' },
          effectiveDateTime: '2025-12-09',
          valueQuantity: { value: 6.7, unit: '%' },
        },
        {
          id: 'obs-a1c-mid-1',
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-03-10',
          valueQuantity: { value: 6.8, unit: '%' },
        },
        {
          id: 'obs-a1c-mid-2',
          code: { text: 'HbA1c' },
          effectiveDateTime: '2026-01-08',
          valueQuantity: { value: 7.0, unit: '%' },
        },
        {
          id: 'obs-psa-new',
          code: { text: 'PSA' },
          effectiveDateTime: '2026-06-02',
          valueQuantity: { value: 0.64, unit: 'ng/mL' },
        },
        {
          id: 'obs-psa-old',
          code: { text: 'PSA' },
          effectiveDateTime: '2025-02-10',
          valueQuantity: { value: 1.32, unit: 'ng/mL' },
        },
      ],
    }
    const catalog = buildSourceCatalog(input as never)
    const context = buildLongitudinalInvestigationContext(input as never, catalog)

    expect(context).toContain('NOT a single result')
    expect(context).not.toContain('6.7 % (2025-12-09;')
    expect(context).toContain('HbA1c: 7 % (2026-01-08; O4)')
    expect(context).toContain('6.8 % (2026-03-10; O3)')
    expect(context).toContain('6.6 % (2026-06-02; O1)')
    expect(context).toContain('PSA: 1.32 ng/mL (2025-02-10; O6)')
    expect(context).toContain('0.64 ng/mL (2026-06-02; O2)')
    expect(context).toContain('胸腔檢查:')
    expect(context).toContain('2026-05-25;')
    expect(context).toContain('2026-06-02;')
  })

  it('joins a newer shared echo narrative to an older singleton without losing any source', () => {
    const report = (
      id: string,
      date: string,
      code: string,
      title: string,
      conclusion: string,
    ) => ({
      id,
      status: 'final',
      subject: { reference: 'Patient/p-1' },
      encounter: { reference: `Encounter/e-${date}` },
      category: [{ text: 'Radiology' }],
      code: { text: title, coding: [{ code }] },
      effectiveDateTime: date,
      performer: [{ display: '甲醫學中心' }],
      conclusion,
    })
    const newFinding = 'LVEF 63%. Mild mitral regurgitation.'
    const oldFinding = 'LVEF 58%. Mild mitral regurgitation.'
    const input = {
      diagnosticReports: [
        report('new-2d', '2026-06-05', '18005C', '2D echocardiography', newFinding),
        report('new-doppler', '2026-06-05', '18007C', 'Doppler echocardiography', newFinding),
        report('old-2d', '2025-11-12', '18005C', '2D echocardiography', oldFinding),
      ],
    }
    const catalog = buildSourceCatalog(input as never)
    const context = buildLongitudinalInvestigationContext(input as never, catalog)

    expect(catalog.filter((source) => source.resourceType === 'DiagnosticReport')).toHaveLength(3)
    expect(context.match(/LVEF 63%\. Mild mitral regurgitation\./g)).toHaveLength(1)
    expect(context.match(/LVEF 58%\. Mild mitral regurgitation\./g)).toHaveLength(1)
    expect(context).toContain('2025-11-12; L3: LVEF 58%')
    expect(context).toContain('2026-06-05; L1 2D echocardiography')
    expect(context).toContain('L1 2D echocardiography [codes: 18005C] [id: new-2d]')
    expect(context).toContain('L2 Doppler echocardiography [codes: 18007C] [id: new-doppler]')
  })
})

describe('buildCoverageStats', () => {
  it('counts everything and derives the date range + unique organizations', () => {
    const stats = buildCoverageStats(CATALOG_INPUT)
    expect(stats).toMatchObject({
      start: '2026-03-10',
      end: '2026-06-12',
      organizations: 3, // 甲醫學中心, 丙醫院, 乙診所
      encounters: 3,
      medications: 1,
      labs: 1,
      procedures: 0,
    })
  })
})

describe('classifyEncounterClass', () => {
  it('maps v3-ActCode codes', () => {
    expect(classifyEncounterClass({ code: 'IMP' })).toBe('inpatient')
    expect(classifyEncounterClass({ code: 'ACUTE' })).toBe('inpatient')
    expect(classifyEncounterClass({ code: 'EMER' })).toBe('emergency')
    expect(classifyEncounterClass({ code: 'AMB' })).toBe('outpatient')
  })

  it('handles CodeableConcept-ish shapes from the bridge', () => {
    expect(classifyEncounterClass({ coding: [{ code: 'IMP' }] })).toBe('inpatient')
    expect(classifyEncounterClass({ coding: [{ display: '住院' }] })).toBe('inpatient')
  })

  it('falls back to display/text keywords (zh + en)', () => {
    expect(classifyEncounterClass({ display: '住院' })).toBe('inpatient')
    expect(classifyEncounterClass({ display: 'emergency' })).toBe('emergency')
    expect(classifyEncounterClass({ text: '門診' })).toBe('outpatient')
  })

  it('returns undefined for unknown or missing class', () => {
    expect(classifyEncounterClass(undefined)).toBeUndefined()
    expect(classifyEncounterClass({ code: 'VR' })).toBeUndefined() // virtual — no zh mapping yet
  })
})

// ---------------------------------------------------------------------------
// 初診快覽 modules: overview (headline) / problems — `reports` has its own lane
// ---------------------------------------------------------------------------

const VALID_AI_RESULT = {
  headline: '多重慢性病男性：CKD 3b 與第二型糖尿病分由兩院追蹤。',
  medicationEducation: [],
  problems: [
    { label: '第2型糖尿病', basis: '照護計畫', kind: 'careplan', sources: ['C1'] },
  ],
}

describe('parseResult', () => {
  it('parses a valid reply wrapped in markdown fences', () => {
    const parsed = useCase.parseResult(
      '```json\n' + JSON.stringify(VALID_AI_RESULT) + '\n```',
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.headline).toContain('CKD 3b')
    expect(parsed!.problems).toHaveLength(1)
    expect(parsed!.reports).toBeUndefined()
  })

  it('ignores the retired sections a legacy object still carries', () => {
    const parsed = useCase.parseResult(JSON.stringify({
      ...VALID_AI_RESULT,
      mustKnow: [{ slot: 'renal', label: 'eGFR 32', text: '腎功能', sources: ['L1'] }],
      focus: [{ title: '腎功能', text: 'eGFR 下降', sources: ['L1'] }],
      recent: [{ ref: 'E1', label: '門診' }],
    }))
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed!)).toEqual(expect.not.arrayContaining(['mustKnow', 'focus', 'recent']))
  })

  it('rejects malformed / off-schema replies', () => {
    expect(useCase.parseResult('not json')).toBeNull()
    // headline is required; a reply without it is not a summary.
    expect(useCase.parseResult(JSON.stringify({ problems: [] }))).toBeNull()
    // Wrong TYPES still reject — only oversize content clamps.
    expect(useCase.parseResult(JSON.stringify({
      ...VALID_AI_RESULT,
      problems: [{ label: 1, sources: ['C1'] }],
    }))).toBeNull()
  })

  it('clamps oversize-but-valid replies instead of rejecting them', () => {
    const parsed = useCase.parseResult(JSON.stringify({
      ...VALID_AI_RESULT,
      headline: 'x'.repeat(400),
      problems: Array.from({ length: 24 }, () => ({
        label: 'a'.repeat(200),
        basis: 'b'.repeat(120),
        sources: ['C1'],
      })),
    }))
    expect(parsed).not.toBeNull()
    expect(parsed!.headline).toHaveLength(240)
    expect(parsed!.problems).toHaveLength(20)
    expect(parsed!.problems[0].label).toHaveLength(120)
    expect(parsed!.problems[0].basis).toHaveLength(80)
  })

  describe('failure diagnostics', () => {
    const originalEnv = process.env.NODE_ENV
    let warn: jest.SpyInstance

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warn.mockRestore()
      Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, configurable: true })
    })

    it('warns with the failure reason and the raw reply head', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true })
      useCase.parseResult('total garbage')
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no parseable JSON found'),
        expect.stringContaining('total garbage'),
      )
    })

    it('truncates the logged head to 300 chars', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true })
      useCase.parseResult('x'.repeat(500))
      expect((warn.mock.calls[0][1] as string).length).toBe(300)
    })

    it('does not warn on a successful parse', () => {
      useCase.parseResult(JSON.stringify(VALID_AI_RESULT))
      expect(warn).not.toHaveBeenCalled()
    })
  })
})

describe('modular summary generation contract', () => {
  const promptInput = {
    clinicalContext: '[E1] 內分泌科門診',
    catalog: buildSourceCatalog(CATALOG_INPUT),
    locale: 'zh-TW' as const,
    audience: 'medical' as const,
  }

  it('the module and card ids are exactly the surviving sections', () => {
    expect(MEDICAL_SUMMARY_MODULE_IDS).toEqual(['overview', 'problems', 'reports'])
    expect(MEDICAL_SUMMARY_CARD_IDS).toEqual(['overview', 'problems', 'reports', 'safety'])
  })

  it('builds a card-specific output contract instead of requiring the full summary object', () => {
    const messages = useCase.buildModuleMessages(promptInput, 'problems')
    const contract = messages[0].content.slice(
      messages[0].content.indexOf('MODULAR OUTPUT CONTRACT'),
    )
    expect(contract).toContain('Generate ONLY the "problems" module')
    expect(contract).toContain('"problems"')
    expect(contract).not.toContain('"headline"')
  })

  it('asks the clinician overview for the headline alone', () => {
    const content = useCase.buildModuleMessages(promptInput, 'overview')[0].content
    expect(content).toContain('"medicationEducation" MUST be the literal empty array []')
    expect(content).toContain('"headline"')
    expect(content).not.toContain('mustKnow')
    expect(content).not.toContain('開藥前必看')
  })

  it('asks the patient overview for medication education, with no prescribing checklist', () => {
    const content = useCase.buildModuleMessages(
      { ...promptInput, audience: 'patient' },
      'overview',
    )[0].content
    expect(content).toContain('populate "medicationEducation"')
    expect(content).not.toContain('mustKnow')
  })

  it('builds one batch prompt with the two narrative modules, independently delimited', () => {
    const content = useCase.buildBatchModuleMessages(promptInput)[0].content
    for (const moduleId of ['overview', 'problems']) {
      expect(content).toContain(`<<<MEDIPRISMA_MODULE:${moduleId}>>>`)
      expect(content).toContain(`<<<END_MEDIPRISMA_MODULE:${moduleId}>>>`)
    }
    expect(content).toContain('Generate all 2 modules')
    for (const retired of ['focus', 'recent', 'reports']) {
      expect(content).not.toContain(`<<<MEDIPRISMA_MODULE:${retired}>>>`)
    }
  })

  it('registers overview, problems and safety for the batch; reports runs on its own lane', () => {
    const registered = registeredMedicalSummaryCards(promptInput)
    expect(registered.map((card) => card.id)).toEqual(['overview', 'problems', 'safety', 'reports'])
    // Same order on the compact harness: there is nothing left to reorder.
    expect(registeredMedicalSummaryCards({ ...promptInput, harnessProfile: 'local-small' })
      .map((card) => card.id)).toEqual(['overview', 'problems', 'safety', 'reports'])
    const cards = registered.filter((card) => card.id !== 'reports')
    const content = useCase.buildRegisteredCardBatchMessages(
      promptInput,
      cards.map((card) => card.buildBatchInstruction(promptInput)),
    )[0].content
    expect(content).not.toContain('<<<MEDIPRISMA_MODULE:reports>>>')
    expect(content).toContain('Generate all 3 registered cards')
    expect(content.indexOf('<<<MEDIPRISMA_MODULE:overview>>>'))
      .toBeLessThan(content.indexOf('<<<MEDIPRISMA_MODULE:safety>>>'))
  })

  it('never asks the patient audience for 影像與病理重點', () => {
    expect(registeredMedicalSummaryCards({ ...promptInput, audience: 'patient' }).map((card) => card.id))
      .toEqual(['overview', 'problems', 'safety'])
  })

  it('supports removing a card without adding an orchestration branch', () => {
    const cards = registeredMedicalSummaryCards(promptInput, ['overview', 'safety'])
    expect(cards.map((card) => card.id)).toEqual(['overview', 'safety'])
  })

  it('builds one retry batch containing only the failed registered cards', () => {
    const failed = [
      MEDICAL_SUMMARY_CARD_REGISTRY.problems,
      MEDICAL_SUMMARY_CARD_REGISTRY.safety,
    ]
    const content = useCase.buildRegisteredCardBatchMessages(
      promptInput,
      failed.map((card) => card.buildBatchInstruction(promptInput)),
    )[0].content
    expect(content).toContain('Generate all 2 registered cards')
    expect(content).toContain('<<<MEDIPRISMA_MODULE:problems>>>')
    expect(content).not.toContain('<<<MEDIPRISMA_MODULE:overview>>>')
  })

  it('can build a smaller requested-module batch for local-model A/B evaluation', () => {
    const content = useCase.buildBatchModuleMessages(promptInput, ['overview'])[0].content
    expect(content).toContain('Generate only the 1 requested modules')
    expect(content).toContain('<<<MEDIPRISMA_MODULE:overview>>>')
    expect(content).not.toContain('<<<MEDIPRISMA_MODULE:problems>>>')
  })

  it('uses a shorter module-scoped contract for an instruction-sensitive local endpoint', () => {
    const local = useCase.buildModuleMessages(
      { ...promptInput, harnessProfile: 'local-small' },
      'problems',
    )[0].content
    expect(local).toContain('NON-NEGOTIABLE EVIDENCE CONTRACT')
    expect(local).toContain('PROBLEMS:')
    expect(local).not.toContain('OVERVIEW:')
    // The long frontier prompt must not leak into the compact contract.
    expect(local).not.toContain('Completeness sweep')
  })

  it('no longer tells the problems module to skip what another section carries', () => {
    const frontier = useCase.buildModuleMessages(promptInput, 'problems')[0].content
    const local = useCase.buildModuleMessages({ ...promptInput, harnessProfile: 'local-small' }, 'problems')[0].content
    for (const content of [frontier, local]) {
      expect(content).not.toMatch(/focus/i)
      expect(content).not.toContain('Do NOT repeat a problem')
    }
    expect(frontier).toContain('the complete problem list')
  })

  it('scrubs patient literals from appended context and source labels at the final boundary', () => {
    const messages = useCase.buildModuleMessages(
      {
        clinicalContext: '病人 A123456789 於門診追蹤',
        piiLiterals: ['王小明'],
        catalog: [{
          key: 'E1',
          resourceType: 'Encounter',
          resourceId: 'enc-1',
          display: '王小明 門診',
        }],
        locale: 'zh-TW',
        audience: 'medical',
      },
      'overview',
    )
    expect(messages[1].content).not.toContain('A123456789')
    expect(messages[1].content).not.toContain('王小明')
  })

  it('does not accept an unrelated/defaulted object as a successful module', () => {
    expect(useCase.parseModuleResult('problems', JSON.stringify({}))).toBeNull()
    expect(useCase.parseModuleResult('overview', JSON.stringify({ problems: [] }))).toBeNull()
    expect(useCase.parseModuleResult('reports', JSON.stringify({ unremarkable: [] }))).toBeNull()
    expect(useCase.parseModuleResult('reports', JSON.stringify({ groups: [] })))
      .toEqual({ groups: [], unremarkable: [] })
  })

  it('validates each module independently so one malformed card does not discard another', () => {
    const text = [
      '<<<MEDIPRISMA_MODULE:overview>>>',
      JSON.stringify({ headline: '摘要', medicationEducation: [] }),
      '<<<END_MEDIPRISMA_MODULE:overview>>>',
      '<<<MEDIPRISMA_MODULE:problems>>>',
      '{ this is not json',
      '<<<END_MEDIPRISMA_MODULE:problems>>>',
    ].join('\n')
    expect(useCase.parseBatchModuleResult('overview', text)?.headline).toBe('摘要')
    expect(useCase.parseBatchModuleResult('problems', text)).toBeNull()
  })

  it('salvages a complete final JSON block when only its closing marker is truncated', () => {
    const text = [
      '<<<MEDIPRISMA_MODULE:overview>>>',
      JSON.stringify({ headline: '摘要', medicationEducation: [] }),
      '<<<END_MEDIPRISMA_MODULE:overview>>>',
      '<<<MEDIPRISMA_MODULE:problems>>>',
      JSON.stringify({ problems: [{ label: '糖尿病', sources: ['C1'] }] }),
    ].join('\n')
    expect(useCase.parseBatchModuleResult('problems', text)?.problems).toHaveLength(1)
  })

  it('does not treat a parseable streaming block as complete before its closing marker', () => {
    const partial = [
      '<<<MEDIPRISMA_MODULE:overview>>>',
      JSON.stringify({ headline: '摘要', medicationEducation: [] }),
    ].join('\n')
    expect(useCase.hasCompleteBatchModuleBlock('overview', partial)).toBe(false)
    expect(useCase.hasCompleteBatchModuleBlock(
      'overview',
      `${partial}\n<<<END_MEDIPRISMA_MODULE:overview>>>`,
    )).toBe(true)
  })

  it('repairs harmless citation formatting and reports only truly unknown keys', () => {
    expect(normaliseSummarySourceKey('[l 1]')).toBe('L1')
    expect(normaliseSummarySourceKey('e2')).toBe('E2')
    const unknown = useCase.findUnknownSourceKeys(
      {
        problems: [{ label: 'x', sources: ['[e 1]', 'Z9'] }],
        groups: [{ organ: 'heart', points: [{ text: 'y', sources: ['l1'] }] }],
      },
      buildSourceCatalog(CATALOG_INPUT),
    )
    expect(unknown).toEqual(['Z9'])
  })

  it('merges a retried module into an existing draft without replacing successful cards', () => {
    const draft = useCase.createEmptyAiResult()
    const withOverview = useCase.mergeModuleResult(draft, 'overview', {
      headline: '摘要',
      medicationEducation: [],
    })
    const withProblems = useCase.mergeModuleResult(withOverview, 'problems', {
      problems: [{ label: '腎功能下降', sources: ['L1'] }],
    })
    const withReports = useCase.mergeModuleResult(withProblems, 'reports', {
      groups: [{ organ: 'heart', points: [{ text: '心臟擴大', sources: ['L1'], quotes: [] }] }],
      unremarkable: [],
    })
    expect(withReports.headline).toBe('摘要')
    expect(withReports.problems[0].label).toBe('腎功能下降')
    expect(withReports.reports?.groups).toHaveLength(1)
  })
})

describe('初診快覽 prompt contract', () => {
  const promptInput = {
    clinicalContext: '[E1] 內分泌科門診',
    catalog: buildSourceCatalog(CATALOG_INPUT),
    locale: 'zh-TW' as const,
    audience: 'medical' as const,
  }

  it('states today before the record so old values are not read as current', () => {
    const [, user] = useCase.buildBatchModuleMessages({ ...promptInput, referenceDate: '2026-10-03' })
    expect(user.content).toContain('Reference date (today): 2026-10-03.')
    expect(user.content).toContain('more than 12 months old describes the past')
    expect(user.content.indexOf('Reference date')).toBeLessThan(user.content.indexOf('Patient clinical data'))
    // No date supplied (legacy callers): nothing is invented.
    expect(useCase.buildBatchModuleMessages(promptInput)[1].content).not.toContain('Reference date')
  })

  it('describes the data and weighs diagnosis codes by the bridge that produced it', () => {
    const system = (dataSource?: 'nhi-medcloud' | 'nhi-health-bank' | 'other', harnessProfile?: 'local-small') =>
      useCase.buildBatchModuleMessages({ ...promptInput, dataSource, harnessProfile })[0].content
    for (const profile of [undefined, 'local-small'] as const) {
      const medcloud = system('nhi-medcloud', profile)
      expect(medcloud).toContain('NHI MediCloud (雲端病歷)')
      expect(medcloud).toContain("provides only each visit's primary diagnosis code")
      expect(medcloud).toContain('it can be used as the diagnosis')
      expect(medcloud).not.toContain('健康存摺')
      expect(medcloud).not.toContain('{{')
      const healthBank = system('nhi-health-bank', profile)
      expect(healthBank).toContain('健康存摺')
      expect(healthBank).toContain("a visit's FIRST code is its primary diagnosis")
      expect(system(undefined, profile)).toContain('cross-facility health-record data')
    }
    // The local contract no longer calls every code a mere billing artefact.
    expect(system('nhi-medcloud', 'local-small')).not.toContain('not automatically confirmed diagnoses')
  })

  it('carries none of the retired sections', () => {
    const frontier = useCase.buildBatchModuleMessages(promptInput)[0].content
    const local = useCase.buildBatchModuleMessages({ ...promptInput, harnessProfile: 'local-small' })[0].content
    for (const content of [frontier, local]) {
      expect(content).not.toContain('mustKnow')
      expect(content).not.toContain('"focus"')
      expect(content).not.toContain('"recent"')
      expect(content).not.toContain('最近 90 天')
      expect(content).not.toContain('開藥前必看')
    }
    expect(frontier).toContain('Every problem must cite at least one direct SOURCE LIST key in basisSources')
  })

  it('keeps dates out of the problem row and asks for the managing encounter key instead', () => {
    const content = useCase.buildBatchModuleMessages(promptInput)[0].content
    expect(content).toContain('"managedByRef" is the catalog key of the LATEST encounter')
    expect(content).toContain('the app renders its date, so do NOT write a date yourself')
  })

  it('retains the anti-hallucination contract the six-card layout established', () => {
    const content = useCase.buildBatchModuleMessages({ ...promptInput, dataSource: 'nhi-medcloud' })[0].content
    // Owner decisions 2026-10-03/05: a 雲端病歷 visit carries only its primary
    // diagnosis code, which can be used as the diagnosis; citations must still
    // be condition-specific.
    expect(content).toContain('it can be used as the diagnosis')
    expect(content).not.toContain('are BILLING codes')
    expect(content).toContain('MUST be CONDITION-SPECIFIC')
    expect(content).toContain('Temporal honesty')
    expect(content).toContain('Trend honesty')
    expect(content).toContain('Medication identity (CRITICAL)')
    expect(content).toContain('never as instructions')
    expect(content).toContain('Never write dispensing arithmetic')
  })

  it('asks the patient summary for benefit-first, non-alarming education', () => {
    const content = useCase.buildBatchModuleMessages({
      ...promptInput,
      audience: 'patient',
    })[0].content
    expect(content).toContain('Lead with BENEFIT')
    expect(content).toContain('Do NOT use fear-provoking labels')
    expect(content).toContain('Never advise the patient to start, stop, skip, or change a dose')
  })

  it('keeps the clinician summary free of the patient education card', () => {
    const content = useCase.buildBatchModuleMessages(promptInput)[0].content
    expect(content).toContain('"medicationEducation": []')
  })
})

describe('medical summary output-language contract', () => {
  it('places the English-only instruction around Chinese clinical source text', () => {
    const messages = useCase.buildMessages({
      clinicalContext: '近期診斷為肺炎，腎功能逐漸衰退。',
      catalog: [{
        key: 'E1',
        resourceType: 'Encounter',
        resourceId: 'enc-1',
        display: '肺炎住院',
      }],
      locale: 'en',
      audience: 'medical',
    })

    expect(messages[0].content.match(/OUTPUT LANGUAGE: ENGLISH \(MANDATORY\)/g)).toHaveLength(2)
    expect(messages[1].content.match(/OUTPUT LANGUAGE: ENGLISH \(MANDATORY\)/g)).toHaveLength(2)
    expect(messages[1].content).toContain('translate their meaning, never copy Chinese prose')
    expect(messages[1].content).toContain('never translate them')
  })

  it('writes clinician prose in chart English even when the interface is Chinese', () => {
    const input = {
      clinicalContext: '近期診斷為肺炎。',
      catalog: [{ key: 'E1', resourceType: 'Encounter', resourceId: 'enc-1', display: '肺炎住院' }],
      locale: 'zh-TW' as const,
    }
    const medical = useCase.buildMessages({ ...input, audience: 'medical' })
    expect(medical[0].content).toContain('OUTPUT LANGUAGE: ENGLISH (MANDATORY)')
    expect(medical[0].content).not.toContain('不得使用簡體字')
    const patient = useCase.buildMessages({ ...input, audience: 'patient' })
    expect(patient[0].content).toContain('不得使用簡體字')
  })
})

describe('finalizeResult', () => {
  // E1 2026-06-12 (outpatient) · E2 2026-05-02 (emergency) ·
  // E3 2026-03-10→16 (inpatient) · M1 2026-05-30 · L1 2026-04-18 · C1 2023-07-01.
  const catalog = buildSourceCatalog(CATALOG_INPUT)
  const empty = {
    headline: '摘要',
    medicationEducation: [],
    problems: [],
  }

  it('verifies known keys and flags unknown keys without dropping them', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: '腎功能', kind: 'lab', sources: ['L1', 'Z9'] }],
    }, catalog)

    expect(result.sourceIndex).toEqual([
      expect.objectContaining({ key: 'L1', num: 1, verified: true, resourceId: 'rep-1' }),
      expect.objectContaining({ key: 'Z9', num: 2, verified: false, resourceId: undefined }),
    ])
    expect(result.problems).toHaveLength(1)
  })

  it('returns only the surviving sections', () => {
    const result = useCase.finalizeResult(empty, catalog)
    for (const retired of ['mustKnow', 'focus', 'recent', 'allergyRecords', 'droppedRecentCount', 'droppedProblemCount']) {
      expect(result).not.toHaveProperty(retired)
    }
  })

  it('resolves harmlessly reformatted citations to the canonical source key', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: '糖尿病', kind: 'lab', sources: ['[l 1]'] }],
    }, catalog)

    expect(result.sourceIndex[0]).toEqual(
      expect.objectContaining({ key: 'L1', verified: true }),
    )
  })

  it('keeps every problem: the list is complete, nothing is deduplicated against another section', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'CKD 3b', kind: 'lab', sources: ['L1'] },
        { label: '第2型糖尿病', kind: 'careplan', sources: ['C1'] },
      ],
    }, catalog)

    expect(result.problems.map((problem) => problem.label)).toEqual(['CKD 3b', '第2型糖尿病'])
  })

  it('resolves the managing encounter date app-side and never from the model', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{
        label: '第2型糖尿病',
        kind: 'careplan',
        metric: 'HbA1c 6.6%',
        metricMeta: '2026-04-18',
        managedBy: '甲醫學中心 內分泌科',
        managedByRef: 'E1',
        medications: 'Metformin 500mg',
        sources: ['C1', 'M1', 'E1'],
      }],
    }, catalog)

    expect(result.problems[0]).toEqual(expect.objectContaining({
      managedBy: '甲醫學中心 內分泌科',
      managedByDate: '2026-06-12',
      metric: 'HbA1c 6.6%',
      medications: 'Metformin 500mg',
      kind: 'careplan',
    }))
    // A managedByRef that does not resolve yields no date at all — the app
    // never invents one, and never shows the model's.
    const unresolved = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'x', kind: 'other', managedByRef: 'Z9', sources: ['C1'] }],
    }, catalog)
    expect(unresolved.problems[0].managedByDate).toBeUndefined()
  })

  it('cites each problem column separately and writes medicine names and value dates app-side', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{
        label: '第2型糖尿病',
        kind: 'careplan',
        basisSources: ['C1'],
        metric: 'HbA1c 6.6%',
        metricSources: ['L1'],
        // The model's own date and medicine text lose to the cited records.
        metricMeta: '2026-01-01',
        managedBy: '甲醫學中心 內分泌科',
        managedByRef: 'E1',
        medicationSources: ['M1'],
        medications: 'Metform',
      }],
    }, catalog)

    expect(result.problems[0]).toEqual(expect.objectContaining({
      basisSourceKeys: ['C1'],
      metricSourceKeys: ['L1'],
      medicationSourceKeys: ['M1'],
      managedBySourceKey: 'E1',
      sourceKeys: ['C1', 'L1', 'M1'],
      metricMeta: '2026-04-18',
      medications: 'Metformin 500mg',
    }))
    expect(result.sourceIndex.map((source) => source.key)).toEqual(expect.arrayContaining(['C1', 'L1', 'M1', 'E1']))
  })

  it('names a managing organization only from the row\'s own records', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // 丙醫院 appears in the record but in none of this row's sources, and
        // the 甲醫學中心 visit it cites is not 丙醫院's: nobody is named.
        { label: 'x', kind: 'other', managedBy: '丙醫院', managedByRef: 'E1', basisSources: ['C1'] },
        // Names an organization with no record at all: no date at all.
        { label: 'y', kind: 'other', managedBy: '丁診所', managedByRef: 'E1', basisSources: ['C1'] },
        // 乙診所 has a prescription, but not one this row cites.
        { label: 'z', kind: 'other', managedBy: '乙診所', basisSources: ['C1'] },
        // The problem's own prescription there is a record for THIS problem.
        { label: 'w', kind: 'other', managedBy: '乙診所', basisSources: ['C1'], medicationSources: ['M1'] },
      ],
    }, catalog)
    for (const unsupported of result.problems.slice(0, 3)) {
      expect(unsupported.managedBy).toBeUndefined()
      expect(unsupported.managedByDate).toBeUndefined()
      expect(unsupported.managedBySourceKey).toBeUndefined()
    }
    expect(result.problems[3]).toEqual(expect.objectContaining({ managedBy: '乙診所', managedBySourceKey: 'M1', managedByDate: '2026-05-30' }))
    expect(result.problems[3].managedByScope).toBeUndefined()
  })

  it('dates a specialty row from that specialty\'s visit, not another department of the same hospital', () => {
    const hospital = { display: '甲醫學中心' }
    const deptData = {
      encounters: [
        { id: 'nephro', type: [{ text: '腎臟科門診' }], period: { start: '2026-03-01' }, serviceProvider: hospital },
        { id: 'derm', type: [{ text: '皮膚科門診' }], period: { start: '2026-06-01' }, serviceProvider: hospital },
        { id: 'claim', type: [{ text: '門診' }], reasonCode: [{ text: '慢性腎臟病' }], period: { start: '2026-02-01' }, serviceProvider: hospital },
      ],
      conditions: [{ id: 'ckd', code: { text: 'CKD' }, recordedDate: '2025-01-01' }],
      observations: [{ id: 'creat', code: { text: 'Creatinine' }, effectiveDateTime: '2026-04-10', valueQuantity: { value: 1.9, unit: 'mg/dL' }, performer: [hospital] }],
    } as any
    const deptCatalog = buildSourceCatalog(deptData)
    const key = (id: string) => deptCatalog.find((entry) => entry.resourceId === id)!.key
    const ckd = key('ckd')
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // The model cites the dermatology visit for the nephrology row.
        { label: 'CKD', kind: 'other', basisSources: [ckd, key('creat')], managedBy: '甲醫學中心 腎臟科', managedByRef: key('derm') },
        // The row's own claim visit wins over any other department's.
        { label: 'CKD', kind: 'other', basisSources: [ckd, key('claim')], managedBy: '甲醫學中心' },
        // A specialty with no visit in the record: the row's own record there.
        { label: 'HF', kind: 'other', basisSources: [ckd, key('creat')], managedBy: '甲醫學中心 心臟科' },
      ],
    }, deptCatalog)

    expect(result.problems[0]).toEqual(expect.objectContaining({ managedBySourceKey: key('nephro'), managedByDate: '2026-03-01' }))
    expect(result.problems[0].managedByScope).toBeUndefined()
    expect(result.problems[1]).toEqual(expect.objectContaining({ managedBySourceKey: key('claim'), managedByDate: '2026-02-01' }))
    expect(result.problems[2]).toEqual(expect.objectContaining({ managedBySourceKey: key('creat'), managedByDate: '2026-04-10' }))
    expect(result.problems[2].managedByScope).toBeUndefined()
  })

  it('writes a lab metric from the cited records, never the model\'s numbers', () => {
    const labData = {
      observations: [
        { id: 'a1c-old', code: { text: 'HbA1c' }, effectiveDateTime: '2026-01-10', valueQuantity: { value: 6.6, unit: '%' } },
        { id: 'a1c-new', code: { text: 'HbA1c' }, effectiveDateTime: '2026-04-18', valueQuantity: { value: 7.1, unit: '%' } },
        { id: 'egfr', code: { text: 'eGFR' }, effectiveDateTime: '2026-04-18', valueQuantity: { value: 32, unit: 'mL/min/1.73m2' } },
      ],
      diagnosticReports: [{
        id: 'us-1', code: { text: 'Abdominal ultrasound' }, effectiveDateTime: '2026-03-01', conclusion: 'Fatty liver.',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
      }],
    } as any
    const labCatalog = buildSourceCatalog(labData)
    const key = (id: string) => labCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // The model typed 9.9% against records that say 6.6% then 7.1%.
        { label: 'Type 2 DM', kind: 'lab', basisSources: [key('a1c-new')], metric: 'HbA1c 9.9%', metricSources: [key('a1c-new'), key('a1c-old')] },
        { label: 'CKD', kind: 'lab', basisSources: [key('egfr')], metric: 'eGFR 99', metricSources: [key('egfr')] },
        // An imaging statement has no lab value to write from: the line stays.
        { label: 'Fatty liver', kind: 'other', basisSources: [key('us-1')], metric: 'Fatty liver on US', metricSources: [key('us-1')] },
      ],
    }, labCatalog, { clinicalData: labData, audience: 'medical', locale: 'zh-TW' })

    expect(result.problems[0]).toEqual(expect.objectContaining({
      metric: 'HbA1c 6.6 → 7.1%',
      metricMeta: '2026-01-10 → 2026-04-18',
    }))
    expect(result.problems[1].metric).toBe('eGFR 32')
    expect(result.problems[2].metric).toBe('Fatty liver on US')
  })

  it('never names a pharmacy as the organization following a problem', () => {
    const pharmacyData = {
      encounters: [{ id: 'clinic-visit', type: [{ text: '門診' }], period: { start: '2026-01-02' }, serviceProvider: { display: '示範甲診所;門診' } }],
      medications: [{
        id: 'dispensed', authoredOn: '2026-01-23', status: 'completed',
        medicationCodeableConcept: { text: 'Trajenta Duo 2.5/850mg' }, requester: { display: '示範甲藥局;藥局' },
      }],
      observations: [{
        id: 'checkup-glucose', code: { text: 'Glucose AC' }, effectiveDateTime: '2026-01-02',
        valueQuantity: { value: 158, unit: 'mg/dL' }, performer: [{ display: '雲端懷爾抓抓（系統產生）' }],
      }],
    } as any
    const pharmacyCatalog = buildSourceCatalog(pharmacyData)
    const key = (id: string) => pharmacyCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // The row cites the clinic visit: that clinic follows it.
        { label: 'T2DM', kind: 'other', basisSources: [key('clinic-visit')], managedBy: '示範甲藥局', managedByRef: key('dispensed'), medicationSources: [key('dispensed')] },
        // Only the pharmacy's dispensing: no prescriber is guessed.
        { label: 'Dyslipidemia', kind: 'other', medicationSources: [key('dispensed')], managedBy: '示範甲藥局' },
        // A generated check-up summary's author is the importer, not a clinic.
        { label: 'Hyperglycemia', kind: 'lab', basisSources: [key('checkup-glucose')], managedBy: '示範甲診所' },
      ],
    }, pharmacyCatalog)

    expect(result.problems[0]).toEqual(expect.objectContaining({
      managedBy: '示範甲診所',
      managedByDate: '2026-01-02',
      managedBySourceKey: key('clinic-visit'),
    }))
    expect(result.problems[1].managedBy).toBeUndefined()
    expect(result.problems[1].managedByDate).toBeUndefined()
    expect(result.problems[2].managedBy).toBeUndefined()
    expect(result.problems[2].managedByDate).toBeUndefined()
  })

  it('keeps the model line for a cited panel or a free-text result', () => {
    const panelData = {
      observations: [
        { id: 'wbc-u', code: { text: 'WBC (urine)' }, effectiveDateTime: '2026-06-08', valueQuantity: { value: 12, unit: '/HPF' } },
        { id: 'rbc-u', code: { text: 'RBC (urine)' }, effectiveDateTime: '2026-06-08', valueQuantity: { value: 1, unit: '/HPF' } },
        { id: 'culture', code: { text: 'Sputum culture' }, effectiveDateTime: '2026-08-14', valueString: '檢體編號 123 報告日期 2026-08-16 Klebsiella pneumoniae heavy growth; Streptococcus anginosus' },
      ],
      diagnosticReports: [{
        id: 'ua', code: { text: 'Urinalysis' }, effectiveDateTime: '2026-06-08',
        result: [{ reference: 'Observation/wbc-u' }, { reference: 'Observation/rbc-u' }],
      }],
    } as any
    const panelCatalog = buildSourceCatalog(panelData)
    const key = (id: string) => panelCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'Pyuria', kind: 'lab', basisSources: [key('ua')], metric: 'Urine WBC 12/HPF', metricSources: [key('ua')] },
        { label: 'Pneumonia', kind: 'lab', basisSources: [key('culture')], metric: 'Sputum: Klebsiella', metricSources: [key('culture')] },
      ],
    }, panelCatalog, { clinicalData: panelData, audience: 'medical', locale: 'zh-TW' })

    expect(result.problems[0].metric).toBe('Urine WBC 12/HPF')
    expect(result.problems[1].metric).toBe('Sputum: Klebsiella')
  })

  it('infers a refill\'s prescribing visit from its diagnosis code and timing', () => {
    const icd = (code: string) => [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] }]
    const refill = (id: string, date: string, code: string) => ({
      id, authoredOn: date, status: 'completed', reasonCode: icd(code),
      medicationCodeableConcept: { text: `Drug ${id}` }, requester: { display: '示範甲藥局;藥局' },
    })
    const refillData = {
      encounters: [
        { id: 'dm-visit', type: [{ text: '門診' }], reasonCode: icd('E11.9'), period: { start: '2026-01-02' }, serviceProvider: { display: '示範甲診所' } },
        { id: 'old-visit', type: [{ text: '門診' }], reasonCode: icd('I10'), period: { start: '2025-09-01' }, serviceProvider: { display: '示範丙診所' } },
      ],
      medications: [
        refill('dm-refill', '2026-01-23', 'E11.9'),
        refill('htn-refill', '2026-01-23', 'I10'),
        refill('gout-refill', '2026-01-23', 'M10.9'),
      ],
    } as any
    const refillCatalog = buildSourceCatalog(refillData)
    const key = (id: string) => refillCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // Same code 21 days earlier at a clinic: that visit wrote it.
        { label: 'T2DM', kind: 'diagnosis', medicationSources: [key('dm-refill')], managedBy: '示範甲藥局' },
        // The only same-code visit is 144 days earlier: not this prescription.
        { label: 'Hypertension', kind: 'diagnosis', medicationSources: [key('htn-refill')], managedBy: '示範甲藥局' },
        // No visit with the refill's code at all.
        { label: 'Gout', kind: 'diagnosis', medicationSources: [key('gout-refill')], managedBy: '示範甲藥局' },
      ],
    }, refillCatalog, { clinicalData: refillData })

    expect(result.problems[0]).toEqual(expect.objectContaining({
      managedBy: '示範甲診所',
      managedByDate: '2026-01-02',
      managedBySourceKey: key('dm-visit'),
      managedByScope: 'inferred',
    }))
    for (const problem of result.problems.slice(1)) {
      expect(problem.managedBy).toBeUndefined()
      expect(problem.managedByDate).toBeUndefined()
    }
  })

  it('finds a refill\'s origin in the hospital\'s own prescription when the visit is outside the window', () => {
    const icd = (code: string) => [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] }]
    const eyeData = {
      // P3 (2026-10-03): the 02-13 eye visit is outside the AI window, but the
      // hospital dispensed the same prescription that day.
      medications: [
        { id: 'hosp-fill', authoredOn: '2026-02-20', status: 'completed', reasonCode: icd('H40.11'), medicationCodeableConcept: { text: 'Demo eye drops' }, requester: { display: '臺北榮總;門診' } },
        { id: 'refill', authoredOn: '2026-04-07', status: 'completed', reasonCode: icd('H40.11'), medicationCodeableConcept: { text: 'Demo eye drops' }, requester: { display: '示範乙藥局;藥局' } },
      ],
    } as any
    const eyeCatalog = buildSourceCatalog(eyeData)
    const key = (id: string) => eyeCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'Glaucoma', kind: 'medication', basisSources: [key('refill')], medicationSources: [key('refill')], managedBy: '臺北榮總' }],
    }, eyeCatalog, { clinicalData: eyeData })
    expect(result.problems[0]).toEqual(expect.objectContaining({
      managedBy: '臺北榮總',
      managedByDate: '2026-02-20',
      managedBySourceKey: key('hosp-fill'),
      managedByScope: 'inferred',
    }))
  })

  it('shows every medication-only problem tagged as inferred, and counts it', () => {
    const med = (id: string, atcCode: string) => ({
      id, authoredOn: '2026-06-01', status: 'active', medicationCodeableConcept: { text: `Drug ${id}` },
      requester: { display: '甲醫學中心' }, drugTerminology: { atcCode },
    })
    const medData = {
      medications: [med('linagliptin', 'A10BD11'), med('dapagliflozin', 'A10BK01'), med('denosumab', 'M05BX04')],
    } as any
    const medCatalog = buildSourceCatalog(medData)
    const key = (id: string) => medCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'Type 2 diabetes mellitus', kind: 'medication', basisSources: [key('linagliptin')] },
        // The model's judgement, not a deny list: shown, tagged, counted.
        { label: 'Heart failure', kind: 'medication', basisSources: [key('dapagliflozin')] },
        { label: 'Osteoporosis', kind: 'medication', basisSources: [key('denosumab')] },
      ],
    }, medCatalog, { clinicalData: medData, strictGrounding: true })
    expect(result.problems).toHaveLength(3)
    expect(result.problems.every((problem) => problem.inferredFromMedication)).toBe(true)
    expect(result.medicationInference).toEqual({ inferred: 3, atcClasses: ['A10B', 'M05B'] })
  })

  it('states the medication-inference guidance in both harnesses', () => {
    const promptInput = {
      clinicalContext: '[E1] 內分泌科門診',
      catalog: buildSourceCatalog(CATALOG_INPUT),
      locale: 'zh-TW' as const,
      audience: 'medical' as const,
    }
    const frontier = useCase.buildBatchModuleMessages(promptInput)[0].content
    const local = useCase.buildBatchModuleMessages({ ...promptInput, harnessProfile: 'local-small' })[0].content
    for (const content of [frontier, local]) {
      expect(content).toContain('when that class points to one condition')
      expect(content).toContain('Be careful with classes that serve several conditions')
    }
  })

  it('names serial eGFR values briefly, one series per method', () => {
    const egfr = (id: string, date: string, value: number, loinc: string, text: string) => ({
      id, effectiveDateTime: date, valueQuantity: { value, unit: 'mL/min/1.73m2' },
      code: { text, coding: [{ system: 'http://loinc.org', code: loinc }] },
    })
    const egfrData = {
      observations: [
        egfr('epi-1', '2026-05-25', 32.7, '62238-1', '腎絲球過濾率(新) ;(eGFR-CKD-EPI)'),
        egfr('epi-2', '2026-06-02', 31.68, '62238-1', 'eGFR 腎絲球過濾率(CKD-EPI)'),
        egfr('epi-3', '2026-06-02', 30.1, '62238-1', '腎絲球過濾率(新) ;(eGFR-CKD-EPI)'),
        egfr('bare', '2026-06-02', 32, '69405-9', 'Estimated GFR'),
        { id: 'odd', effectiveDateTime: '2026-06-02', valueQuantity: { value: 3, unit: 'U' }, code: { text: '某院特殊檢驗 ;(Zeta assay)' } },
      ],
    } as any
    const egfrCatalog = buildSourceCatalog(egfrData)
    const key = (id: string) => egfrCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'CKD', kind: 'lab', basisSources: [key('epi-1')], metric: 'eGFR 99', metricSources: [key('epi-1'), key('epi-2'), key('bare')] },
        { label: 'Odd', kind: 'lab', basisSources: [key('odd')], metric: 'x', metricSources: [key('odd')] },
      ],
    }, egfrCatalog, { clinicalData: egfrData, audience: 'medical', locale: 'zh-TW' })

    expect(result.problems[0].metric).toBe('eGFR (CKD-EPI) 32.7 → 31.68; eGFR 32')

    const sameDay = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'CKD', kind: 'lab', basisSources: [key('epi-1')], metric: 'x', metricSources: [key('epi-2'), key('epi-1'), key('epi-3')] }],
    }, egfrCatalog, { clinicalData: egfrData, audience: 'medical', locale: 'zh-TW' })
    // Two orders of one day stand side by side; only a later day earns an arrow.
    expect(sameDay.problems[0].metric).toBe('eGFR (CKD-EPI) 32.7 → 31.68')
    expect(result.problems[1].metric).toBe('Zeta assay 3 U')
  })

  it('dates a row from the latest visit with the same diagnosis, not only the one it cites', () => {
    const hospital = { display: '新北市聯醫' }
    const visitData = {
      encounters: [
        { id: 'thyroid-old', type: [{ text: '門診' }], reasonCode: [{ text: '甲狀腺疾患' }], period: { start: '2026-06-08' }, serviceProvider: hospital },
        { id: 'thyroid-new', type: [{ text: '門診' }], reasonCode: [{ text: '甲狀腺疾患' }], period: { start: '2026-08-05' }, serviceProvider: hospital },
        { id: 'other', type: [{ text: '門診' }], reasonCode: [{ text: '急性鼻咽炎' }], period: { start: '2026-09-01' }, serviceProvider: hospital },
      ],
    } as any
    const visitCatalog = buildSourceCatalog(visitData)
    const key = (id: string) => visitCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'Thyroid disorder', kind: 'diagnosis', basisSources: [key('thyroid-old')], managedBy: '新北市聯醫', managedByRef: key('thyroid-old') }],
    }, visitCatalog)
    expect(result.problems[0]).toEqual(expect.objectContaining({ managedBySourceKey: key('thyroid-new'), managedByDate: '2026-08-05' }))
  })

  it('lets a model metric draw a trend only where its records carry one (Codex 2026-10-03)', () => {
    const rad = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]
    const trendData = {
      diagnosticReports: [
        { id: 'pwv', code: { text: '動脈硬化檢查 baPWV' }, effectiveDateTime: '2026-06-08', conclusion: 'baPWV R 1544, L 1547' },
        { id: 'ct', code: { text: '電腦斷層造影' }, category: rad, effectiveDateTime: '2025-11-25', conclusion: 'Cyst 6.4x5.9 cm' },
        { id: 'us', code: { text: '其他超音波' }, category: rad, effectiveDateTime: '2025-12-24', conclusion: 'Cyst 5.5x4.5 cm' },
        { id: 'us-2', code: { text: '其他超音波' }, category: rad, effectiveDateTime: '2026-03-01', conclusion: 'Cyst 4.0x3.0 cm' },
      ],
    } as any
    const trendCatalog = buildSourceCatalog(trendData)
    const key = (id: string) => trendCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // P4 L12: right and left of one study read as a change.
        { label: 'Arterial stiffness', kind: 'other', basisSources: [key('pwv')], metric: 'baPWV 1544 → 1547 cm/s', metricSources: [key('pwv')] },
        // P2 L36/L32: a CT and an ultrasound, the later date written first.
        { label: 'Pelvic cyst', kind: 'other', basisSources: [key('ct')], metric: '5.5×4.5 cm (12/24/2025) → 6.4×5.9 cm (11/25/2025)', metricSources: [key('us'), key('ct')] },
        // Two ultrasounds on different dates, in order: a real trend.
        { label: 'Pelvic cyst (US)', kind: 'other', basisSources: [key('us')], metric: '5.5×4.5 → 4.0×3.0 cm', metricSources: [key('us'), key('us-2')] },
      ],
    }, trendCatalog, { clinicalData: trendData })

    expect(result.problems[0]).toEqual(expect.objectContaining({ metric: 'baPWV 1544；1547 cm/s', metricNeedsReview: true }))
    expect(result.problems[1]).toEqual(expect.objectContaining({
      metric: '6.4×5.9 cm (11/25/2025)；5.5×4.5 cm (12/24/2025)',
      metricNeedsReview: true,
    }))
    expect(result.problems[2].metric).toBe('5.5×4.5 → 4.0×3.0 cm')
    expect(result.problems[2].metricNeedsReview).toBeUndefined()
  })

  it('checks a legacy row\'s arrow against the row\'s own lab and report records', () => {
    const rad = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]
    const legacyData = {
      encounters: [{ id: 'visit', type: [{ text: '門診' }], period: { start: '2026-06-02' }, serviceProvider: { display: '示範長青醫院' } }],
      diagnosticReports: [
        { id: 'ct', code: { text: '電腦斷層造影' }, category: rad, effectiveDateTime: '2025-11-25', conclusion: 'Cyst 6.4x5.9 cm' },
        { id: 'us', code: { text: '其他超音波' }, category: rad, effectiveDateTime: '2025-12-24', conclusion: 'Cyst 5.5x4.5 cm' },
        { id: 'us-2', code: { text: '其他超音波' }, category: rad, effectiveDateTime: '2026-03-01', conclusion: 'Cyst 4.0x3.0 cm' },
      ],
    } as any
    const legacyCatalog = buildSourceCatalog(legacyData)
    const key = (id: string) => legacyCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        // A cached result from before per-column citations: the visit does
        // not stop two ultrasounds from carrying a trend.
        { label: 'Pelvic cyst (US)', kind: 'other', metric: '5.5×4.5 → 4.0×3.0 cm', sources: [key('us'), key('us-2'), key('visit')] },
        { label: 'Pelvic cyst', kind: 'other', metric: '6.4×5.9 → 5.5×4.5 cm', sources: [key('ct'), key('us'), key('visit')] },
      ],
    }, legacyCatalog, { clinicalData: legacyData })

    expect(result.problems[0].metric).toBe('5.5×4.5 → 4.0×3.0 cm')
    expect(result.problems[0].metricNeedsReview).toBeUndefined()
    expect(result.problems[1].metricNeedsReview).toBe(true)
  })

  it('flags each app-written metric value by its own record: source flag first, then the reference range', () => {
    const tg = (id: string, date: string, value: number, extra: object = {}) => ({
      id, status: 'final', effectiveDateTime: date, valueQuantity: { value, unit: 'mg/dL' },
      code: { text: 'Triglyceride', coding: [{ system: 'http://loinc.org', code: '2571-8' }] }, ...extra,
    })
    const labData = {
      observations: [
        tg('t1', '2026-01-01', 467, { interpretation: [{ coding: [{ code: 'H' }] }] }),
        tg('t2', '2026-03-01', 256, { referenceRange: [{ low: { value: 0, unit: 'mg/dL' }, high: { value: 150, unit: 'mg/dL' } }] }),
        tg('t3', '2026-06-01', 103, { interpretation: [{ coding: [{ code: 'N' }] }] }),
      ],
    } as any
    const labCatalog = buildSourceCatalog(labData)
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'Hypertriglyceridemia', kind: 'lab', metricSources: labCatalog.map((entry) => entry.key) }],
    }, labCatalog, { clinicalData: labData })
    const problem = result.problems[0]
    expect(problem.metricSegments?.map((segment) => segment.text).join('')).toBe(problem.metric)
    expect(problem.metricSegments?.filter((segment) => segment.abnormal)).toEqual([
      { text: '467', abnormal: 'high' },
      { text: '256', abnormal: 'high' },
    ])
  })

  it('writes eGFR without a unit, so differently spelled units stay one series', () => {
    const egfr = (id: string, date: string, value: number, unit: string) => ({
      id, status: 'final', effectiveDateTime: date, valueQuantity: { value, unit },
      code: { text: 'eGFR', coding: [{ system: 'http://loinc.org', code: '33914-3' }] },
    })
    const labData = { observations: [egfr('e1', '2026-08-03', 37.5, 'ml/min/1.7'), egfr('e2', '2026-08-20', 52.5, 'mL/min/1.73m²')] } as any
    const labCatalog = buildSourceCatalog(labData)
    const result = useCase.finalizeResult({ ...empty, problems: [{ label: 'CKD', kind: 'lab', metricSources: labCatalog.map((entry) => entry.key) }] }, labCatalog, { clinicalData: labData })
    expect(result.problems[0].metric).toMatch(/^eGFR.* 37\.5 → 52\.5$/)
  })

  it('keeps one eGFR a day, the first record, and every same-day value of other tests', () => {
    const obs = (id: string, text: string, code: string, date: string, value: number, unit: string) => ({
      id, status: 'final', effectiveDateTime: date, valueQuantity: { value, unit }, code: { text, coding: [{ system: 'http://loinc.org', code }] },
    })
    const labData = {
      observations: [
        obs('e-lab', 'eGFR', '33914-3', '2026-08-03', 37.6, 'mL/min/1.73m2'),
        obs('e-nhi', 'eGFR', '33914-3', '2026-08-03', 37.9, 'mL/min/1.73m2'),
        obs('k-am', 'Potassium', '2823-3', '2026-08-03', 3.2, 'mmol/L'),
        obs('k-pm', 'Potassium', '2823-3', '2026-08-03', 2.8, 'mmol/L'),
      ],
    } as any
    const labCatalog = buildSourceCatalog(labData)
    const key = (id: string) => labCatalog.find((entry) => entry.resourceId === id)!.key
    const metric = (ids: string[]) => useCase.finalizeResult({ ...empty, problems: [{ label: 'x', kind: 'lab', metricSources: ids.map(key) }] }, labCatalog, { clinicalData: labData }).problems[0].metric
    expect(metric(['e-nhi', 'e-lab'])).toMatch(/^eGFR.* 37\.6$/)
    expect(metric(['k-am', 'k-pm'])).toMatch(/3\.2 \/ 2\.8 mmol\/L$/)
  })

  it('writes no segments when no value is flagged', () => {
    const labData = { observations: [{ id: 'n', status: 'final', effectiveDateTime: '2026-01-01', valueQuantity: { value: 5.4, unit: '%' }, code: { text: 'HbA1c' }, interpretation: [{ coding: [{ code: 'N' }] }] }] } as any
    const labCatalog = buildSourceCatalog(labData)
    const result = useCase.finalizeResult({ ...empty, problems: [{ label: 'x', kind: 'lab', metricSources: [labCatalog[0].key] }] }, labCatalog, { clinicalData: labData })
    expect(result.problems[0].metricSegments).toBeUndefined()
  })

  it('writes each cited medicine as an item: the drug master short name, the record name kept', () => {
    const medData = {
      medications: [
        { id: 'm-1', status: 'active', authoredOn: '2026-08-01', medicationCodeableConcept: { text: 'DEMO-TRAMED CAPSULES 50MG "SYNTH"' }, drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText: 'TRAMADOL HCL 50 MG' } },
        { id: 'm-2', status: 'active', authoredOn: '2026-08-01', medicationCodeableConcept: { text: 'Demo Plain Tablet' } },
        { id: 'm-3', status: 'active', authoredOn: '2026-07-01', medicationCodeableConcept: { text: 'DEMO-TRAMED CAPSULES 50MG "SYNTH"' }, drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', ingredientText: 'TRAMADOL HCL 50 MG' } },
      ],
    } as any
    const medCatalog = buildSourceCatalog(medData)
    const key = (id: string) => medCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'Pain', kind: 'medication', medicationSources: [key('m-1'), key('m-2'), key('m-3')] }],
    }, medCatalog, { clinicalData: medData })
    expect(result.problems[0].medicationItems).toEqual([
      { key: key('m-1'), name: 'Tramadol HCl 50 mg', fullName: expect.stringContaining('DEMO-TRAMED') },
      { key: key('m-2'), name: 'Demo Plain Tablet', fullName: 'Demo Plain Tablet' },
    ])
  })

  it('keeps a medicine whose class treats something else on the row, tagged for review', () => {
    const med = (id: string, text: string, atcCode: string) => ({
      id, status: 'active', authoredOn: '2026-08-27', medicationCodeableConcept: { text },
      drugTerminology: { source: 'nhi-official-drug-master', snapshotId: 's', atcCode },
    })
    const medData = {
      medications: [
        med('eye', 'DEMO-XALA EYE DROPS', 'S01EE01'),
        med('dementia', 'DEMO-DONE TABLETS 5MG', 'N06DA02'),
      ],
    } as any
    const medCatalog = buildSourceCatalog(medData)
    const key = (id: string) => medCatalog.find((entry) => entry.resourceId === id)!.key
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: 'Primary open-angle glaucoma', kind: 'diagnosis', medicationSources: [key('eye'), key('dementia')] }],
    }, medCatalog, { clinicalData: medData })
    expect(result.problems[0].medicationItems?.map((item) => item.key)).toEqual([key('eye'), key('dementia')])
    expect(result.problems[0].medicationReviewKeys).toEqual([key('dementia')])
  })

  it('leaves the metric empty for N/A, a medicine name, a code or a visit date', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'x', kind: 'other', basisSources: ['C1'], metric: 'N/A' },
        { label: 'y', kind: 'other', basisSources: ['C1'], metric: '—' },
        { label: 'z', kind: 'other', basisSources: ['C1'], metric: 'None reported' },
        // A medicine is not a value (a furosemide written on a pneumonia row).
        { label: 'w', kind: 'other', basisSources: ['C1'], metric: 'Metformin 500mg (2026-05-30)' },
        // Codes and visit dates belong to the basis and managing columns.
        { label: 'v', kind: 'other', basisSources: ['C1'], metric: 'Billing codes N40.0 (2026-06-02, 2026-06-16)' },
        { label: 'u', kind: 'other', basisSources: ['C1'], metric: 'ICD-10 F31.0 on 2026-06-04' },
        { label: 't', kind: 'other', basisSources: ['C1'], metric: 'Last visit 2026-07-01' },
        // A real finding stays.
        { label: 's', kind: 'other', basisSources: ['C1'], metric: 'PSA 1.49 ng/mL' },
      ],
    }, catalog)
    expect(result.problems.map((problem) => problem.metric)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'PSA 1.49 ng/mL'])
  })

  it('accepts a single column key written as a bare string', () => {
    const parsed = useCase.parseModuleResult('problems', JSON.stringify({
      problems: [{ label: 'CKD stage 3b', basisSources: 'C1', metricSources: ['L1'] }],
    }))
    expect(parsed?.problems[0]).toEqual(expect.objectContaining({ basisSources: ['C1'], metricSources: ['L1'] }))
  })

  it('numbers sources in render order: education → problems', () => {
    const result = useCase.finalizeResult({
      ...empty,
      medicationEducation: [
        { name: 'Metformin', benefit: '協助控制血糖', attention: '隨餐服用', sources: ['M1'] },
      ],
      problems: [{ label: '第2型糖尿病', kind: 'careplan', sources: ['C1', 'M1'] }],
    }, catalog, { audience: 'patient' })

    expect(result.sourceIndex.map((source) => source.key)).toEqual(['M1', 'C1'])
  })

  it('normalises an off-list problem kind', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{ label: '第2型糖尿病', kind: 'claim', sources: ['C1'] }],
    }, catalog)
    expect(result.problems[0].kind).toBe('other')
  })

  it('flags problem citations whose report type contradicts the stated basis', () => {
    const ecgCatalog = buildSourceCatalog({
      ...CATALOG_INPUT,
      diagnosticReports: [
        { id: 'rep-1', code: { text: '胸部X光' }, effectiveDateTime: '2026-04-18' },
        { id: 'rep-2', code: { text: '心電圖' }, effectiveDateTime: '2026-04-17' },
      ],
    })
    const result = useCase.finalizeResult({
      ...empty,
      problems: [{
        label: '心律不整',
        basis: '依據:心電圖紀錄',
        kind: 'lab',
        sources: ['L1', 'L2'],
      }],
    }, ecgCatalog)

    // L1 is the chest film — shown, but marked suspect; L2 (the ECG) is clean.
    expect(result.problems[0].suspectSourceKeys).toEqual(['L1'])
  })

  it('finalizes patient medication education and requires a verified medication record', () => {
    const result = useCase.finalizeResult({
      ...empty,
      medicationEducation: [
        { name: 'Metformin', benefit: '協助控制血糖', attention: '隨餐服用', sources: ['M1', 'C1'] },
        { name: '沒有來源的藥', benefit: 'x', attention: 'y', sources: ['C1'] },
      ],
    }, catalog, { audience: 'patient' })

    expect(result.medicationEducation).toHaveLength(1)
    expect(result.medicationEducation[0].sourceKeys).toEqual(['M1', 'C1'])
  })

  it('strictly grounds patient medication education and uses a generic reminder', () => {
    const result = useCase.finalizeResult({
      ...empty,
      medicationEducation: [
        { name: 'Metformin', benefit: '血糖控制不佳時使用', attention: '自行加量', sources: ['M1'] },
      ],
    }, catalog, { audience: 'patient', locale: 'zh-TW', strictGrounding: true })

    expect(result.medicationEducation[0].benefit).toContain('請向醫師或藥師確認')
    expect(result.medicationEducation[0].attention).toContain('請依醫囑使用')
  })

  it('keeps a medication-only problem under strict grounding, tagged as inferred (owner decision 2026-10-03)', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: '糖尿病', basis: '用藥推斷', kind: 'medication', sources: ['M1'] },
        { label: '第2型糖尿病', basis: '照護計畫', kind: 'careplan', sources: ['C1'] },
      ],
    }, catalog, { strictGrounding: true })

    expect(result.problems.map((problem) => [problem.label, problem.inferredFromMedication ?? false])).toEqual([
      ['糖尿病', true],
      ['第2型糖尿病', false],
    ])
  })

  it('keeps a single unassessed lab problem under strict grounding, tagged as a single value', () => {
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'Hyperglycemia', kind: 'lab', basisSources: ['L1'] },
        { label: 'Ghost', kind: 'lab', basisSources: ['Z9'] },
      ],
    }, catalog, { strictGrounding: true })
    // A row citing nothing real is still removed.
    expect(result.problems.map((problem) => [problem.label, problem.singleUnassessedLab ?? false])).toEqual([['Hyperglycemia', true]])
  })

  it('tags a chronic disease named from values spanning under three months, and keeps it', () => {
    const lab = (key: string, date: string) => ({
      key, resourceType: 'DiagnosticReport', resourceId: `r-${key}`, display: 'eGFR', date, supportsNormalityAssessment: true,
    })
    const labs = [lab('L1', '2026-05-25'), lab('L2', '2026-05-31'), lab('L3', '2025-11-01')]
    const result = useCase.finalizeResult({
      ...empty,
      problems: [
        { label: 'Chronic kidney disease, stage 3b', kind: 'lab', basisSources: ['L1', 'L2'] },
        { label: 'Chronic kidney disease, stage 3a', kind: 'lab', basisSources: ['L3', 'L2'] },
        { label: 'Reduced eGFR, chronicity undetermined', kind: 'lab', basisSources: ['L1', 'L2'] },
      ],
    }, labs, { strictGrounding: true })
    expect(result.problems.map((problem) => [problem.label, problem.shortSpanChronic ?? false])).toEqual([
      ['Chronic kidney disease, stage 3b', true],
      ['Chronic kidney disease, stage 3a', false],
      ['Reduced eGFR, chronicity undetermined', false],
    ])
  })

  it('removes unsupported assessment language from a strictly-grounded headline', () => {
    const result = useCase.finalizeResult(
      { ...empty, headline: '病人狀況穩定，血糖控制不佳，建議調整用藥' },
      catalog,
      { strictGrounding: true, locale: 'zh-TW' },
    )
    expect(result.headline).not.toContain('控制不佳')
    expect(result.headline).not.toContain('調整用藥')
  })
})

describe('local zh-TW prose guards', () => {
  const catalog = buildSourceCatalog(CATALOG_INPUT)

  it('repairs Simplified prose but keeps medicine names verbatim', () => {
    const ai = {
      headline: '血糖控制记录',
      problems: [{ label: '糖尿病', basis: '多次检验', kind: 'diagnosis', sources: ['E1'] }],
      medicationEducation: [{ name: '测试药名', benefit: '控制血糖', attention: '注意低血糖', sources: ['M1'] }],
    }
    const result = useCase.finalizeResult(ai as never, catalog, { locale: 'zh-TW', audience: 'patient' })
    expect(result.headline).toBe('血糖控制記錄')
    expect(result.problems[0]?.basis).toBe('多次檢驗')
    expect(result.medicationEducation[0]?.name).toBe('测试药名')
    const en = useCase.finalizeResult(ai as never, catalog, { locale: 'en' })
    expect(en.headline).toBe('血糖控制记录')
    // Clinician prose is English; the Traditional backstop does not touch it.
    const medical = useCase.finalizeResult(ai as never, catalog, { locale: 'zh-TW', audience: 'medical' })
    expect(medical.headline).toBe('血糖控制记录')
  })

  it('accepts short verbatim Chinese quotes but not short Latin fragments', () => {
    expect(verifyDocumentQuote('疑似肺炎', '入院診斷：疑似肺炎。').verification).toBe('exact')
    expect(verifyDocumentQuote('肺炎', '入院診斷：疑似肺炎。').verification).toBe('not-found')
    expect(verifyDocumentQuote('R/O PE', 'Impression: R/O PE').verification).toBe('not-found')
  })

  it('local prompt states record-date, certainty and chart-English rules', () => {
    const input = { clinicalContext: 'ctx', catalog, locale: 'zh-TW', audience: 'medical', harnessProfile: 'local-small' } as never
    const messages = useCase.buildRegisteredCardBatchMessages(
      input,
      registeredMedicalSummaryCards(input)
        .filter((card) => card.id !== 'reports')
        .map((card) => card.buildBatchInstruction(input)),
    )
    expect(messages[0].content).toContain('Dates, organizations and encounter types are supplied by the app')
    expect(messages[0].content).toContain('Never upgrade a suspected')
    expect(messages[0].content).toContain('OUTPUT LANGUAGE: ENGLISH (MANDATORY)')
    expect(messages[0].content).toContain('Name a coded diagnosis as the diagnosis-code rule above allows')
  })
})


describe('problems module tolerates a medication list array', () => {
  it('joins problems.medications when a model sends an array instead of a string', () => {
    const parsed = new GenerateMedicalSummaryUseCase().parseModuleResult(
      'problems',
      '{"problems": [{"label": "慢性腎臟病", "basis": "檢驗", "kind": "lab", "medications": ["Drug A 10mg", "Drug B 80mg"], "sources": ["O1"]}]}',
    )
    expect(parsed?.problems[0].medications).toBe('Drug A 10mg、Drug B 80mg')
  })
})
