import type { AiModelExecution } from '@/src/core/entities/ai-model-execution.entity'
import { modelExecutionLabel } from '@/src/shared/utils/ai-model-execution'
import type { MedicalSummaryResult } from "@/src/core/entities/medical-summary.entity"

export interface MedicalSummaryGenerationInfo {
  modelExecution?: AiModelExecution
  prefix?: string
  modelName: string
  generatedAtIso?: string
  generatedAtText?: string
  generatedAtLabel?: string
  durationLabel?: string
  durationText?: string
  /** Time to the FIRST visible section. Shown beside the total because on a
   *  slow endpoint those two numbers answer different questions. */
  firstCardLabel?: string
  firstCardText?: string
  ariaLabel: string
}

export function formatGenerationDuration(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined
  const totalSeconds = Math.floor(durationMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const twoDigits = (value: number) => value.toString().padStart(2, "0")
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`
}

export function buildSummaryGenerationInfo({
  generation,
  locale,
  labelTemplate,
  labelWithDurationTemplate,
  labelWithFirstCardTemplate,
  generatedAtLabel,
  durationLabel,
  firstCardLabel,
  preGeneratedLabel,
  preGeneratedTemplate,
}: {
  generation?: MedicalSummaryResult["generation"]
  locale: string
  labelTemplate: string
  labelWithDurationTemplate: string
  /** Optional: callers that do not surface the first-section timing keep the
   *  duration-only aria label. */
  labelWithFirstCardTemplate?: string
  generatedAtLabel: string
  durationLabel: string
  firstCardLabel?: string
  preGeneratedLabel: string
  preGeneratedTemplate: string
}): MedicalSummaryGenerationInfo | undefined {
  if (!generation) return undefined
  if (generation.source === "pre-generated") {
    return {
      prefix: preGeneratedLabel,
      modelName: generation.modelName,
      ariaLabel: preGeneratedTemplate.replace("{model}", generation.modelName),
    }
  }

  // Once the whole summary + safety batch has settled, show that completion
  // time. Legacy results (and summaries whose companion pipeline did not
  // complete successfully) retain the structured-summary timestamp.
  const generatedAt = new Date(generation.completedAt ?? generation.generatedAt)
  if (Number.isNaN(generatedAt.getTime())) return undefined

  const generatedAtText = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(generatedAt)
  const modelName = generation.modelExecution ? modelExecutionLabel(generation.modelExecution) : generation.modelName
  const durationText = generation.durationMs === undefined
    ? undefined
    : formatGenerationDuration(generation.durationMs)
  const firstCardText = generation.firstCardMs === undefined
    ? undefined
    : formatGenerationDuration(generation.firstCardMs)
  const showFirstCard = Boolean(firstCardText && firstCardLabel)
  const ariaLabel = showFirstCard && durationText && labelWithFirstCardTemplate
    ? labelWithFirstCardTemplate
      .replace("{model}", modelName)
      .replace("{time}", generatedAtText)
      .replace("{first}", firstCardText as string)
      .replace("{duration}", durationText)
    : durationText
      ? labelWithDurationTemplate
        .replace("{model}", modelName)
        .replace("{time}", generatedAtText)
        .replace("{duration}", durationText)
      : labelTemplate
        .replace("{model}", modelName)
        .replace("{time}", generatedAtText)

  return {
    modelName,
    modelExecution: generation.modelExecution,
    generatedAtIso: generatedAt.toISOString(),
    generatedAtText,
    generatedAtLabel,
    durationLabel: durationText ? durationLabel : undefined,
    durationText,
    firstCardLabel: showFirstCard ? firstCardLabel : undefined,
    firstCardText: showFirstCard ? firstCardText : undefined,
    ariaLabel,
  }
}
