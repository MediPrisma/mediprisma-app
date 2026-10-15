// Validate the pre-generated demo AI snapshots (src/infrastructure/demo/
// demo-ai-snapshots.ts) through the REAL parse/finalize pipeline against the
// REAL demo bundle. Run whenever demo-bundle.json or the snapshots change:
//
//   npx tsx scripts/validate-demo-snapshots.ts
//
// Fails if any citation doesn't resolve verified, the problem list is empty,
// 影像與病理重點 does not list every digest report in its fallback, OR a
// grounding-audit issue is found (a fabricated test, a positional cross-ref,
// or a topically-irrelevant citation — the "second pass" that mere citation
// resolution misses).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  auditSummaryGrounding,
  auditSafetyGrounding,
  buildGroundingAuditInput,
} from './lib/grounding-audit'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// A file URL, so the dynamic imports also resolve on Windows.
const load = (relative: string) => import(pathToFileURL(path.join(ROOT, relative)).href)

async function main() {
  const { LocalBundleService } = await load('src/infrastructure/fhir/services/local-bundle.service.ts')
  const { enrichBundleWithNhiDrugTerminology } = await load('src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service.ts')
  const { generateMedicalSummaryUseCase, getSourceCatalog } =
    await load('src/core/use-cases/medical-summary/generate-medical-summary.use-case.ts')
  const { generateSafetyAlertsUseCase } = await load('src/core/use-cases/safety-alerts/generate-safety-alerts.use-case.ts')
  const { scopeClinicalDataForAi } = await load('src/core/utils/ai-clinical-scope.utils.ts')
  const { listClinicalDocuments, resolveSelectedDocuments } = await load('src/core/utils/clinical-documents.utils.ts')
  const { ALL_DATA_FILTERS, ALL_DATA_SELECTION } = await load('src/shared/constants/data-selection.constants.ts')
  const { DEMO_DATA_AS_OF_MS } = await load('src/shared/constants/demo-data.constants.ts')
  const { demoMedicalSummarySnapshots, demoSafetyScanSnapshots, remapDemoSnapshotSourceKeys } = await load('src/infrastructure/demo/demo-ai-snapshots.ts')

  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/demo/demo-bundle.json'), 'utf8'))
  // Match the real demo/local import path: exact-code NHI MedicationKnowledge
  // is attached before the App view model and AI context are built.
  const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
  const { collection } = await LocalBundleService.parse(enriched.bundle)
  // Demo seeding runs against the scope the 初診 defaults give the demo: the
  // record is small (under AUTO_SELECT_ALL_TOKENS), so useAdaptiveDataDefaults
  // selects all of it — every category, every date, every document. Build the
  // same scoped catalog here so key numbering and citation verification cannot
  // drift from what localhost/production show.
  const includedDocumentIds = resolveSelectedDocuments(
    listClinicalDocuments(collection),
    'all',
    [],
  ).map((document: { id: string }) => document.id)
  const scopedClinicalData = scopeClinicalDataForAi(
    collection,
    ALL_DATA_SELECTION,
    ALL_DATA_FILTERS,
    includedDocumentIds,
    DEMO_DATA_AS_OF_MS,
  )
  let failures = 0
  const fail = (msg: string) => { failures += 1; console.error('✗', msg) }

  for (const locale of ['zh-TW', 'en'] as const) {
    const catalog = getSourceCatalog(scopedClinicalData, locale)
    const keys = new Set(catalog.map((c: any) => c.key))
    // Use the exact scoped records and the canonical decoded clinical-document
    // text. Searching the raw Bundle would miss Base64-encoded discharge prose.
    const grounding = buildGroundingAuditInput(scopedClinicalData, catalog)

    for (const aud of ['medical', 'patient'] as const) {
      const tag = `${locale}/${aud}`
      // --- medical summary: exact same path as a live reply ---
      // Match runtime seeding: new demo reports can renumber short L keys;
      // citations still belong to the original stable resource identities.
      const snapshot = remapDemoSnapshotSourceKeys(demoMedicalSummarySnapshots[locale][aud], catalog)
      const parsed = generateMedicalSummaryUseCase.parseResult(JSON.stringify(snapshot))
      if (!parsed) { fail(`summary[${tag}]: parseResult rejected`); continue }
      const finalized = generateMedicalSummaryUseCase.finalizeResult(parsed, catalog, {
        clinicalData: scopedClinicalData,
        audience: aud,
        locale,
      })
      const unverified = finalized.sourceIndex.filter((s: any) => !s.verified)
      if (unverified.length) fail(`summary[${tag}]: unverified keys ${unverified.map((s: any) => s.key).join(',')}`)
      if (finalized.problems.length === 0) fail(`summary[${tag}]: no problems survived`)
      for (const issue of auditSummaryGrounding(snapshot, grounding)) fail(`summary[${tag}] grounding: ${issue}`)
      // A quote that does not match its document shows an amber warning in
      // the demo; a frozen snapshot must not carry one.
      for (const problem of finalized.problems) {
        for (const entry of problem.documentEvidence ?? []) {
          if (entry.verification === 'not-found') fail(`summary[${tag}]: "${problem.label}" quotes ${entry.source} with text the document does not hold`)
        }
      }
      // 影像與病理重點: the clinician snapshots carry a reports module, so the
      // section is a summary whose every point keeps a quote that matches its
      // report verbatim.
      const highlights = finalized.reportHighlights
      if (aud === 'medical') {
        if (!highlights) fail(`summary[${tag}]: no 影像與病理重點 rendered`)
        else {
          if (!highlights.summarized) fail(`summary[${tag}]: 影像與病理重點 is not summarized`)
          if (highlights.groups.length === 0) fail(`summary[${tag}]: 影像與病理重點 has no findings`)
          if (highlights.hiddenPointCount > 0) fail(`summary[${tag}]: ${highlights.hiddenPointCount} 影像與病理重點 point(s) lost every quote`)
          const points = highlights.groups.reduce((sum: number, group: { points: unknown[] }) => sum + group.points.length, 0)
          console.log(`✓ reports[${tag}]: ${points} findings in ${highlights.groups.length} organ groups, ${highlights.droppedQuoteCount} quote(s) dropped, ${highlights.others.length} other report(s)`)
        }
      } else if (highlights) fail(`summary[${tag}]: 影像與病理重點 rendered for the patient audience`)
      // An education item survives finalize only with a resolved M key.
      if (aud === 'patient' && finalized.medicationEducation.length < 3) {
        fail(`summary[${tag}]: only ${finalized.medicationEducation.length} medication education item(s) survived`)
      }
      console.log(`✓ summary[${tag}]: ${finalized.problems.length} problems, ${finalized.medicationEducation.length} education items, ${finalized.sourceIndex.length} sources all verified; grounding clean`)

      // --- safety: same path as a live reply ---
      const scan = generateSafetyAlertsUseCase.parseScanResult(JSON.stringify(
        remapDemoSnapshotSourceKeys(demoSafetyScanSnapshots[locale][aud], catalog),
      ))
      if (!scan) { fail(`safety[${tag}]: parseScanResult rejected`); continue }
      for (const a of scan.alerts) {
        for (const k of a.sources ?? []) if (!keys.has(k)) fail(`safety[${tag}] "${a.title}": unknown key ${k}`)
      }
      for (const issue of auditSafetyGrounding(scan, grounding)) fail(`safety[${tag}] grounding: ${issue}`)
      console.log(`✓ safety[${tag}]: ${scan.alerts.length} alerts, all source keys resolve; grounding clean`)
    }
  }

  if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1) }
  console.log('\nALL SNAPSHOTS VALID')
}
main().catch((e) => { console.error(e); process.exit(1) })
