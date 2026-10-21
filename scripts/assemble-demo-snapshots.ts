// Assemble src/infrastructure/demo/demo-ai-snapshots.data.json from raw model
// replies captured in the app, then check them with
// scripts/validate-demo-snapshots.ts.
//
// How the replies are captured: load 使用試用資料, pick the model in 醫療摘要,
// press 重新產生 for each locale × audience, then open 摘要設定 → AI 診斷資料
// and save each execution's PROMPT and OUTPUT as text. A clinician run has two
// executions: the card batch (overview, problems, safety blocks) and the
// reports lane; a patient run has the batch only.
//
//   npx tsx scripts/assemble-demo-snapshots.ts <manifest.json>
//
// manifest.json:
//   {
//     "modelId": "gemini-3-flash-preview", "modelName": "Gemini 3 Flash Preview",
//     "dir": "<folder holding the captured files>",
//     "runs": {
//       "zh-TW": { "medical": { "batch": "x-output.txt", "batchPrompt": "x-prompt.txt", "reports": "y-output.txt" },
//                  "patient": { "batch": "...", "batchPrompt": "..." } },
//       "en":    { ... }
//     },
//     "edits": [
//       { "locale": "zh-TW", "audience": "medical", "problem": "<label>",
//         "removeMedicationSources": ["M1"], "why": "artificial tears do not treat glaucoma" }
//     ]
//   }
//
// "edits" is the only editorial change allowed, and every one is printed:
// dropping a medicine the model attached to a problem it does not treat.
//
// The snapshots keep the RAW module shape (the same JSON a live reply holds) so
// the demo goes through the live parse → finalize path. Citations are stored
// with the keys the model saw, plus `sourceResourceIds` (key → FHIR resource
// id) so a later catalog that numbers the same records differently still
// resolves them. clinicalInsights are carried over unchanged.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_PATH = path.join(ROOT, 'src/infrastructure/demo/demo-ai-snapshots.data.json')

type Locale = 'zh-TW' | 'en'
type Audience = 'medical' | 'patient'
interface RunFiles { batch: string; batchPrompt?: string; reports?: string }
interface Edit {
  locale: Locale
  audience: Audience
  problem: string
  removeMedicationSources: string[]
  why: string
}
interface Manifest {
  modelId: string
  modelName: string
  dir: string
  runs: Record<Locale, Record<Audience, RunFiles>>
  edits?: Edit[]
}

const BLOCK = /<<<MEDIPRISMA_MODULE:([\w-]+)>>>\s*([\s\S]*?)\s*<<<END_MEDIPRISMA_MODULE:\1>>>/g

function readBlocks(file: string): Record<string, any> {
  const text = fs.readFileSync(file, 'utf8')
  const blocks: Record<string, any> = {}
  for (const match of text.matchAll(BLOCK)) blocks[match[1]] = JSON.parse(match[2])
  return blocks
}

/** Every citation key in a raw module, by the field names the schemas use. */
function citedKeys(value: unknown, field?: string, into = new Set<string>()): Set<string> {
  const isKeyList = (name?: string) => name === 'sources' || name === 'unremarkable' || /Sources$/.test(name ?? '')
  const isKeyField = (name?: string) => name === 'source' || name === 'ref' || /Ref$/.test(name ?? '')
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') { if (isKeyList(field)) into.add(item) } else citedKeys(item, undefined, into)
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) citedKeys(item, key, into)
  } else if (typeof value === 'string' && isKeyField(field)) {
    into.add(value)
  }
  return into
}

/** "[E3] Encounter | 2026-08-25 | org | display" lines of a captured prompt. */
function promptSourceList(file: string): Map<string, { type: string; date: string }> {
  const lines = new Map<string, { type: string; date: string }>()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\[([A-Z]+\d+)\]\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/.exec(line)
    if (match) lines.set(match[1], { type: match[2], date: match[3] })
  }
  return lines
}

