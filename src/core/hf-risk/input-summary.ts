import type { HfInput } from './contract'
import { HF_LABS } from './labs'

/** Summarize only the projected single-hospital input, never unrelated raw chart data. */
export function summarizeHfInput(input: HfInput) {
  const resources = input.bundle.entry.map((entry: any) => entry.resource)
  const observations = resources.filter((item: any) => item.resourceType === 'Observation')
  const dates = [...new Set<string>(observations.map((item: any) => item.effectiveDateTime))].sort()
  const present = new Set(observations.flatMap((item: any) => item.code.coding.filter((code: any) => code.system.endsWith('/hf-source-lab-item')).map((code: any) => code.code)))
  const encounterClasses: Record<string, number> = {}
  for (const item of resources) if (item.resourceType === 'Encounter') encounterClasses[item.class?.code] = (encounterClasses[item.class?.code] ?? 0) + 1
  return {
    dates,
    presentLabs: HF_LABS.filter(lab => present.has(lab.key)).map(lab => lab.key),
    missingLabs: HF_LABS.filter(lab => !present.has(lab.key)).map(lab => lab.key),
    encounterClasses,
  }
}

/** True when the prepared input carries any heart-failure diagnosis (ICD-10-CM I50.x or ICD-9-CM 428.x),
 * including codes a physician supplied for this request. Whether those are enough is still the API's call. */
export function hasHfDiagnosis(input: HfInput): boolean {
  return input.bundle.entry.some((entry: any) => entry.resource.resourceType === 'Condition'
    && (entry.resource.code?.coding ?? []).some((coding: any) => /^(I50|428)/.test(String(coding.code ?? '').replace('.', '').toUpperCase())))
}
