/** Units have already passed the analyte-specific conversion policy. Preserve
 * case for unknown units: a generic grouping rule must not invent equivalence. */
export function compactLabTrendUnit(unit: string | undefined): string {
  return unit?.normalize('NFKC').trim().replace(/\s+/g, '').replace(/μ/g, 'µ') || ''
}

export function labTrendGroupKey(unit: string | undefined, specimen: string | undefined, categoryId: string): string {
  return JSON.stringify([
    compactLabTrendUnit(unit),
    categoryId === 'bloodgas' ? specimen?.normalize('NFKC').trim().toLowerCase() || '' : '',
  ])
}
