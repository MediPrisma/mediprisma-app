// Medical Calculator — unit conversion
//
// Auto-fill values arrive in whatever unit the source lab reported. Each
// calculator input declares a `dimension` (the analyte's measurement family)
// and its expected/base unit is the conventional (US / Taiwan) unit the
// formula assumes. This module converts a source value into that base unit.
//
// Factors are expressed relative to the BASE (expected) unit = 1. Conversion
// is `value × factor[sourceUnit]`. A factor of 1 (e.g. mEq/L ↔ mmol/L for a
// monovalent electrolyte, or 10³/µL ↔ 10⁹/L for platelets) means the units are
// interchangeable — no numeric change, no warning.

import type { ConvertDim } from './types'

/** Normalize a unit string for lookup: lowercase, strip spaces, µ/μ → u, and
 *  collapse the many ways an exponent is written (10⁹, 10*9, 10e9, x10^9) to a
 *  single `10^9` form. */
/** UCUM spellings of the same vital-sign unit (FHIR sends 「Cel」, 「/min」). */
const UNIT_ALIASES: Record<string, string> = { 'mm[hg]': 'mmhg', cel: '°c', degc: '°c', '℃': '°c', '[degf]': '°f', degf: '°f', '℉': '°f', '/min': 'bpm', '{beats}/min': 'bpm', 'beats/min': 'bpm', '{breaths}/min': 'bpm', 'breaths/min': 'bpm' }

export function normUnit(u: string | undefined): string {
  const unit = normUnitSpelling(u)
  return UNIT_ALIASES[unit] ?? unit
}

function normUnitSpelling(u: string | undefined): string {
  return (u || '')
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, '')
    .replace(/·/g, '')
    // Superscript exponent → `^<digit>` (10⁹ → 10^9), so the caret is preserved.
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => '^' + '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)])
    .replace(/10\*/g, '10^') // 10*9/l → 10^9/l
    .replace(/10e/g, '10^') // 10e9/l → 10^9/l
    .replace(/x10\^/g, '10^') // x10^9/l → 10^9/l
    .replace(/\^\^/g, '^') // guard against a doubled caret
    .replace(/^x/, '')
    .trim()
}

