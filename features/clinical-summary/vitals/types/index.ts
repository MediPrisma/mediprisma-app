import type { Observation, CodeableConcept, Quantity, Coding, ObservationComponent } from '@/src/shared/types/fhir.types'

export type { Observation, CodeableConcept, Quantity, Coding, ObservationComponent }

// Type aliases for backward compatibility
export type ObsComponent = ObservationComponent
/** The measurements the patient tab shows. RR / Temp / SpO2 are realtime
 *  vitals whose historical value is not useful in this summary. */
export type VitalKey = 'height' | 'weight' | 'bmi' | 'bp' | 'bpSys' | 'bpDia' | 'hr'
export interface VitalReading {
  key: VitalKey
  value: string
  /** When this reading was taken, as the source wrote it (FHIR dateTime). */
  effective?: string
  /** Set only when the source tags the Observation as 成人預防保健. */
  sourceProgram?: 'adult-preventive'
}
export interface VitalsView {
  /** Latest reading per vital, in display order; vitals with no value are left out. */
  readings: VitalReading[]
}
export const LOINC = {
  HEIGHT: "8302-2",
  WEIGHT: "29463-7",
  BMI: "39156-5",
  BP_PANEL: "85354-9",
  BP_PANEL_ALT: "55284-4", // Alternative blood pressure panel code
  BP_SYS: "8480-6",
  BP_DIA: "8462-4",
  HR: "8867-4",
  RR: "9279-1",
  TEMP: "8310-5",
  SPO2: "59408-5",
}

/**
 * Vital sign matchers — LOINC stays the primary key, then optional fallbacks
 * for vendors that ship custom code systems (智群 OCTOFLOW uses
 * https://bestshape.example/mqtt/metric-code) or no codes at all.
 *
 * Keep keywords TIGHT — they're substring-matched and must NOT overlap
 * between vitals (e.g. don't put just "rate" anywhere because it matches
 * both heart-rate and respiratory-rate).
 */
import type { VitalDescriptor } from '../utils/observation-helpers'

export const VITAL: Record<
  | 'HEIGHT' | 'WEIGHT' | 'BMI' | 'BP_PANEL' | 'BP_SYS' | 'BP_DIA'
  | 'HR' | 'RR' | 'TEMP' | 'SPO2',
  VitalDescriptor
> = {
  HEIGHT: {
    loinc: LOINC.HEIGHT,
    aliasCodes: ['height', 'body-height', 'body_height'],
    displayKeywords: ['身高', 'body height', 'height (cm)'],
  },
  WEIGHT: {
    loinc: LOINC.WEIGHT,
    aliasCodes: ['weight', 'body-weight', 'body_weight'],
    displayKeywords: ['體重', 'body weight'],
  },
  BMI: {
    loinc: LOINC.BMI,
    aliasCodes: ['bmi', 'body-mass-index'],
    displayKeywords: ['body mass index', 'bmi'],
  },
  BP_PANEL: {
    loinc: [LOINC.BP_PANEL, LOINC.BP_PANEL_ALT],
    aliasCodes: ['blood-pressure', 'blood_pressure', 'bp-panel'],
    displayKeywords: ['血壓', 'blood pressure panel'],
  },
  BP_SYS: {
    loinc: LOINC.BP_SYS,
    aliasCodes: ['systolic', 'blood-pressure-systolic', 'sbp'],
    displayKeywords: ['收縮壓', 'systolic'],
  },
  BP_DIA: {
    loinc: LOINC.BP_DIA,
    aliasCodes: ['diastolic', 'blood-pressure-diastolic', 'dbp'],
    displayKeywords: ['舒張壓', 'diastolic'],
  },
  HR: {
    loinc: LOINC.HR,
    aliasCodes: ['heart-rate', 'heart_rate', 'pulse', 'pulse-rate'],
    displayKeywords: ['心率', '心跳', 'heart rate', 'pulse'],
  },
  RR: {
    loinc: LOINC.RR,
    aliasCodes: ['respiratory-rate', 'respiratory_rate', 'resp-rate'],
    displayKeywords: ['呼吸', '呼吸速率', 'respiratory rate', 'breathing rate'],
  },
  TEMP: {
    loinc: LOINC.TEMP,
    aliasCodes: ['body-temperature', 'body_temperature', 'temperature', 'temp'],
    displayKeywords: ['體溫', 'body temperature'],
  },
  SPO2: {
    loinc: LOINC.SPO2,
    aliasCodes: ['spo2', 'oxygen-saturation', 'spo-2'],
    displayKeywords: ['血氧', 'oxygen saturation', 'spo2'],
  },
}
