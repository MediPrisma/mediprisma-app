import {
  DEMO_CLINICAL_INSIGHT_GENERATION,
  DEMO_MEDICAL_SUMMARY_GENERATION,
  DEMO_SAFETY_SCAN_GENERATION,
  DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY,
  demoClinicalInsightSnapshots,
  demoMedicalSummarySnapshots,
  demoSafetyScanSnapshots,
  getDemoClinicalInsightSnapshot,
  remapDemoSnapshotSourceKeys,
} from '@/src/infrastructure/demo/demo-ai-snapshots'
import {
  buildSourceCatalog,
  generateMedicalSummaryUseCase,
  getSourceCatalog,
} from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import {
  listClinicalDocuments,
  resolveSelectedDocuments,
} from '@/src/core/utils/clinical-documents.utils'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { enrichBundleWithNhiDrugTerminology } from '@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service'
import {
  ALL_DATA_FILTERS,
  ALL_DATA_SELECTION,
  DEFAULT_DATA_FILTERS,
  DEFAULT_DATA_SELECTION,
} from '@/src/shared/constants/data-selection.constants'
import { DEMO_DATA_AS_OF_MS } from '@/src/shared/constants/demo-data.constants'
import {
  auditSafetyGrounding,
  auditSummaryGrounding,
  buildGroundingAuditInput,
} from '../../../scripts/lib/grounding-audit'

/** Every citation key in raw snapshot modules, by the schemas' citation
 *  fields: key lists ("sources", "basisSources", "metricSources",
 *  "medicationSources", "unremarkable") and single keys ("source", "ref",
 *  "managedByRef"). */
function collectCitedKeys(value: unknown, into = new Set<string>(), field?: string): Set<string> {
  const isKeyList = field === 'sources' || field === 'unremarkable' || /Sources$/.test(field ?? '')
  const isKey = field === 'source' || field === 'ref' || /Ref$/.test(field ?? '')
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === 'string') { if (isKeyList) into.add(item) } else collectCitedKeys(item, into)
    })
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectCitedKeys(item, into, key))
  } else if (isKey && typeof value === 'string') {
    into.add(value)
  }
  return into
}

describe('demo clinical-insight snapshots', () => {
  it('declares honest pre-generated model provenance without a fabricated time', () => {
    expect(DEMO_CLINICAL_INSIGHT_GENERATION).toEqual({
      source: 'pre-generated',
      modelId: 'gemini-3-flash-preview',
      modelName: 'Gemini 3 Flash Preview',
      provider: 'gemini',
    })
    expect(DEMO_CLINICAL_INSIGHT_GENERATION).not.toHaveProperty('generatedAt')
  })

  it('selects the bundled snapshot without consulting a retained model preference', () => {
    expect(getDemoClinicalInsightSnapshot(
      'demo-patient-1',
      'patient',
      'zh-TW',
      'health-overview',
    )?.text).toContain('截至 8 月 27 日')
  })

  it('never supplies a demo snapshot for a real patient', () => {
    expect(getDemoClinicalInsightSnapshot(
      'real-patient',
      'patient',
      'zh-TW',
      'health-overview',
    )).toBeUndefined()
  })

  it('selects the locale-matched English custom insight snapshot', () => {
    expect(getDemoClinicalInsightSnapshot(
      'demo-patient-1',
      'medical',
      'en',
      'changes',
    )?.text).toContain('August 27 records show')
  })

  it('does not promote the unconfirmed myeloma ICD claim into any snapshot', () => {
    const allSnapshots = JSON.stringify({
      summaries: demoMedicalSummarySnapshots,
      insights: demoClinicalInsightSnapshots,
      safety: demoSafetyScanSnapshots,
    })
    expect(allSnapshots).not.toMatch(/多發性骨髓瘤|multiple\s+myeloma|\bmyeloma\b|\bMM\b/i)
    expect(allSnapshots).toMatch(/申報|claim/i)
  })
})

