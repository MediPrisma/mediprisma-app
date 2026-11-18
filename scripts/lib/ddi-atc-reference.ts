// See scripts/build-ddi-atc-reference.ts for what this table is and why.

export interface FormularyItem {
  udCode: string
  isActive: boolean
  atcCode: string | null
  route: string | null
  nhiCode: string | null
}

/** NHI drug-master rows: [code, …, ingredient text at 5, …, ATC at 9, …]. */
export type DictionaryRow = string[]

const firstWord = (text: string) => /^\s*([A-Z][A-Z-]*)/.exec(text.toUpperCase())?.[1] ?? ''

/**
 * ATC codes that name one substance in the NHI drug master: every product
 * filed under the code has a single ingredient, and the same one. Some WHO
 * groups below the combination range still hold different combinations
 * (R05FA01: codeine or dextromethorphan with expectorants), and the master
 * files a few products under a neighbouring substance's code; a cloud
 * prescription under such a code could be swapped for a different drug, so
 * those keep their own code and the ingredient-name check.
 */
export function singleSubstanceAtcCodes(rows: DictionaryRow[]): Set<string> {
  const words = new Map<string, Set<string>>()
  const mixed = new Set<string>()
  for (const row of rows) {
    const atc = row[9]?.trim().toUpperCase()
    if (!atc) continue
    if ((row[5] ?? '').includes('+')) mixed.add(atc)
    const set = words.get(atc) ?? new Set<string>()
    set.add(firstWord(row[5] ?? ''))
    words.set(atc, set)
  }
  return new Set([...words].filter(([atc, set]) => !mixed.has(atc) && set.size === 1 && !set.has('')).map(([atc]) => atc))
}

export function buildDdiAtcReference(items: FormularyItem[], dictionaryRows: DictionaryRow[]): Record<string, string> {
  const single = singleSubstanceAtcCodes(dictionaryRows)
  const chosen = new Map<string, FormularyItem>()
  for (const item of items) {
    const atc = item.atcCode?.trim().toUpperCase() ?? ''
    if (!item.isActive || item.udCode.startsWith('T') || !item.nhiCode) continue
    if (!/^[A-Z]\d\d[A-Z][A-Z]\d\d$/.test(atc) || Number(atc.slice(5)) >= 50 || !single.has(atc)) continue
    const current = chosen.get(atc)
    const oral = (candidate?: FormularyItem) => candidate?.route?.toUpperCase() === 'PO'
    // Deterministic: an oral product first, then the lowest NHI code.
    if (!current || (oral(item) && !oral(current))
      || (oral(item) === oral(current) && item.nhiCode < current.nhiCode!)) chosen.set(atc, item)
  }
  return Object.fromEntries([...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([atc, item]) => [atc, item.nhiCode!]))
}
