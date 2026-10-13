/**
 * @jest-environment node
 *
 * queryLabResultsByCategory for 免疫: one NHI order bills several analytes
 * (12064B = SS-A + SS-B + Ro52), all sharing the order's panel name in
 * code.text. The AI tool must group them by the same analyte identity as the
 * cumulative report, and must not let an empty category answer stand in for
 * specific-allergen IgE, which is kept out of every lab category.
 */
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { labResultsByCategorySchema } from '@/src/infrastructure/ai/tools/fhir-tool-schemas'
import { en } from '@/src/shared/i18n/locales/en'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { samplePatient, sampleCollection } from './fixtures'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'
const PANEL = '可抽出的核抗體測定— Ro/La 抗體'

function labObs(id: string, nhi: string, nhiDisplay: string, text: string, item: string, value: any) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: {
      text,
      coding: [
        { system: NHI, code: nhi, display: nhiDisplay },
        { system: LOCAL, code: item, display: item },
      ],
    },
    effectiveDateTime: '2026-03-01T08:00:00+08:00',
    ...value,
  }
}

const observations = [
  labObs('ssa', '12064B', PANEL, PANEL, 'SS-A/Ro Ab', { valueQuantity: { value: 2, unit: 'U/mL' } }),
  labObs('ssb', '12064B', PANEL, PANEL, 'SS-B/La Ab', { valueQuantity: { value: 3, unit: 'U/mL' } }),
  labObs('ro52', '12064B', PANEL, PANEL, 'Ro52', { valueString: 'Negative' }),
  labObs('mould', '30022C', '特異過敏原免疫檢驗', '混合黴菌', '混合黴菌', { valueString: 'Class 0' }),
]

const tools = createFhirTools(() => ({
  patient: samplePatient,
  collection: { ...sampleCollection, observations: observations as any, vitalSigns: [] },
}))

describe('queryLabResultsByCategory — 免疫', () => {
  it('returns SS-A, SS-B and Ro52 as three analytes sharing one panel name', async () => {
    const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'immuno' })
    expect(result.analyteCount).toBe(3)
    expect(result.observationCount).toBe(3)
    expect(result.availableAnalytes).toEqual(expect.arrayContaining(['SS-A/Ro', 'SS-B/La', 'Ro52']))
    const ids = result.data.flatMap((group: any) => group.results.map((r: any) => r.value))
    expect(ids).toEqual(expect.arrayContaining([2, 3, 'Negative']))
  })

  it('says specific-allergen IgE is not covered, so absence is not concluded for allergens', async () => {
    const result = await (tools.queryLabResultsByCategory as any).execute({ category: 'immuno' })
    expect(JSON.stringify(result.data)).not.toContain('混合黴菌')
    expect(result.excludedFromCategory).toMatchObject({ specificAllergenIgE: 1 })
    expect(result.excludedFromCategory.instruction).toMatch(/searchObservationByName/)
  })

  it('still finds the allergen row through searchObservationByName', async () => {
    const result = await (tools.searchObservationByName as any).execute({ query: '混合黴菌' })
    expect(JSON.stringify(result)).toContain('Class 0')
  })

  it('no longer advertises allergens under the immuno category', () => {
    const description = (labResultsByCategorySchema.shape.category as any).description as string
    expect(description).not.toMatch(/allergen/i)
    expect(description).toMatch(/searchObservationByName/)
    for (const text of [
      (en as any).agent.systemPrompt.toolDescriptions.queryLabResultsByCategory,
      (zhTW as any).agent.systemPrompt.toolDescriptions.queryLabResultsByCategory,
    ]) {
      expect(text).toBeTruthy()
      expect(text).not.toMatch(/allergens\)|過敏原）/)
      expect(text).toMatch(/searchObservationByName/)
    }
  })
})
