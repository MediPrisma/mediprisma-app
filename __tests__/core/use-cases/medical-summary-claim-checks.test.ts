// The app's own checks on what a model writes in 初診快覽: a severity stays
// on the finding the report gives it, a trend arrow needs dated records in
// order and comparable units, a medicine is called lapsed only when it was
// dispensed and ran out, and a 需核對 survives another card's retry.
// Synthetic fixtures only (PR #237 review, 2026-10-03).
import {
  buildSourceCatalog,
  generateMedicalSummaryUseCase as useCase,
} from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { buildOverviewSnapshot } from '@/src/core/use-cases/medical-summary/overview-snapshot'
import { selectMedicationRecords } from '@/src/core/utils/clinical-context-selection.utils'

const RAD = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]
const report = (id: string, date: string, conclusion: string, title = 'Echocardiography') =>
  ({ id, status: 'final', category: RAD, code: { text: title }, effectiveDateTime: date, conclusion })

function reportPoint(quote: string, text: string) {
  const clinicalData: any = { diagnosticReports: [report('echo', '2026-01-01', quote)] }
  const catalog = buildSourceCatalog(clinicalData)
  const key = catalog[0].key
  return useCase.finalizeResult({
    ...useCase.createEmptyAiResult(),
    reports: { groups: [{ organ: 'heart', points: [{ text, sources: [key], quotes: [{ source: key, quote }] }] }], unremarkable: [] },
  }, catalog, { clinicalData, audience: 'medical' }).reportHighlights!.groups[0].points[0]
}

describe('severity stays on its finding', () => {
  it.each([
    // Two findings in one sentence: "moderate" belongs to the hypertension.
    ['Severe tricuspid regurgitation and moderate pulmonary hypertension.', 'Moderate tricuspid regurgitation and pulmonary hypertension'],
    // A severity written after its finding.
    ['Severe tricuspid regurgitation. Moderate pulmonary hypertension.', 'Tricuspid regurgitation (moderate); pulmonary hypertension (moderate)'],
    // Shared words: the regurgitation the report calls moderate is tricuspid.
    ['Severe mitral regurgitation, moderate tricuspid regurgitation.', 'Moderate mitral regurgitation'],
    // "with" hangs each severity on its valve (f209 review).
    ['Mitral valve with severe regurgitation. Tricuspid valve with moderate regurgitation.', 'Moderate mitral regurgitation'],
    // A range is not narrowed to one end.
    ['Mild-to-moderate mitral regurgitation.', 'Moderate mitral regurgitation'],
  ])('falls back to the quote: %s', (quote, text) => {
    expect(reportPoint(quote, text).displayAs).toBe('quote')
  })

  it.each([
    ['Severe tricuspid regurgitation and moderate pulmonary hypertension.', 'Severe tricuspid regurgitation; moderate pulmonary hypertension'],
    ['Severe tricuspid regurgitation.', 'Tricuspid regurgitation (severe)'],
    ['Mitral valve with moderate regurgitation.', 'Moderate mitral regurgitation'],
    ['Moderate to severe tricuspid regurgitation.', 'Moderate to severe tricuspid regurgitation'],
    ['Mitral valve with severe regurgitation. Tricuspid valve with moderate regurgitation.', 'Severe mitral regurgitation; moderate tricuspid regurgitation'],
    ['Mild-to-moderate mitral regurgitation.', 'Mild to moderate mitral regurgitation'],
  ])('keeps a faithful line: %s', (quote, text) => {
    expect(reportPoint(quote, text).displayAs).toBe('text')
  })
})

describe('a metric trend', () => {
  const ct = { diagnosticReports: [report('old', '2026-01-01', 'Mass measures 5 cm.', 'CT chest'), report('new', '2026-02-01', 'Mass measures 2 cm.', 'CT chest')] } as any
  const finalizeMetric = (clinicalData: any, metric: string | undefined) => {
    const catalog = buildSourceCatalog(clinicalData)
    return useCase.finalizeResult({
      ...useCase.createEmptyAiResult(),
      problems: [{ label: 'Finding', ...(metric ? { metric } : {}), metricSources: catalog.map((entry) => entry.key) }],
    }, catalog, { clinicalData, audience: 'medical' }).problems[0]
  }

  it('without dates is tied to the records that state its values', () => {
    expect(finalizeMetric(ct, 'Size 2 → 5 cm')).toEqual(expect.objectContaining({ metric: '5 cm；Size 2', metricNeedsReview: true }))
    const forward = finalizeMetric(ct, 'Size 5 → 2 cm')
    expect(forward.metric).toBe('Size 5 → 2 cm')
    expect(forward.metricNeedsReview).toBeUndefined()
  })

  it.each([
    // Values and dates paired the wrong way round (f209 review).
    'Size 2 cm (2026-01-01) → 5 cm (2026-02-01)',
    // Dates no cited record bears.
    'Size 5 cm (2024-01-01) → 2 cm (2024-02-01)',
  ])('with written dates is checked against the records too: %s', (metric) => {
    expect(finalizeMetric(ct, metric).metricNeedsReview).toBe(true)
  })

  it('with written dates that the records bear keeps its arrow', () => {
    const line = finalizeMetric(ct, 'Size 5 cm (2026-01-01) → 2 cm (2026-02-01)')
    expect(line.metric).toBe('Size 5 cm (2026-01-01) → 2 cm (2026-02-01)')
    expect(line.metricNeedsReview).toBeUndefined()
  })

  it('is not drawn between different, unconverted units', () => {
    const glucose = (id: string, date: string, value: number, unit: string) => ({
      id, status: 'final', effectiveDateTime: date, valueQuantity: { value, unit },
      code: { text: 'Glucose', coding: [{ system: 'http://loinc.org', code: '2345-7' }] },
    })
    const metric = finalizeMetric({ observations: [glucose('old', '2026-01-01', 90, 'mg/dL'), glucose('new', '2026-02-01', 5, 'mmol/L')] }, undefined).metric
    expect(metric).not.toContain('→')
    expect(metric).toContain('90 mg/dL (2026-01-01)')
    expect(metric).toContain('5 mmol/L (2026-02-01)')
  })
})

