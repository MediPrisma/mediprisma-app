// Builds public/terminology/icd10cm-to-icd9cm-gem-2018.json from the public
// CMS files (U.S. government works, no copyright):
//   2018 ICD-10-CM General Equivalence Mappings  -> 2018_I10gem.txt
//   ICD-9-CM v32 master descriptions             -> CMS32_DESC_LONG_DX.txt
// Download:
//   https://www.cms.gov/Medicare/Coding/ICD10/Downloads/2018-ICD-10-CM-General-Equivalence-Mappings.zip
//   https://www.cms.gov/Medicare/Coding/ICD9ProviderDiagnosticCodes/Downloads/ICD-9-CM-v32-master-descriptions.zip
// Usage: node scripts/build-icd9-crosswalk.mjs <dir containing both txt files>
//
// Every GEM row is kept with its five flags (approximate, no map, combination,
// scenario, choice list); src/core/utils/icd-code-reference.utils.ts
// interprets them. Dropping the flags turns alternatives and combinations into
// one flat "equivalent" list, which is wrong for both.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in step with ICD_CROSSWALK_VERSION in icd-code-reference.utils.ts.
const VERSION = 2

const source = process.argv[2]
if (!source) throw Error('Usage: node scripts/build-icd9-crosswalk.mjs <cms-files-dir>')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const map = {}
for (const line of readFileSync(join(source, '2018_I10gem.txt'), 'utf8').split(/\r?\n/)) {
  const [from, to, flags] = line.trim().split(/\s+/)
  if (!from) continue
  if (!to || !/^[01]{3}\d{2}$/.test(flags ?? '')) throw Error(`Unexpected GEM row: ${line}`)
  // The 2018 file spells one target in lower case (T88.53XD -> v5889).
  const row = `${to === 'NoDx' ? to : to.toUpperCase()} ${flags}`
  const rows = (map[from] ??= [])
  if (!rows.includes(row)) rows.push(row)
}

const used = new Set(
  Object.values(map).flat().map((row) => row.split(' ')[0]).filter((code) => code !== 'NoDx'),
)
const names = {}
for (const line of readFileSync(join(source, 'CMS32_DESC_LONG_DX.txt'), 'latin1').split(/\r?\n/)) {
  const match = /^(\S+)\s+(.+)$/.exec(line.trim())
  if (match && used.has(match[1])) names[match[1]] = match[2].trim()
}

const output = {
  version: VERSION,
  source: 'CMS 2018 ICD-10-CM to ICD-9-CM General Equivalence Mapping; ICD-9-CM v32 long descriptions',
  // Codes are stored without the decimal point, exactly as in the CMS files.
  // Each map value lists the GEM rows "<ICD-9-CM target> <flags>"; flags are
  // approximate, no map, combination, scenario, choice list.
  map,
  names,
}
const file = join(repoRoot, 'public', 'terminology', 'icd10cm-to-icd9cm-gem-2018.json')
writeFileSync(file, JSON.stringify(output))
console.log(JSON.stringify({
  icd10Codes: Object.keys(map).length,
  gemRows: Object.values(map).flat().length,
  icd9Codes: Object.keys(names).length,
  icd9CodesWithoutName: [...used].filter((code) => !names[code]),
  bytes: JSON.stringify(output).length,
}))
