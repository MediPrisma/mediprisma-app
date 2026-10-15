// A medicine's short label for dense clinical rows: the NHI drug master's
// ingredient and strength ("ACETYLCYSTEINE 600 MG" → "Acetylcysteine 600 mg"),
// read from the governed terminology, never from the model. The full source
// name stays available wherever this label is shown.

const UNIT_CASE: Record<string, string> = {
  MG: 'mg', G: 'g', MCG: 'mcg', UG: 'mcg', ML: 'mL', L: 'L', MEQ: 'mEq', MMOL: 'mmol',
  IU: 'IU', U: 'U', KIU: 'kIU', MIU: 'MIU',
}

// Salt and form abbreviations keep their chemical casing.
const WORD_CASE: Record<string, string> = { HCL: 'HCl', HBR: 'HBr', NA: 'Na', K: 'K', CA: 'Ca', MG: 'Mg' }

const titleWord = (word: string): string =>
  WORD_CASE[word] ?? (/^[A-Z][A-Z-]*$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word)

/** Lower-cases the units of a strength ("500 MG/5 ML" → "500 mg/5 mL"). */
const strengthCase = (text: string): string =>
  text.replace(/[A-Za-zµμ]+/g, (unit) => UNIT_CASE[unit.toUpperCase()] ?? unit.toLowerCase())

/**
 * "ACETYLCYSTEINE 600 MG" → "Acetylcysteine 600 mg"; "SODIUM CHLORIDE 0.9 %"
 * → "Sodium Chloride 0.9 %". A combination ("AMLODIPINE 5 MG; VALSARTAN 80
 * MG") keeps every component. Text that is not an upper-case ingredient list
 * is returned trimmed, unchanged.
 */
export function formatIngredientStrength(ingredientText: string | undefined): string | undefined {
  const text = ingredientText?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text
    // Components join with ";" or, in the NHI master, "+" right after a
    // strength ("3.2 MG/ML+POTASSIUM CHLORIDE 1.4 MG/ML"); "SENNOSIDE A+B" is
    // one name.
    .split(/\s*[;；]\s*|(?<=[\d%A-Za-z)])\s*\+\s*(?=[A-Za-z]{2,})/)
    .map((part) => {
      // A strength may open on a bare decimal point (".1 MG" → "0.1 mg").
      const match = part.match(/^(.*?[A-Za-z)])\s+(\.?\d[\s\S]*)$/)
      // The master sometimes appends synonyms: "OXYBUTYNIN CHLORIDE (=OXIBUTININA
      // HCL=…"; the first name is the one shown.
      const name = (match ? match[1] : part).replace(/\s*\(=.*$/, '')
      if (!match) return name.split(' ').map(titleWord).join(' ')
      const strength = match[2].replace(/(^|[^\d])\.(\d)/g, '$10.$2')
      return `${name.split(' ').map(titleWord).join(' ')} ${strengthCase(strength)}`
    })
    .join(' + ')
}
