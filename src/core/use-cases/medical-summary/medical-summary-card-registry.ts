import type {
  MedicalSummaryAiResult,
  MedicalSummaryCardId,
  MedicalSummaryModuleId,
  MedicalSummaryModuleResult,
  SummarySourceCatalogEntry,
} from '@/src/core/entities/medical-summary.entity'
import {
  MEDICAL_SUMMARY_MODULE_IDS,
  MEDICAL_SUMMARY_NARRATIVE_MODULE_IDS,
} from '@/src/core/entities/medical-summary.entity'
import type { SafetyScanResult } from '@/src/core/entities/safety-alert.entity'
import {
  generateMedicalSummaryUseCase,
  type GenerateMedicalSummaryInput,
} from './generate-medical-summary.use-case'
import { generateSafetyAlertsUseCase } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'

export interface MedicalSummaryCardAggregate {
  summary: MedicalSummaryAiResult
  safety?: SafetyScanResult
}

export interface MedicalSummaryCardDefinition {
  id: MedicalSummaryCardId
  buildBatchInstruction: (input: GenerateMedicalSummaryInput) => string
  hasCompleteBatchBlock: (text: string) => boolean
  parseBatch: (text: string, catalog: SummarySourceCatalogEntry[]) => unknown | null
  parseRetry: (text: string, catalog: SummarySourceCatalogEntry[]) => unknown | null
  apply: (
    aggregate: MedicalSummaryCardAggregate,
    value: unknown,
    catalog: SummarySourceCatalogEntry[],
  ) => MedicalSummaryCardAggregate
  findUnknownSourceKeys?: (
    value: unknown,
    catalog: SummarySourceCatalogEntry[],
  ) => string[]
}

function createSummaryCardDefinition<T extends MedicalSummaryModuleId>(
  moduleId: T,
): MedicalSummaryCardDefinition {
  return {
    id: moduleId,
    buildBatchInstruction: (input) =>
      generateMedicalSummaryUseCase.buildBatchCardInstruction(input, moduleId),
    hasCompleteBatchBlock: (text) =>
      generateMedicalSummaryUseCase.hasCompleteBatchModuleBlock(moduleId, text),
    parseBatch: (text) =>
      generateMedicalSummaryUseCase.parseBatchModuleResult(moduleId, text),
    parseRetry: (text) =>
      generateMedicalSummaryUseCase.parseModuleResult(moduleId, text),
    apply: (aggregate, value) => ({
      ...aggregate,
      summary: generateMedicalSummaryUseCase.mergeModuleResult(
        aggregate.summary,
        moduleId,
        value as MedicalSummaryModuleResult<T>,
      ),
    }),
    findUnknownSourceKeys: (value, catalog) =>
      generateMedicalSummaryUseCase.findUnknownSourceKeys(value, catalog),
  }
}

const SUMMARY_CARD_DEFINITIONS = Object.fromEntries(
  MEDICAL_SUMMARY_MODULE_IDS.map((moduleId) => [
    moduleId,
    createSummaryCardDefinition(moduleId),
  ]),
) as Record<MedicalSummaryModuleId, MedicalSummaryCardDefinition>

const SAFETY_CARD_DEFINITION: MedicalSummaryCardDefinition = {
  id: 'safety',
  buildBatchInstruction: (input) =>
    generateSafetyAlertsUseCase.buildBatchModuleInstruction(input),
  hasCompleteBatchBlock: (text) =>
    generateSafetyAlertsUseCase.hasCompleteBatchModuleBlock(text),
  parseBatch: (text, catalog) =>
    generateSafetyAlertsUseCase.parseBatchModuleResult(text, catalog),
  parseRetry: (text, catalog) =>
    generateSafetyAlertsUseCase.parseScanResult(text, catalog),
  apply: (aggregate, value, catalog) => ({
    ...aggregate,
    safety: {
      ...(value as SafetyScanResult),
      scannedCount: catalog.length,
    },
  }),
}

export const MEDICAL_SUMMARY_CARD_REGISTRY: Readonly<
  Record<MedicalSummaryCardId, MedicalSummaryCardDefinition>
> = {
  ...SUMMARY_CARD_DEFINITIONS,
  safety: SAFETY_CARD_DEFINITION,
}

// One order for both harness profiles. Overview is always first: it is the
// smallest block and paints the hero card while a slow model is still
// writing. 影像與病理重點 runs on its own lane over the report digest and never
// shares a request with the cards above, so it is listed last.
const CARD_ORDER: readonly MedicalSummaryCardId[] = [
  ...MEDICAL_SUMMARY_NARRATIVE_MODULE_IDS,
  'safety',
  'reports',
]

/** Cards a given audience is ever asked for. 影像與病理重點 is clinician-facing:
 *  the patient version never requests it. */
function cardServesAudience(
  cardId: MedicalSummaryCardId,
  audience: GenerateMedicalSummaryInput['audience'],
): boolean {
  return cardId !== 'reports' || audience !== 'patient'
}

export function registeredMedicalSummaryCards(
  input: GenerateMedicalSummaryInput,
  enabledCardIds?: readonly MedicalSummaryCardId[],
): MedicalSummaryCardDefinition[] {
  const enabled = enabledCardIds ? new Set(enabledCardIds) : null
  return CARD_ORDER
    .filter((cardId) => cardServesAudience(cardId, input.audience))
    .filter((cardId) => !enabled || enabled.has(cardId))
    .map((cardId) => MEDICAL_SUMMARY_CARD_REGISTRY[cardId])
}
