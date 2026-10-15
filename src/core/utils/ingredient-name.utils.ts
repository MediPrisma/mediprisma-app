// One spelling for an ingredient across the NHI drug master's ingredient text,
// shared by the table generator (scripts/build-drug-mechanism-table.ts) and the
// app, so a combination product's ingredients find the same entries.

// Salt, ester and hydrate words that follow the base name ("CHLORPHENIRAMINE
// MALEATE 5 MG"). The first word is never dropped, so "POTASSIUM CHLORIDE"
// keeps "potassium".
// "Butylbromide" and "methylbromide" are not salts here: butylscopolamine and
// methscopolamine are other medicines than scopolamine.
const SALT_WORDS = new Set([
  'acetate', 'anhydrous', 'besilate', 'besylate', 'bisulfate', 'bitartrate', 'bromide', 'butyrate',
  'calcium', 'chloride', 'citrate', 'decanoate', 'dihydrate', 'dihydrobromide', 'dihydrochloride',
  'dimaleate', 'dipotassium', 'dipropionate', 'disodium', 'edisylate', 'embonate', 'enanthate', 'fumarate',
  'gluconate', 'hbr', 'hcl', 'hemifumarate', 'hemihydrate', 'hemitartrate', 'hydrate', 'hydrobromide',
  'hydrochloride', 'hydrogen', 'hyclate', 'lactate', 'magnesium', 'maleate', 'malate', 'mesilate',
  'mesylate', 'monohydrate', 'monohydrochloride', 'monosodium', 'napsylate', 'nitrate', 'oxalate',
  'palmitate', 'pamoate', 'phosphate', 'potassium', 'propionate', 'sesquihydrate', 'sodium', 'succinate',
  'sulfate', 'sulphate', 'tartrate', 'tosylate', 'trihydrate', 'trihydrochloride', 'valerate',
])

/** "BUTYLSCOPOLAMINE BROMIDE (=HYOSCINE BUTYLBROMIDE) 10 MG" → "butylscopolamine";
 *  "METHYLEPHEDRINE DL- HCL .25 MG/ML" → "methylephedrine". */
export function normalizeIngredient(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    // A synonym whose bracket never closes: "OXYBUTYNIN CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG".
    .replace(/\(.*$/, ' ')
    // The strength, written "10 MG" or ".25 MG/GM", ends the name.
    .replace(/\s+\.?\d.*$/, '')
    // Stereo prefixes: "DL-METHIONINE", "ARGININE L-".
    .replace(/(^|\s)(dl|d|l)-/g, ' ')
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return words.filter((word, i) => i === 0 || !SALT_WORDS.has(word)).join(' ')
}

/** The ingredients of a combination product ("A 5 MG+B 10 MG"), normalized;
 *  one entry for a single-ingredient product. */
export const splitIngredients = (text: string): string[] =>
  text.split('+').map(normalizeIngredient).filter(Boolean)
