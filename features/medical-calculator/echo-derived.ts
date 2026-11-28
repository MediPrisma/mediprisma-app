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

/** LV mass in g by the ASE linear (cube) formula, from end-diastolic dimensions in mm. */
export function aseLvMass(lviddMm: number | undefined, ivsdMm: number | undefined, lvpwdMm: number | undefined): number | undefined {
  if (lviddMm === undefined || ivsdMm === undefined || lvpwdMm === undefined || !(lviddMm > 0) || !(ivsdMm > 0) || !(lvpwdMm > 0)) return undefined
  const [l, i, p] = [lviddMm / 10, ivsdMm / 10, lvpwdMm / 10]
  return 0.8 * 1.04 * ((l + i + p) ** 3 - l ** 3) + 0.6
}

/** Relative wall thickness, 2 × posterior wall / LV end-diastolic diameter. */
export function relativeWallThickness(lvpwdMm: number | undefined, lviddMm: number | undefined): number | undefined {
  if (lvpwdMm === undefined || lviddMm === undefined || !(lvpwdMm > 0) || !(lviddMm > 0)) return undefined
  return 2 * lvpwdMm / lviddMm
}
