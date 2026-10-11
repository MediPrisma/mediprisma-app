/**
 * @jest-environment node
 *
 * FHIR Tools — end-to-end behavior tests with realistic NHI bundle shape.
 * Catches the kind of bug LLM input mismatches cause (HL7 vs friendly names,
 * case-insensitivity, double-counting, refill dedup, PII leakage).
 *
 * Uses node env because `ai` package (transitively imported) needs
 * TransformStream which jsdom doesn't expose.
 */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { sampleDataSource, samplePatient, sampleCollection } from './fixtures'

const tools = createFhirTools(sampleDataSource)

// Tool#execute is typed loosely; cast through any for tests.
async function call(toolName: keyof typeof tools, args: any = {}): Promise<any> {
  const t = tools[toolName] as any
  return t.execute(args)
}

describe('lab searches by analyte alias', () => {
  // The record names the analyte the way the NHI bridge does — a LOINC with its
  // long display and a Chinese order-code display — never as the abbreviation
  // a clinician types.
  const urea = {
    id: 'obs-bun',
    resourceType: 'Observation',
    status: 'final',
    effectiveDateTime: '2026-06-02T00:00:00+08:00',
    code: {
      coding: [
        { system: 'http://loinc.org', code: '3094-0', display: 'Urea nitrogen [Mass/volume] in Serum or Plasma' },
        { system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '09002C', display: '血中尿素氮' },
      ],
      text: '血中尿素氮',
    },
    valueQuantity: { value: 23.7, unit: 'mg/dL' },
  } as any
  const urate = {
    id: 'obs-ua',
    resourceType: 'Observation',
    status: 'final',
    effectiveDateTime: '2026-06-02T00:00:00+08:00',
    code: { coding: [{ system: 'http://loinc.org', code: '3084-1', display: 'Urate [Mass/volume] in Serum or Plasma' }], text: '尿酸' },
    valueQuantity: { value: 4.4, unit: 'mg/dL' },
  } as any
  const report = {
    id: 'dr-bun',
    resourceType: 'DiagnosticReport',
    status: 'final',
    effectiveDateTime: '2026-06-02T00:00:00+08:00',
    category: [{ coding: [{ code: 'LAB' }] }],
    code: { coding: [{ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '09002C', display: '血中尿素氮' }], text: '血中尿素氮' },
    _observations: [urea],
  } as any
  const aliasTools = createFhirTools(() => ({
    patient: samplePatient,
    collection: { ...sampleCollection, observations: [urea, urate], diagnosticReports: [report] },
  }))
  const run = async (name: keyof typeof aliasTools, args: any) => (aliasTools[name] as any).execute(args)

  it('finds urea nitrogen when the clinician types BUN or blood urea nitrogen', async () => {
    for (const query of ['BUN', 'blood urea nitrogen', 'bun']) {
      const r = await run('searchObservationByName', { query })
      expect(r.count).toBe(1)
      expect(r.data[0].value).toBe(23.7)
    }
  })

  it('finds urate when asked for uric acid, and creatinine-style prefixes do not break the alias', async () => {
    const r = await run('searchObservationByName', { query: 'Uric Acid' })
    expect(r.count).toBe(1)
    expect(r.data[0].value).toBe(4.4)
  })

  it('still returns nothing for an analyte the record lacks, and says how to check', async () => {
    const r = await run('searchObservationByName', { query: 'CRP' })
    expect(r.count).toBe(0)
    expect(r.summary).toContain('listAvailableObservationCodes')
  })

  it('matches a lab report by analyte alias through its code and its result observations', async () => {
    const r = await run('queryDiagnosticReports', { query: 'BUN' })
    expect(r.count).toBe(1)
    expect(r.matchedQueryTerms).toEqual(['BUN'])
    expect(r.unmatchedQueryTerms).toEqual([])
  })

  it('applies the alias to queryObservations codeQuery too', async () => {
    const r = await run('queryObservations', { codeQuery: 'uric acid' })
    expect(r.count).toBe(1)
  })
})