describe('demo medical-summary snapshots', () => {
  it('declares honest pre-generated model provenance without a fabricated time', () => {
    expect(DEMO_MEDICAL_SUMMARY_GENERATION).toEqual({
      source: 'pre-generated',
      modelId: 'gemini-3.8-flash',
      modelName: 'Gemini 3.8 Flash',
    })
    expect(DEMO_MEDICAL_SUMMARY_GENERATION).not.toHaveProperty('generatedAt')
    expect(DEMO_SAFETY_SCAN_GENERATION).toEqual(DEMO_MEDICAL_SUMMARY_GENERATION)
  })

  it.each([
    ['zh-TW', 'medical'],
    ['zh-TW', 'patient'],
    ['en', 'medical'],
    ['en', 'patient'],
  ] as const)('passes the current %s/%s summary schema', (locale, audience) => {
    expect(generateMedicalSummaryUseCase.parseResult(
      JSON.stringify(demoMedicalSummarySnapshots[locale][audience]),
    )).not.toBeNull()
  })

  it('keeps the former audience-first exports as zh-TW compatibility aliases', () => {
    expect(demoMedicalSummarySnapshots.medical)
      .toBe(demoMedicalSummarySnapshots['zh-TW'].medical)
    expect(demoMedicalSummarySnapshots.patient)
      .toBe(demoMedicalSummarySnapshots['zh-TW'].patient)
    expect(demoSafetyScanSnapshots.medical)
      .toBe(demoSafetyScanSnapshots['zh-TW'].medical)
    expect(demoSafetyScanSnapshots.patient)
      .toBe(demoSafetyScanSnapshots['zh-TW'].patient)
  })

  it.each(['zh-TW', 'en'] as const)('keeps benefit-first education patient-only in %s', (locale) => {
    expect(demoMedicalSummarySnapshots[locale].medical.medicationEducation).toEqual([])
    expect(demoMedicalSummarySnapshots[locale].patient.medicationEducation.length).toBeGreaterThan(0)
  })

  // 開藥前必看, 最可能的就診主因 and 最近 90 天 were retired (2026-10-02); the
  // problems only the focus card carried moved into the problem list.
  it.each(['zh-TW', 'en'] as const)('carries none of the retired sections in %s', (locale) => {
    for (const audience of ['medical', 'patient'] as const) {
      const snapshot = demoMedicalSummarySnapshots[locale][audience] as Record<string, unknown>
      for (const retired of ['mustKnow', 'focus', 'recent']) expect(snapshot).not.toHaveProperty(retired)
    }
    // Clinicians read the problem list in chart English in either locale.
    const labels = demoMedicalSummarySnapshots[locale].medical.problems.map((problem) => problem.label).join(' ')
    expect(labels).toMatch(/Chronic kidney disease/)
    expect(labels).toMatch(/Hypothyroidism/)
  })

  it.each(['medical', 'patient'] as const)('ships non-empty English content for %s audience', (audience) => {
    const snapshot = demoMedicalSummarySnapshots.en[audience]
    expect(snapshot.headline).toMatch(/[A-Za-z]/)
    expect(snapshot.problems.map((item) => item.label).join('')).toMatch(/[A-Za-z]/)
    expect(snapshot.problems.length).toBeGreaterThan(0)
    expect(demoSafetyScanSnapshots.en[audience].alerts.length).toBeGreaterThan(0)
  })

  it('keeps the English problem list fully English and de-identified', () => {
    const problems = demoMedicalSummarySnapshots.en.medical.problems
      .map((item) => [item.label, item.basis, item.metric].join(' '))
      .join(' ')
    expect(problems).toMatch(/Chronic kidney disease/)
    expect(problems).not.toMatch(/[一-鿿]/)
    expect(problems).not.toContain('示範')
  })

  it('resolves every bundled summary and safety citation against the enriched demo AI scope', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require('../../../public/demo/demo-bundle.json')
    const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
    const parsedData = LocalBundleService.parse(enriched.bundle)
    expect(parsedData).not.toBeNull()
    // The demo record is small, so the 初診 defaults select all of it
    // (useAdaptiveDataDefaults) — the scope the snapshots were generated over.
    const includedDocumentIds = listClinicalDocuments(parsedData!.collection).map((document) => document.id)
    // Scope against the demo's own as-of date, exactly like the app does for
    // demo data. Using the wall clock made this assertion decay as supply
    // windows passed.
    const scopedClinicalData = scopeClinicalDataForAi(
      parsedData!.collection,
      ALL_DATA_SELECTION,
      ALL_DATA_FILTERS,
      includedDocumentIds,
      DEMO_DATA_AS_OF_MS,
    )
    for (const locale of ['zh-TW', 'en'] as const) {
      const catalog = getSourceCatalog(scopedClinicalData, locale)
      const catalogKeys = new Set(catalog.map((source) => source.key))
      const grounding = buildGroundingAuditInput(scopedClinicalData, catalog)
      for (const audience of ['medical', 'patient'] as const) {
        const snapshot = remapDemoSnapshotSourceKeys(
          demoMedicalSummarySnapshots[locale][audience], catalog,
        )
        const parsedSummary = generateMedicalSummaryUseCase.parseResult(
          JSON.stringify(snapshot),
        )
        expect(parsedSummary).not.toBeNull()
        const finalized = generateMedicalSummaryUseCase.finalizeResult(parsedSummary!, catalog, {
          clinicalData: scopedClinicalData,
          audience,
          locale,
        })
        expect(finalized.sourceIndex.filter((source) => !source.verified)).toEqual([])
        // Every problem that cites a discharge summary carries its verbatim quote.
        for (const problem of finalized.problems) {
          for (const key of problem.sourceKeys.filter((sourceKey) => /^D\d+$/.test(sourceKey))) {
            expect(problem.documentEvidence).toEqual(expect.arrayContaining([
              expect.objectContaining({ source: key, quote: expect.any(String) }),
            ]))
          }
        }
        expect(auditSummaryGrounding(snapshot, grounding)).toEqual([])

        const safetySnapshot = remapDemoSnapshotSourceKeys(
          demoSafetyScanSnapshots[locale][audience], catalog,
        )
        for (const alert of safetySnapshot.alerts) {
          expect((alert.sources ?? []).filter((key) => !catalogKeys.has(key))).toEqual([])
        }
        expect(auditSafetyGrounding(safetySnapshot, grounding)).toEqual([])
      }
    }
  })

  it('pins the demo as-of date to the bundle it describes', () => {
    // The whole point of the frozen clock is that it belongs to THIS bundle.
    // If a regenerated demo moves the newest clinical event, the as-of date has
    // to move with it — otherwise the scope silently drifts again.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require('../../../public/demo/demo-bundle.json')
    const newestClinicalDate = bundle.entry
      .map((entry: any) => {
        const r = entry.resource
        return r.authoredOn || r.effectiveDateTime || r.period?.start || r.context?.period?.start
      })
      .filter((value: unknown): value is string => typeof value === 'string')
      .sort()
      .at(-1)!

    expect(Date.parse(newestClinicalDate)).toBeLessThanOrEqual(DEMO_DATA_AS_OF_MS)
    // …and not so far ahead that the as-of date stops describing the bundle.
    expect(DEMO_DATA_AS_OF_MS - Date.parse(newestClinicalDate))
      .toBeLessThan(31 * 24 * 60 * 60 * 1000)
  })

  it('keeps every demo medication citation inside the as-of scope', async () => {
    // Regression guard for the failure this pinning fixed: six citations
    // (M16–M21) pointed at dispensings that had aged out of the "active"
    // filter. A plain resolution check on the wall clock would start passing
    // or failing depending on the day it ran.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require('../../../public/demo/demo-bundle.json')
    const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
    const parsedData = LocalBundleService.parse(enriched.bundle)!
    const scoped = scopeClinicalDataForAi(
      parsedData.collection,
      ALL_DATA_SELECTION,
      ALL_DATA_FILTERS,
      listClinicalDocuments(parsedData.collection).map((document) => document.id),
      DEMO_DATA_AS_OF_MS,
    )
    const catalog = getSourceCatalog(scoped, 'zh-TW')
    const catalogKeys = new Set(catalog.map((source) => source.key))

    const cited = new Set<string>()
    for (const locale of ['zh-TW', 'en'] as const) {
      collectCitedKeys(remapDemoSnapshotSourceKeys(demoMedicalSummarySnapshots[locale].medical, catalog), cited)
      collectCitedKeys(remapDemoSnapshotSourceKeys(demoMedicalSummarySnapshots[locale].patient, catalog), cited)
      collectCitedKeys(remapDemoSnapshotSourceKeys(demoSafetyScanSnapshots[locale].medical, catalog), cited)
      collectCitedKeys(remapDemoSnapshotSourceKeys(demoSafetyScanSnapshots[locale].patient, catalog), cited)
    }

    const unresolvable = [...cited]
      .filter((key) => /^[A-Z]+\d+$/.test(key) && !catalogKeys.has(key))
      .sort()
    expect(unresolvable).toEqual([])
  })

  it('ties each education item to a record of the medicine it explains', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require('../../../public/demo/demo-bundle.json')
    const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
    const collection = LocalBundleService.parse(enriched.bundle)!.collection
    const scoped = scopeClinicalDataForAi(
      collection,
      ALL_DATA_SELECTION,
      ALL_DATA_FILTERS,
      listClinicalDocuments(collection).map((document) => document.id),
      DEMO_DATA_AS_OF_MS,
    )
    for (const locale of ['zh-TW', 'en'] as const) {
      const catalog = getSourceCatalog(scoped, locale)
      const education = remapDemoSnapshotSourceKeys(demoMedicalSummarySnapshots[locale].patient, catalog).medicationEducation
      expect(education.length).toBeGreaterThan(0)
      for (const item of education) {
        const medicines = item.sources
          .map((key) => catalog.find((source) => source.key === key))
          .filter((source) => source?.resourceType?.startsWith('Medication'))
        const brand = item.name.split(/[\s(（]/)[0].toLowerCase()
        expect(medicines.some((source) => source!.display.toLowerCase().includes(brand))).toBe(true)
      }
    }

    // The clinician list carries medicines on the problem rows: each row's
    // medicines are cited per row.
    const problems = demoMedicalSummarySnapshots['zh-TW'].medical.problems
    expect(problems.filter((item) => item.medicationSources?.length).length).toBeGreaterThan(5)
  })

  it.each(['medical', 'patient'] as const)(
    'remaps stable %s resource ids when another model renumbers the catalog',
    async (audience) => {
      // The full bundle produces a deliberately different key sequence from
      // the default AI scope, matching the small-model prioritization hazard.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bundle = require('../../../public/demo/demo-bundle.json')
      const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
      const parsedData = LocalBundleService.parse(enriched.bundle)
      expect(parsedData).not.toBeNull()
      const alternateCatalog = buildSourceCatalog(parsedData!.collection)
      const remappedSummary = remapDemoSnapshotSourceKeys(
        demoMedicalSummarySnapshots['zh-TW'][audience],
        alternateCatalog,
      )
      const parsedSummary = generateMedicalSummaryUseCase.parseResult(
        JSON.stringify(remappedSummary),
      )
      expect(parsedSummary).not.toBeNull()
      const finalized = generateMedicalSummaryUseCase.finalizeResult(
        parsedSummary!,
        alternateCatalog,
        {
          clinicalData: parsedData!.collection,
          audience,
          locale: 'zh-TW',
        },
      )

      expect(finalized.sourceIndex.filter((source) => !source.verified)).toEqual([])
      // A document quote follows its document to the new key: every document a
      // row still cites (a column keeps at most six keys) has its quote.
      const documentProblems = finalized.problems.filter((problem) =>
        problem.sourceKeys.some((key) => /^D\d+$/.test(key)))
      expect(documentProblems.length).toBeGreaterThan(0)
      for (const problem of documentProblems) {
        for (const key of problem.sourceKeys.filter((sourceKey) => /^D\d+$/.test(sourceKey))) {
          expect(problem.documentEvidence?.map((entry) => entry.source)).toContain(key)
        }
      }
    },
  )
})

