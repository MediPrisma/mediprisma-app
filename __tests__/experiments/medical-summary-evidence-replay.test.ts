/** Opt-in local replay. Patient records and model replies are never fixtures. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { generateMedicalSummaryUseCase as after } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { MEDICAL_SUMMARY_MODULE_IDS } from '@/src/core/entities/medical-summary.entity'
import { resolveClaimSources } from '@/features/medical-summary/utils/resolve-claim-sources'

const directory = process.env.MEDCLOUD_SUMMARY_REPLAY_DIR
const baselinePath = process.env.MEDCLOUD_SUMMARY_BASELINE_PATH
const replay = directory && baselinePath ? test : test.skip
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const withoutEvidence = (value: any): any => Array.isArray(value) ? value.map(withoutEvidence)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'documentEvidence').map(([key, child]) => [key, withoutEvidence(child)])) : value
const evidenceItems = (value: any): any[] => {
  if (!value || typeof value !== 'object') return []
  return [...(value.documentEvidence || []), ...Object.entries(value).filter(([key]) => key !== 'documentEvidence')
    .flatMap(([, child]) => evidenceItems(child))]
}

replay('same authorized real responses retain all clinical fields and source links, including retries', () => {
  // Export the chosen base revision's use-case to an ignored .ts file first.
  const before = jest.requireActual(resolve(baselinePath!)).generateMedicalSummaryUseCase as typeof after
  const read = (name: string) => JSON.parse(readFileSync(join(directory!, name), 'utf8'))
  const rows = []
  // Parser diagnostics can include raw patient excerpts. Keep replay logs
  // aggregate-only even when a captured attempt was malformed.
  const silence = ['error', 'warn', 'info'].map(method => jest.spyOn(console, method as 'warn').mockImplementation(() => {}))
  for (let patient = 1; patient <= 7; patient++) {
    const caseId = `patient${patient}`
    const tag = [5, 7].includes(patient) ? 'summary-adaptive-clock-fixed-2026-09-27' : 'summary-adaptive-cohort-2026-09-27'
    const input = read(`${tag}-${caseId}-input.json`)
    const catalog = input.catalog.map((entry: any) => ({ ...entry, getContentText: () => entry.contentText }))
    const promptInput = { clinicalContext: input.clinicalContext, catalog, locale: 'zh-TW' as const, audience: 'medical' as const, harnessProfile: 'local-small' as const }
    expect(hash(after.buildMessages(promptInput))).toBe(hash(before.buildMessages(promptInput)))
    const options = { clinicalData: input.clinicalData, locale: 'zh-TW' as const, audience: 'medical' as const, strictGrounding: true }
    for (let rep = 1; rep <= 3; rep++) {
      const response = read(`${tag}-${caseId}-baseline-run${rep}.json`)
      const parse = (useCase: typeof after) => {
        let draft = useCase.createEmptyAiResult()
        for (const attempt of response.attempts) for (const id of MEDICAL_SUMMARY_MODULE_IDS) {
          const card = useCase.parseBatchModuleResult(id, attempt.rawText)
          if (card) draft = useCase.mergeModuleResult(draft, id, card)
        }
        return useCase.finalizeResult(draft, catalog, options)
      }
      const oldResult = parse(before), newResult = parse(after)
      // Hash assertions avoid dumping real clinical text on a test failure.
      expect(hash(withoutEvidence(newResult))).toBe(hash(withoutEvidence(oldResult)))
      expect(hash(newResult.sourceIndex)).toBe(hash(oldResult.sourceIndex))
      const oldEvidence = evidenceItems(oldResult), newEvidence = evidenceItems(newResult)
      expect(newEvidence.length).toBe(oldEvidence.length)
      let exact = 0, repaired = 0, unmatched = 0, unavailable = 0
      for (const entry of newEvidence) {
        const raw = catalog.find((c: any) => c.key === entry.source)?.contentText
        if (entry.verification === 'exact' || entry.verification === 'whitespace-restored') {
          expect(Boolean(raw?.includes(entry.quote))).toBe(true)
          if (entry.verification === 'exact') exact++; else repaired++
        } else if (entry.verification === 'not-found') unmatched++; else unavailable++
      }
      // Exercise every manual failed-module retry choice. Retained cards
      // must keep clinical fields AND excerpt metadata after draft rebuilding.
      for (const id of MEDICAL_SUMMARY_MODULE_IDS) {
        const draft = after.createAiDraftFromResult(newResult)
        const replacement = after.createAiDraftFromResult(newResult)
        const retried = after.mergeModuleResult(draft, id, id === 'overview'
          ? { headline: replacement.headline, medicationEducation: replacement.medicationEducation }
          : id === 'reports' ? replacement.reports ?? { groups: [], unremarkable: [] }
            : { [id]: replacement[id] } as any)
        const retryResult = after.finalizeResult(retried, catalog, options)
        expect(hash(withoutEvidence(retryResult))).toBe(hash(withoutEvidence(newResult)))
        // A whitespace-restored quote is exact on the next pass; the source
        // and original excerpt, rather than that historical status, must stay.
        const passages = (items: any[]) => items.map(({ source, quote }) => ({ source, quote }))
        expect(hash(passages(evidenceItems(retryResult)))).toBe(hash(passages(newEvidence)))
      }
      let documentClaims = 0, warned = 0
      const byKey = new Map(newResult.sourceIndex.map(source => [source.key, source]))
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return
        const keys = value.sourceKeys || (value.category && value.key ? [value.key] : [])
        for (const source of resolveClaimSources(keys, byKey, value.documentEvidence)) {
          if (source.resourceType !== 'Composition' && source.resourceType !== 'DocumentReference') continue
          documentClaims++
          expect(Boolean(source.resourceId)).toBe(true)
          if (source.evidenceWarning) warned++
        }
        for (const [key, child] of Object.entries(value)) if (key !== 'sourceIndex' && key !== 'documentEvidence') visit(child)
      }
      visit(newResult)
      rows.push({ caseId, rep, clinicalFieldsIdentical: true, sourceIndexIdentical: true,
        retryVariants: MEDICAL_SUMMARY_MODULE_IDS.length, evidenceCount: newEvidence.length, exact, repaired, unmatched, unavailable, documentClaims, warned,
        beforeRetryEvidence: evidenceItems(before.createAiDraftFromResult(oldResult)).length,
        afterRetryEvidence: evidenceItems(after.createAiDraftFromResult(newResult)).length })
    }
  }
  silence.forEach(spy => spy.mockRestore())
  writeFileSync(join(directory!, 'summary-evidence-pr-replay.json'), JSON.stringify(rows, null, 2))
  console.log(JSON.stringify(rows))
})
