import { buildSourceCatalog, formatSourceList, GenerateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { GenerateSafetyAlertsUseCase } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'
import { LAB_SOURCE_EVIDENCE_RULE } from '@/src/core/use-cases/medical-summary/source-evidence-contract'

const date = '2026-07-01'
const data: any = {
  observations: [
    { id: 'occult', code: { text: 'Occult blood' }, valueCodeableConcept: { text: 'Negative' }, effectiveDateTime: date },
    { id: 'cells', code: { text: 'WBC/HPF' }, valueRange: { low: { value: 6, unit: '/HPF' }, high: { value: 9, unit: '/HPF' } }, effectiveDateTime: date },
    { id: 'sodium', code: { text: 'Na' }, valueQuantity: { value: 139, unit: 'mmol/L' }, effectiveDateTime: date },
    { id: 'potassium', code: { text: 'K' }, valueQuantity: { value: 4.1, unit: 'mmol/L' }, effectiveDateTime: date },
  ],
  diagnosticReports: [
    { id: 'urine-panel', code: { text: 'Urinalysis' }, result: [{ reference: 'Observation/occult' }, { reference: 'Observation/cells' }], effectiveDateTime: date },
    { id: 'electrolytes', code: { text: 'Electrolyte panel' }, result: [{ reference: 'Observation/sodium' }, { reference: 'Observation/potassium' }], effectiveDateTime: date },
  ],
  medications: [
    { id: 'unknown-brand', medicationCodeableConcept: { text: 'Synthetic product', coding: [{ system: 'http://www.whocc.no/atc', code: 'H01BA02' }] }, authoredOn: date },
    { id: 'other-brand', medicationCodeableConcept: { text: 'Another product', coding: [{ system: 'https://www.whocc.no/atc/', code: 'S01EA05' }] }, authoredOn: date },
    { id: 'thyroid', medicationCodeableConcept: { text: 'Replacement product', coding: [{ system: 'http://www.whocc.no/atc', code: 'H03AA01' }] }, authoredOn: date },
  ],
}
const catalog = buildSourceCatalog(data)
const key = (id: string) => catalog.find(entry => entry.resourceId === id)!.key
const useCase = new GenerateMedicalSummaryUseCase()
const row = (metric: string, id: string) => useCase.finalizeResult({ headline: '', problems: [{ label: 'Finding', metric, metricSources: [key(id)] }] } as any, catalog, { clinicalData: data }).problems[0]

test('pairs panel members with their own names, values and existing Observation keys', () => {
  const facts = catalog.find(entry => entry.resourceId === 'urine-panel')!.observationFacts!
  expect(facts).toContain(`[${key('occult')}] OCCULT = Negative`)
  expect(facts).toContain(`[${key('cells')}] WBC/HPF = 6–9 /HPF`)
  const electrolyteFacts = catalog.find(entry => entry.resourceId === 'electrolytes')!.observationFacts!
  expect(electrolyteFacts).toContain('Na = 139 mmol/L')
  expect(electrolyteFacts).toContain('K = 4.1 mmol/L')
  expect(formatSourceList(catalog)).toContain(facts)
})

test.each([['OCCULT 6–9 /HPF', 'urine-panel'], ['Na 4.1 mmol/L', 'electrolytes']])('flags an unverified named value from a multi-test panel: %s', (metric, id) => {
  expect(row(metric, id)).toEqual(expect.objectContaining({ metric, metricNeedsReview: true }))
  expect(row(metric, id).metricMeta).toBeUndefined()
})

test('individual observations remain authoritative, including ranges', () => {
  const result = row('WBC/HPF 99 /HPF', 'cells')
  expect(result.metric).toContain('6–9 /HPF')
  expect(result.metricNeedsReview).toBeUndefined()
  expect(result.metricMeta).toBe(date)
  expect(row('Na 99 mmol/L', 'sodium').metric).toBe('Na 139 mmol/L')
})

test('reads original FHIR ATC without enrichment or brand-name matching', () => {
  const entry = catalog.find(entry => entry.resourceId === 'unknown-brand')!
  expect(entry.medicationClass).toContain('H01BA02')
  expect(entry.medicine?.mechanism).toContain('Vasopressin')
  expect(catalog.find(entry => entry.resourceId === 'other-brand')!.medicine?.mechanism).toBeTruthy()
  const result = useCase.finalizeResult({ headline: '', problems: [{ label: 'Hypothyroidism', medicationSources: [entry.key] }] } as any, catalog, { clinicalData: data })
  expect(result.problems[0]).toEqual(expect.objectContaining({ inferredFromMedication: true, medicationReviewKeys: [entry.key], flag: true }))
  const correct = useCase.finalizeResult({ headline: '', problems: [{ label: 'Hypothyroidism', medicationSources: [key('thyroid')] }] } as any, catalog, { clinicalData: data })
  expect(correct.problems[0].medicationReviewKeys).toBeUndefined()
  expect(correct.problems[0].flag).toBe(false)
})

test('standalone safety prompt receives the same source-owned facts and mechanism', () => {
  const messages = new GenerateSafetyAlertsUseCase().buildMessages({ clinicalContext: '', catalog, locale: 'en', audience: 'medical' } as any)
  const text = messages.map(message => message.content).join('\n')
  expect(text).toContain('OCCULT = Negative')
  expect(text).toContain('6–9 /HPF')
  expect(text).toContain('Vasopressin')
})

test('ignores lookalike codes from non-ATC systems and falls back past empty enrichment', () => {
  const meds = [
    { ...data.medications[0], id: 'lookalike', medicationCodeableConcept: { text: 'Unmapped', coding: [{ system: 'https://example.org/local', code: 'H01BA02' }] } },
    { ...data.medications[0], id: 'empty-enrichment', drugTerminology: { atcCode: ' ' } },
  ]
  const sources = buildSourceCatalog({ medications: meds })
  expect(sources.find(entry => entry.resourceId === 'lookalike')!.medicine).toBeUndefined()
  expect(sources.find(entry => entry.resourceId === 'empty-enrichment')!.medicine?.mechanism).toContain('Vasopressin')
})

test.each([
  [{ low: { value: 0, unit: 'U' }, high: { value: 2, unit: 'U' } }, '0–2 U'],
  [{ low: { value: 5, unit: 'U' } }, '≥5 U'],
  [{ high: { value: 2, unit: 'U' } }, '≤2 U'],
  [{ low: { value: 1, unit: 'mg' }, high: { value: 2, unit: 'g' } }, '1 mg–2 g'],
])('preserves range bounds and units: %j', (valueRange, expected) => {
  const sources = buildSourceCatalog({ observations: [{ id: 'range', code: { text: 'Synthetic assay' }, valueRange }] } as any)
  expect(sources[0].observationFacts).toContain(` = ${expected}`)
})

test.each(['local-small', 'frontier'])('uses the same general evidence rule for %s, without case-specific instructions', harnessProfile => {
  const messages = useCase.buildMessages({ clinicalContext: '', catalog: [], locale: 'en', harnessProfile } as any)
  const system = String(messages[0].content)
  expect(system).toContain(LAB_SOURCE_EVIDENCE_RULE)
  expect(LAB_SOURCE_EVIDENCE_RULE).not.toMatch(/patient[145]|MINIRIN|1544|1547|OCCULT|urine|thyroid/i)
})
