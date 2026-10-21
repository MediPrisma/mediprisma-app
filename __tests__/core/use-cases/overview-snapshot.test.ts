// The overview snapshot is the fast lane's whole promise: a request whose size
// is set by the code, not by the patient. These tests pin the parts that make
// that promise true — the caps, the "+N more" disclosure, the trim ladder, the
// catalog subset, and the windows measured against the data's own newest date.
import {
  buildOverviewSnapshot,
  OVERVIEW_SNAPSHOT_TOKEN_BUDGET,
} from '@/src/core/use-cases/medical-summary/overview-snapshot'
import {
  buildSourceCatalog,
  type SummaryCatalogInput,
} from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { estimateTokens } from '@/src/shared/utils/token-estimator'

const NOW = Date.parse('2026-04-30T00:00:00Z')

const options = { nowMs: NOW, locale: 'zh-TW' as const }

const build = (input: SummaryCatalogInput, overrides: Partial<typeof options> & { tokenBudget?: number } = {}) => {
  const catalog = buildSourceCatalog(input)
  return buildOverviewSnapshot({ clinicalData: input, catalog }, { ...options, ...overrides })
}

describe('buildOverviewSnapshot', () => {
  it('states gender and age against the newest record the data carries', () => {
    const input: SummaryCatalogInput = {
      encounters: [{ id: 'e1', class: { code: 'AMB' }, period: { start: '2026-04-20' } } as never],
    }
    const snapshot = buildOverviewSnapshot(
      {
        clinicalData: input,
        catalog: buildSourceCatalog(input),
        patient: { gender: 'female', birthDate: '1958-06-01' },
      },
      options,
    )
    expect(snapshot.clinicalContext).toContain('## Patient')
    // Newest record is 2026-04-20, before the birthday → 67, not 68.
    expect(snapshot.clinicalContext).toContain('female, 67 y')
  })

  it('lists Encounter.reasonCode diagnoses as the visits\' primary diagnosis with a count and the latest date', () => {
    const input: SummaryCatalogInput = {
      encounters: [
        { id: 'e1', class: { code: 'AMB' }, period: { start: '2026-04-20' }, reasonCode: [{ text: '第二型糖尿病' }] },
        { id: 'e2', class: { code: 'AMB' }, period: { start: '2026-01-04' }, reasonCode: [{ text: '第二型糖尿病' }] },
      ] as never,
      conditions: [{ id: 'c1', code: { text: '慢性腎臟病' }, recordedDate: '2026-03-01' } as never],
    }
    const snapshot = build(input)
    expect(snapshot.clinicalContext).toContain('- 慢性腎臟病 (2026-03-01) [C1]')
    expect(snapshot.clinicalContext).toContain('- 第二型糖尿病 — primary diagnosis, 2 visits, last 2026-04-20 [E1]')
  })

  it('groups and ranks a zh-TW visit diagnosis by its ICD coding, not its Chinese name', () => {
    const icd = (code: string, display: string) => [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code, display }] }]
    const input: SummaryCatalogInput = {
      encounters: [
        { id: 'eye', class: { code: 'AMB' }, period: { start: '2026-04-20' }, reasonCode: icd('H10.43', '雙側眼慢性結膜炎') },
        { id: 'ca-1', class: { code: 'AMB' }, period: { start: '2026-02-12' }, reasonCode: icd('C61', '攝護腺惡性腫瘤') },
        { id: 'ca-2', class: { code: 'AMB' }, period: { start: '2025-11-12' }, reasonCode: icd('C61', '攝護腺惡性腫瘤') },
      ] as never,
    }
    const lines = build(input).clinicalContext.split('\n').filter((line) => line.startsWith('- ') && line.includes('primary diagnosis'))
    expect(lines[0]).toContain('攝護腺惡性腫瘤 — primary diagnosis, 2 visits')
    expect(lines[1]).toContain('雙側眼慢性結膜炎')
  })

  it('lists a claims-feed medicine whose only evidence is a live supply window', () => {
    // The NHI bridge leaves status at `unknown`; the days-supply is the evidence.
    const input: SummaryCatalogInput = {
      medications: [
        {
          id: 'm1',
          status: 'unknown',
          authoredOn: '2026-04-20',
          medicationCodeableConcept: { text: 'Metformin 500mg' },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd' } },
        },
        {
          id: 'm2',
          status: 'unknown',
          authoredOn: '2025-01-02',
          medicationCodeableConcept: { text: 'Old drug' },
          dispenseRequest: { expectedSupplyDuration: { value: 7, unit: 'd' } },
        },
      ] as never,
    }
    const snapshot = build(input)
    expect(snapshot.clinicalContext).toContain('Metformin 500mg')
    expect(snapshot.clinicalContext).toContain('28d supply')
    // Lapsed medicines are still listed when fewer than five are current — but marked.
    expect(snapshot.clinicalContext).toContain('Old drug')
    expect(snapshot.clinicalContext).toMatch(/Old drug.*supply ended/)
  })

  it('discloses a capped section instead of silently dropping its tail', () => {
    const input: SummaryCatalogInput = {
      conditions: Array.from({ length: 26 }, (_, index) => ({
        id: `c${index}`,
        code: { text: `診斷 ${index}` },
        recordedDate: `2026-04-${String(index + 1).padStart(2, '0')}`,
      })) as never,
    }
    const snapshot = build(input)
    const problems = snapshot.sections.find((section) => section.id === 'problems')
    expect(problems).toMatchObject({ kept: 20, dropped: 6 })
    expect(snapshot.clinicalContext).toContain('+6 more not listed')
  })

  it('never writes allergy ABSENCE into the prompt, and lists records when present', () => {
    expect(build({}).clinicalContext).not.toContain('Allergies')
    const withAllergy = build({
      allergies: [{ id: 'a1', code: { text: 'Penicillin' }, recordedDate: '2020-02-02' }] as never,
    })
    expect(withAllergy.clinicalContext).toContain('## Allergies on record')
    expect(withAllergy.clinicalContext).toContain('- Penicillin (2020-02-02) [A1]')
  })

  it('returns only the catalog entries it cites, with their keys unchanged', () => {
    const input: SummaryCatalogInput = {
      encounters: [{ id: 'e1', class: { code: 'AMB' }, period: { start: '2026-04-20' } } as never],
      procedures: [{ id: 'p1', code: { text: '大腸鏡' }, performedDateTime: '2026-04-01' } as never],
      conditions: [{ id: 'c1', code: { text: '慢性腎臟病' }, recordedDate: '2026-03-01' } as never],
    }
    const snapshot = build(input)
    // The encounter carries no citable row here; the condition and the
    // procedure do.
    expect(snapshot.catalog.map((entry) => entry.key).sort()).toEqual(['C1', 'P1'])
    // A surviving key still means what it means in the full catalog.
    expect(snapshot.catalog.find((entry) => entry.key === 'C1')?.resourceId).toBe('c1')
  })

  it('trims documents before problems, and reports what it trimmed', () => {
    const narrative = [
      '出院診斷',
      ...Array.from({ length: 400 }, (_, index) => `Finding line number ${index} with some clinical detail.`),
      '住院治療經過',
      ...Array.from({ length: 400 }, (_, index) => `Course line number ${index} with some clinical detail.`),
      '出院指示',
      'Follow up in clinic.',
    ].join('\n')
    const input: SummaryCatalogInput = {
      encounters: [
        { id: 'e1', class: { code: 'IMP' }, period: { start: '2026-04-01', end: '2026-04-10' } },
        { id: 'e2', class: { code: 'IMP' }, period: { start: '2026-02-01', end: '2026-02-08' } },
      ] as never,
      documentReferences: [
        {
          id: 'd1',
          type: { coding: [{ code: '18842-5' }] },
          context: { period: { start: '2026-04-01' }, encounter: [{ reference: 'Encounter/e1' }] },
          content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(narrative, 'utf8').toString('base64') } }],
        },
        {
          id: 'd2',
          type: { coding: [{ code: '18842-5' }] },
          context: { period: { start: '2026-02-01' }, encounter: [{ reference: 'Encounter/e2' }] },
          content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(narrative, 'utf8').toString('base64') } }],
        },
      ] as never,
    }
    const roomy = build(input)
    expect(roomy.sections.find((section) => section.id === 'documents')).toMatchObject({ kept: 2, dropped: 0 })

    const squeezed = build(input, { tokenBudget: 500 })
    const documents = squeezed.sections.find((section) => section.id === 'documents')
    expect(documents).toMatchObject({ kept: 1, dropped: 1 })
    expect(squeezed.clinicalContext).toContain('+1 more not listed')
    expect(squeezed.estimatedTokens).toBeLessThan(roomy.estimatedTokens)
  })

  it('holds a large chart inside the default budget', () => {
    const input: SummaryCatalogInput = {
      encounters: Array.from({ length: 400 }, (_, index) => ({
        id: `e${index}`,
        class: { code: index % 20 === 0 ? 'IMP' : 'AMB' },
        period: { start: `2026-0${(index % 4) + 1}-${String((index % 28) + 1).padStart(2, '0')}` },
        reasonCode: [{ text: `申報診斷 ${index % 60}` }],
        serviceProvider: { display: `醫院 ${index % 12}` },
      })) as never,
      medications: Array.from({ length: 300 }, (_, index) => ({
        id: `m${index}`,
        status: 'unknown',
        authoredOn: '2026-04-15',
        medicationCodeableConcept: { text: `藥品 ${index} TABLETS` },
        dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd' } },
      })) as never,
      observations: Array.from({ length: 900 }, (_, index) => ({
        id: `o${index}`,
        code: { text: `分析物 ${index % 90}`, coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
        valueQuantity: { value: index % 30, unit: 'mg/dL' },
        effectiveDateTime: `2026-0${(index % 4) + 1}-${String((index % 28) + 1).padStart(2, '0')}`,
        interpretation: { coding: [{ code: 'H' }] },
      })) as never,
    }
    const snapshot = build(input)
    expect(snapshot.estimatedTokens).toBeLessThanOrEqual(OVERVIEW_SNAPSHOT_TOKEN_BUDGET)
    expect(estimateTokens(snapshot.clinicalContext)).toBe(snapshot.estimatedTokens)
    // …and it still says how much it did not list.
    expect(snapshot.clinicalContext).toContain('more not listed')
  })

  // ── Major procedures ────────────────────────────────────────────────────
  // NHI claims record nursing work as Procedures. On the real breast-cancer
  // chart this section was built against there are 67 procedure records and
  // only 14 of them are procedures a first visit needs to see.
  describe('major procedures', () => {
    const procedure = (id: string, text: string, date: string, status = 'completed') => ({
      id, status, code: { text }, performedDateTime: date,
    })

    it('omits nursing and ancillary billing rows, and keeps the operations', () => {
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', '手術、創傷處置及換藥－傷口處置', '2026-04-20'),
          procedure('p2', '大量液體點滴注射(生理食鹽水)注射。', '2026-04-19'),
          procedure('p3', '脈動式或耳垂式血氧飽和監視器 - 每次', '2026-04-18'),
          procedure('p4', '一般導尿', '2026-04-17'),
          procedure('p5', '拆線(次)－ 傷口小於十公分', '2026-04-16'),
          procedure('p6', '麻醉前評估', '2026-04-15'),
          procedure('p7', '靜脈或肌肉麻醉', '2026-04-15'),
          procedure('p8', '子宮頸抹片採樣/骨盆腔檢查（醫療院所）', '2026-04-14'),
          procedure('p9', '3D電腦斷層模擬攝影', '2026-04-13'),
          procedure('p10', '多葉型準直儀合金模塊之設計及製作-每一照野', '2026-04-13'),
          procedure('p11', '電腦治療規劃--複雜', '2026-04-13'),
          procedure('p12', '引流管灌洗', '2026-04-12'),
          procedure('p13', '改良式乳房根除手術 － 單側', '2024-07-19'),
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('## Major procedures')
      expect(snapshot.clinicalContext).toContain('改良式乳房根除手術')
      // Only the section's rows — the heading names two of the excluded kinds.
      const rows = snapshot.clinicalContext
        .split('\n')
        .filter((line) => line.startsWith('- ') && !line.includes('申報碼'))
      expect(rows).toHaveLength(1)
      for (const hidden of ['換藥', '點滴注射', '血氧', '導尿', '拆線', '麻醉', '抹片', '模擬攝影', '準直儀', '治療規劃', '灌洗']) {
        expect(rows.join('\n')).not.toContain(hidden)
      }
      // Ancillary rows are not part of the section's own accounting either.
      expect(snapshot.sections.find((section) => section.id === 'procedures')).toMatchObject({ kept: 1, dropped: 0 })
    })

    it('groups repeats into one row with count, latest, first and the latest record’s key', () => {
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', '經皮中央靜脈單株抗體抗腫瘤藥劑輸入', '2026-04-20'),
          procedure('p2', '經皮中央靜脈單株抗體抗腫瘤藥劑輸入', '2025-03-03'),
          procedure('p3', '腹腔鏡闌尾切除術', '2024-01-27'),
        ] as never,
      }
      const snapshot = build(input)
      // Catalog is date-desc, so the newest infusion record is P1.
      expect(snapshot.clinicalContext).toContain(
        '- 經皮中央靜脈單株抗體抗腫瘤藥劑輸入 — ×2, latest 2026-04-20 (first 2025-03-03) [P1]',
      )
      expect(snapshot.clinicalContext).toContain('- 腹腔鏡闌尾切除術 — ×1, latest 2024-01-27 [P3]')
      // …and the cited P keys resolve in the returned catalog subset.
      expect(snapshot.catalog.map((entry) => entry.key).sort()).toEqual(['P1', 'P3'])
    })

    it('ranks operations, implants and radiotherapy above drug infusions', () => {
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', '經皮中央靜脈其他抗腫瘤藥劑輸入', '2026-04-20'),
          procedure('p2', '治療性導管植入術 — Port-A導管植入術', '2024-02-15'),
          procedure('p3', '直線加速器遠隔照射治療，每一複雜照野', '2024-10-09'),
          procedure('p4', '經皮骨盆腔引流術，使用引流裝置', '2025-12-30'),
        ] as never,
      }
      const lines = build(input).clinicalContext.split('\n')
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle))
      expect(at('直線加速器')).toBeLessThan(at('Port-A'))
      expect(at('Port-A')).toBeLessThan(at('抗腫瘤藥劑輸入'))
      // Drainage/biopsy-class work fills what is left, below the infusions.
      expect(at('抗腫瘤藥劑輸入')).toBeLessThan(at('引流術'))
    })

    it('keeps interventional angiography and ERCP, and drops only planning films', () => {
      // 攝影 is the same character in a screening mammogram and in a coronary
      // angiogram. Only the planning/screening films are ancillary.
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', '冠狀動脈血管攝影', '2026-03-02'),
          procedure('p2', '內視鏡逆行性膽道攝影', '2026-02-11'),
          procedure('p3', '3D電腦斷層模擬攝影', '2026-04-13'),
          procedure('p4', '乳房X光攝影檢查', '2026-04-12'),
          procedure('p5', '經皮骨盆腔引流術，使用引流裝置', '2026-04-25'),
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('冠狀動脈血管攝影')
      expect(snapshot.clinicalContext).toContain('內視鏡逆行性膽道攝影')
      expect(snapshot.clinicalContext).not.toContain('模擬攝影')
      expect(snapshot.clinicalContext).not.toContain('乳房X光攝影')
      // …and they outrank the drainage row despite being older.
      const lines = snapshot.clinicalContext.split('\n')
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle))
      expect(at('冠狀動脈血管攝影')).toBeLessThan(at('引流術'))
      expect(at('內視鏡逆行性膽道攝影')).toBeLessThan(at('引流術'))
    })

    it('drops a standalone anaesthesia row but keeps an operation that names one', () => {
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', 'IV or IM anesthesia', '2026-04-15'),
          procedure('p2', 'Excision of skin lesion under local anesthesia', '2026-04-14'),
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('Excision of skin lesion under local anesthesia')
      expect(snapshot.clinicalContext).not.toContain('IV or IM anesthesia')
      expect(snapshot.sections.find((section) => section.id === 'procedures')).toMatchObject({ kept: 1, dropped: 0 })
    })

    it('never lists a procedure the source says did not happen', () => {
      const input: SummaryCatalogInput = {
        procedures: [
          procedure('p1', '腹腔鏡闌尾切除術', '2024-01-27', 'not-done'),
          procedure('p2', '開放性左側乳房全部切除術', '2024-01-20', 'entered-in-error'),
          procedure('p3', '胸腔鏡肺葉切除術', '2024-01-10'),
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('胸腔鏡肺葉切除術')
      expect(snapshot.clinicalContext).not.toContain('闌尾')
      expect(snapshot.clinicalContext).not.toContain('乳房')
    })

    it('caps the section and discloses the tail', () => {
      const input: SummaryCatalogInput = {
        procedures: Array.from({ length: 20 }, (_, index) =>
          procedure(`p${index}`, `第 ${index} 號切除術`, `2026-04-${String(index + 1).padStart(2, '0')}`),
        ) as never,
      }
      const snapshot = build(input)
      expect(snapshot.sections.find((section) => section.id === 'procedures')).toMatchObject({ kept: 12, dropped: 8 })
      expect(snapshot.clinicalContext).toContain('+8 more not listed')
    })
  })

  // ── Labs ────────────────────────────────────────────────────────────────
  // The fast lane sends the SAME date × test pivot as the full lane. A first
  // visit is read from trajectories, so the section's job is the time series,
  // not a list of latest values.
  describe('labs', () => {
    const analyte = (
      id: string, text: string, loinc: string, date: string,
      value: number, unit: string, flag?: string,
    ) => ({
      id,
      code: { text, coding: [{ system: 'http://loinc.org', code: loinc }] },
      valueQuantity: { value, unit },
      effectiveDateTime: date,
      ...(flag ? { interpretation: { coding: [{ code: flag }] } } : {}),
    })

    it('renders one date × test table per panel, newest date first', () => {
      const input: SummaryCatalogInput = {
        observations: [
          analyte('c1', 'Creatinine', '2160-0', '2026-04-20', 0.71, 'mg/dL'),
          analyte('c2', 'Creatinine', '2160-0', '2026-01-20', 1.9, 'mg/dL', 'H'),
          analyte('b1', 'BUN', '3094-0', '2026-04-20', 15, 'mg/dL'),
          analyte('h1', 'Hemoglobin', '718-7', '2026-04-20', 9.1, 'g/dL', 'L'),
        ] as never,
      }
      const context = build(input).clinicalContext
      // Catalog is date-desc: O1=c1, O2=b1, O3=h1, O4=c2.
      expect(context).toContain('- [chem]')
      expect(context).toContain('| Date | BUN (mg/dL) [O2] | CREA (mg/dL) [O1] |')
      expect(context).toContain('| --- | --- | --- |')
      // Newest sampling date first; "-" says the analyte was not measured then.
      expect(context).toContain('| 2026-04-20 | 15 | 0.71 |')
      expect(context).toContain('| 2026-01-20 | - | 1.9 H |')
      const rows = context.split('\n')
      expect(rows.indexOf('| 2026-04-20 | 15 | 0.71 |'))
        .toBeLessThan(rows.indexOf('| 2026-01-20 | - | 1.9 H |'))
      // A second panel is its own table, tagged with its own category id.
      expect(context).toContain('- [cbc]')
      expect(context).toContain('| Date | Hb (g/dL) [O3] |')
      expect(context).toContain('| 2026-04-20 | 9.1 L |')
    })

    it('carries the catalog key of the LATEST value only, and keeps it citable', () => {
      const input: SummaryCatalogInput = {
        observations: [
          analyte('c1', 'Creatinine', '2160-0', '2026-04-20', 0.71, 'mg/dL'),
          analyte('c2', 'Creatinine', '2160-0', '2026-01-20', 1.9, 'mg/dL', 'H'),
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('| Date | CREA (mg/dL) [O1] |')
      // The older cell carries no key of its own.
      expect(snapshot.clinicalContext).toContain('| 2026-01-20 | 1.9 H |')
      expect(snapshot.clinicalContext).not.toContain('O2')
      // …and the header key survives the catalog filter, so it resolves.
      expect(snapshot.catalog.map((entry) => entry.key)).toEqual(['O1'])
    })

    it('shows an analyte whose only value predates the window as an older row', () => {
      // The latest-known floor pulls a prescribing analyte in from outside the
      // lab window. It needs no list of its own: it is a row further down its
      // own panel's table, with dashes above it.
      const input: SummaryCatalogInput = {
        observations: [
          analyte('c1', 'Creatinine', '2160-0', '2026-04-20', 0.71, 'mg/dL'),
          analyte('c2', 'Creatinine', '2160-0', '2026-04-10', 0.68, 'mg/dL'),
          analyte('g1', 'γ-GT', '2324-2', '2025-06-15', 512, 'U/L', 'H'),
        ] as never,
      }
      const context = build(input).clinicalContext
      expect(context).toContain('| Date | CREA (mg/dL) [O1] | GGT (U/L) [O3] |')
      expect(context).toContain('| 2026-04-20 | 0.71 | - |')
      expect(context).toContain('| 2025-06-15 | - | 512 H |')
    })

    it('caps sampling dates per panel and says how many it did not list', () => {
      const days = Array.from({ length: 12 }, (_, index) => `2026-04-${String(28 - index).padStart(2, '0')}`)
      const input: SummaryCatalogInput = {
        observations: days.map((day, index) =>
          analyte(`c${index}`, 'Creatinine', '2160-0', day, 1 + index / 10, 'mg/dL')) as never,
      }
      const snapshot = build(input)
      expect(snapshot.sections.find((section) => section.id === 'labs'))
        .toMatchObject({ kept: 8, dropped: 4 })
      expect(snapshot.clinicalContext).toContain('| 2026-04-28 | 1 |')
      expect(snapshot.clinicalContext).toContain('| 2026-04-21 | 1.7 |')
      expect(snapshot.clinicalContext).not.toContain('| 2026-04-20 |')
      expect(snapshot.clinicalContext).toContain('+4 earlier sampling dates not listed')
    })

    // `other` is a real lab category the pivot builder emits, so the leftover
    // bucket must not borrow that tag.
    it('lists a value the pivot seats in no panel on its own line', () => {
      const input: SummaryCatalogInput = {
        observations: [
          {
            id: 'w1',
            code: { text: 'Body Weight', coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
            valueQuantity: { value: 58, unit: 'kg' },
            effectiveDateTime: '2026-04-18',
          },
          {
            id: 'w2',
            code: { text: 'Body Weight', coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
            valueQuantity: { value: 61, unit: 'kg' },
            effectiveDateTime: '2026-01-18',
          },
        ] as never,
      }
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('- [no panel] (not part of any lab panel: vital signs and free-standing measurements)')
      // Newest first, and the key belongs to the newest point.
      expect(snapshot.clinicalContext).toContain('- Body Weight (kg) [O1]: 58 (2026-04-18); 61 (2026-01-18)')
      expect(snapshot.sections.find((section) => section.id === 'labs'))
        .toMatchObject({ kept: 2, dropped: 0 })
    })

    // The trend gives up depth before the medicine list gives up rows: four
    // points still read as a trajectory, a missing prescription reads as none.
    describe('trim ladder', () => {
      const days = Array.from({ length: 12 }, (_, index) => `2026-04-${String(28 - index).padStart(2, '0')}`)
      const panel: Array<[string, string, string]> = [
        ['Creatinine', '2160-0', 'mg/dL'], ['BUN', '3094-0', 'mg/dL'], ['Sodium', '2951-2', 'mmol/L'],
        ['Potassium', '2823-3', 'mmol/L'], ['ALT', '1742-6', 'U/L'], ['AST', '1920-8', 'U/L'],
      ]
      const input: SummaryCatalogInput = {
        observations: days.flatMap((day, dayIndex) =>
          panel.map(([text, loinc, unit], index) =>
            analyte(`o${dayIndex}-${index}`, text, loinc, day, 1 + index, unit))) as never,
        medications: Array.from({ length: 25 }, (_, index) => ({
          id: `m${index}`,
          status: 'unknown',
          authoredOn: '2026-04-20',
          medicationCodeableConcept: { text: `藥品 ${index}` },
          dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd' } },
        })) as never,
      }
      const labsOf = (tokenBudget?: number) =>
        build(input, tokenBudget === undefined ? {} : { tokenBudget })
          .sections.find((section) => section.id === 'labs')
      const medicinesOf = (tokenBudget: number) =>
        build(input, { tokenBudget }).sections.find((section) => section.id === 'medications')

      it('sends eight sampling dates when the budget allows', () => {
        expect(labsOf()).toMatchObject({ kept: 8, dropped: 4 })
      })

      it('halves the trend to four dates before touching medicines', () => {
        expect(labsOf(440)).toMatchObject({ kept: 4, dropped: 8 })
        expect(medicinesOf(440)).toMatchObject({ kept: 25, dropped: 0 })
      })

      it('falls back to the latest value only, still before medicines', () => {
        expect(labsOf(410)).toMatchObject({ kept: 1, dropped: 11 })
        expect(medicinesOf(410)).toMatchObject({ kept: 25, dropped: 0 })
      })

      it('only then starts dropping medicines', () => {
        expect(labsOf(300)).toMatchObject({ kept: 1, dropped: 11 })
        expect(medicinesOf(300)).toMatchObject({ kept: 15, dropped: 10 })
      })
    })
  })

  // ── Discharge documents ─────────────────────────────────────────────────
  describe('discharge-document history', () => {
    const narrative = [
      '出院診斷',
      'Left breast invasive ductal carcinoma, ypT2N2.',
      '病史',
      `This 61-year-old patient received 6 cycles of neoadjuvant TCHP before mastectomy. ${'Prior regimen detail line. '.repeat(45)}`,
      '理學檢查',
      'Abdomen soft.',
      '檢驗',
      'WBC 4210, Hb 12.0.',
      '住院治療經過',
      ...Array.from({ length: 300 }, (_, index) => `Course line number ${index} with some clinical detail.`),
      '出院指示',
      'Follow up in clinic.',
    ].join('\n')
    const document = (id: string, encounterId: string, day: string) => ({
      id,
      type: { coding: [{ code: '18842-5' }] },
      context: { period: { start: day }, encounter: [{ reference: `Encounter/${encounterId}` }] },
      content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(narrative, 'utf8').toString('base64') } }],
    })
    const input: SummaryCatalogInput = {
      encounters: [
        { id: 'e1', class: { code: 'IMP' }, period: { start: '2026-04-01', end: '2026-04-10' } },
        { id: 'e2', class: { code: 'IMP' }, period: { start: '2026-02-01', end: '2026-02-08' } },
      ] as never,
      documentReferences: [document('d1', 'e1', '2026-04-01'), document('d2', 'e2', '2026-02-01')] as never,
    }

    it('keeps 病史 while the routine sections stay omitted', () => {
      const snapshot = build(input)
      expect(snapshot.clinicalContext).toContain('neoadjuvant TCHP')
      expect(snapshot.clinicalContext).not.toContain('Abdomen soft')
      // The trailer must not claim history was dropped when it was not.
      expect(snapshot.clinicalContext).not.toMatch(/sections omitted:[^\]]*history/)
      expect(snapshot.clinicalContext).toMatch(/sections omitted:[^\]]*physical exam/)
    })

    it('places 病史 inside the kept text, before the omission marker', () => {
      // The marker names what was dropped; anything printed after it reads as
      // part of that notice rather than as evidence.
      const lines = build(input).clinicalContext.split('\n')
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle))
      expect(at('出院診斷')).toBeLessThan(at('neoadjuvant TCHP'))
      expect(at('neoadjuvant TCHP')).toBeLessThan(at('[sections omitted:'))
    })

    it('keeps 病史 for the newest note only when the budget tightens', () => {
      // Tight enough to force the ladder past its history step, roomy enough
      // that both documents still fit.
      const squeezed = buildOverviewSnapshot(
        { clinicalData: input, catalog: buildSourceCatalog(input) },
        { ...options, tokenBudget: 1_200 },
      )
      expect(squeezed.sections.find((section) => section.id === 'documents')).toMatchObject({ kept: 2 })
      expect(squeezed.clinicalContext.match(/neoadjuvant TCHP/g) ?? []).toHaveLength(1)
      expect(squeezed.estimatedTokens).toBeLessThanOrEqual(1_200)
    })

    it('says history was omitted again once the last-resort step drops it', () => {
      const starved = buildOverviewSnapshot(
        { clinicalData: input, catalog: buildSourceCatalog(input) },
        { ...options, tokenBudget: 700 },
      )
      expect(starved.clinicalContext).not.toContain('neoadjuvant TCHP')
      expect(starved.clinicalContext).toMatch(/sections omitted:[^\]]*history/)
    })
  })
})
