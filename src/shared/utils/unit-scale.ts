// UCUM scale normalisation for the CUMULATIVE lab report only.
//
// The NHI 健保存摺 bridge faithfully passes each source lab's unit, so the SAME
// analyte arrives at different scales across hospitals/dates:
//   • blood counts — WBC as "K/µL" (~5) vs raw "/µL" (~5600), RBC "M/µL" (~4) vs
//     "x10^4/µL" (~400);
//   • CRP — "mg/dL" (~0.5) at one hospital vs "mg/L" (~5) at another (×10).
//   • urine microalbumin — "mg/dL" at one hospital vs "mg/L" at another (×10).
// Sources also use equivalent display spellings such as fL/fl, pg/pg/Cell,
// ASCII/full-width percent, mmol/L/mEq/L (for monovalent Na/K), and U/L/IU/L
// (for AST/ALT).
// In one cumulative-report column that reads as "0.5 next to 5", which is
// meaningless. We convert or relabel positively recognised analyte/unit pairs
// to one canonical column unit. The sole missing-unit default is the explicitly
// approved body-surface-area-normalised eGFR display unit.
//
// SCOPED TO THE CUMULATIVE REPORT: the raw row-by-row report keeps each value in
// its source unit. We only rescale units we positively recognise; anything else
// is returned untouched, so a unit we don't understand is never silently mangled.

export interface NormalizedValue {
  value: number
  unit: string
}

export interface UnitNormalizationContext {
  loincCode?: string
}

function compactUnit(rawUnit: string | undefined | null): string | null {
  if (!rawUnit) return null
  const compact = String(rawUnit)
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
  return compact || null
}

function aliasScale(
  rawUnit: string | undefined | null,
  aliases: ReadonlySet<string>,
): number | null {
  const compact = compactUnit(rawUnit)
  return compact && aliases.has(compact) ? 1 : null
}

const FEMTOLITRE_ALIASES = new Set(['fl'])
const MCH_ALIASES = new Set(['pg', 'pg/cell'])
const PERCENT_ALIASES = new Set(['%'])
const MONOVALENT_ELECTROLYTE_ALIASES = new Set(['mmol/l', 'meq/l'])
const AMINOTRANSFERASE_ACTIVITY_ALIASES = new Set(['u/l', 'iu/l', '[iu]/l', 'unit/l', 'units/l'])
const EGFR_ALIASES = new Set([
  'ml/min/1.73m2',
  'ml/min/1.73.m2',
  'ml/min/1.73m^2',
  'ml/min/{1.73_m2}',
])

function femtolitreScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, FEMTOLITRE_ALIASES)
}

function mchScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, MCH_ALIASES)
}

function percentScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, PERCENT_ALIASES)
}

function monovalentElectrolyteScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, MONOVALENT_ELECTROLYTE_ALIASES)
}

function aminotransferaseActivityScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, AMINOTRANSFERASE_ACTIVITY_ALIASES)
}

function egfrScale(rawUnit: string | undefined | null): number | null {
  return aliasScale(rawUnit, EGFR_ALIASES)
}

/**
 * Scale of a count-per-microlitre unit relative to "/µL" = 1. Returns null for
 * anything that is NOT a recognised count-per-µL unit. Handles the spelling /
 * notation variants the bridge emits:
 *   /µL · k/µL · K/µL · 1000/µL · *1000/µL · x10^3/µL · 10^3/µL
 *   x10^4/µL · M/µL · million/µL · *10^6/µL · 10^6/µL
 */
export function cellConcScale(rawUnit: string | undefined | null): number | null {
  if (!rawUnit) return null
  const u = String(rawUnit).toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'u')
  if (!u.endsWith('/ul')) return null
  const p = u.slice(0, -3).replace(/[*x×·^]/g, '')
  if (p === '') return 1
  if (p === 'k') return 1e3
  if (p === '1000' || p === '103') return 1e3
  if (p === '104') return 1e4
  if (p === 'm' || p === 'million') return 1e6
  if (p === '106') return 1e6
  return null
}

/**
 * Scale of a mass-per-volume unit relative to "mg/L" = 1. Returns null for
 * anything not recognised. Note 1 mg/dL = 10 mg/L (dL is 1/10 L).
 */
export function massConcScale(rawUnit: string | undefined | null): number | null {
  if (!rawUnit) return null
  const u = String(rawUnit).toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'u')
  if (u === 'mg/l') return 1
  if (u === 'mg/dl') return 10
  if (u === 'g/l') return 1000
  if (u === 'g/dl') return 10000
  return null
}

// MCHC sources sometimes spell grams of haemoglobin as "gHb". In an MCHC
// column that is the same mass-concentration quantity as g/dL. Keep this
// analyte-specific: "Hb" must never be stripped from arbitrary units.
function mchcMassConcScale(rawUnit: string | undefined | null): number | null {
  const compact = compactUnit(rawUnit)
  if (compact === 'ghb/l') return 1000
  if (compact === 'ghb/dl') return 10000
  return massConcScale(rawUnit)
}

