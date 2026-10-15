import { buildSourceCatalog, formatSourceList, GenerateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { GenerateSafetyAlertsUseCase } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'
import { LAB_SOURCE_EVIDENCE_RULE } from '@/src/core/use-cases/medical-summary/source-evidence-contract'
import { enrichLocalFhirImport } from '@/src/application/services/local-fhir-import-enrichment.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

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
  expect(facts).toContain(`[${key('occult')}]`)
  expect(formatSourceList(catalog)).toContain('= Negative')
  expect(facts).toContain(`[${key('cells')}]`)
  expect(formatSourceList(catalog)).toContain('= 6–9 /HPF')
  const electrolyteFacts = catalog.find(entry => entry.resourceId === 'electrolytes')!.observationFacts!
  expect(electrolyteFacts).toContain(`[${key('sodium')}]`)
  expect(formatSourceList(catalog)).toContain('= 139 mmol/L')
  expect(formatSourceList(catalog)).toContain('= 4.1 mmol/L')
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

test.each(['N/A', 'Billing codes N40.0', 'Synthetic product'])('does not promote non-metric panel text to a warning: %s', metric => {
  expect(row(metric, 'urine-panel').metric).toBeUndefined()
})

test('a redundant panel key does not invalidate a correctly named individual result', () => {
  const result = useCase.finalizeResult({ headline: '', problems: [{ label: 'Finding', metric: 'WBC/HPF 6–9 /HPF', metricSources: [key('urine-panel'), key('cells')] }] } as any, catalog, { clinicalData: data }).problems[0]
  expect(result.metric).toContain('6–9 /HPF')
  expect(result.metricNeedsReview).toBeUndefined()
})

test('redundant panel dates do not manufacture an individual result trend', () => {
  const sources = catalog.map(entry => entry.resourceId === 'urine-panel' ? { ...entry, date: '2025-01-01' } : entry)
  const result = useCase.finalizeResult({ headline: '', problems: [{ label: 'Finding', metric: 'WBC/HPF 6–9 /HPF', metricSources: [key('urine-panel'), key('cells')] }] } as any, sources, { clinicalData: data }).problems[0]
  expect(result.metricMeta).toBe(date)
})

test('retains specimen qualifiers and emits each fact once, including urine creatinine and glucose', () => {
  const sources = buildSourceCatalog({ observations: [
    { id: 'u1', code: { text: 'Urine Creatinine' }, valueQuantity: { value: 82, unit: 'mg/dL' } },
    { id: 'u2', code: { text: 'Urine Glucose' }, valueCodeableConcept: { text: 'Negative' } },
  ], diagnosticReports: [{ id: 'panel', code: { text: 'Urine panel' }, result: [{ reference: 'Observation/u1' }, { reference: 'Observation/u2' }] }] } as any)
  const text = formatSourceList(sources)
  expect(text).toContain('Urine Creatinine')
  expect(text).toContain('Urine Glucose')
  expect(text.match(/= 82 mg\/dL/g)).toHaveLength(1)
})

test('standalone safety prompt receives the same source-owned facts', () => {
  const messages = new GenerateSafetyAlertsUseCase().buildMessages({ clinicalContext: '', catalog, locale: 'en', audience: 'medical' } as any)
  const text = messages.map(message => message.content).join('\n')
  expect(text).toContain('= Negative')
  expect(text).toContain('6–9 /HPF')
})

test('uses the production import boundary before checking ingredient and mechanism delivery', async () => {
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic-patient' } },
    { resource: { resourceType: 'MedicationRequest', id: 'synthetic-medication', status: 'active', intent: 'order', authoredOn: date,
      subject: { reference: 'Patient/synthetic-patient' }, medicationCodeableConcept: { text: 'Synthetic source name', coding: [
        { system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code', code: 'AC49322100' },
      ] } } },
  ] }
  const parsed = LocalBundleService.parse(await enrichLocalFhirImport(bundle))!
  expect(parsed).not.toBeNull()
  const medication = parsed.collection.medications![0]
  expect(medication.drugTerminology?.ingredientText).toBeTruthy()
  expect(medication.drugTerminology?.atcCode).toBeTruthy()
  const sources = buildSourceCatalog(parsed.collection)
  const entry = sources.find(source => source.resourceType === 'MedicationRequest')!
  expect(entry.medicationClass).toContain(medication.drugTerminology!.atcNameEn!.toLowerCase())
  expect(entry.medicine?.mechanism).toBeTruthy()
  const safety = new GenerateSafetyAlertsUseCase().buildMessages({ clinicalContext: '', catalog: sources, locale: 'en' } as any)
  expect(safety.map(message => message.content).join('\n')).toContain(entry.medicationClass)
  expect(formatSourceList(sources)).toContain(entry.medicationClass)
})

test.each([
  [{ low: { value: 0, unit: 'U' }, high: { value: 2, unit: 'U' } }, '0–2 U'],
  [{ low: { value: 5, unit: 'U' } }, '≥5 U'],
  [{ high: { value: 2, unit: 'U' } }, '≤2 U'],
  [{ low: { value: 1, unit: 'mg' }, high: { value: 2, unit: 'g' } }, '1 mg–2 g'],
])('preserves range bounds and units: %j', (valueRange, expected) => {
  const sources = buildSourceCatalog({ observations: [{ id: 'range', code: { text: 'Synthetic assay' }, valueRange }] } as any)
  expect(sources[0].observationFacts).toContain(`= ${expected}`)
})

test.each(['local-small', 'frontier'])('uses the same general evidence rule for %s, without case-specific instructions', harnessProfile => {
  const messages = useCase.buildMessages({ clinicalContext: '', catalog: [], locale: 'en', harnessProfile } as any)
  const system = String(messages[0].content)
  expect(system).toContain(LAB_SOURCE_EVIDENCE_RULE)
  expect(LAB_SOURCE_EVIDENCE_RULE).not.toMatch(/patient[145]|MINIRIN|1544|1547|OCCULT|urine|thyroid/i)
})