describe('demo snapshot citation keys', () => {
  const citedKeys = () => {
    const cited = new Set<string>()
    for (const locale of ['zh-TW', 'en'] as const) {
      for (const audience of ['medical', 'patient'] as const) {
        collectCitedKeys(demoMedicalSummarySnapshots[locale][audience], cited)
        collectCitedKeys(demoSafetyScanSnapshots[locale][audience], cited)
      }
    }
    return [...cited].filter((key) => /^[A-Z]+\d+$/.test(key)).sort()
  }

  const demoCollection = async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require('../../../public/demo/demo-bundle.json')
    const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
    return LocalBundleService.parse(enriched.bundle)!.collection
  }

  it('pins every cited key to a stable resource id', () => {
    // An unpinned key keeps its raw catalog position, so appending records to
    // the demo silently points it at a newer resource of the same type.
    expect(citedKeys().filter((key) => !DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY[key])).toEqual([])
  })

  it.each(['default', 'all-data'] as const)(
    'maps every cited key back to its own record in the %s demo scope',
    async (scope) => {
      // The demo loads with the whole record selected (it is small enough) —
      // the scope the snapshots were written against, where every citation
      // resolves. A narrower retained 初診 selection may leave out a cited
      // record; that citation must stay unresolved (shown unverified), never
      // land on a different record.
      const collection = await demoCollection()
      const documents = listClinicalDocuments(collection)
      const scoped = scope === 'default'
        ? scopeClinicalDataForAi(
            collection,
            DEFAULT_DATA_SELECTION,
            DEFAULT_DATA_FILTERS,
            resolveSelectedDocuments(documents, 'latestAdmission', []).map((document) => document.id),
            DEMO_DATA_AS_OF_MS,
          )
        : scopeClinicalDataForAi(
            collection,
            ALL_DATA_SELECTION,
            ALL_DATA_FILTERS,
            documents.map((document) => document.id),
            DEMO_DATA_AS_OF_MS,
          )
      const catalog = getSourceCatalog(scoped, 'zh-TW')
      const resolved = citedKeys().map((key) => {
        const remapped = remapDemoSnapshotSourceKeys({ sources: [key] }, catalog).sources[0]
        return [key, catalog.find((source) => source.key === remapped)?.resourceId]
      })
      if (scope === 'all-data') {
        expect(resolved).toEqual(citedKeys().map((key) => [key, DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY[key]]))
      } else {
        const misplaced = resolved.filter(([key, resourceId]) =>
          resourceId !== undefined && resourceId !== DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY[key!])
        expect(misplaced).toEqual([])
      }
    },
  )

  it('leaves a citation unresolved rather than reusing a renumbered key', () => {
    const [key, resourceId] = Object.entries(DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY)[0]
    const catalog = [{ key, resourceId: `${resourceId}-other`, resourceType: 'MedicationRequest', display: 'other' }] as any
    const remapped = remapDemoSnapshotSourceKeys({ sources: [key] }, catalog).sources[0]
    expect(catalog.some((source: { key: string }) => source.key === remapped)).toBe(false)
  })
})
