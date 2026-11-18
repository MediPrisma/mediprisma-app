type NotedMedication = { note?: Array<{ text?: string }> }

export function hasCloudCoverageDerivedStatus(medication: { meta?: { tag?: Array<{ system?: string; code?: string }> } }): boolean {
  return !!medication.meta?.tag?.some(tag => tag.system === 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module'
    && String(tag.code).toUpperCase() === 'IMUE0008')
}

/** Interpret only explicit source fields, never a mention of self-pay in prose. */
export function sourceSelfPurchase(medication: NotedMedication): boolean | undefined {
  const notes = Array.isArray(medication.note) ? medication.note : []
  const values = notes.map((note) => typeof note?.text === 'string'
    ? note.text.match(/^\s*(?:自購|自費|是否自購)\s*[:：]\s*(.*?)\s*$/i)?.[1]?.toUpperCase() : undefined)
  if (values.some((value) => /^(?:Y|YES|TRUE|1|是|有|自購|自費)$/.test(value ?? ''))) return true
  if (values.some((value) => /^(?:N|NO|FALSE|0|否|無)$/.test(value ?? ''))) return false
  return undefined
}

type SlipMedication = NotedMedication & { dispenseRequest?: { numberOfRepeatsAllowed?: unknown } }

const SLIP_MONTHS: Record<string, number> = { 2: 2, 3: 3, 二: 2, 兩: 2, 三: 3 }

/**
 * How many fills a chronic slip allows in all, counting the one this record
 * dispensed: numberOfRepeatsAllowed + 1, or the months of a 「慢簽(三個月)」
 * remark when each fill is about a month. An NHI slip allows at most three.
 */
export function chronicSlipFills(medication: SlipMedication, durationDays: number | undefined): number | undefined {
  const repeats = medication.dispenseRequest?.numberOfRepeatsAllowed
  if (repeats === 1 || repeats === 2) return repeats + 1
  if (!durationDays || durationDays < 28 || durationDays > 31 || !Array.isArray(medication.note)) return undefined
  for (const note of medication.note) {
    const months = /^\s*慢[箋簽]\s*[（(]\s*([23二兩三])\s*個?月\s*[）)]\s*$/.exec(note?.text ?? '')?.[1]
    if (months) return SLIP_MONTHS[months]
  }
  return undefined
}

export function hasExplicitChronicNote(medication: NotedMedication): boolean {
  return Array.isArray(medication.note) && medication.note.some((note) => /^\s*(?:處方(?:類型|種類)\s*[:：]\s*)?(?:慢[箋簽]|慢性處方[箋簽])(?:\s*[:：]\s*(?:是|Y|1))?(?:\s*[（(]\s*(?:\d+|[一二三四五六七八九十]+)\s*個?月\s*[）)])?\s*$/i.test(note?.text ?? ''))
}
