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
