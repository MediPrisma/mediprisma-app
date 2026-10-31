import { splitIngredients } from '@/src/core/utils/ingredient-name.utils'

/**
 * Keys shared by the VGH hospital medication index generator
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

const MICROGRAM_UNITS = new Set(['MCG', 'UG', 'µG'])
const GRAM_UNITS = new Set(['G', 'GM'])

function amount(value: string, unit: string, per?: string, perUnit?: string): string {
  let number = Number(value)
  let canonical = unit
  if (MICROGRAM_UNITS.has(unit)) { number /= 1000; canonical = 'MG' }
  else if (GRAM_UNITS.has(unit)) { number *= 1000; canonical = 'MG' }
  const rounded = Math.round(number * 1e6) / 1e6
  if (!perUnit) return `${rounded}${canonical}`
  const perValue = per ? Number(per) : 1
  return `${Math.round((number / perValue) * 1e6) / 1e6}${canonical}/${GRAM_UNITS.has(perUnit) ? 'G' : perUnit}`
}

/** Every drug amount written in one ingredient component, canonical units. */
function componentStrengths(text: string): string[] {
  const upper = text.normalize('NFKC').toUpperCase().replace(/\([^)]*\)/g, ' ')
  const pattern = /(?<![\d.])(\d+(?:\.\d+)?|\.\d+)\s*(MCG|UG|µG|MG|GM|G|IU|U|%)(?![A-Z])(?:\s*\/\s*(\d+(?:\.\d+)?|\.\d+)?\s*(ML|GM|G|L)(?![A-Z]))?/g
  return [...upper.matchAll(pattern)].map(match => amount(match[1], match[2], match[3], match[4]))
}

/**
 * Ingredient identity of an NHI drug-master ingredient text: the normalized
 * ingredient names (salts, hydrates and synonyms dropped) with every drug
 * amount, so "CLINDAMYCIN HCL 150 MG" and "CLINDAMYCIN (HCL HYDRATE) 150 MG"
 * agree while 10 MG and 20 MG never do. Undefined without a name or amount.
 */
export function ingredientIdentityKey(text: string): string | undefined {
  const components = text.split('+')
  const names = splitIngredients(text)
  const strengths = components.flatMap(componentStrengths)
  if (!names.length || names.length !== components.length || names.some(name => !/^[a-z]/.test(name)) || !strengths.length) return undefined
  return `${[...names].sort().join('+')}|${[...strengths].sort().join('+')}`
}
