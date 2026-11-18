import type { ClinicalSelectValue } from './hfpef-clinical-autofill'
import { convertToBase } from './units'
import type { AutofillSource } from './types'
import type { AutofillValue } from './hooks/use-lab-autofill.hook'

/** Age bands and the latest blood pressure, as the scores ask them. */
export type AgeBpKey = 'ageOver60' | 'rockallAge' | 'bpOver140_90'

const day = (date: string) => date.slice(0, 10)

/** A pressure in mmHg: a kPa reading converted, no unit read as mmHg, an unreadable unit undefined. */
function mmHg(reading: AutofillValue): number | undefined {
  return reading.unit.trim() ? convertToBase(reading.value, reading.unit, 'pressure')?.value : reading.value
}

/**
 * ABCD²'s age ≥60 and Rockall's age band (option index: <60, 60–79, ≥80) from
 * the patient's age; ABCD²'s BP ≥140/90 from the latest systolic and diastolic
 * readings. Without a reading, the input's presumed answer applies.
 */
export function ageBpSelects(input: {
  age?: number
  resolve: (source: AutofillSource) => AutofillValue | undefined
}): Partial<Record<AgeBpKey, ClinicalSelectValue>> {
  const { age, resolve } = input
  const out: Partial<Record<AgeBpKey, ClinicalSelectValue>> = {}
  if (typeof age === 'number') {
    const testName = `年齡 ${age} 歲`
    out.ageOver60 = { value: age >= 60 ? 'yes' : 'no', date: '', testName }
    out.rockallAge = { value: age >= 80 ? '2' : age >= 60 ? '1' : '0', date: '', testName }
  }

  const sbp = resolve({ kind: 'vital', loinc: ['8480-6'], vital: 'sbp' })
  const dbp = resolve({ kind: 'vital', loinc: ['8462-4'] })
  const readings = [sbp && { name: '收縮壓', reading: sbp, value: mmHg(sbp), limit: 140 }, dbp && { name: '舒張壓', reading: dbp, value: mmHg(dbp), limit: 90 }]
    .filter((item): item is NonNullable<typeof item> => !!item)
  if (readings.length) {
    const latest = readings.map((item) => item.reading).sort((a, b) => b.date.localeCompare(a.date))[0]
    const text = readings.map((item) => item.value === undefined ? `${item.name} ${item.reading.value} ${item.reading.unit}` : `${item.name} ${Math.round(item.value)} mmHg`).join('、')
    const high = readings.some((item) => item.value !== undefined && item.value >= item.limit)
    // A reading in a unit that cannot be read leaves the answer to the clinician, unless another reading is already high.
    const unreadable = readings.some((item) => item.value === undefined)
    out.bpOver140_90 = !high && unreadable
      ? { value: 'unknown', date: day(latest.date), testName: `最近${text}（單位無法判讀，請核對）` }
      : { value: high ? 'yes' : 'no', date: day(latest.date), testName: `最近${text}（請核對就診時血壓）`, obsId: latest.obsId, resourceType: 'Observation' }
  }
  return out
}
