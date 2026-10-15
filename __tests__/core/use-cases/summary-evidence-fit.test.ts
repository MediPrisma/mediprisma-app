import { labClaimConflicts, reportOrganFromQuotes, pathologySpecimenDescriptors } from '@/src/core/utils/summary-evidence-fit.utils'
import { buildReportPromptBody, deterministicReportExcerpt } from '@/src/core/use-cases/medical-summary/report-digest'
import { buildSourceCatalog, GenerateMedicalSummaryUseCase, finalizeReportHighlights } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

test.each([
  ['Hyperuricemia', ['Urine Protein'], true],
  ['Hyperuricemia', ['Uric acid'], false],
  ['Hypokalemia', ['Sodium'], true],
  ['Hypokalemia', ['Potassium'], false],
  ['Anemia', ['Hemoglobin'], false],
  ['Unknown condition', ['Unfamiliar test'], false],
])('checks narrow biochemical evidence without diagnosing: %s', (label, names, conflict) => {
  expect(labClaimConflicts(label, names.map(name => ({ code: { text: name } })))).toBe(conflict)
})

test('unrelated lab-only disease remains visible and flagged, with verified metric and date preserved', () => {
  const data: any = { observations: [{ id: 'protein', code: { text: 'Urine Protein' }, valueQuantity: { value: 17, unit: 'mg/dL' }, effectiveDateTime: '2026-01-01' }] }
  const catalog = buildSourceCatalog(data)
  const result = new GenerateMedicalSummaryUseCase().finalizeResult({ headline: '', problems: [{ label: 'Hyperuricemia', kind: 'lab', basisSources: [catalog[0].key], metricSources: [catalog[0].key], metric: 'PROT 17 mg/dL' }] } as any, catalog, { clinicalData: data })
  expect(result.problems[0]).toMatchObject({ label: 'Hyperuricemia', flag: true, metric: 'PROT 17 mg/dL' })
  expect(result.problems[0].metricMeta).toBe('2026-01-01')
  expect(result.problems[0].metricNeedsReview).toBeUndefined()
})

test.each([
  ['gynecologic', 'Bone, humeral head, fracture.', 'musculoskeletal'],
  ['musculoskeletal', 'Uterine leiomyoma.', 'gynecologic'],
  ['other', 'Renal cortical cyst.', 'kidney-urinary'],
  ['heart', 'Liver and lung lesions.', 'other'],
  ['heart', 'No specific anatomical term.', 'heart'],
])('uses verified anatomy across organs: %s / %s', (proposed, quote, expected) => {
  expect(reportOrganFromQuotes(proposed as any, [quote])).toBe(expected)
})

test('regroups an actual verified pathology quote without losing the finding or source', () => {
  const data: any = { diagnosticReports: [{ id: 'path', code: { text: 'Surgical pathology' }, category: [{ text: 'pathology' }], conclusion: 'Bone, femoral head, fracture.', effectiveDateTime: '2026-01-01' }] }
  const catalog = buildSourceCatalog(data)
  const key = catalog.find(entry => entry.resourceId === 'path')!.key
  const result = finalizeReportHighlights({ groups: [{ organ: 'gynecologic', points: [{ text: 'Femoral head fracture', sources: [key], quotes: [{ source: key, quote: 'Bone, femoral head, fracture.' }] }] }], unremarkable: [] }, data, catalog)
  expect(result.groups[0].organ).toBe('musculoskeletal')
  expect(result.groups[0].points[0].sources[0].key).toBe(key)
})

test('a short quote uses only unambiguous source anatomy, never an unrelated report', () => {
  expect(reportOrganFromQuotes('gynecologic', ['Fracture'], ['Bone, femoral head. Diagnosis: Fracture.'])).toBe('musculoskeletal')
  expect(reportOrganFromQuotes('other', ['Cyst'], ['Liver cyst. Renal cyst.'])).toBe('other')
  expect(reportOrganFromQuotes('heart', ['Tricuspid regurgitation'], ['Lungs clear. Tricuspid regurgitation.'])).toBe('heart')
})

test.each([
  ['abdomen-liver-biliary', 'Arterial phase hyperenhancement with washout'],
  ['brain', 'Mild ventriculomegaly'],
  ['brain', 'Dilated lateral ventricle'],
])('does not mistake acquisition wording or shared anatomy for another organ', (organ, quote) => {
  expect(reportOrganFromQuotes(organ as any, [quote])).toBe(organ)
})

test('sex and clinical history cannot establish finding anatomy', () => {
  expect(reportOrganFromQuotes('breast', ['Nodule'], ['Female, 60 y/o'])).toBe('breast')
})

