/** Units have already passed the analyte-specific conversion policy. Preserve
 * case for unknown units: a generic grouping rule must not invent equivalence. */
export function compactLabTrendUnit(unit: string | undefined): string {
  return unit?.normalize('NFKC').trim().replace(/\s+/g, '').replace(/μ/g, 'µ')
    // UCUM §31 / Table 5 defines both l and L as liter (verified 2026-10-16,
    // https://ucum.org/ucum). Fold only complete volume tokens, retaining
    // prefix case: mg/dl == mg/dL, but mU/L != MU/L and ml != Ml.
    .replace(/(^|\/)([fpnumcdhkMGTµ]?)l(?=\/|$)/g, '$1$2L') || ''
}

export function labTrendGroupKey(unit: string | undefined, specimen: string | undefined, categoryId: string): string {
  return JSON.stringify([
    compactLabTrendUnit(unit),
    categoryId === 'bloodgas' ? specimen?.normalize('NFKC').trim().toLowerCase() || '' : '',
  ])
}
