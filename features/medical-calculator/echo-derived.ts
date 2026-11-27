// Values derived from echo measurements and body size. Pure functions, no rounding:
// thresholds are judged on the exact value and only the displayed row is rounded.

/** Du Bois & Du Bois (1916) body surface area in m², from height in cm and weight in kg. */
export function duBoisBsa(heightCm: number | undefined, weightKg: number | undefined): number | undefined {
  if (heightCm === undefined || weightKg === undefined) return undefined
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) return undefined
  return 0.007184 * weightKg ** 0.425 * heightCm ** 0.725
}

/** A raw measurement (LA volume, LV mass) divided by BSA, e.g. LAVI or LVMI. */
export function indexToBsa(raw: number | undefined, bsa: number | undefined): number | undefined {
  if (raw === undefined || bsa === undefined || !(raw > 0) || !(bsa > 0)) return undefined
  return raw / bsa
}
