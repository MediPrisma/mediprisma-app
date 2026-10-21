// Custom Hook: Vitals View Processing
//
// Latest reading per vital, each carrying its own date. Height from a 2018
// health check and a blood pressure from last month are different readings;
// the card must not stamp one date on both.
import { useMemo } from 'react'
import type { Observation, VitalReading, VitalsView, ObsComponent } from '../types'
import { VITAL } from '../types'
import {
  pickLatestByVital,
  filterVitalSigns,
  matchesVital,
} from '../utils/observation-helpers'
import { formatQuantity } from '../utils/fhir-helpers'
import { isAdultPreventiveHealthExamResource } from '@/src/shared/utils/observation-provenance.utils'
import { readingDay } from '../utils/reading-dates'

function effectiveOf(o?: Observation): string | undefined {
  return o?.effectiveDateTime || o?.effectivePeriod?.start || undefined
}

// Source-driven only: the bridge / MediCloud tag, never guessed from values.
function sourceOf(o?: Observation): Pick<VitalReading, 'sourceProgram'> {
  return isAdultPreventiveHealthExamResource(o) ? { sourceProgram: 'adult-preventive' } : {}
}

function sameMoment(a?: string, b?: string): boolean {
  if (!a || !b) return a === b
  const [ta, tb] = [Date.parse(a), Date.parse(b)]
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb
}

const EXAM_ANCHORS = new Set<VitalReading['key']>(['height', 'weight', 'bmi'])
const BLOOD_PRESSURE = new Set<VitalReading['key']>(['bp', 'bpSys', 'bpDia'])

function componentValue(c?: ObsComponent): string | null {
  return c?.valueQuantity?.value != null ? String(Math.round(Number(c.valueQuantity.value))) : null
}

export function useVitalsView(vitalSigns: any[]) {
  const vitalObservations = useMemo(() => filterVitalSigns(vitalSigns), [vitalSigns])

  return useMemo<VitalsView>(() => {
    const readings: VitalReading[] = []
    const addQuantity = (key: VitalReading['key'], o?: Observation) => {
      if (o?.valueQuantity) readings.push({ key, value: formatQuantity(o.valueQuantity), effective: effectiveOf(o), ...sourceOf(o) })
    }

    addQuantity('height', pickLatestByVital(vitalObservations, VITAL.HEIGHT))
    addQuantity('weight', pickLatestByVital(vitalObservations, VITAL.WEIGHT))
    addQuantity('bmi', pickLatestByVital(vitalObservations, VITAL.BMI))

    // Blood Pressure — try the panel first (LOINC + aliases + keywords),
    // fall back to individual systolic/diastolic Observations if no panel
    // exists (some vendors ship them separately).
    const bpPanel = pickLatestByVital(vitalObservations, VITAL.BP_PANEL)
    if (bpPanel?.component?.length) {
      const s = componentValue(bpPanel.component.find((c: ObsComponent) => matchesVital(c, VITAL.BP_SYS)))
      const d = componentValue(bpPanel.component.find((c: ObsComponent) => matchesVital(c, VITAL.BP_DIA)))
      if (s && d) readings.push({ key: 'bp', value: `${s}/${d} mmHg`, effective: effectiveOf(bpPanel), ...sourceOf(bpPanel) })
    } else {
      // Separate systolic / diastolic Observations make one blood pressure
      // only when they are the same measurement (same effective time). A 2026
      // systolic and a 2018 diastolic are two readings, each with its own date.
      const sObs = pickLatestByVital(vitalObservations, VITAL.BP_SYS)
      const dObs = pickLatestByVital(vitalObservations, VITAL.BP_DIA)
      const s = sObs?.valueQuantity?.value != null ? String(Math.round(Number(sObs.valueQuantity.value))) : null
      const d = dObs?.valueQuantity?.value != null ? String(Math.round(Number(dObs.valueQuantity.value))) : null
      if (s && d && sameMoment(effectiveOf(sObs), effectiveOf(dObs))) {
        readings.push({ key: 'bp', value: `${s}/${d} mmHg`, effective: effectiveOf(sObs), ...sourceOf(sObs) })
      } else {
        if (s) readings.push({ key: 'bpSys', value: `${s} mmHg`, effective: effectiveOf(sObs), ...sourceOf(sObs) })
        if (d) readings.push({ key: 'bpDia', value: `${d} mmHg`, effective: effectiveOf(dObs), ...sourceOf(dObs) })
      }
    }

    const hr = pickLatestByVital(vitalObservations, VITAL.HR)
    if (hr?.valueQuantity?.value != null) {
      readings.push({ key: 'hr', value: `${Math.round(Number(hr.valueQuantity.value))} bpm`, effective: effectiveOf(hr), ...sourceOf(hr) })
    }

    // A blood pressure taken the same day as a height / weight / BMI the source
    // tags 成人預防保健 belongs to that exam. The bridge builds its BP panel
    // without the source-program tag, so without this the exam's BP would sit
    // on a line of its own, unbadged. Owner decision 2026-09-28; blood pressure
    // only — other vitals still need their own tag.
    const examDays = new Set(
      readings
        .filter((r) => r.sourceProgram === 'adult-preventive' && EXAM_ANCHORS.has(r.key))
        .map((r) => readingDay(r.effective))
        .filter(Boolean),
    )
    for (const r of readings) {
      if (BLOOD_PRESSURE.has(r.key) && !r.sourceProgram && examDays.has(readingDay(r.effective))) {
        r.sourceProgram = 'adult-preventive'
      }
    }

    return { readings }
  }, [vitalObservations])
}