describe('createFhirTools (unified)', () => {
  describe('searchEncountersByDiagnosis — one call for "when did X first appear"', () => {
    it('matches an ICD code with or without the dot, oldest first, with first/latest dates', async () => {
      const dotted = await call('searchEncountersByDiagnosis', { query: 'I50.9' })
      const plain = await call('searchEncountersByDiagnosis', { query: 'I509' })
      expect(dotted.success).toBe(true)
      expect(dotted.count).toBe(1)
      expect(dotted.data[0].encounterId).toBe('enc-inpatient-1')
      expect(dotted.data[0].matchedDiagnoses[0].code).toBe('I50.9')
      expect(dotted.firstOccurrence).toBe(dotted.data[0].date)
      expect(dotted.latestOccurrence).toBe(dotted.data[0].date)
      expect(plain.data.map((r: any) => r.encounterId)).toEqual(dotted.data.map((r: any) => r.encounterId))
    })

    it('matches diagnosis text and secondary reason codes, and a code prefix', async () => {
      const text = await call('searchEncountersByDiagnosis', { query: '心臟衰竭' })
      expect(text.data.map((r: any) => r.encounterId)).toEqual(['enc-inpatient-1'])
      const secondary = await call('searchEncountersByDiagnosis', { query: 'E11' })
      expect(secondary.data.map((r: any) => r.encounterId)).toEqual(['enc-inpatient-1'])
      expect(secondary.data[0].matchedDiagnoses.map((d: any) => d.code)).toEqual(['E11.9'])
    })

    it('returns matching problem-list conditions beside the visits', async () => {
      const r = await call('searchEncountersByDiagnosis', { query: 'I10' })
      expect(r.data.map((x: any) => x.encounterId)).toEqual(['enc-amb-1'])
      expect(r.conditions).toHaveLength(1)
      expect(r.conditions[0].recordedDate).toBe('2020-01-15')
    })

    it('reports zero matches as a successful empty result, not an error', async () => {
      const r = await call('searchEncountersByDiagnosis', { query: 'R35.0' })
      expect(r.success).toBe(true)
      expect(r.count).toBe(0)
      expect(r.data).toEqual([])
      expect(r.firstOccurrence).toBeUndefined()
      expect(r.summary).toContain('No visit')
    })
  })

  describe('queryEncounters — class aliases (HL7 ↔ friendly)', () => {
    it('class="inpatient" matches IMP', async () => {
      const r = await call('queryEncounters', { class: 'inpatient' })
      expect(r.success).toBe(true)
      expect(r.count).toBe(1)
      expect(r.data[0].encounterId).toBe('enc-inpatient-1')
    })

    it('class="IMP" matches IMP', async () => {
      const r = await call('queryEncounters', { class: 'IMP' })
      expect(r.count).toBe(1)
    })

    it('class="outpatient" matches AMB', async () => {
      const r = await call('queryEncounters', { class: 'outpatient' })
      // Both enc-amb-1 and enc-pharm-1 use AMB class
      expect(r.count).toBe(2)
    })

    it('class="emergency" matches EMER', async () => {
      const r = await call('queryEncounters', { class: 'emergency' })
      expect(r.count).toBe(1)
      expect(r.data[0].encounterId).toBe('enc-emer-1')
    })

    it('no class filter returns all', async () => {
      const r = await call('queryEncounters')
      expect(r.count).toBe(4)
    })

    it('department substring matches type.text', async () => {
      const r = await call('queryEncounters', { department: '住院' })
      expect(r.count).toBe(1)
    })

    it('institution substring matches serviceProvider.display', async () => {
      const r = await call('queryEncounters', { institution: '長庚' })
      expect(r.count).toBe(1)
    })

    it('date range filters by period.start', async () => {
      const r = await call('queryEncounters', {
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      })
      expect(r.count).toBe(2) // inpatient 2025-05 + emergency 2025-02
    })

    it('summarize=true returns compact form', async () => {
      const r = await call('queryEncounters', { summarize: true })
      expect(r.data[0]).toHaveProperty('encounterId')
      expect(r.data[0]).toHaveProperty('date')
      expect(r.data[0]).toHaveProperty('type')
      expect(r.data[0]).not.toHaveProperty('period')
    })
  })

  describe('queryObservations — category aliases + case-insensitive code', () => {
    it('category="Laboratory" matches "laboratory"', async () => {
      const r = await call('queryObservations', { category: 'Laboratory' })
      expect(r.count).toBeGreaterThanOrEqual(2) // HbA1c x2 + WBC
    })

    it('category="lab" matches "laboratory" via alias', async () => {
      const r = await call('queryObservations', { category: 'lab' })
      expect(r.count).toBeGreaterThan(0)
    })

    it('category="Vital Signs" matches "vital-signs"', async () => {
      const r = await call('queryObservations', { category: 'Vital Signs' })
      expect(r.count).toBe(1)
    })

    it('category="vitals" matches via alias', async () => {
      const r = await call('queryObservations', { category: 'vitals' })
      expect(r.count).toBe(1)
    })

    it('code exact match is case-insensitive', async () => {
      const r = await call('queryObservations', { code: 'body height' })
      expect(r.count).toBe(1)
    })

    it('codeQuery substring search works', async () => {
      const r = await call('queryObservations', { codeQuery: 'hba1c' })
      expect(r.count).toBe(2)
    })

    it('abnormalOnly filters by interpretation', async () => {
      const r = await call('queryObservations', { abnormalOnly: true })
      // Two HbA1c values flagged H
      expect(r.count).toBe(2)
    })

    it('does not report an unloaded collection as zero clinical records', async () => {
      const unloadedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: null,
      }))
      const r = await (unloadedTools.queryObservations as any).execute({
        codeQuery: 'HbA1c',
      })

      expect(r.success).toBe(false)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
    })
  })

  describe('queryDiagnosticReports', () => {
    it('category="Lab" matches "LAB"', async () => {
      const r = await call('queryDiagnosticReports', { category: 'Lab' })
      expect(r.count).toBe(1)
    })

    it('category="imaging" matches "RAD" via alias', async () => {
      const r = await call('queryDiagnosticReports', { category: 'imaging' })
      expect(r.count).toBe(1)
    })

    it('abnormalOnly returns only reports with abnormal obs', async () => {
      const r = await call('queryDiagnosticReports', { abnormalOnly: true })
      expect(r.count).toBe(1)
      expect(r.data[0].reportName).toBe('全套血液檢查')
    })

    it('embeds component observations from _observations', async () => {
      const r = await call('queryDiagnosticReports', {})
      const labReport = r.data.find((d: any) => d.reportName === '全套血液檢查')
      expect(labReport.results.length).toBe(2)
      expect(labReport.results.some((x: any) => x.abnormal === true)).toBe(true)
    })

    it('uses the same category-less imaging inference as the reports UI', async () => {
      const inferredTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [{
            id: 'dr-us',
            status: 'final',
            code: { text: '腹部超音波' },
            issued: '2025-02-01T12:00:00+08:00',
          } as any],
        },
      }))
      const r = await (inferredTools.queryDiagnosticReports as any).execute({
        category: 'imaging',
      })

      expect(r.count).toBe(1)
      expect(r.data[0].reportName).toBe('腹部超音波')
    })

    it('fuzzy-searches a named older report before applying the output cap', async () => {
      const reports = Array.from({ length: 11 }, (_, index) => ({
        id: `report-${index + 1}`,
        status: 'final',
        code: { text: index === 10 ? 'Target Old Lab' : `Lab ${index + 1}` },
        category: [{ coding: [{ code: 'LAB' }] }],
        effectiveDateTime: `2025-${String(12 - index).padStart(2, '0')}-01`,
      }))
      const reportTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: { ...sampleCollection, diagnosticReports: reports as any },
      }))

      const all = await (reportTools.queryDiagnosticReports as any).execute({
        category: 'lab',
      })
      const named = await (reportTools.queryDiagnosticReports as any).execute({
        category: 'lab',
        query: 'target old',
      })

      expect(all.totalCount).toBe(11)
      expect(all.returnedCount).toBe(10)
      expect(all.truncated).toBe(true)
      expect(all.hasMore).toBe(true)
      expect(named.count).toBe(1)
      expect(named.truncated).toBe(false)
      expect(named.data[0].reportName).toBe('Target Old Lab')
    })

    it('matches CA tumor-marker separator variants and checks multiple names independently', async () => {
      const markerTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [
            {
              id: 'ca-125',
              status: 'final',
              code: { text: 'CA-125' },
              category: [{ coding: [{ code: 'LAB' }] }],
              effectiveDateTime: '2025-02-01',
            },
            {
              id: 'ca-199',
              status: 'final',
              code: { text: 'CA–199腫瘤標記 (EIA/LIA法)' },
              category: [{ coding: [{ code: 'LAB' }] }],
              effectiveDateTime: '2025-02-02',
            },
          ] as any,
        },
      }))

      const ca199 = await (markerTools.queryDiagnosticReports as any).execute({
        category: 'lab',
        query: 'CA19-9',
      })
      const both = await (markerTools.queryDiagnosticReports as any).execute({
        category: 'lab',
        queries: ['CA 125', 'CA199'],
      })
      const commaSeparated = await (markerTools.queryDiagnosticReports as any).execute({
        category: 'lab',
        query: 'CA125, CA199',
      })

      expect(ca199.count).toBe(1)
      expect(ca199.data[0].reportName).toContain('CA–199')
      expect(both.count).toBe(2)
      expect(both.matchedQueryTerms).toEqual(['CA 125', 'CA199'])
      expect(both.unmatchedQueryTerms).toEqual([])
      expect(commaSeparated.count).toBe(2)
      expect(commaSeparated.matchedQueryTerms).toEqual(['CA125', 'CA199'])
    })

    it('keeps a representative of every requested lab inside the default page', async () => {
      const reports = [
        ...Array.from({ length: 11 }, (_, index) => ({
          id: `ca125-${index}`,
          status: 'final',
          code: { text: 'CA-125' },
          category: [{ coding: [{ code: 'LAB' }] }],
          effectiveDateTime: `2025-${String(12 - index).padStart(2, '0')}-01`,
        })),
        {
          id: 'older-ca199',
          status: 'final',
          code: { text: 'CA–199腫瘤標記' },
          category: [{ coding: [{ code: 'LAB' }] }],
          effectiveDateTime: '2024-01-01',
        },
      ]
      const markerTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: { ...sampleCollection, diagnosticReports: reports as any },
      }))

      const result = await (markerTools.queryDiagnosticReports as any).execute({
        category: 'lab',
        queries: ['CA125', 'CA199'],
      })

      expect(result.totalCount).toBe(12)
      expect(result.returnedCount).toBe(10)
      expect(result.truncated).toBe(true)
      expect(result.matchedQueryTerms).toEqual(['CA125', 'CA199'])
      expect(result.data.some((report: any) => report.reportName.includes('CA–199'))).toBe(true)
    })

    it('uses issued as the report date when effectiveDateTime is absent', async () => {
      const issuedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [{
            id: 'issued-only',
            status: 'final',
            code: { text: 'Issued-only report' },
            category: [{ coding: [{ code: 'LAB' }] }],
            issued: '2025-02-01T12:00:00+08:00',
          } as any],
        },
      }))
      const r = await (issuedTools.queryDiagnosticReports as any).execute({
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      })

      expect(r.count).toBe(1)
      expect(r.data[0].date).toBe('2025-02-01T12:00:00+08:00')
    })

    it('does not turn a failed DiagnosticReport query into clinical absence', async () => {
      const failedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [],
          resourceQueryStatus: {
            DiagnosticReport: {
              resourceType: 'DiagnosticReport',
              state: 'forbidden',
              httpStatus: 403,
            },
          },
        },
      }))
      const r = await (failedTools.queryDiagnosticReports as any).execute({})

      expect(r.success).toBe(false)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
      expect(r.queryIssues[0]).toMatchObject({
        resourceType: 'DiagnosticReport',
        state: 'forbidden',
      })
    })
  })

  describe('queryLabResultsByCategory', () => {
    const markerObservation = (
      id: string,
      text: string,
      value: number,
      date: string,
      loinc?: string,
    ) => ({
      id,
      status: 'final',
      code: {
        text,
        coding: loinc ? [{ system: 'http://loinc.org', code: loinc }] : [],
      },
      category: [{ coding: [{ code: 'laboratory' }] }],
      valueQuantity: { value, unit: 'U/mL' },
      effectiveDateTime: `${date}T00:00:00+08:00`,
    }) as any

    const categoryTools = createFhirTools(() => ({
      patient: samplePatient,
      collection: {
        ...sampleCollection,
        observations: [
          markerObservation('afp', 'AFP', 2.1, '2025-04-01', '1834-1'),
          markerObservation('cea', 'CEA', 3.2, '2025-04-01', '2039-6'),
          markerObservation('ca125-old', 'CA-125', 10, '2025-01-01', '10334-1'),
          markerObservation('ca125-new', 'CA125', 12, '2025-04-01', '10334-1'),
          markerObservation('ca199', 'CA–199腫瘤標記', 31.83, '2025-04-01', '24108-3'),
          {
            id: 'creatinine',
            status: 'final',
            code: {
              text: 'Creatinine',
              coding: [{ system: 'http://loinc.org', code: '2160-0' }],
            },
            category: [{ coding: [{ code: 'laboratory' }] }],
            valueQuantity: { value: 1.2, unit: 'mg/dL' },
            effectiveDateTime: '2025-04-01T00:00:00+08:00',
          },
        ] as any,
        vitalSigns: [],
      },
    }))

    it('returns every tumor-marker analyte and excludes other lab categories', async () => {
      const result = await (categoryTools.queryLabResultsByCategory as any).execute({
        category: 'tumor',
      })

      expect(result.success).toBe(true)
      expect(result.analyteCount).toBe(4)
      expect(result.observationCount).toBe(5)
      expect(result.availableAnalytes).toEqual(['AFP', 'CEA', 'CA-125', 'CA 19-9'])
      expect(result.data.map((group: any) => group.analyte)).not.toContain('Creatinine')
      expect(result.data.find((group: any) => group.analyte === 'CA-125').results).toHaveLength(1)
      expect(result.data.find((group: any) => group.analyte === 'CA-125').results[0].value).toBe(12)
      expect(result.groundingRules.normalityStatusIsAuthoritative).toBe(true)
    })

    it('returns a date-sorted series per analyte when withTrend is true', async () => {
      const result = await (categoryTools.queryLabResultsByCategory as any).execute({
        category: 'tumor',
        withTrend: true,
      })
      const ca125 = result.data.find((group: any) => group.analyte === 'CA-125')

      expect(ca125.observationCount).toBe(2)
      expect(ca125.results.map((item: any) => item.value)).toEqual([12, 10])
    })

    it('keeps source interpretation authoritative and omits a conflicting range', async () => {
      const observation = markerObservation('cea', 'CEA', 3.8, '2025-04-01', '2039-6')
      observation.interpretation = [{ coding: [{ code: 'N' }] }]
      observation.referenceRange = [{ low: { value: 4 }, high: { value: 5 } }]
      const tools = createFhirTools(() => ({
        patient: samplePatient,
        collection: { ...sampleCollection, observations: [observation], vitalSigns: [] },
      }))

      const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'tumor' })
      const item = result.data[0].results[0]

      expect(item).toMatchObject({
        abnormal: false,
        normalityStatus: 'Normal',
        assessmentBasis: 'source-interpretation',
      })
      expect(item.referenceRange).toBeUndefined()
    })

    it('exposes only an audited range when source interpretation is absent', async () => {
      const observation = markerObservation('cea', 'CEA', 6, '2025-04-01', '2039-6')
      observation.referenceRange = [{ low: { value: 0 }, high: { value: 5 } }]
      const tools = createFhirTools(() => ({
        patient: samplePatient,
        collection: { ...sampleCollection, observations: [observation], vitalSigns: [] },
      }))

      const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'tumor' })

      expect(result.data[0].results[0]).toMatchObject({
        abnormal: true,
        normalityStatus: 'Outside audited reference range',
        assessmentBasis: 'audited-reference-range',
        referenceRange: { low: 0, high: 5 },
      })
    })

    it('keeps a differential count and its percentage as two analytes, as the cumulative report does', async () => {
      const neutrophil = (id: string, loinc: string, value: number, unit: string, date: string) => ({
        id,
        status: 'final',
        code: {
          text: '嗜中性白血球 / Neutrophil',
          coding: [
            { system: 'http://loinc.org', code: loinc },
            { system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '08013C' },
          ],
        },
        category: [{ coding: [{ code: 'laboratory' }] }],
        valueQuantity: { value, unit },
        effectiveDateTime: `${date}T00:00:00+08:00`,
      }) as any
      const tools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          observations: [
            neutrophil('anc-1', '751-8', 3.2, '10^3/uL', '2025-04-01'),
            neutrophil('neu-1', '770-8', 55, '%', '2025-04-01'),
            neutrophil('anc-2', '751-8', 2.9, '10^3/uL', '2025-03-01'),
            neutrophil('neu-2', '770-8', 61, '%', '2025-03-01'),
          ],
          vitalSigns: [],
        },
      }))

      const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'cbc', withTrend: true })
      const byKey = new Map(result.data.map((group: any) => [group.canonicalKey, group]))

      expect([...byKey.keys()].sort()).toEqual(['ANC', 'NEU'])
      expect((byKey.get('NEU') as any).results.map((item: any) => item.value)).toEqual([55, 61])
      expect((byKey.get('ANC') as any).results.map((item: any) => item.value)).toEqual([3.2, 2.9])
      expect((byKey.get('ANC') as any).analyte).toBe('ANC')
    })

    it('does not treat an unavailable Observation query as an empty category', async () => {
      const unavailableTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          observations: [],
          resourceQueryStatus: {
            Observation: {
              resourceType: 'Observation',
              state: 'forbidden',
              httpStatus: 403,
            },
          },
        },
      }))
      const result = await (unavailableTools.queryLabResultsByCategory as any).execute({
        category: 'tumor',
      })

      expect(result.success).toBe(false)
      expect(result.incomplete).toBe(true)
      expect(result.canConcludeAbsence).toBe(false)
    })
  })

  describe('queryImagingRecords', () => {
    it('returns a standalone ImagingStudy that queryDiagnosticReports cannot contain', async () => {
      const imagingTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [],
          imagingStudies: [{
            id: 'study-1',
            status: 'available',
            started: '2024-01-01T09:00:00+08:00',
            description: 'Brain CT',
            modality: [{ code: 'CT', display: 'Computed Tomography' }],
            series: [{
              bodySite: { code: 'BRAIN', display: 'Brain' },
            }],
          } as any],
        },
      }))

      const r = await (imagingTools.queryImagingRecords as any).execute({
        query: 'brain',
        modality: 'CT',
      })

      expect(r.success).toBe(true)
      expect(r.count).toBe(1)
      expect(r.data[0]).toMatchObject({
        resourceType: 'ImagingStudy',
        studyName: 'Brain CT',
      })
    })

    it('combines a linked ImagingStudy with its DiagnosticReport without duplicating it', async () => {
      const imagingTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [{
            id: 'dr-ct',
            status: 'final',
            code: { text: 'Chest CT' },
            effectiveDateTime: '2026-06-01T09:00:00+08:00',
            imagingStudy: [{ reference: 'ImagingStudy/study-ct' }],
            conclusion: 'No focal consolidation.',
          } as any],
          imagingStudies: [{
            id: 'study-ct',
            status: 'available',
            started: '2026-06-01T09:00:00+08:00',
            description: 'CT chest without contrast',
            modality: [{ code: 'CT' }],
          } as any],
        },
      }))

      const r = await (imagingTools.queryImagingRecords as any).execute({
        query: 'chest',
      })

      expect(r.count).toBe(1)
      expect(r.data[0].resourceType).toBe('DiagnosticReport')
      expect(r.data[0].linkedImagingStudies).toHaveLength(1)
      expect(r.data[0].linkedImagingStudies[0].studyName)
        .toBe('CT chest without contrast')
    })

    it('reports image presence and decodes textual report attachments without sending pixels', async () => {
      const text = Buffer.from('影像報告：未見急性病灶', 'utf8').toString('base64')
      const imagingTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [{
            id: 'dr-attachments',
            status: 'final',
            code: { text: 'Chest X-ray' },
            category: [{ coding: [{ code: 'RAD' }] }],
            effectiveDateTime: '2026-01-01',
            presentedForm: [
              { title: 'Report text', contentType: 'text/plain', data: text },
              { title: 'X-ray image', contentType: 'image/jpeg', data: 'AA==' },
              {
                title: 'NHI image viewer',
                contentType: 'text/html',
                url: 'https://meddcmc.nhi.gov.tw/zfp/IMME/must-not-leak_123456',
              },
            ],
          } as any],
          imagingStudies: [],
        },
      }))

      const r = await (imagingTools.queryImagingRecords as any).execute({
        query: 'Chest X-ray',
      })

      expect(r.data[0].imageAttachmentCount).toBe(1)
      expect(r.data[0].attachments[0].text).toContain('未見急性病灶')
      expect(r.data[0].attachments[1]).not.toHaveProperty('data')
      expect(JSON.stringify(r)).not.toContain('must-not-leak')
      expect(r.data[0].attachments[2]).not.toHaveProperty('url')
    })

    it('bridges a Taiwan Chinese chest X-ray query to an English FHIR report name', async () => {
      const imagingTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [{
            id: 'dr-chest-xray',
            status: 'final',
            code: { text: 'Chest X-ray' },
            category: [{ coding: [{ code: 'RAD' }] }],
            effectiveDateTime: '2025-05-18',
          } as any],
          imagingStudies: [],
        },
      }))

      const r = await (imagingTools.queryImagingRecords as any).execute({
        query: '胸部 X 光',
      })

      expect(r.count).toBe(1)
      expect(r.data[0].reportName).toBe('Chest X-ray')
    })

    it('does not assert absence when either imaging resource query is incomplete', async () => {
      const failedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          diagnosticReports: [],
          imagingStudies: [],
          resourceQueryStatus: {
            DiagnosticReport: {
              resourceType: 'DiagnosticReport',
              state: 'ok',
              count: 0,
            },
            ImagingStudy: {
              resourceType: 'ImagingStudy',
              state: 'unsupported',
              httpStatus: 400,
            },
          },
        },
      }))

      const r = await (failedTools.queryImagingRecords as any).execute({})

      expect(r.success).toBe(false)
      expect(r.count).toBe(0)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
    })
  })

  describe('queryMedications', () => {
    it('chronic=true returns only continuous-therapy meds', async () => {
      const r = await call('queryMedications', { chronic: true })
      // Both refill cycles of Sotalol / 通舒錠 are chronic
      expect(r.count).toBe(2)
      expect(r.data.every((m: any) => m.chronic === true)).toBe(true)
      expect(r.data[0]).toMatchObject({
        medication: 'Sotalol',
        recordedName: '通舒錠',
      })
    })

    it('chronic=false returns non-chronic', async () => {
      const r = await call('queryMedications', { chronic: false })
      expect(r.count).toBe(1)
      expect(r.data[0].medication).toBe('Acetaminophen')
    })

    it('status filter is case-insensitive', async () => {
      const r = await call('queryMedications', { status: 'ACTIVE' })
      expect(r.count).toBe(1)
    })

    it('date range filters authoredOn', async () => {
      const r = await call('queryMedications', { dateFrom: '2026-04-01' })
      expect(r.count).toBe(1)
    })

    it('resolves the past-three-month preset without asking the model to calculate dates', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00+08:00'))
      try {
        const recentTools = createFhirTools(() => ({
          patient: samplePatient,
          collection: {
            ...sampleCollection,
            medications: [
              { ...sampleCollection.medications[0], id: 'recent', authoredOn: '2026-09-01' },
              { ...sampleCollection.medications[1], id: 'old', authoredOn: '2026-05-01' },
            ],
          },
        }))

        const r = await (recentTools.queryMedications as any).execute({ timeRange: 'last-90-days' })

        expect(r.count).toBe(1)
        expect(r.timeRange).toBe('last-90-days')
        expect(r.resolvedDateRange).toEqual({ dateFrom: '2026-06-17', dateTo: '2026-09-15' })
        expect(r.data[0].authoredOn).toBe('2026-09-01')
      } finally {
        jest.useRealTimers()
      }
    })

    it('does not present an unloaded medication collection as a confirmed empty result', async () => {
      const unloadedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: null,
      }))

      const r = await (unloadedTools.queryMedications as any).execute({})

      expect(r).toMatchObject({
        success: false,
        count: 0,
        incomplete: true,
        canConcludeAbsence: false,
      })
    })

    it('returns exact governed drug terminology and keeps source category separate', async () => {
      const terminologyTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [{
            ...sampleCollection.medications[0],
            medicationCodeableConcept: {
              text: '通舒錠',
              coding: [{
                system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code',
                code: 'AC12345100',
                display: 'Sotalol',
              }],
            },
            category: [{
              text: '心血管用藥',
              coding: [{ code: 'cardiovascular', display: 'CARDIOVASCULAR' }],
            }],
            drugTerminology: {
              source: 'nhi-official-drug-master',
              snapshotId: 'nhi-drug-terminology-test',
              officialNameZh: '通舒錠',
              officialNameEn: 'Sotalol Tablets',
              ingredientText: 'SOTALOL HCL 80 MG',
              doseForm: '錠劑',
              atcCode: 'C07AA07',
              atcNameEn: 'sotalol',
              atcLevel2Code: 'C07',
              atcLevel2NameZh: '乙型阻斷劑',
              atcLevel2NameEn: 'BETA BLOCKING AGENTS',
              atcLevel4Code: 'C07AA',
              atcLevel4NameZh: '非選擇性乙型阻斷劑',
              atcLevel4NameEn: 'Beta blocking agents, non-selective',
            },
          }],
        },
      }))

      const r = await (terminologyTools.queryMedications as any).execute({})

      expect(r.groundingRules).toMatchObject({
        ingredientProvided: true,
        drugClassProvided: true,
        purposeOrIndicationProvided: false,
      })
      expect(r.data[0]).toMatchObject({
        medication: 'Sotalol',
        recordedName: '通舒錠',
        terminologyStatus: 'matched',
        nhiDrugCode: 'AC12345100',
        drugTerminology: {
          ingredientText: 'SOTALOL HCL 80 MG',
          doseForm: '錠劑',
          atcCode: 'C07AA07',
          atcLevel2NameZh: '乙型阻斷劑',
          atcLevel4NameZh: '非選擇性乙型阻斷劑',
        },
        recordedCategories: [{
          code: 'cardiovascular',
          text: '心血管用藥',
          meaning: 'source-administrative-category',
        }],
      })
      expect(r.data[0].medicationIdentity).toContain('Sotalol')
      expect(r.data[0].medicationIdentity).toContain('SOTALOL HCL 80 MG')
      expect(r.data[0].medicationIdentity).toContain('ATC C07AA07')
      expect(r.data[0]).not.toHaveProperty('modelInstruction')
    })

    it('filters patient medication records by governed ingredient or ATC class', async () => {
      const terminologyTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [{
            ...sampleCollection.medications[0],
            drugTerminology: {
              source: 'nhi-official-drug-master',
              snapshotId: 'nhi-drug-terminology-test',
              officialNameZh: '通舒錠',
              officialNameEn: 'Sotalol Tablets',
              ingredientText: 'SOTALOL HCL 80 MG',
              doseForm: '錠劑',
              atcCode: 'C07AA07',
              atcLevel2Code: 'C07',
              atcLevel2NameZh: '乙型阻斷劑',
              atcLevel2NameEn: 'BETA BLOCKING AGENTS',
              atcLevel4Code: 'C07AA',
              atcLevel4NameZh: '非選擇性乙型阻斷劑',
              atcLevel4NameEn: 'Beta blocking agents, non-selective',
            },
          }],
        },
      }))

      const byIngredient = await (terminologyTools.queryMedications as any).execute({ query: 'SOTALOL HCL' })
      const byClass = await (terminologyTools.queryMedications as any).execute({ query: '乙型阻斷劑' })
      const absent = await (terminologyTools.queryMedications as any).execute({ query: 'antihistamine' })

      expect(byIngredient.count).toBe(1)
      expect(byClass.count).toBe(1)
      expect(absent).toMatchObject({ count: 0, canConcludeAbsence: true })
    })

    it('surfaces a partial medication-source failure without discarding available records', async () => {
      const partialTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          resourceQueryStatus: {
            MedicationRequest: {
              resourceType: 'MedicationRequest',
              state: 'ok',
              count: sampleCollection.medications.length,
            },
            MedicationStatement: {
              resourceType: 'MedicationStatement',
              state: 'unsupported',
              httpStatus: 400,
            },
          },
        },
      }))

      const r = await (partialTools.queryMedications as any).execute({})

      expect(r.success).toBe(true)
      expect(r.count).toBe(3)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
      expect(r.queryIssues).toEqual([
        expect.objectContaining({ resourceType: 'MedicationStatement', state: 'unsupported' }),
      ])
    })

    it('returns governed source ATC classification when no NHI terminology match exists', async () => {
      const atcTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [{
            ...sampleCollection.medications[0],
            drugTerminology: undefined,
            atcClassification: {
              source: 'source-who-atc',
              atcCode: 'L01EB04',
              atcNameEn: 'osimertinib',
              atcLevel2Code: 'L01',
              atcLevel2NameZh: '抗腫瘤劑',
              atcLevel2NameEn: 'ANTINEOPLASTIC AGENTS',
              atcLevel4Code: 'L01EB',
              atcLevel4NameZh: 'EGFR 酪胺酸激酶抑制劑',
              atcLevel4NameEn: 'Epidermal growth factor receptor tyrosine kinase inhibitors',
              atcHierarchySnapshotId: 'atc-hierarchy-test',
            },
          }],
        },
      }))

      const r = await (atcTools.queryMedications as any).execute({})

      expect(r.groundingRules.drugClassProvided).toBe(true)
      expect(r.data[0].sourceAtcClassification).toMatchObject({
        atcCode: 'L01EB04',
        atcLevel2NameZh: '抗腫瘤劑',
        atcLevel4NameZh: 'EGFR 酪胺酸激酶抑制劑',
      })
    })

    it('preserves structured dosage and supply when dosage text is absent', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00+08:00'))
      try {
        const structuredTools = createFhirTools(() => ({
          patient: samplePatient,
          collection: {
            ...sampleCollection,
            medications: [{
              id: 'structured-medication',
              medicationCodeableConcept: { text: 'Structured medicine' },
              status: 'active',
              authoredOn: '2026-09-14',
              dosageInstruction: [{
                route: { text: 'PO' },
                doseAndRate: [{ doseQuantity: { value: 1, unit: 'tablet' } }],
                timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } },
              }],
              dispenseRequest: {
                quantity: { value: 14, unit: 'tablet' },
                expectedSupplyDuration: { value: 7, unit: 'days', code: 'd' },
              },
            } as any],
          },
        }))

        const r = await (structuredTools.queryMedications as any).execute({})

        expect(r.data[0]).toMatchObject({
          dosageDetails: {
            route: 'PO',
            doseQuantity: { value: 1, unit: 'tablet' },
            frequency: 2,
            period: 1,
            periodUnit: 'd',
          },
          dispenseQuantity: { value: 14, unit: 'tablet' },
          expectedSupplyDuration: { value: 7, unit: 'days', code: 'd' },
          expectedSupplyEnd: '2026-09-21',
          current: true,
        })
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('queryAllergies', () => {
    it('severity="high" matches criticality "high"', async () => {
      const r = await call('queryAllergies', { severity: 'high' })
      expect(r.count).toBe(1)
    })

    it('severity="low" returns 0 when no low-criticality entries', async () => {
      const r = await call('queryAllergies', { severity: 'low' })
      expect(r.count).toBe(0)
    })
  })

  describe('queryConditions', () => {
    it('category filter accepts "problem-list-item"', async () => {
      const r = await call('queryConditions', { category: 'problem-list-item' })
      expect(r.count).toBe(1)
    })

    it('clinicalStatus is case-insensitive', async () => {
      const r = await call('queryConditions', { clinicalStatus: 'Active' })
      expect(r.count).toBe(1)
    })
  })

  describe('queryProcedures', () => {
    it('date range filters by performedDateTime', async () => {
      const r = await call('queryProcedures', { dateFrom: '2016-01-01', dateTo: '2017-01-01' })
      expect(r.count).toBe(1)
    })

    it('date range excludes out-of-range', async () => {
      const r = await call('queryProcedures', { dateFrom: '2020-01-01' })
      expect(r.count).toBe(0)
    })
  })

  describe('queryImmunizations', () => {
    it('returns all when no filter', async () => {
      const r = await call('queryImmunizations')
      expect(r.count).toBe(1)
    })

    it('date range filters by occurrenceDateTime', async () => {
      const r = await call('queryImmunizations', { dateFrom: '2024-01-01' })
      expect(r.count).toBe(1)
    })

    it('date range excludes too-old vaccines', async () => {
      const r = await call('queryImmunizations', { dateFrom: '2025-01-01' })
      expect(r.count).toBe(0)
    })
  })

  describe('getDataOverview', () => {
    it('returns counts for every resource type', async () => {
      const r = await call('getDataOverview')
      expect(r.success).toBe(true)
      expect(r.data.encounters.count).toBe(4)
      expect(r.data.conditions.count).toBe(1)
      expect(r.data.medications.count).toBe(3)
      expect(r.data.allergies.count).toBe(1)
      expect(r.data.diagnosticReports.count).toBe(2)
      expect(r.data.procedures.count).toBe(1)
      expect(r.data.immunizations.count).toBe(1)
    })

    it('observation count dedups vitals + observations by id', async () => {
      const r = await call('getDataOverview')
      // 3 lab observations + 1 vital sign, distinct ids
      expect(r.data.observations.count).toBe(4)
    })

    it('returns date range for each resource type', async () => {
      const r = await call('getDataOverview')
      expect(r.data.encounters.range).toEqual({
        earliest: '2025-02-11',
        latest: '2026-05-13',
      })
    })

    it('surfaces resource query failures instead of presenting a complete zero inventory', async () => {
      const overviewTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          imagingStudies: [],
          resourceQueryStatus: {
            ImagingStudy: {
              resourceType: 'ImagingStudy',
              state: 'unsupported',
              httpStatus: 400,
            },
          },
        },
      }))
      const r = await (overviewTools.getDataOverview as any).execute({})

      expect(r.success).toBe(true)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
      expect(r.data.imagingStudies.queryStatus).toBe('unsupported')
    })
  })

  describe('getEncounterDetails (cross-resource)', () => {
    it('returns full visit detail by encounterId', async () => {
      const r = await call('getEncounterDetails', { encounterId: 'enc-inpatient-1' })
      expect(r.success).toBe(true)
      expect(r.data.type).toBe('inpatient')
      expect(r.data.department).toBe('住院')
    })

    it('returns primary + secondary ICDs', async () => {
      const r = await call('getEncounterDetails', { encounterId: 'enc-inpatient-1' })
      expect(r.data.diagnoses.length).toBe(2)
      expect(r.data.diagnoses[0].code).toBe('I50.9')
      expect(r.data.diagnoses[1].code).toBe('E11.9')
    })

    it('returns meds linked to that encounter', async () => {
      const r = await call('getEncounterDetails', { encounterId: 'enc-inpatient-1' })
      expect(r.data.medications.length).toBe(1)
      expect(r.data.medications[0].medication).toBe('Acetaminophen')
    })

    it('returns diagnostic reports linked to encounter', async () => {
      const r = await call('getEncounterDetails', { encounterId: 'enc-inpatient-1' })
      expect(r.data.reports.length).toBe(1)
    })

    it('returns failure for unknown encounter id', async () => {
      const r = await call('getEncounterDetails', { encounterId: 'does-not-exist' })
      expect(r.success).toBe(false)
    })
  })

  describe('getActiveMedicationList (refill dedup)', () => {
    it('dedups same-name refill cycles into one row', async () => {
      const r = await call('getActiveMedicationList')
      const names = r.data.map((m: any) => m.medication)
      expect(new Set(names).size).toBe(names.length)
    })

    it('chronicOnly=true keeps only continuous-therapy', async () => {
      const r = await call('getActiveMedicationList', { chronicOnly: true })
      expect(r.data.every((m: any) => m.chronic === true)).toBe(true)
    })

    it('tracks refillCount when same drug appears multiple times', async () => {
      const r = await call('getActiveMedicationList')
      const sotalol = r.data.find((m: any) => m.medication === 'Sotalol')
      expect(sotalol?.refillCount).toBe(2)
      expect(sotalol?.recordedName).toBe('通舒錠')
      expect(sotalol?.status).toBe('active')
    })

    it('keeps status and fields from the newest refill regardless of input order', async () => {
      const reversedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [...sampleCollection.medications].reverse(),
        },
      }))

      const r = await (reversedTools.getActiveMedicationList as any).execute({})
      const sotalol = r.data.find((m: any) => m.medication === 'Sotalol')

      expect(sotalol).toMatchObject({
        status: 'active',
        authoredOn: '2026-04-27T00:00:00+08:00',
        refillCount: 2,
      })
    })

    it('uses supply timing for missing/unknown status and leaves only unresolvable rows uncertain', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00+08:00'))
      try {
        const unknownStatusTools = createFhirTools(() => ({
          patient: samplePatient,
          collection: {
            ...sampleCollection,
            medications: [
              {
                id: 'unknown-current-med',
                medicationCodeableConcept: {
                  text: 'Status-unknown current medicine',
                },
                status: 'unknown',
                authoredOn: '2026-09-08',
                dosageInstruction: [{ text: 'QD' }],
                dispenseRequest: {
                  expectedSupplyDuration: { value: 6, unit: 'days', code: 'd' },
                },
              },
              {
                id: 'missing-current-med',
                medicationCodeableConcept: { text: 'Status-missing current medicine' },
                authoredOn: '2026-09-09',
                dispenseRequest: {
                  expectedSupplyDuration: { value: 5, unit: 'days', code: 'd' },
                },
              },
              {
                id: 'unknown-expired-med',
                medicationCodeableConcept: { text: 'Status-unknown expired medicine' },
                status: 'unknown',
                authoredOn: '2026-09-01',
                dispenseRequest: {
                  expectedSupplyDuration: { value: 3, unit: 'days', code: 'd' },
                },
              },
              {
                id: 'unknown-unresolvable-med',
                medicationCodeableConcept: { text: 'Status-unknown unresolved medicine' },
                status: 'unknown',
                authoredOn: '2026-09-10',
              },
            ] as any,
          },
        }))

        const r = await (unknownStatusTools.getActiveMedicationList as any).execute({})

        expect(r).toMatchObject({
          success: true,
          count: 2,
          canConcludeAbsence: false,
          uncertainCount: 1,
        })
        expect(r.data).toEqual(expect.arrayContaining([
          expect.objectContaining({
            medication: 'Status-unknown current medicine',
            status: 'unknown',
            current: true,
            expectedSupplyEnd: '2026-09-14',
            currentnessBasis: 'supply-window',
          }),
          expect.objectContaining({
            medication: 'Status-missing current medicine',
            current: true,
            expectedSupplyEnd: '2026-09-14',
            currentnessBasis: 'supply-window',
          }),
        ]))
        expect(r.data).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ medication: 'Status-unknown expired medicine' }),
        ]))
        expect(r.uncertainData[0]).toMatchObject({
          medication: 'Status-unknown unresolved medicine',
          status: 'unknown',
          current: false,
          currentnessBasis: 'insufficient-status-and-supply',
          currentness: 'uncertain-source-status',
        })
      } finally {
        jest.useRealTimers()
      }
    })

    it('uses status plus supply end instead of a one-year age heuristic', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00+08:00'))
      try {
        const supplyTools = createFhirTools(() => ({
          patient: samplePatient,
          collection: {
            ...sampleCollection,
            medications: [
              {
                id: 'expired',
                medicationCodeableConcept: { text: 'Expired medicine' },
                status: 'active',
                authoredOn: '2026-05-13',
                dispenseRequest: {
                  expectedSupplyDuration: { value: 3, unit: 'days', code: 'd' },
                },
              },
              {
                id: 'current-completed',
                medicationCodeableConcept: { text: 'Current supplied medicine' },
                status: 'completed',
                authoredOn: '2026-09-14',
                dispenseRequest: {
                  expectedSupplyDuration: { value: 3, unit: 'days', code: 'd' },
                },
              },
            ] as any,
          },
        }))

        const r = await (supplyTools.getActiveMedicationList as any).execute({})

        expect(r.data.map((medication: any) => medication.medication)).toEqual([
          'Current supplied medicine',
        ])
        expect(r.data[0]).toMatchObject({
          current: true,
          expectedSupplyEnd: '2026-09-17',
          currentnessBasis: 'source-status-and-supply-window',
        })
      } finally {
        jest.useRealTimers()
      }
    })

    it('keeps same-name prescriptions separate when the regimen differs', async () => {
      const differentRegimenTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [
            {
              id: 'regimen-1',
              medicationCodeableConcept: { text: 'Same drug' },
              status: 'active',
              authoredOn: '2026-09-01',
              dosageInstruction: [{ text: '1 TAB QD' }],
            },
            {
              id: 'regimen-2',
              medicationCodeableConcept: { text: 'Same drug' },
              status: 'active',
              authoredOn: '2026-09-02',
              dosageInstruction: [{ text: '2 TAB BID' }],
            },
          ] as any,
        },
      }))

      const r = await (differentRegimenTools.getActiveMedicationList as any).execute({})

      expect(r.count).toBe(2)
      expect(r.data.map((medication: any) => medication.dosage)).toEqual([
        '2 TAB BID',
        '1 TAB QD',
      ])
    })
  })

  describe('getHealthSummarySnapshot', () => {
    it('returns a compact, deduplicated cross-domain summary', async () => {
      const r = await call('getHealthSummarySnapshot')

      expect(r).toMatchObject({
        success: true,
        incomplete: false,
        canConcludeAbsence: true,
        counts: {
          conditions: 1,
          activeMedications: 1,
          abnormalLabs: 1,
          recentVitals: 1,
        },
      })
      expect(r.data.conditions).toHaveLength(1)
      expect(r.data.medications).toHaveLength(1)
      expect(r.data.medications[0].name).toBe('Sotalol')
      expect(r.data.medications[0].recordedName).toBe('通舒錠')
      expect(r.data.abnormalLabs).toEqual([
        expect.objectContaining({ name: 'HbA1c', value: 8.2, abnormal: true }),
      ])
      expect(r.data.recentVitals).toEqual([
        expect.objectContaining({ name: 'Body Height', value: 168 }),
      ])
      expect(r.groundingRules).toMatchObject({
        medicationFieldsOnly: true,
        normalityStatusIsAuthoritative: true,
      })
      expect(r.groundingRules.instruction).toContain('Follow the system prompt language')
      expect(r.groundingRules.instruction).not.toContain('Taiwan Traditional Chinese')
    })

    it('does not expose patient identifiers in the snapshot', async () => {
      const r = await call('getHealthSummarySnapshot')
      const serialized = JSON.stringify(r)

      expect(serialized).not.toContain(samplePatient.id)
      expect(serialized).not.toContain('Dr. Wang')
    })

    it('keeps unknown-status medication records separate and returns other available domains', async () => {
      const uncertainSnapshotTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          medications: [{
            id: 'unknown-medication',
            medicationCodeableConcept: { text: 'Status-unknown drug' },
            status: 'unknown',
            authoredOn: '2026-09-08',
          } as any],
          resourceQueryStatus: {
            MedicationStatement: {
              resourceType: 'MedicationStatement',
              state: 'unsupported',
              httpStatus: 400,
            },
          },
        },
      }))

      const r = await (uncertainSnapshotTools.getHealthSummarySnapshot as any).execute({})

      expect(r.success).toBe(true)
      expect(r.incomplete).toBe(true)
      expect(r.canConcludeAbsence).toBe(false)
      expect(r.data.conditions).toHaveLength(1)
      expect(r.data.medications).toEqual([])
      expect(r.data.medicationsWithUncertainStatus).toEqual([
        expect.objectContaining({
          name: 'Status-unknown drug',
          status: 'unknown',
          current: false,
          currentness: 'uncertain-source-status',
        }),
      ])
    })
  })

  describe('searchObservationByName', () => {
    it('finds by substring (English)', async () => {
      const r = await call('searchObservationByName', { query: 'HbA1c' })
      expect(r.count).toBeGreaterThan(0)
    })

    it('is case-insensitive', async () => {
      const r = await call('searchObservationByName', { query: 'hba1c' })
      expect(r.count).toBeGreaterThan(0)
    })

    it('default (no withTrend) returns latest per code', async () => {
      const r = await call('searchObservationByName', { query: 'HbA1c' })
      // Two HbA1c entries but only most recent should appear
      expect(r.count).toBe(1)
    })

    it('withTrend=true returns multiple per code, sorted desc', async () => {
      const r = await call('searchObservationByName', { query: 'HbA1c', withTrend: true })
      expect(r.count).toBe(2)
      expect(r.data[0].effectiveDateTime > r.data[1].effectiveDateTime).toBe(true)
    })

    it('matches Chinese substrings too', async () => {
      const r = await call('searchObservationByName', { query: 'Body Height' })
      expect(r.count).toBe(1)
    })

    it('finds a CA–199 observation when the user types CA199', async () => {
      const markerTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          observations: [{
            id: 'ca199-observation',
            status: 'final',
            code: { text: 'CA–199腫瘤標記 (EIA/LIA法)' },
            category: [{ coding: [{ code: 'laboratory' }] }],
            valueQuantity: { value: 31.83, unit: 'U/mL' },
            effectiveDateTime: '2025-12-09T00:00:00+08:00',
          }] as any,
          vitalSigns: [],
        },
      }))

      const result = await (markerTools.searchObservationByName as any).execute({
        query: 'CA199',
      })

      expect(result.count).toBe(1)
      expect(result.data[0]).toMatchObject({
        code: 'CA–199腫瘤標記 (EIA/LIA法)',
        value: 31.83,
        unit: 'U/mL',
      })
    })
  })

  describe('searchObservationByName — LOINC aliasing (stale-value-as-latest fix)', () => {
    // Real demo-bundle gotcha: one analyte is stored under DIFFERENT display
    // names across dates while sharing a single LOINC. eGFR's recent values sit
    // under text "Estimated GFR"; the oldest under "eGFR". CRP's latest sits
    // under one Chinese alias, older ones under another. Grouping by display
    // text splits the series and lets a stale value be returned as "latest";
    // grouping by LOINC keeps one dated series so the most-recent wins.
    const LOINC = 'http://loinc.org'
    const o = (id: string, text: string, code: string, value: number, date: string) =>
      ({
        id,
        code: {
          text,
          coding: [{ system: LOINC, code, display: 'Glomerular filtration rate (MDRD)' }],
        },
        category: [{ coding: [{ code: 'laboratory' }] }],
        valueQuantity: { value, unit: 'mL/min/1.73m2' },
        effectiveDateTime: `${date}T00:00:00+08:00`,
        status: 'final',
      }) as any
    const crp = (id: string, text: string, value: number, date: string) =>
      ({
        id,
        code: {
          text,
          coding: [{ system: LOINC, code: '1988-5', display: 'C reactive protein [Mass/volume] in Serum or Plasma' }],
        },
        category: [{ coding: [{ code: 'laboratory' }] }],
        valueQuantity: { value, unit: 'mg/dL' },
        effectiveDateTime: `${date}T00:00:00+08:00`,
        status: 'final',
      }) as any

    const aliasTools = createFhirTools(() => ({
      patient: samplePatient,
      collection: {
        ...sampleCollection,
        observations: [
          // eGFR — recent three under "Estimated GFR", oldest under "eGFR"
          o('egfr-1', 'Estimated GFR', '33914-3', 32, '2026-06-02'),
          o('egfr-2', 'Estimated GFR', '33914-3', 33, '2026-05-25'),
          o('egfr-3', 'Estimated GFR', '33914-3', 35, '2026-01-14'),
          o('egfr-4', 'eGFR', '33914-3', 36.3, '2025-12-09'),
          // CRP — latest under one Chinese alias, older under another
          crp('crp-1', 'C反應性蛋白試驗 -  免疫比濁法', 0.76, '2026-05-25'),
          crp('crp-2', 'C反應蛋白', 0.26, '2026-01-14'),
          crp('crp-3', 'C反應蛋白', 2.65, '2025-05-20'),
        ],
        vitalSigns: [],
      },
    }))
    const aCall = (args: any) => (aliasTools.searchObservationByName as any).execute(args)

    it('query "eGFR" returns the true latest (32) even though latest text is "Estimated GFR"', async () => {
      const r = await aCall({ query: 'eGFR' })
      expect(r.count).toBe(1) // one analyte, not split by display text
      expect(r.data[0].value).toBe(32)
      expect(r.data[0].effectiveDateTime.startsWith('2026-06-02')).toBe(true)
    })

    it('query "eGFR" does NOT return the stale 36.3 as latest', async () => {
      const r = await aCall({ query: 'eGFR' })
      expect(r.data[0].value).not.toBe(36.3)
    })

    it('withTrend collapses both display names into one date-sorted series', async () => {
      const r = await aCall({ query: 'eGFR', withTrend: true })
      expect(r.count).toBe(4)
      expect(r.data.map((d: any) => d.value)).toEqual([32, 33, 35, 36.3])
    })

    it('matching a coding.display synonym still resolves the analyte ("GFR")', async () => {
      const r = await aCall({ query: 'GFR' })
      expect(r.count).toBe(1)
      expect(r.data[0].value).toBe(32)
    })

    it('CRP: English synonym finds latest (0.76) despite Chinese-only text', async () => {
      const r = await aCall({ query: 'C reactive protein' })
      expect(r.count).toBe(1)
      expect(r.data[0].value).toBe(0.76)
    })

    it('CRP: two Chinese aliases collapse into one series, latest first', async () => {
      const r = await aCall({ query: 'C反應蛋白', withTrend: true })
      expect(r.data.map((d: any) => d.value)).toEqual([0.76, 0.26, 2.65])
    })

    it('distinct LOINCs do NOT merge: CRP search excludes eGFR', async () => {
      const r = await aCall({ query: 'C reactive protein', withTrend: true })
      expect(r.data.every((d: any) => d.unit === 'mg/dL')).toBe(true)
    })

    it('mixed coding: an uncoded entry inherits a same-text sibling LOINC (real "PT" case)', async () => {
      const mixedTools = createFhirTools(() => ({
        patient: samplePatient,
        collection: {
          ...sampleCollection,
          observations: [
            // newest entry has NO LOINC, older one does — same text "PT"
            {
              id: 'pt-new',
              code: { text: 'PT' },
              category: [{ coding: [{ code: 'laboratory' }] }],
              valueQuantity: { value: 11.2, unit: 'sec' },
              effectiveDateTime: '2026-06-02T00:00:00+08:00',
            },
            {
              id: 'pt-old',
              code: { text: 'PT', coding: [{ system: 'http://loinc.org', code: '5902-2', display: 'Prothrombin time' }] },
              category: [{ coding: [{ code: 'laboratory' }] }],
              valueQuantity: { value: 13.5, unit: 'sec' },
              effectiveDateTime: '2026-01-14T00:00:00+08:00',
            },
          ] as any,
          vitalSigns: [],
        },
      }))
      const r = await (mixedTools.searchObservationByName as any).execute({ query: 'PT', withTrend: true })
      expect(r.count).toBe(2) // one analyte, both dates in one series
      expect(r.data[0].value).toBe(11.2) // newest first, not split off
    })
  })

  describe('getRecentVisits', () => {
    it('returns sorted by date desc', async () => {
      const r = await call('getRecentVisits')
      const dates = r.data.map((v: any) => v.date)
      const sorted = [...dates].sort().reverse()
      expect(dates).toEqual(sorted)
    })

    it('type="inpatient" matches IMP encounter', async () => {
      const r = await call('getRecentVisits', { type: 'inpatient' })
      expect(r.count).toBe(1)
      expect(r.data[0].encounterId).toBe('enc-inpatient-1')
    })

    it('type="pharmacy" matches 藥局 type even with AMB class', async () => {
      const r = await call('getRecentVisits', { type: 'pharmacy' })
      expect(r.count).toBe(1)
      expect(r.data[0].encounterId).toBe('enc-pharm-1')
    })

    it('reports counts of meds/labs/procs per visit', async () => {
      const r = await call('getRecentVisits')
      const inpat = r.data.find((v: any) => v.encounterId === 'enc-inpatient-1')
      expect(inpat.medCount).toBe(1)   // 普拿疼
      expect(inpat.labCount).toBeGreaterThanOrEqual(0)
    })

    it('limit respects user-provided value', async () => {
      const r = await call('getRecentVisits', { limit: 2 })
      expect(r.count).toBe(2)
    })

    it('exposes primary ICD label', async () => {
      const r = await call('getRecentVisits', { type: 'inpatient' })
      expect(r.data[0].primaryIcd).toBe('I50.9')
    })
  })

  describe('listEncounterDepartments', () => {
    it('returns unique departments with visit counts', async () => {
      const r = await call('listEncounterDepartments')
      expect(r.count).toBeGreaterThan(0)
      const depts = r.data.map((d: any) => d.department)
      expect(depts).toContain('住院')
      expect(depts).toContain('門診')
      expect(depts).toContain('藥局')
      expect(depts).toContain('急診')
    })
  })

  describe('listAvailableObservationCodes', () => {
    it('returns unique observation names sorted by count desc', async () => {
      const r = await call('listAvailableObservationCodes')
      const codes = r.data.map((d: any) => d.code)
      expect(codes).toContain('HbA1c')
      expect(codes).toContain('WBC')
      expect(codes).toContain('Body Height')
      // HbA1c (2) should come before WBC (1)
      const hba1cIdx = codes.indexOf('HbA1c')
      const wbcIdx = codes.indexOf('WBC')
      expect(hba1cIdx).toBeLessThan(wbcIdx)
    })
  })

  describe('queryPatientInfo + PII scrub', () => {
    it('returns gender + age only', async () => {
      const r = await call('queryPatientInfo')
      expect(r.success).toBe(true)
      expect(r.data.gender).toBe('male')
      expect(typeof r.data.age).toBe('number')
    })

    it('does NOT return patient id', async () => {
      const r = await call('queryPatientInfo')
      expect(r.data.id).toBeUndefined()
    })

    it('does NOT return birthDate', async () => {
      const r = await call('queryPatientInfo')
      expect(r.data.birthDate).toBeUndefined()
    })

    it('labels demographics that came from the local user profile', async () => {
      const localTools = createFhirTools(() => ({
        patient: {
          ...samplePatient,
          demographicsSource: 'user-entered-local-profile',
        },
        collection: sampleCollection,
      }))
      const r = await (localTools.queryPatientInfo as any).execute({})
      expect(r.data.source).toBe('user-entered-local-profile')
      expect(r.data.name).toBeUndefined()
      expect(r.data.birthDate).toBeUndefined()
    })

    it('marks age as approximate when only a birth year is available', async () => {
      const yearOnlyTools = createFhirTools(() => ({
        patient: {
          ...samplePatient,
          birthDate: '1980',
        },
        collection: sampleCollection,
      }))
      const r = await (yearOnlyTools.queryPatientInfo as any).execute({})
      expect(typeof r.data.age).toBe('number')
      expect(r.data.ageApproximate).toBe(true)
      expect(r.data.birthDate).toBeUndefined()
    })
  })

  describe('Realistic LLM query scenarios', () => {
    it('"past 2 years inpatient" → queryEncounters returns IMP', async () => {
      const r = await call('queryEncounters', {
        class: 'inpatient',
        dateFrom: '2024-01-01',
        dateTo: '2026-12-31',
      })
      expect(r.count).toBeGreaterThan(0)
    })

    it('"what is the patient currently on?" → getActiveMedicationList', async () => {
      const r = await call('getActiveMedicationList')
      expect(r.count).toBeGreaterThan(0)
    })

    it('"abnormal labs" → queryDiagnosticReports abnormalOnly', async () => {
      const r = await call('queryDiagnosticReports', { abnormalOnly: true })
      expect(r.count).toBeGreaterThan(0)
    })

    it('"HbA1c trend" → searchObservationByName withTrend', async () => {
      const r = await call('searchObservationByName', { query: 'HbA1c', withTrend: true })
      expect(r.count).toBeGreaterThan(1)
    })

    it('"what visits did the patient have at 長庚?" → queryEncounters institution', async () => {
      const r = await call('queryEncounters', { institution: '長庚' })
      expect(r.count).toBeGreaterThan(0)
    })

    it('"what departments has patient seen?" → listEncounterDepartments', async () => {
      const r = await call('listEncounterDepartments')
      expect(r.count).toBeGreaterThan(0)
    })

    it('"recent visits summary" → getRecentVisits', async () => {
      const r = await call('getRecentVisits', { limit: 5 })
      expect(r.count).toBeGreaterThan(0)
    })

    it('"specific visit detail" → getEncounterDetails after getRecentVisits', async () => {
      const recent = await call('getRecentVisits', { type: 'inpatient', limit: 1 })
      const id = recent.data[0].encounterId
      const detail = await call('getEncounterDetails', { encounterId: id })
      expect(detail.success).toBe(true)
      expect(detail.data.diagnoses.length).toBeGreaterThan(0)
    })

    it('"chronic meds (慢箋)" → getActiveMedicationList chronicOnly', async () => {
      const r = await call('getActiveMedicationList', { chronicOnly: true })
      expect(r.count).toBeGreaterThan(0)
      expect(r.data.every((m: any) => m.chronic === true)).toBe(true)
    })
  })
})