// Per-analyte canonical unit + which family's scale factor to use, keyed by
// canonical testKey. Add a line here as the multi-hospital data surfaces new
// scale-mixed analytes (e.g. ANC / reticulocyte → cellConcScale).
const UNIT_NORMALIZATION: Record<
  string,
  {
    unit: string
    scale: number
    scaleOf: (u: string | undefined | null) => number | null
    defaultWhenMissing?: boolean
    defaultWhenMissingLoincCodes?: ReadonlySet<string>
  }
> = {
  WBC: { unit: 'K/µL', scale: 1e3, scaleOf: cellConcScale },
  RBC: { unit: 'M/µL', scale: 1e6, scaleOf: cellConcScale },
  PLT: { unit: 'K/µL', scale: 1e3, scaleOf: cellConcScale },
  MCV: { unit: 'fL', scale: 1, scaleOf: femtolitreScale },
  MCH: { unit: 'pg', scale: 1, scaleOf: mchScale },
  MCHC: { unit: 'g/dL', scale: 10000, scaleOf: mchcMassConcScale },
  // Na+ and K+ are monovalent, so mmol/L and mEq/L have the same numeric value.
  // This equivalence is intentionally scoped to these two analytes.
  NA: { unit: 'mmol/L', scale: 1, scaleOf: monovalentElectrolyteScale },
  K: { unit: 'mmol/L', scale: 1, scaleOf: monovalentElectrolyteScale },
  // AST/ALT reports commonly use U/L and IU/L interchangeably. Keep this
  // equivalence scoped to aminotransferases; International Units are not
  // globally interchangeable with every activity unit.
  AST: { unit: 'U/L', scale: 1, scaleOf: aminotransferaseActivityScale },
  ALT: { unit: 'U/L', scale: 1, scaleOf: aminotransferaseActivityScale },
  // LOINC 788-0 is RDW-CV (percentage). Some health-record exports omit its
  // Quantity unit; only that verified LOINC may receive the missing-unit
  // default. Other RDW forms, such as RDW-SD in fL, must remain untouched.
  RDW: {
    unit: '%',
    scale: 1,
    scaleOf: percentScale,
    defaultWhenMissingLoincCodes: new Set(['788-0']),
  },
  // Adult health-check eGFR feeds may omit the unit even though the observation
  // is explicitly an eGFR analyte. The user-approved cumulative-report display
  // default is the body-surface-area-normalised unit below.
  'EGFR(M)': {
    unit: 'mL/min/1.73m²',
    scale: 1,
    scaleOf: egfrScale,
    defaultWhenMissing: true,
  },
  'EGFR(EPI)': {
    unit: 'mL/min/1.73m²',
    scale: 1,
    scaleOf: egfrScale,
    defaultWhenMissing: true,
  },
  'EGFR(PED)': {
    unit: 'mL/min/1.73m²',
    scale: 1,
    scaleOf: egfrScale,
    defaultWhenMissing: true,
  },
  EGFR: {
    unit: 'mL/min/1.73m²',
    scale: 1,
    scaleOf: egfrScale,
    defaultWhenMissing: true,
  },
  // CRP: mg/dL is the Taiwan-common unit; mg/L (international / hs-CRP) values
  // are ÷10 onto it. (mg/L base = 1, mg/dL = 10.)
  CRP: { unit: 'mg/dL', scale: 10, scaleOf: massConcScale },
  // Urine microalbumin: keep one scale across institutions so a source value of
  // 271.3 mg/L is displayed as 27.13 mg/dL in the cumulative MALB column.
  MALB: { unit: 'mg/dL', scale: 10, scaleOf: massConcScale },
}

// Round off float noise from the ×10^n conversion (5600/1000 = 5.6), ~4 sig figs.
function tidy(n: number): number {
  if (!isFinite(n) || n === 0) return n
  const d = Math.max(0, Math.min(6, 4 - Math.ceil(Math.log10(Math.abs(n)))))
  return Number(n.toFixed(d))
}

/**
 * If `testKey` is configured and `rawUnit` is recognised for that analyte,
 * return the value in its canonical unit. The approved eGFR keys may also
 * receive their display unit when the source omits one. Otherwise return null
 * so the caller keeps the original value/unit untouched.
 */
export function normalizeAnalyteUnit(
  testKey: string | undefined,
  value: number,
  rawUnit: string | undefined | null,
  context?: UnitNormalizationContext,
): NormalizedValue | null {
  if (!testKey) return null

  // Percent is dimensionless. NFKC folding in percentScale makes the ASCII
  // percent sign and its full-width presentation form one display unit for any
  // numeric analyte, without changing the value.
  if (percentScale(rawUnit) !== null) {
    return { value: tidy(value), unit: '%' }
  }

  const cfg = UNIT_NORMALIZATION[testKey.toUpperCase()]
  if (!cfg) return null
  const unitMissing = rawUnit === undefined || rawUnit === null || String(rawUnit).trim() === ''
  const canDefaultMissingUnit = cfg.defaultWhenMissing
    || (
      !!context?.loincCode
      && !!cfg.defaultWhenMissingLoincCodes?.has(context.loincCode)
    )
  if (unitMissing && canDefaultMissingUnit) {
    return { value: tidy(value), unit: cfg.unit }
  }
  const rawScale = cfg.scaleOf(rawUnit)
  if (rawScale === null) return null
  return { value: tidy(value * (rawScale / cfg.scale)), unit: cfg.unit }
}
