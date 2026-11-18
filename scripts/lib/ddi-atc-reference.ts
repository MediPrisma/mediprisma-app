// See scripts/build-ddi-atc-reference.ts for what this table is and why.

export interface FormularyItem {
  udCode: string
  isActive: boolean
  atcCode: string | null
  route: string | null
  nhiCode: string | null
}

export function buildDdiAtcReference(items: FormularyItem[]): Record<string, string> {
  const chosen = new Map<string, FormularyItem>()
  for (const item of items) {
    const atc = item.atcCode?.trim().toUpperCase() ?? ''
    if (!item.isActive || item.udCode.startsWith('T') || !item.nhiCode) continue
    if (!/^[A-Z]\d\d[A-Z][A-Z]\d\d$/.test(atc) || Number(atc.slice(5)) >= 50) continue
    const current = chosen.get(atc)
    const oral = (candidate?: FormularyItem) => candidate?.route?.toUpperCase() === 'PO'
    // Deterministic: an oral product first, then the lowest NHI code.
    if (!current || (oral(item) && !oral(current))
      || (oral(item) === oral(current) && item.nhiCode < current.nhiCode!)) chosen.set(atc, item)
  }
  return Object.fromEntries([...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([atc, item]) => [atc, item.nhiCode!]))
}