/** Source-unit → factor to the dimension's base (expected) unit. */
const FACTORS: Record<ConvertDim, Record<string, number>> = {
  // Indexed eGFR only; absolute mL/min is deliberately not interchangeable.
  egfr: { 'ml/min/1.73m^2': 1, 'ml/min/1.73m2': 1, 'ml/min/{1.73_m2}': 1 },
  // Monovalent electrolytes: mmol/L ≡ mEq/L (Na, K, Cl, HCO₃/CO₂).
  electrolyte: { 'mmol/l': 1, 'meq/l': 1 },
  // Creatinine: base mg/dL. 1 mg/dL = 88.42 µmol/L.
  creatinine: { 'mg/dl': 1, 'umol/l': 1 / 88.42, 'mmol/l': 1000 / 88.42 },
  // Bilirubin: base mg/dL. 1 mg/dL = 17.104 µmol/L.
  bilirubin: { 'mg/dl': 1, 'umol/l': 1 / 17.104 },
  // Calcium: base mg/dL. 1 mmol/L = 4.008 mg/dL; 1 mEq/L = 2.004 mg/dL.
  calcium: { 'mg/dl': 1, 'mmol/l': 4.008, 'meq/l': 2.004 },
  // Glucose: base mg/dL. 1 mmol/L = 18.016 mg/dL.
  glucose: { 'mg/dl': 1, 'mmol/l': 18.016 },
  // Albumin: base g/dL. 1 g/dL = 10 g/L.
  albumin: { 'g/dl': 1, 'g/l': 0.1 },
  // Aminotransferases: U/L ≡ IU/L.
  enzyme: { 'u/l': 1, 'iu/l': 1 },
  // BUN: base mg/dL. 1 mmol/L urea = 2.8 mg/dL BUN (nitrogen).
  bun: { 'mg/dl': 1, 'mmol/l': 2.8 },
  // Cholesterol (TC/HDL/LDL): base mg/dL. 1 mmol/L = 38.67 mg/dL.
  cholesterol: { 'mg/dl': 1, 'mmol/l': 38.67 },
  // Triglyceride: base mg/dL. 1 mmol/L = 88.57 mg/dL.
  triglyceride: { 'mg/dl': 1, 'mmol/l': 88.57 },
  // Ethanol: base mg/dL. 1 mmol/L = 4.61 mg/dL.
  ethanol: { 'mg/dl': 1, 'mmol/l': 4.61 },
  // Platelets: base 10⁹/L ≡ 10³/µL ≡ 1000/µL ≡ K/µL. Raw /µL is ×1000.
  platelets: { '10^9/l': 1, '10^3/ul': 1, '1000/ul': 1, 'k/ul': 1, '/ul': 0.001, '10^6/ul': 1000 },
  // WBC: same cell-count units as platelets (10⁹/L ≡ 10³/µL ≡ K/µL).
  wbc: { '10^9/l': 1, '10^3/ul': 1, '1000/ul': 1, 'k/ul': 1, '/ul': 0.001 },
  // Weight: base kg.
  weight: { kg: 1, g: 0.001, lb: 0.453592, lbs: 0.453592 },
  // Height: base cm.
  height: { cm: 1, m: 100, in: 2.54, inch: 2.54, '"': 2.54 },
  // Blood-gas partial pressure: base mmHg. 1 kPa = 7.500617 mmHg.
  pressure: { mmhg: 1, 'mm[hg]': 1, kpa: 7.500617, 'k[pa]': 7.500617 },
  // Osmolality: base mOsm/kg. 1 Osm/kg = 1000 mOsm/kg (mOsm/L ≈ mOsm/kg for plasma).
  osmolality: { 'mosm/kg': 1, 'osm/kg': 1000, 'mosm/l': 1, 'osm/l': 1000, 'mosm/kgh2o': 1 },
  // Hemoglobin: base g/dL. 1 g/L = 0.1 g/dL; 1 mmol/L = 1.6113 g/dL.
  hemoglobin: { 'g/dl': 1, 'g/l': 0.1, 'mmol/l': 1.6113 },
  // FiO₂: base %. A fraction (0.21) → percent (21%); unit "1" or "fraction".
  fio2: { '%': 1, '1': 100, fraction: 100 },
  // ECG interval: base ms. UCUM 「s」 is seconds.
  duration: { ms: 1, s: 1000, sec: 1000 },
  // Body temperature: base °C. °F is converted in convertToBase (not a factor).
  temperature: { '°c': 1 },
  // Urine albumin/creatinine ratio: base mg/g.
  // 1 mg/mmol ≈ 8.84 mg/g; µg/mg and mcg/mg are numerically equivalent to mg/g.
  'albumin-creatinine-ratio': {
    'mg/g': 1,
    'mg/g{creat}': 1,
    'mg/gcreat': 1,
    'mg/gcreatinine': 1,
    'ug/mg': 1,
    'ug/mg{creat}': 1,
    'ug/mgcreat': 1,
    'ug/mgcreatinine': 1,
    'mcg/mg': 1,
    'mcg/mgcreatinine': 1,
    'mg/mmol': 8.84,
    'mg/mmol{creat}': 8.84,
    'mg/mmolcreat': 8.84,
    'mg/mmolcreatinine': 8.84,
  },
}

export interface UnitConversion {
  /** Value in the expected/base unit. */
  value: number
  /** True when the numeric value actually changed (source unit ≠ base unit). */
  changed: boolean
}

/**
 * Convert `value` from `fromUnit` into the base unit of `dimension`.
 * Returns null when the calculator input has no dimension, or the source unit
 * is unrecognized for that dimension (→ caller keeps the raw value and warns).
 */
export function convertToBase(
  value: number,
  fromUnit: string | undefined,
  dimension: ConvertDim | undefined,
): UnitConversion | null {
  if (!dimension) return null
  if (dimension === 'temperature' && normUnit(fromUnit) === '°f') return { value: (value - 32) * 5 / 9, changed: true }
  const table = FACTORS[dimension]
  if (!table) return null
  const factor = table[normUnit(fromUnit)]
  if (factor === undefined) return null
  const converted = value * factor
  return { value: converted, changed: Math.abs(converted - value) > 1e-9 }
}
