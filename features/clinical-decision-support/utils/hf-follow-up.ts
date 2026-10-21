import { excludeUnresolvedDecisionVariants } from '@/src/core/utils/clinical-variant-inputs'
import type { ObservationEntity } from '@/src/core/entities/clinical-data.entity'

export type SymptomChange = 'improved' | 'unchanged' | 'worse' | 'resolved'
export interface FollowUpComplaint { text: string; date: string; source: string; change?: SymptomChange; comparedWith?: string; note?: string }
export interface WeightPoint { value: number; date: string; source: string }
export interface HfFollowUpHistory { complaints: FollowUpComplaint[]; weights: WeightPoint[]; weightChanges?: { date: string; value: 'increased' | 'unchanged' | 'decreased' }[] }
export const EMPTY_HF_HISTORY: HfFollowUpHistory = { complaints: [], weights: [] }
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function parseHfHistory(raw: unknown): HfFollowUpHistory {
  const value = raw as Partial<HfFollowUpHistory> | undefined
  return {
    ...(Array.isArray(value?.weightChanges) ? { weightChanges: value.weightChanges.filter(item => item && validDate(item.date) && ['increased', 'unchanged', 'decreased'].includes(item.value)) } : {}),
    complaints: Array.isArray(value?.complaints) ? value.complaints.filter(item => item && typeof item.text === 'string' && item.text.trim() && validDate(item.date) && typeof item.source === 'string' && (item.note === undefined || typeof item.note === 'string') && (item.change === undefined || ['improved', 'unchanged', 'worse', 'resolved'].includes(item.change)) && (item.comparedWith === undefined || validDate(item.comparedWith))) : [],
    weights: Array.isArray(value?.weights) ? value.weights.filter(item => item && Number.isFinite(item.value) && item.value > 0 && validDate(item.date) && typeof item.source === 'string') : [],
  }
}

/** Read explicit observations only; encounter diagnosis codes are not chief complaints. */
export function hfFollowUpHistory(observations: readonly ObservationEntity[]): HfFollowUpHistory {
  const history: HfFollowUpHistory = { complaints: [], weights: [] }
  for (const item of excludeUnresolvedDecisionVariants({ observations }).observations) {
    const date = item.effectiveDateTime?.slice(0, 10)
    if (!validDate(date) || ['entered-in-error', 'cancelled'].includes(item.status ?? '')) continue
    const source = `Observation/${item.id ?? ''}`
    const labels = [item.code?.text, ...item.code?.coding?.map(code => code.display) ?? []]
    if (labels.some(label => /^(主訴|chief complaint)$/i.test(label?.trim() ?? ''))) {
      const text = item.valueString ?? item.valueCodeableConcept?.text
      if (text?.trim()) history.complaints.push({ text, date, source })
    }
    if (!item.code?.coding?.some(code => code.system === 'http://loinc.org' && code.code === '29463-7') && !labels.some(label => /^(體重|体重|body weight|weight)$/i.test(label?.trim() ?? ''))) continue
    const quantity = item.valueQuantity
    const unit = quantity?.code ?? quantity?.unit
    const factor = unit === 'kg' ? 1 : unit === 'g' ? 0.001 : ['[lb_av]', 'lb', 'lbs'].includes(unit ?? '') ? 0.45359237 : undefined
    if (factor && quantity?.value !== undefined && quantity.value > 0 && Number.isFinite(quantity.value)) history.weights.push({ value: quantity.value * factor, date, source })
  }
  return history
}