test.each([
  ['Hypokalemia', '鉀'], ['Hyponatremia', '鈉'], ['Hypercalcemia', '鈣'],
  ['Hyperglycemia', 'Hb A1c'], ['Hyperglycemia', 'A1C'], ['Hyperglycemia', 'Glu-PC'],
  ['Hypercalcemia', 'iCa'], ['Anemia', 'Ferritin'], ['Anemia', '血色素'],
])('recognizes aliases or defers broad diagnoses: %s / %s', (label, name) => {
  expect(labClaimConflicts(label, [{ code: { text: name } }])).toBe(false)
})

test('tumour marker Ca spelling is not calcium', () => {
  expect(labClaimConflicts('Hypercalcemia', [{ code: { text: 'CA-125' } }])).toBe(true)
})

test('numbered pathological diagnosis supplies anatomy but clinical history does not', () => {
  const data: any = { diagnosticReports: [{ id: 'p', code: { text: 'Pathology' }, category: [{ text: 'pathology' }], conclusion: 'Clinical history: uterine fibroid\n病理診斷 1：Bone, humeral head\nFracture\nGross description:\nTissue received.' }] }
  const catalog = buildSourceCatalog(data)
  const key = catalog[0].key
  const result = finalizeReportHighlights({ groups: [{ organ: 'gynecologic', points: [{ text: 'Fracture', sources: [key], quotes: [{ source: key, quote: 'Fracture' }] }] }], unremarkable: [] }, data, catalog)
  expect(result.groups[0].organ).toBe('musculoskeletal')
})

test('coded fasting glucose supports a glucose claim', () => {
  expect(labClaimConflicts('Hyperglycemia', [{ code: { coding: [{ system: 'http://loinc.org', code: '1558-6' }] } }])).toBe(false)
})

test.each([
  ['head-neck', 'Mucosal thickening of maxillary sinus'],
  ['musculoskeletal', 'Lumbar spondylosis'],
  ['abdomen-liver-biliary', 'Gall bladder stone'],
  ['abdomen-liver-biliary', 'Gall-bladder stone'],
  ['abdomen-liver-biliary', '肝血管瘤'],
  ['heart', 'Coronary artery calcification'],
  ['gynecologic', '骨盆腔腫塊'],
])('preserves organ identity in overlapping anatomical wording: %s / %s', (organ, quote) => {
  expect(reportOrganFromQuotes(organ as any, [quote])).toBe(organ)
})

test('multiple specimens use the quoted diagnosis section, not the last specimen', () => {
  const data: any = { diagnosticReports: [{ id: 'multi', code: { text: 'Pathology' }, category: [{ text: 'pathology' }], conclusion: '病理診斷 1：Uterus, myometrium\nLeiomyoma\n病理診斷 2：Bone, femoral head\nFracture' }] }
  const catalog = buildSourceCatalog(data)
  const key = catalog[0].key
  const result = finalizeReportHighlights({ groups: [{ organ: 'gynecologic', points: [{ text: 'Leiomyoma', sources: [key], quotes: [{ source: key, quote: 'Leiomyoma' }] }] }], unremarkable: [] }, data, catalog)
  expect(result.groups[0].organ).toBe('gynecologic')
})

test.each([
  ['kidney-urinary', 'Sonar Diagnosis:\n1. Fatty liver.\n2. Right hydronephrosis.', 'Right hydronephrosis.'],
  ['abdomen-other', 'Impression:\n1. Bilateral pleural effusion.\n2. Splenomegaly.', 'Splenomegaly.'],
])('never borrows anatomy from sibling imaging findings', (organ, conclusion, quote) => {
  const data: any = { diagnosticReports: [{ id: 'imaging', code: { text: 'Abdominal ultrasound' }, category: [{ text: 'radiology' }], conclusion }] }
  const catalog = buildSourceCatalog(data)
  const key = catalog[0].key
  const result = finalizeReportHighlights({ groups: [{ organ, points: [{ text: quote, sources: [key], quotes: [{ source: key, quote }] }] }], unremarkable: [] }, data, catalog)
  expect(result.groups[0].organ).toBe(organ)
})

test('a preceding diagnosis is not a pathology specimen descriptor', () => {
  expect(pathologySpecimenDescriptors('Diagnosis:\nLymph node metastasis\nAdenocarcinoma', ['Adenocarcinoma'])).toEqual([])
})

test('numbered specimen parsing does not change report excerpt or prompt visibility', () => {
  const text = '病理診斷 1：Uterus, myometrium\nLeiomyoma\n病理診斷 2：Bone, femoral head\nFracture'
  expect(deterministicReportExcerpt(text)?.excerpt).toContain('Leiomyoma')
  expect(buildReportPromptBody(text).text).toContain('Leiomyoma')
  expect(buildReportPromptBody(text).text.indexOf('Leiomyoma')).toBeLessThan(buildReportPromptBody(text).text.indexOf('Fracture'))
  expect(pathologySpecimenDescriptors(text, ['Leiomyoma'])).toEqual(['Uterus, myometrium'])
  expect(pathologySpecimenDescriptors(text, ['Fracture'])).toEqual(['Bone, femoral head'])
})
