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
 * name has one drug identity, every NHI code of that identity. It never
 * becomes the order's own coding; reconciliation alone reads the codes. */
export const VGHTPE_MEDICATION_IDENTITY_URL =
  'https://mediprisma.app/fhir/StructureDefinition/vghtpe-medication-identity'

export function vghtpeMedicationIdentityExtension(indexSha256: string, nhiCodes: readonly string[]) {
  return { url: VGHTPE_MEDICATION_IDENTITY_URL, extension: [{ url: 'index', valueString: indexSha256 },
    ...nhiCodes.map(code => ({ url: 'nhiCode', valueCode: code }))] }
}

export function hasVghtpeMedicationIdentityCheck(order: { extension?: any[] }): boolean {
  return (order.extension ?? []).some(extension => extension?.url === VGHTPE_MEDICATION_IDENTITY_URL)
}

export function vghtpeMedicationIdentityCodes(order: { extension?: any[] }): Set<string> | undefined {
  const marks = (order.extension ?? []).filter(extension => extension?.url === VGHTPE_MEDICATION_IDENTITY_URL)
  if (marks.length !== 1) return undefined
  const codes = (marks[0].extension ?? []).filter((part: any) => part?.url === 'nhiCode' && part.valueCode)
    .map((part: any) => String(part.valueCode).trim().toUpperCase())
  return codes.length ? new Set(codes) : undefined
}