describe('a lapsed medicine', () => {
  const NOW = Date.parse('2026-02-01')
  const supply28 = { dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'd' } } }

  it('in the overview is never an order that was not dispensed', () => {
    for (const status of ['draft', 'cancelled', 'entered-in-error']) {
      const clinicalData: any = { medications: [{ id: 'm', status, authoredOn: '2026-01-01', medicationCodeableConcept: { text: 'SyntheticDrug' } }] }
      const snapshot = buildOverviewSnapshot({ clinicalData, catalog: buildSourceCatalog(clinicalData), patient: { id: 'p', gender: 'male', birthDate: '1970-01-01' } as any }, { nowMs: NOW, locale: 'en' })
      expect(snapshot.clinicalContext).not.toContain('SyntheticDrug')
    }
  })

  it('in the overview is a dispensing whose supply ran out', () => {
    const clinicalData: any = { medications: [{ id: 'm', status: 'completed', authoredOn: '2025-12-01', medicationCodeableConcept: { text: 'SyntheticDrug' }, ...supply28 }] }
    const snapshot = buildOverviewSnapshot({ clinicalData, catalog: buildSourceCatalog(clinicalData), patient: { id: 'p', gender: 'male', birthDate: '1970-01-01' } as any }, { nowMs: NOW, locale: 'en' })
    expect(snapshot.clinicalContext).toContain('SyntheticDrug')
    expect(snapshot.clinicalContext).toContain('last dispensed 2025-12-01 (supply ended)')
  })

  it('in the full lane keeps the 急慢性 filter and needs a passed supply', () => {
    const chronic = { courseOfTherapyType: { coding: [{ code: 'continuous' }] } }
    const filters = { medicationStatus: 'active', medicationChronic: 'acute', medicationTimeRange: 'all' } as any
    // A current chronic medicine the acute filter left out is not lapsed.
    expect(selectMedicationRecords([{ id: 'c', status: 'active', authoredOn: '2026-01-01', medicationCodeableConcept: { text: 'Chronic' }, ...chronic }], filters, null, NOW).floor).toEqual([])
    // A chronic dispensing that ran out stays out under the acute filter too.
    expect(selectMedicationRecords([{ id: 'c', status: 'completed', authoredOn: '2025-12-01', medicationCodeableConcept: { text: 'Chronic' }, ...chronic, ...supply28 }], filters, null, NOW).floor).toEqual([])
    // An acute dispensing that ran out is the floor's to add.
    const acute = { id: 'a', status: 'completed', authoredOn: '2025-12-01', medicationCodeableConcept: { text: 'Acute' }, ...supply28 }
    expect(selectMedicationRecords([acute], filters, null, NOW).floor).toEqual([acute])
    // No supply estimate: unknown, not lapsed.
    expect(selectMedicationRecords([{ id: 'u', status: 'unknown', authoredOn: '2025-12-01', medicationCodeableConcept: { text: 'Unknown' } }], { ...filters, medicationChronic: 'all' }, null, NOW).floor).toEqual([])
  })
})

describe('a 需核對 across retries', () => {
  const clinicalData: any = { diagnosticReports: [report('pwv', '2026-01-01', 'Right baPWV 1200 cm/s; left baPWV 1300 cm/s.', 'baPWV')] }
  const catalog = buildSourceCatalog(clinicalData)
  const keys = catalog.map((entry) => entry.key)
  const first = useCase.finalizeResult({
    ...useCase.createEmptyAiResult(),
    problems: [{ label: 'baPWV', metric: '1200 → 1300 cm/s', metricSources: keys }],
  }, catalog, { clinicalData, audience: 'medical' })

  it('survives another card\'s retry', () => {
    expect(first.problems[0].metricNeedsReview).toBe(true)
    const retained = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData, audience: 'medical' })
    expect(retained.problems[0]).toEqual(expect.objectContaining({ metric: '1200；1300 cm/s', metricNeedsReview: true }))
  })

  it('is decided afresh when the problems card itself is regenerated', () => {
    const draft = useCase.mergeModuleResult(useCase.createAiDraftFromResult(first), 'problems', {
      problems: [{ label: 'baPWV', metric: '1200；1300 cm/s', metricSources: keys }],
    } as any)
    expect(useCase.finalizeResult(draft, catalog, { clinicalData, audience: 'medical' }).problems[0].metricNeedsReview).toBeUndefined()
  })

  it('cannot be set by the model', () => {
    const parsed = useCase.parseModuleResult('problems', JSON.stringify({
      problems: [{ label: 'x', basisSources: ['C1'] }],
      problemsCarriedMetricReview: ['x\u0000y'],
    }))
    expect(parsed).not.toHaveProperty('problemsCarriedMetricReview')
  })
})
