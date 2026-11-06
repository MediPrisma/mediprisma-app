/**
 * Key shared by the VGH hospital medication index generator
 * (scripts/build-vghtpe-medication-index.ts) and the app.
 *
 * A hospital product name is compared exactly except for typography: Unicode
 * width, the bridge's HTML entities, letter case and whitespace. Every other
 * character stays significant; `*`, `#` and quoted manufacturer text tell
 * different hospital items apart.
 */
export function hospitalMedicationNameKey(name: string): string {
  return name.normalize('NFKC')
    .replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&amp;/gi, '&')
    .replace(/\s+/g, '').toLowerCase()
}

/** App-derived mark on a VGH hospital MedicationRequest checked against the
 * index: the index source it was checked with and, when its recorded product
 * name has one drug identity, every NHI code of that identity and the
 * identity's NHI drug-master ingredient text. It never becomes the order's own
 * coding; reconciliation reads the codes, the hospital name resolver the
 * ingredient. */
export const VGHTPE_MEDICATION_IDENTITY_URL =
  'https://mediprisma.app/fhir/StructureDefinition/vghtpe-medication-identity'

export function vghtpeMedicationIdentityExtension(indexSha256: string, nhiCodes: readonly string[], ingredientText?: string) {
  return { url: VGHTPE_MEDICATION_IDENTITY_URL, extension: [{ url: 'index', valueString: indexSha256 },
    ...nhiCodes.map(code => ({ url: 'nhiCode', valueCode: code })),
    ...(nhiCodes.length && ingredientText ? [{ url: 'ingredient', valueString: ingredientText }] : [])] }
}

const identityMark = (order: { extension?: any[] }) => {
  const marks = (order.extension ?? []).filter(extension => extension?.url === VGHTPE_MEDICATION_IDENTITY_URL)
  return marks.length === 1 ? marks[0] : undefined
}
const markPart = (mark: any, url: string) => (mark?.extension ?? []).find((part: any) => part?.url === url)

/** A mark with an identity but no ingredient predates the ingredient and is
 * checked again, so charts saved before it read the same as new imports. */
export function hasVghtpeMedicationIdentityCheck(order: { extension?: any[] }): boolean {
  const mark = identityMark(order)
  return !!mark && (!markPart(mark, 'nhiCode') || !!markPart(mark, 'ingredient'))
}

/** An identity mark whose NHI codes were already checked for one shared ATC
 * code (see the drug terminology enrichment). Marks without codes need none. */
export function hasVghtpeMedicationAtcCheck(order: { extension?: any[] }): boolean {
  const mark = identityMark(order)
  return !mark || !markPart(mark, 'nhiCode') || !!markPart(mark, 'atcCheck')
}

export function vghtpeMedicationIdentityIngredient(order: { extension?: any[] }): { ingredientText: string; indexSha256?: string } | undefined {
  const mark = identityMark(order)
  const ingredientText = markPart(mark, 'ingredient')?.valueString?.trim()
  return ingredientText ? { ingredientText, indexSha256: markPart(mark, 'index')?.valueString } : undefined
}

export function vghtpeMedicationIdentityCodes(order: { extension?: any[] }): Set<string> | undefined {
  const mark = identityMark(order)
  if (!mark) return undefined
  const codes = (mark.extension ?? []).filter((part: any) => part?.url === 'nhiCode' && part.valueCode)
    .map((part: any) => String(part.valueCode).trim().toUpperCase())
  return codes.length ? new Set(codes) : undefined
}