async function main() {
  const manifestPath = process.argv[2]
  if (!manifestPath) throw new Error('usage: npx tsx scripts/assemble-demo-snapshots.ts <manifest.json>')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest
  const file = (name: string) => path.resolve(path.dirname(manifestPath), manifest.dir, name)

  // The catalog the model saw: the demo record is small (≈14K tokens, under
  // AUTO_SELECT_ALL_TOKENS), so the 初診 defaults select all of it
  // (useAdaptiveDataDefaults) — every category, every date, every document.
  const { LocalBundleService } = await import(pathToFileURL(path.join(ROOT, 'src/infrastructure/fhir/services/local-bundle.service.ts')).href)
  const { enrichBundleWithNhiDrugTerminology } = await import(pathToFileURL(path.join(ROOT, 'src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service.ts')).href)
  const { getSourceCatalog } = await import(pathToFileURL(path.join(ROOT, 'src/core/use-cases/medical-summary/generate-medical-summary.use-case.ts')).href)
  const { scopeClinicalDataForAi } = await import(pathToFileURL(path.join(ROOT, 'src/core/utils/ai-clinical-scope.utils.ts')).href)
  const { listClinicalDocuments, resolveSelectedDocuments } = await import(pathToFileURL(path.join(ROOT, 'src/core/utils/clinical-documents.utils.ts')).href)
  const { ALL_DATA_FILTERS, ALL_DATA_SELECTION } = await import(pathToFileURL(path.join(ROOT, 'src/shared/constants/data-selection.constants.ts')).href)
  const { DEMO_DATA_AS_OF_MS } = await import(pathToFileURL(path.join(ROOT, 'src/shared/constants/demo-data.constants.ts')).href)

  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/demo/demo-bundle.json'), 'utf8'))
  const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
  const { collection } = await LocalBundleService.parse(enriched.bundle)
  const includedDocumentIds = resolveSelectedDocuments(listClinicalDocuments(collection), 'all', [])
    .map((document: { id: string }) => document.id)
  const scoped = scopeClinicalDataForAi(collection, ALL_DATA_SELECTION, ALL_DATA_FILTERS, includedDocumentIds, DEMO_DATA_AS_OF_MS)

  const existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
  const medicalSummary: Record<string, Record<string, unknown>> = {}
  const safetyScan: Record<string, Record<string, unknown>> = {}
  const sourceResourceIds: Record<string, string> = {}
  let problems = 0

  for (const locale of ['zh-TW', 'en'] as const) {
    const catalog: Array<{ key: string; resourceId: string; resourceType: string; date?: string }> = getSourceCatalog(scoped, locale)
    const byKey = new Map(catalog.map((entry) => [entry.key, entry]))
    medicalSummary[locale] = {}
    safetyScan[locale] = {}
    for (const audience of ['medical', 'patient'] as const) {
      const run = manifest.runs[locale][audience]
      const batch = readBlocks(file(run.batch))
      if (!batch.overview || !batch.problems || !batch.safety) {
        throw new Error(`${locale}/${audience}: the batch reply lacks overview, problems or safety`)
      }
      const reports = run.reports ? readBlocks(file(run.reports)).reports : undefined
      if (audience === 'medical' && !reports) throw new Error(`${locale}/medical: no reports block`)
      for (const edit of (manifest.edits ?? []).filter((e) => e.locale === locale && e.audience === audience)) {
        const problem = (batch.problems.problems as Array<{ label: string; medicationSources?: string[] }>)
          .find((p) => p.label === edit.problem)
        const before = problem?.medicationSources ?? []
        if (!problem || !edit.removeMedicationSources.every((key) => before.includes(key))) {
          throw new Error(`${locale}/${audience}: edit does not match "${edit.problem}"`)
        }
        problem.medicationSources = before.filter((key) => !edit.removeMedicationSources.includes(key))
        console.log(`edit ${locale}/${audience} "${edit.problem}": removed ${edit.removeMedicationSources.join(', ')} — ${edit.why}`)
      }
      const summary = {
        ...batch.overview,
        ...batch.problems,
        ...(reports ? { reports } : {}),
      }
      medicalSummary[locale][audience] = summary
      safetyScan[locale][audience] = batch.safety

      // Every key the model cited must name a record of this catalog — the one
      // its prompt listed — and the same record in every snapshot.
      const listed = run.batchPrompt ? promptSourceList(file(run.batchPrompt)) : undefined
      for (const key of [...citedKeys(summary), ...citedKeys(batch.safety)]) {
        const entry = byKey.get(key)
        if (!entry) { console.error(`✗ ${locale}/${audience}: ${key} is not in the demo catalog`); problems += 1; continue }
        const line = listed?.get(key)
        if (listed && (!line || line.type !== entry.resourceType)) {
          console.error(`✗ ${locale}/${audience}: ${key} is ${entry.resourceType} here but ${line?.type ?? 'absent'} in the captured prompt`)
          problems += 1
        }
        const known = sourceResourceIds[key]
        if (known && known !== entry.resourceId) {
          console.error(`✗ ${key} names ${known} and ${entry.resourceId} in different snapshots`)
          problems += 1
        }
        sourceResourceIds[key] = entry.resourceId
      }
    }
  }
  // Reports keys come from the reports prompt's own list, which numbers the
  // same catalog — checked above against the catalog itself.
  if (problems > 0) throw new Error(`${problems} citation problem(s); nothing written`)

  const sortedIds = Object.fromEntries(
    Object.entries(sourceResourceIds).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  )
  const next = {
    metadata: { modelId: manifest.modelId, modelName: manifest.modelName },
    sourceResourceIds: sortedIds,
    medicalSummary,
    clinicalInsights: existing.clinicalInsights,
    safetyScan,
  }
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✓ wrote ${path.relative(ROOT, DATA_PATH)} — ${Object.keys(sortedIds).length} cited records`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
